// e2e-lifecycle harness — float-lookup bridge (PLAN §3 S4, §2.5).
//
// The deployed orchestrator (`supabase/functions/orchestrator-tick/index.ts`) snapshots live DB
// state into the PURE `packages/core` float-lookup input, runs `findFloaters`, then writes each
// resulting `FloatAssignment` via `process_float_lookup_assignment`. This file replicates that
// snapshot/plan/write loop against the harness's `pg` superuser connection so a scenario can drive
// the *same* decision logic the orchestrator runs — but deterministically, in-transaction, with an
// injected `p_now` (we bypass `orchestrator-tick`, which reads the wall clock; PLAN §2.5).
//
// `planFloat` mirrors `buildFloatLookupSnapshot` + `findFloaters`; `applyPlan` mirrors the per-worker
// `process_float_lookup_assignment` calls in `floatLookupStep`. The gap-manufacturing + timing
// helpers below set up the deterministic fixtures S4's scenarios assert on.

import type { Client } from 'pg';

import {
  findFloaters,
  type FloatAssignment,
  type FloatLookupInput,
  type FloatLookupResult,
} from '../../packages/core/src/float-lookup/index.js';

const BLOCK_MS = 30 * 60 * 1000;
const FLOAT_STATUSES = ['pending_float_in', 'floated_in', 'pending_float_out', 'floated_out'];

export interface GapBlock {
  blockId: string;
  blockStartAt: Date;
  assignmentId: string;
}

export interface FloatPlan {
  input: FloatLookupInput;
  result: FloatLookupResult;
  destinationHouseId: string;
  destinationAssignmentByBlockId: Map<string, string>;
  sourceAssignmentByWorkerBlockId: Map<string, string>;
}

export interface WrittenFloat {
  assignment: FloatAssignment;
  sourceAssignmentIds: string[];
  destinationAssignmentIds: string[];
  rpc: { assigned: boolean; float_id?: string; reason?: string };
}

/**
 * Snapshot DB state for a destination gap into the float-lookup input and run the pure algorithm.
 * `gap` is the ordered set of vacant destination seats (one per gap block). Window + profile are
 * computed in Postgres (DST-safe); source rosters come from `float_routing` (the algorithm re-sorts
 * by precedence and re-enforces the Harnwell/Quad source invariants itself).
 */
