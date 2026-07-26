// Float-lookup subsystem for orchestrator-tick.
//
// Extracted from index.ts (2026-07-26) while doing the cost-audit work on the scan and
// no-ack paths. index.ts was already 1,346 lines — more than twice the 600-line ceiling
// in AGENTS.md — so per the "extract the section you touched on your way out" rule this
// is the seam: everything involved in turning ONE vacant block into a float assignment,
// namely the gap builder, the DB snapshot, the pure algorithm call, and the step itself.
//
// Supabase deploys the whole function directory, so a sibling import is fine; the
// repo already relies on multi-file functions via supabase/functions/_shared/. The
// dynamic import of packages/core keeps its original ../../../ depth because this file
// sits in the same directory index.ts did.
//
// NOTHING here changed behaviour in the move. In particular loadCoveredBlockIds is
// byte-identical and still called from loadVacantGap: it IS the coverage-floor-of-one
// invariant (BSpec §5.4) and the audit calls out both call sites as non-negotiable.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Supabase = SupabaseClient;

export type BlockRef = {
  blockId: string;
  blockStartAt: Date;
  houseId: string;
};
export type VacantAssignment = BlockRef & {
  assignmentId: string;
};
export type RuntimeConfig = {
  blockMinutes: number;
  floatRetentionDays: number;
  noAckLookaheadMinutes: number;
  ladderTimeoutMinutes: number;
};

// Maximum coverage secured in a single pass (BEHAVIORAL_SPECIFICATION §5.4).
// A single contiguous vacant gap is only ever handled 8 blocks (4 hours) at a
// time — both for the float lookup and, transitively, for the Allied-coverage
// notification a no-ack void emits. Beyond this, the remainder stays vacant and
// claimable; it re-escalates through the normal chain (broadcast → float →
// Allied) as its own blocks approach their escalation offsets. This keeps a long
// empty window (e.g. 8am–midnight) from being secured to paid Allied all at
// once, which would needlessly lock students out of picking up the later hours.
const MAX_ALLIED_COVERAGE_BLOCKS = 8;

// Desk-presence statuses. See index.ts for the full rationale; this is the ESCALATION
// present-set, which counts 'allied'. It is NOT the pickup-lock present-set.
const PRESENT_STATUSES = [
  'scheduled',
  'claimed',
  'floated_in',
  'pending_float_in',
  'allied',
] as const;

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function nestedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

type FloatLookupInput = {
  gap: {
    destinationHouseId: string;
    blocks: Array<{ blockId: string; blockStartAt: Date }>;
  };
  sources: Array<{
    sourceHouseId: string;
    precedenceOrder: number;
    candidates: Array<{
      userId: string;
      homeHouseId: string;
      roles: Array<'sw' | 'sm' | 'hm' | 'bm'>;
      isActive: boolean;
      coveredGapBlockIds: string[];
      shiftStartAt: Date;
      shiftEndAt: Date;
      hasConflictingFloat: boolean;
      hasConflictingCrossHousePickup: boolean;
    }>;
    effectiveHeadcountByBlockId: Record<string, number>;
  }>;
  exclusions: Array<{
    userId: string;
    destinationHouseId: string;
    windowStartAt: Date;
    windowEndAt: Date;
  }>;
};
type FloatLookupResult = {
  assignments: Array<{ workerId: string; sourceHouseId: string; blocks: string[] }>;
  alliedBlockIds: string[];
};
type FloatLookupSnapshot = {
  input: FloatLookupInput;
  destinationAssignmentByBlockId: Map<string, string>;
  sourceAssignmentByWorkerBlockId: Map<string, string>;
};

async function findFloaters(input: FloatLookupInput): Promise<FloatLookupResult> {
  const module = (await import('../../../packages/core/dist/float-lookup/index.js')) as {
    findFloaters: (input: FloatLookupInput) => FloatLookupResult;
  };
  return module.findFloaters(input);
}

export async function loadCoveredBlockIds(
  supabase: Supabase,
  blockIds: string[],
): Promise<Set<string>> {
  const covered = new Set<string>();
  // Chunk the .in() filter — a full lookahead window of block ids 414s ("URI too
  // long") as one request (mirrors selectByBlockIdChunks on the web side).
  const CHUNK = 100;
  for (let start = 0; start < blockIds.length; start += CHUNK) {
    const chunk = blockIds.slice(start, start + CHUNK);
    if (chunk.length === 0) {
      continue;
    }
    const { data, error } = await supabase
      .from('shift_block_assignments')
      .select('block_id')
      .in('block_id', chunk)
      .in('status', [...PRESENT_STATUSES]);
    if (error !== null) {
      throw error;
    }
    for (const row of data ?? []) {
      covered.add(row.block_id);
    }
  }
  return covered;
}