export async function planFloat(
  db: Client,
  destinationHouseId: string,
  gap: GapBlock[],
): Promise<FloatPlan> {
  const blocks = [...gap].sort((a, b) => a.blockStartAt.getTime() - b.blockStartAt.getTime());
  const blockIds = blocks.map((b) => b.blockId);

  const meta = await db.query(
    `SELECT min(b.block_start_at)                          AS gap_start,
            max(b.block_start_at) + interval '30 minutes'  AS gap_end,
            (SELECT profile_name FROM operating_calendar
              WHERE date = (min(b.block_start_at) AT TIME ZONE 'America/New_York')::date) AS profile_name
       FROM shift_blocks b
      WHERE b.block_id = ANY($1::uuid[])`,
    [blockIds],
  );
  const gapStart: Date = meta.rows[0].gap_start;
  const gapEnd: Date = meta.rows[0].gap_end;
  const profileName: string = meta.rows[0].profile_name;

  const destinationAssignmentByBlockId = new Map<string, string>();
  const gapBlockByStartMs = new Map<number, string>();
  for (const b of blocks) {
    destinationAssignmentByBlockId.set(b.blockId, b.assignmentId);
    gapBlockByStartMs.set(b.blockStartAt.getTime(), b.blockId);
  }

  const routes = await db.query(
    `SELECT source_house_id, precedence_order
       FROM float_routing
      WHERE profile_name = $1 AND destination_house_id = $2
      ORDER BY precedence_order, source_house_id`,
    [profileName, destinationHouseId],
  );
  const sourceHouseIds = routes.rows.map((r) => r.source_house_id as string);

  const sourceAssignmentByWorkerBlockId = new Map<string, string>();
  const sources: FloatLookupInput['sources'] = [];

  if (sourceHouseIds.length > 0) {
    const srcRows = (
      await db.query(
        `SELECT b.house_id AS source_house_id, b.block_start_at, a.assignment_id, a.user_id,
                u.home_house_id, u.is_active,
                COALESCE((SELECT array_agg(r.role::text ORDER BY r.role)
                            FROM user_roles r WHERE r.user_id = a.user_id), ARRAY['sw']) AS roles
           FROM shift_block_assignments a
           JOIN shift_blocks b ON b.block_id = a.block_id
           JOIN users u ON u.user_id = a.user_id
          WHERE b.house_id = ANY($1::text[])
            AND a.status IN ('scheduled', 'claimed')
            AND b.block_start_at >= $2 AND b.block_start_at < $3`,
        [sourceHouseIds, gapStart, gapEnd],
      )
    ).rows;

    const userIds = [...new Set(srcRows.map((r) => r.user_id as string))];
    const conflict = new Map<string, { float: boolean; pickup: boolean }>();
    if (userIds.length > 0) {
      const crows = (
        await db.query(
          `SELECT a.user_id, a.status::text AS status, a.is_cross_house_pickup
             FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
            WHERE a.user_id = ANY($1::uuid[])
              AND b.block_start_at >= $2 AND b.block_start_at < $3`,
          [userIds, gapStart, gapEnd],
        )
      ).rows;
      for (const r of crows) {
        const c = conflict.get(r.user_id) ?? { float: false, pickup: false };
        if (FLOAT_STATUSES.includes(r.status)) c.float = true;
        if (r.is_cross_house_pickup === true) c.pickup = true;
        conflict.set(r.user_id, c);
      }
    }

    for (const route of routes.rows) {
      const houseId = route.source_house_id as string;
      const houseRows = srcRows.filter((r) => r.source_house_id === houseId);
      const effectiveHeadcountByBlockId: Record<string, number> = {};
      for (const b of blocks) effectiveHeadcountByBlockId[b.blockId] = 0;

      const coveredByUser = new Map<
        string,
        { covered: Array<{ gapBlockId: string; start: Date }>; meta: (typeof houseRows)[number] }
      >();
      for (const r of houseRows) {
        const gapBlockId = gapBlockByStartMs.get((r.block_start_at as Date).getTime());
        if (gapBlockId === undefined) continue;
        effectiveHeadcountByBlockId[gapBlockId] += 1;
        sourceAssignmentByWorkerBlockId.set(`${r.user_id}:${gapBlockId}`, r.assignment_id);
        const e = coveredByUser.get(r.user_id) ?? { covered: [], meta: r };
        e.covered.push({ gapBlockId, start: r.block_start_at });
        coveredByUser.set(r.user_id, e);
      }

      const candidates = [...coveredByUser.entries()].map(([userId, e]) => {
        const ordered = [...e.covered].sort((x, y) => x.start.getTime() - y.start.getTime());
        return {
          userId,
          homeHouseId: e.meta.home_house_id as string,
          roles: e.meta.roles as Array<'sw' | 'sm' | 'hm' | 'bm'>,
          isActive: e.meta.is_active as boolean,
          coveredGapBlockIds: ordered.map((o) => o.gapBlockId),
          shiftStartAt: ordered[0].start,
          shiftEndAt: new Date(ordered[ordered.length - 1].start.getTime() + BLOCK_MS),
          hasConflictingFloat: conflict.get(userId)?.float ?? false,
          hasConflictingCrossHousePickup: conflict.get(userId)?.pickup ?? false,
        };
      });

      sources.push({
        sourceHouseId: houseId,
        precedenceOrder: route.precedence_order as number,
        candidates,
        effectiveHeadcountByBlockId,
      });
    }
  }

  const exclusions = (
    await db.query(
      `SELECT user_id, destination_house_id, window_start_at, window_end_at
         FROM float_exclusions
        WHERE destination_house_id = $1 AND window_start_at < $2 AND window_end_at > $3`,
      [destinationHouseId, gapEnd, gapStart],
    )
  ).rows.map((r) => ({
    userId: r.user_id as string,
    destinationHouseId: r.destination_house_id as string,
    windowStartAt: r.window_start_at as Date,
    windowEndAt: r.window_end_at as Date,
  }));

  const input: FloatLookupInput = {
    gap: {
      destinationHouseId,
      blocks: blocks.map((b) => ({ blockId: b.blockId, blockStartAt: b.blockStartAt })),
    },
    sources,
    exclusions,
  };

  return {
    input,
    result: findFloaters(input),
    destinationHouseId,
    destinationAssignmentByBlockId,
    sourceAssignmentByWorkerBlockId,
  };
}

/**
 * Write each planned assignment via `process_float_lookup_assignment(p_now=...)` — the exact RPC the
 * orchestrator's `floatLookupStep` calls. Resolves the algorithm's gap-block ids back to destination
 * + source assignment_ids using the plan's maps.
 */