async function loadVacantGap(
  supabase: Supabase,
  block: VacantAssignment,
  blockMinutes: number,
): Promise<Array<VacantAssignment>> {
  // Cap the window at MAX_ALLIED_COVERAGE_BLOCKS (4 hours). Exclusive upper
  // bound so the window holds exactly the 8 blocks [start, start + 4h).
  const windowEnd = addMinutes(
    block.blockStartAt,
    MAX_ALLIED_COVERAGE_BLOCKS * blockMinutes,
  ).toISOString();
  const { data, error } = await supabase
    .from('shift_block_assignments')
    .select('assignment_id, block_id, shift_blocks!inner(block_start_at, house_id)')
    .eq('status', 'vacant')
    .is('shift_blocks.voided_at', null)
    .eq('shift_blocks.house_id', block.houseId)
    .gte('shift_blocks.block_start_at', block.blockStartAt.toISOString())
    .lt('shift_blocks.block_start_at', windowEnd)
    .order('block_start_at', { referencedTable: 'shift_blocks', ascending: true });

  if (error !== null) {
    throw error;
  }

  const byBlock = new Map<string, VacantAssignment>();
  for (const row of data ?? []) {
    const joinedBlock = nestedOne(
      row.shift_blocks as { block_start_at: string; house_id: string } | null,
    );
    if (joinedBlock === null || byBlock.has(row.block_id)) {
      continue;
    }
    byBlock.set(row.block_id, {
      assignmentId: row.assignment_id,
      blockId: row.block_id,
      blockStartAt: new Date(joinedBlock.block_start_at),
      houseId: joinedBlock.house_id,
    });
  }

  // Only EMPTY blocks (no present staff) belong to the gap — a block where someone
  // is still on the desk is covered and must not pull its remaining vacant seats
  // into the float. A non-empty block also breaks the contiguous run (mirrors the
  // user's example: empty 18:00–20:00, staffed 20:00–22:00, empty 22:00–24:00 →
  // two separate gaps, not one).
  const coveredBlockIds = await loadCoveredBlockIds(supabase, [...byBlock.keys()]);

  const sorted = [...byBlock.values()]
    .filter((row) => !coveredBlockIds.has(row.blockId))
    .sort((left, right) => left.blockStartAt.getTime() - right.blockStartAt.getTime());
  const gap: VacantAssignment[] = [];
  let expectedStart = block.blockStartAt.getTime();
  for (const row of sorted) {
    if (row.blockStartAt.getTime() < expectedStart) {
      continue;
    }
    if (row.blockStartAt.getTime() !== expectedStart) {
      break;
    }
    gap.push(row);
    expectedStart += blockMinutes * 60 * 1000;
    // Hard cap: never secure more than 4 hours in one pass (§5.4). The query
    // window already bounds this, but truncate defensively so the invariant
    // holds regardless of blockMinutes.
    if (gap.length >= MAX_ALLIED_COVERAGE_BLOCKS) {
      break;
    }
  }

  return gap;
}