export async function applyPlan(
  db: Client,
  plan: FloatPlan,
  pNow: Date,
  retentionDays = 14,
): Promise<WrittenFloat[]> {
  const out: WrittenFloat[] = [];
  for (const assignment of plan.result.assignments) {
    const destinationAssignmentIds = assignment.blocks
      .map((blockId) => plan.destinationAssignmentByBlockId.get(blockId))
      .filter((x): x is string => x !== undefined);
    const sourceAssignmentIds = assignment.blocks
      .map((blockId) =>
        plan.sourceAssignmentByWorkerBlockId.get(`${assignment.workerId}:${blockId}`),
      )
      .filter((x): x is string => x !== undefined);

    const { rows } = await db.query(
      `SELECT process_float_lookup_assignment(
                $1::uuid, $2::text, $3::uuid[], $4::uuid[], $5::text, $6::timestamptz, $7::int) AS r`,
      [
        assignment.workerId,
        assignment.sourceHouseId,
        sourceAssignmentIds,
        destinationAssignmentIds,
        plan.destinationHouseId,
        pNow,
        retentionDays,
      ],
    );
    out.push({
      assignment,
      sourceAssignmentIds,
      destinationAssignmentIds,
      rpc: rows[0].r as WrittenFloat['rpc'],
    });
  }
  return out;
}

export interface ManufacturedGap {
  gap: GapBlock[];
  S: Date; // first gap block start
  starts: Date[];
  sourceWorkerIds: string[]; // source-house workers scheduled across the whole window
}

/**
 * Manufacture a floatable destination gap: find the earliest run of `n` consecutive block-starts on
 * `date` where `source` (default Quad) has >= 2 scheduled workers (so the §6 source-floor holds and a
 * full-coverage floater exists), then vacate ONE `dest` seat per start. Returns the vacated seats as
 * the gap plus the source workers covering the whole window. Runs inside the caller's transaction.
 */
export async function manufactureFloatGap(
  db: Client,
  opts: { dest: string; date: string; n?: number; source?: string },
): Promise<ManufacturedGap> {
  const { dest, date, n = 2, source = 'quad' } = opts;

  const candStarts = (
    await db.query(
      `SELECT b.block_start_at AS bs
         FROM shift_blocks b
         JOIN shift_block_assignments a ON a.block_id = b.block_id AND a.status = 'scheduled'
        WHERE b.house_id = $1 AND (b.block_start_at AT TIME ZONE 'America/New_York')::date = $2::date
        GROUP BY b.block_start_at HAVING count(*) >= 2
        ORDER BY b.block_start_at`,
      [source, date],
    )
  ).rows.map((r) => r.bs as Date);

  let starts: Date[] | null = null;
  for (let i = 0; i + n <= candStarts.length; i += 1) {
    let consecutive = true;
    for (let k = 1; k < n; k += 1) {
      if (candStarts[i + k].getTime() - candStarts[i + k - 1].getTime() !== BLOCK_MS) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) {
      starts = candStarts.slice(i, i + n);
      break;
    }
  }
  if (starts === null) {
    throw new Error(`manufactureFloatGap: no ${n}-block ${source} window on ${date}`);
  }

  const sourceWorkerIds = (
    await db.query(
      `SELECT a.user_id
         FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
        WHERE b.house_id = $1 AND a.status = 'scheduled' AND b.block_start_at = ANY($2::timestamptz[])
        GROUP BY a.user_id HAVING count(*) = $3
        ORDER BY a.user_id`,
      [source, starts, n],
    )
  ).rows.map((r) => r.user_id as string);

  // Vacate the lowest-assignment_id seat at each start in the destination house.
  await db.query(
    `WITH pick AS (
       SELECT DISTINCT ON (b.block_start_at) a.assignment_id
         FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
        WHERE b.house_id = $1 AND b.block_start_at = ANY($2::timestamptz[])
        ORDER BY b.block_start_at, a.assignment_id)
     UPDATE shift_block_assignments x
        SET user_id = NULL, status = 'vacant', vacancy_origin = 'temporary_drop',
            is_float = false, source_house_id = NULL, parent_float_id = NULL
       FROM pick
      WHERE x.assignment_id = pick.assignment_id`,
    [dest, starts],
  );

  const gap = await fetchGap(db, dest, starts);
  return { gap, S: starts[0], starts, sourceWorkerIds };
}

/** The earliest run of `n` consecutive already-vacant seats in `house` on `date` (one per block). */
export async function consecutiveVacant(
  db: Client,
  house: string,
  date: string,
  n = 2,
): Promise<GapBlock[]> {
  const rows = (
    await db.query(
      `SELECT DISTINCT ON (b.block_start_at) a.assignment_id, a.block_id, b.block_start_at AS bs
         FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
        WHERE b.house_id = $1 AND a.status = 'vacant'
          AND (b.block_start_at AT TIME ZONE 'America/New_York')::date = $2::date
        ORDER BY b.block_start_at, a.assignment_id`,
      [house, date],
    )
  ).rows;

  for (let i = 0; i + n <= rows.length; i += 1) {
    let consecutive = true;
    for (let k = 1; k < n; k += 1) {
      if (
        (rows[i + k].bs as Date).getTime() - (rows[i + k - 1].bs as Date).getTime() !==
        BLOCK_MS
      ) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) {
      return rows.slice(i, i + n).map((r) => ({
        assignmentId: r.assignment_id as string,
        blockId: r.block_id as string,
        blockStartAt: r.bs as Date,
      }));
    }
  }
  throw new Error(`consecutiveVacant: no ${n} consecutive vacant ${house} blocks on ${date}`);
}