async function buildFloatLookupSnapshot(
  supabase: Supabase,
  block: VacantAssignment,
  profileName: string,
  blockMinutes: number,
): Promise<FloatLookupSnapshot> {
  const gapRows = await loadVacantGap(supabase, block, blockMinutes);
  const gapBlocks = gapRows.map((row) => ({
    blockId: row.blockId,
    blockStartAt: row.blockStartAt,
  }));
  const destinationAssignmentByBlockId = new Map(
    gapRows.map((row) => [row.blockId, row.assignmentId]),
  );
  const gapStart = gapBlocks[0]?.blockStartAt ?? block.blockStartAt;
  const gapEnd = addMinutes(gapBlocks.at(-1)?.blockStartAt ?? block.blockStartAt, blockMinutes);

  const { data: routes, error: routesError } = await supabase
    .from('float_routing')
    .select('source_house_id, precedence_order')
    .eq('profile_name', profileName)
    .eq('destination_house_id', block.houseId)
    .order('precedence_order', { ascending: true });

  if (routesError !== null) {
    throw routesError;
  }

  const sources: FloatLookupInput['sources'] = [];
  const sourceAssignmentByWorkerBlockId = new Map<string, string>();
  const gapBlockByIso = new Map(
    gapBlocks.map((gapBlock) => [gapBlock.blockStartAt.toISOString(), gapBlock]),
  );

  for (const route of routes ?? []) {
    const { data: sourceRows, error: sourceError } = await supabase
      .from('shift_block_assignments')
      .select(
        'assignment_id, user_id, status, shift_blocks!inner(block_id, block_start_at, house_id)',
      )
      .in('status', ['scheduled', 'claimed'])
      .eq('shift_blocks.house_id', route.source_house_id)
      .gte('shift_blocks.block_start_at', gapStart.toISOString())
      .lt('shift_blocks.block_start_at', gapEnd.toISOString());

    if (sourceError !== null) {
      throw sourceError;
    }

    const userIds = [
      ...new Set((sourceRows ?? []).map((row) => row.user_id).filter(Boolean) as string[]),
    ];
    const { data: users, error: usersError } =
      userIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from('users')
            .select('user_id, home_house_id, is_active')
            .in('user_id', userIds);
    if (usersError !== null) {
      throw usersError;
    }
    const usersById = new Map((users ?? []).map((user) => [user.user_id, user]));

    const { data: roles, error: rolesError } =
      userIds.length === 0
        ? { data: [], error: null }
        : await supabase.from('user_roles').select('user_id, role').in('user_id', userIds);
    if (rolesError !== null) {
      throw rolesError;
    }
    const rolesByUser = new Map<string, Array<'sw' | 'sm' | 'hm' | 'rsm' | 'bm' | 'admin'>>();
    for (const role of roles ?? []) {
      const existing = rolesByUser.get(role.user_id) ?? [];
      existing.push(role.role as 'sw' | 'sm' | 'hm' | 'rsm' | 'bm' | 'admin');
      rolesByUser.set(role.user_id, existing);
    }

    const coveredByUser = new Map<string, Array<{ blockId: string; blockStartAt: Date }>>();
    const effectiveHeadcountByBlockId: Record<string, number> = Object.fromEntries(
      gapBlocks.map((gapBlock) => [gapBlock.blockId, 0]),
    );

    for (const row of sourceRows ?? []) {
      if (row.user_id === null) {
        continue;
      }
      const joinedBlock = nestedOne(
        row.shift_blocks as { block_id: string; block_start_at: string; house_id: string } | null,
      );
      if (joinedBlock === null) {
        continue;
      }
      const gapBlock = gapBlockByIso.get(new Date(joinedBlock.block_start_at).toISOString());
      if (gapBlock === undefined) {
        continue;
      }
      effectiveHeadcountByBlockId[gapBlock.blockId] =
        (effectiveHeadcountByBlockId[gapBlock.blockId] ?? 0) + 1;
      sourceAssignmentByWorkerBlockId.set(`${row.user_id}:${gapBlock.blockId}`, row.assignment_id);
      const existing = coveredByUser.get(row.user_id) ?? [];
      existing.push(gapBlock);
      coveredByUser.set(row.user_id, existing);
    }

    // C4 (F-07-005): per-candidate conflict flags. A worker already committed
    // to a float (pending/acknowledged manifests as pending/floated in/out rows)
    // or to a cross-house pickup overlapping the gap window must not be selected.
    const floatConflictUserIds = new Set<string>();
    const crossHousePickupConflictUserIds = new Set<string>();
    if (userIds.length > 0) {
      const { data: conflictRows, error: conflictError } = await supabase
        .from('shift_block_assignments')
        .select('user_id, status, is_cross_house_pickup, shift_blocks!inner(block_start_at)')
        .in('user_id', userIds)
        .gte('shift_blocks.block_start_at', gapStart.toISOString())
        .lt('shift_blocks.block_start_at', gapEnd.toISOString());
      if (conflictError !== null) {
        throw conflictError;
      }
      for (const row of conflictRows ?? []) {
        if (row.user_id === null) {
          continue;
        }
        if (
          row.status === 'pending_float_in' ||
          row.status === 'floated_in' ||
          row.status === 'pending_float_out' ||
          row.status === 'floated_out'
        ) {
          floatConflictUserIds.add(row.user_id);
        }
        if (row.is_cross_house_pickup === true) {
          crossHousePickupConflictUserIds.add(row.user_id);
        }
      }
    }

    const candidates = [...coveredByUser.entries()].flatMap(([userId, coveredBlocks]) => {
      const user = usersById.get(userId);
      if (user === undefined || coveredBlocks.length === 0) {
        return [];
      }
      const sortedBlocks = [...coveredBlocks].sort(
        (left, right) => left.blockStartAt.getTime() - right.blockStartAt.getTime(),
      );
      return [
        {
          userId,
          homeHouseId: user.home_house_id,
          roles: rolesByUser.get(userId) ?? ['sw'],
          isActive: user.is_active,
          coveredGapBlockIds: sortedBlocks.map((gapBlock) => gapBlock.blockId),
          shiftStartAt: sortedBlocks[0]!.blockStartAt,
          shiftEndAt: addMinutes(sortedBlocks.at(-1)!.blockStartAt, blockMinutes),
          hasConflictingFloat: floatConflictUserIds.has(userId),
          hasConflictingCrossHousePickup: crossHousePickupConflictUserIds.has(userId),
        },
      ];
    });

    // Source-floor guard (belt-and-braces; the pure algorithm's sourceHasFloor
    // enforces the same rule). Float direction is now config-driven: any house the
    // admin routes here reaches this loop. But a source may only lend while it is
    // genuinely MULTI-STAFFED — at least one gap block must have >= 2 workers
    // present so the desk keeps >= 1 after a floater leaves. A source with < 2
    // present on every block (e.g. a single-staffed house in the first half of
    // summer) contributes no roster. This is the second enforcement point for the
    // "never empty a source desk" guard, per the enforce-at-every-write-point rule.
    const sourceCanSpare = Object.values(effectiveHeadcountByBlockId).some(
      (present) => present >= 2,
    );
    if (!sourceCanSpare) {
      continue;
    }

    sources.push({
      sourceHouseId: route.source_house_id,
      precedenceOrder: route.precedence_order,
      candidates,
      effectiveHeadcountByBlockId,
    });
  }

  const { data: exclusions, error: exclusionsError } = await supabase
    .from('float_exclusions')
    .select('user_id, destination_house_id, window_start_at, window_end_at')
    .eq('destination_house_id', block.houseId)
    .lt('window_start_at', gapEnd.toISOString())
    .gt('window_end_at', gapStart.toISOString());

  if (exclusionsError !== null) {
    throw exclusionsError;
  }

  return {
    input: {
      gap: { destinationHouseId: block.houseId, blocks: gapBlocks },
      sources,
      exclusions: (exclusions ?? []).map((exclusion) => ({
        userId: exclusion.user_id,
        destinationHouseId: exclusion.destination_house_id,
        windowStartAt: new Date(exclusion.window_start_at),
        windowEndAt: new Date(exclusion.window_end_at),
      })),
    },
    destinationAssignmentByBlockId,
    sourceAssignmentByWorkerBlockId,
  };
}