async function fetchGap(db: Client, house: string, starts: Date[]): Promise<GapBlock[]> {
  return (
    await db.query(
      `SELECT DISTINCT ON (b.block_start_at) a.assignment_id, a.block_id, b.block_start_at
         FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
        WHERE b.house_id = $1 AND b.block_start_at = ANY($2::timestamptz[]) AND a.status = 'vacant'
        ORDER BY b.block_start_at, a.assignment_id`,
      [house, starts],
    )
  ).rows.map((r) => ({
    assignmentId: r.assignment_id as string,
    blockId: r.block_id as string,
    blockStartAt: r.block_start_at as Date,
  }));
}

export interface AutomatedFloat {
  floatId: string;
  floater: string;
  gap: GapBlock[];
  S: Date;
  sourceAssignmentIds: string[];
  destinationAssignmentIds: string[];
}

/**
 * Convenience for scenarios 7–10: manufacture a Quad→single-staff gap, plan it through the pure
 * algorithm, and write the single resulting float at `pNow`. Asserts exactly one floater was chosen
 * and assigned. Returns the float context (id, floater, source/destination assignment ids).
 */
export async function setupAutomatedFloat(
  db: Client,
  opts: { dest: string; date: string; n?: number; pNow?: Date },
): Promise<AutomatedFloat> {
  const { gap, S } = await manufactureFloatGap(db, { dest: opts.dest, date: opts.date, n: opts.n });
  const plan = await planFloat(db, opts.dest, gap);
  if (plan.result.assignments.length !== 1) {
    throw new Error(
      `setupAutomatedFloat: expected exactly 1 floater, got ${plan.result.assignments.length}`,
    );
  }
  // Default the creation instant to a full day before S, so every ack reminder is still in the
  // future (none skipped) and the float is comfortably pending when a later injected time acts on it.
  const pNow =
    opts.pNow ?? (await db.query(`SELECT $1::timestamptz - interval '1 day' AS t`, [S])).rows[0].t;
  const [written] = await applyPlan(db, plan, pNow);
  if (!written.rpc.assigned || written.rpc.float_id === undefined) {
    throw new Error(`setupAutomatedFloat: assignment failed (${written.rpc.reason ?? 'unknown'})`);
  }
  return {
    floatId: written.rpc.float_id,
    floater: written.assignment.workerId,
    gap,
    S,
    sourceAssignmentIds: written.sourceAssignmentIds,
    destinationAssignmentIds: written.destinationAssignmentIds,
  };
}

export interface FloatTimes {
  deadline: Date; // S − 10m (ack_deadline_offset_minutes)
  r6h: Date; // deadline − 6h  = S − 6h10m
  r2h: Date; // deadline − 2h  = S − 2h10m
  r1h: Date; // deadline − 1h  = S − 1h10m
  r30m: Date; // deadline − 30m = S − 40m
  r5m: Date; // deadline − 5m  = S − 15m
  noAckAt: Date; // deadline − no_ack_trigger(5m) = S − 15m (earliest p_now that voids a no-ack)
}

/** The five ack-reminder instants + deadline + no-ack threshold for a gap starting at S (§2.5). */
export async function floatTimes(db: Client, S: Date): Promise<FloatTimes> {
  const { rows } = await db.query(
    `SELECT $1::timestamptz - interval '10 minutes'          AS deadline,
            $1::timestamptz - interval '6 hours 10 minutes'  AS r6h,
            $1::timestamptz - interval '2 hours 10 minutes'  AS r2h,
            $1::timestamptz - interval '1 hour 10 minutes'   AS r1h,
            $1::timestamptz - interval '40 minutes'          AS r30m,
            $1::timestamptz - interval '15 minutes'          AS r5m,
            $1::timestamptz - interval '15 minutes'          AS no_ack_at`,
    [S],
  );
  const r = rows[0];
  return {
    deadline: r.deadline,
    r6h: r.r6h,
    r2h: r.r2h,
    r1h: r.r1h,
    r30m: r.r30m,
    r5m: r.r5m,
    noAckAt: r.no_ack_at,
  };
}