// Stamp a block's one-way coverage lock (BEHAVIORAL_SPECIFICATION §5.4/§5.5).
// Called only from the T-2h coverage-securing steps (float_lookup,
// hmod_notify_allied), NEVER from broadcast (T-3h stays claimable). Locking an
// empty desk makes its vacant seats unpickable from here on, even after a
// floater/Allied later fills it. Idempotent + one-way in SQL.
//
// Returns whether the desk is STILL EMPTY and the caller should proceed.
//
// Audit F4: this used to return void, and the RPC stamped unconditionally because it
// trusted the desk_covered boolean from the tick's ONE scan. That boolean is read
// seconds earlier, in a different transaction, before all the per-block round trips
// below it. A desk staffed inside that window (an SM assigning at T-2h is gated on
// block_started, not on T-2h) still got the one-way lock, permanently un-picking its
// remaining vacant seats, and still got a float or an Allied page it did not need.
// Neither is revocable: invariant #3 (no-takeback) forbids an automated system from
// undoing either. The RPC now re-evaluates coverage itself, under a row lock on the
// block's seats, and answers false once the desk has been staffed. Every caller must
// honour that answer and abort its securing step.
export async function lockBlockCoverage(
  supabase: Supabase,
  blockId: string,
  asOf: Date,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('lock_block_coverage', {
    p_block_id: blockId,
    p_as_of: asOf.toISOString(),
  });
  if (error !== null) {
    throw error;
  }
  return data === true;
}

export async function floatLookupStep(
  supabase: Supabase,
  block: VacantAssignment,
  profileName: string,
  firedAt: Date,
  config: RuntimeConfig,
): Promise<'float_assigned' | 'no_float' | 'covered'> {
  // §5.5: the desk hit its T-2h float-lookup step while empty, so lock its seats
  // (one-way) before attempting the float, regardless of whether a floater is
  // found. A later float-in / Allied fill never re-opens them to pickup.
  //
  // Audit F4: the lock is now a check-and-lock. `false` means the desk was staffed
  // between the tick's scan and this call, so nothing was stamped and there is
  // nothing left to secure. Returning 'covered' (rather than 'no_float') matters:
  // 'no_float' is what routes the caller on to hmod_notify_allied, and paging for
  // Allied cover on a desk that a worker just took is the expensive half of the bug.
  const stillEmpty = await lockBlockCoverage(supabase, block.blockId, firedAt);
  if (!stillEmpty) {
    return 'covered';
  }

  // §7.3 — never assign a float that is ALREADY inside its no-ack window at
  // creation. Such a float is dead on arrival: its acknowledgment deadline
  // (T-10m) and no-ack point (T-15m) are already past, so the worker can never
  // acknowledge it and the no-ack pass voids it immediately — re-opening the gap
  // into an assign→void→re-assign churn that also burns an unfair no_acknowledgment
  // exclusion on the floater. A gap discovered or reopened this late routes
  // straight to HMOD-for-Allied instead (the 'no_float' fallback below — the same
  // terminal a no-ack void produces). The threshold is the no-ack lookahead
  // (ack-deadline + no-ack-trigger); a float whose start is beyond it can still be
  // acknowledged and is unaffected, so normal T-2h floats never hit this guard.
  const noAckHorizon = addMinutes(firedAt, config.noAckLookaheadMinutes).getTime();
  if (block.blockStartAt.getTime() <= noAckHorizon) {
    return 'no_float';
  }

  const snapshot = await buildFloatLookupSnapshot(
    supabase,
    block,
    profileName,
    config.blockMinutes,
  );
  const result = await findFloaters(snapshot.input);

  if (result.assignments.length === 0) {
    return 'no_float';
  }

  let anyAssigned = false;
  for (const assignment of result.assignments) {
    const destinationAssignmentIds = assignment.blocks.flatMap((blockId) => {
      const assignmentId = snapshot.destinationAssignmentByBlockId.get(blockId);
      return assignmentId === undefined ? [] : [assignmentId];
    });
    const sourceAssignmentIds = assignment.blocks.flatMap((blockId) => {
      const assignmentId = snapshot.sourceAssignmentByWorkerBlockId.get(
        `${assignment.workerId}:${blockId}`,
      );
      return assignmentId === undefined ? [] : [assignmentId];
    });

    if (destinationAssignmentIds.length === 0 || sourceAssignmentIds.length === 0) {
      continue;
    }

    // B-2 audit fix: the four writes (float_assignments INSERT,
    // destination + source UPDATEs, notification INSERT) run inside a
    // single plpgsql transaction so partial state — e.g. destination
    // flipped to pending_float_in while source is still scheduled —
    // is impossible. The RPC also re-validates the destination is
    // still vacant under FOR UPDATE; a concurrent claim between the
    // algorithm's snapshot and this call cleanly returns
    // assigned=false with no writes.
    const { data: assignmentResult, error: assignmentError } = await supabase.rpc(
      'process_float_lookup_assignment',
      {
        p_worker_id: assignment.workerId,
        p_source_house_id: assignment.sourceHouseId,
        p_source_assignment_ids: sourceAssignmentIds,
        p_destination_assignment_ids: destinationAssignmentIds,
        p_destination_house_id: block.houseId,
        p_now: firedAt.toISOString(),
        p_retention_days: config.floatRetentionDays,
      },
    );
    if (assignmentError !== null) {
      throw assignmentError;
    }

    if ((assignmentResult as { assigned?: boolean } | null)?.assigned === true) {
      anyAssigned = true;
    }
  }

  // Any successful per-worker assignment means the lookup yielded a
  // float for the orchestrator's purposes. If ALL assignments aborted
  // because their destinations were no longer vacant, the chain
  // re-evaluates next tick (or hmod_notify_allied fires for the
  // residual gap).
  return anyAssigned ? 'float_assigned' : 'no_float';
}
