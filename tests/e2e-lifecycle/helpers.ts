// e2e-lifecycle harness — shared helpers (PLAN §3 S3, §5).
//
// Targets are looked up DYNAMICALLY by (house, NY-date, HH:MM) or by worker, never by hard-coded
// block UUIDs (which change every `db reset`). Worker user_ids ARE stable (the deterministic e…
// roster), so scenarios pass roster `userId`s directly. All clock math is done in Postgres with
// duration intervals (AGENTS invariant #6: never JS wall-clock arithmetic across DST).

import type { Client } from 'pg';
import { expect } from 'vitest';

export const NY = 'America/New_York';

const NY_DATE = `(b.block_start_at AT TIME ZONE 'America/New_York')::date`;
const NY_HHMM = `to_char(b.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI')`;
const NY_BIDX = `((extract(hour FROM b.block_start_at AT TIME ZONE 'America/New_York') * 60
  + extract(minute FROM b.block_start_at AT TIME ZONE 'America/New_York'))::int - 480) / 30`;

export interface AssignmentRow {
  assignment_id: string;
  block_id: string;
  user_id: string | null;
  status: string;
  vacancy_origin: string;
  is_cross_house_pickup: boolean;
  is_float: boolean;
  source_house_id: string | null;
}

export interface BlockRef {
  assignmentId: string;
  blockId: string;
  blockStartAt: Date;
}

export interface Run {
  userId: string;
  assignmentIds: string[];
  blockIds: string[];
  hhmms: string[];
  blockIndexes: number[];
  firstStartAt: Date;
  lastStartAt: Date;
  dow: number; // Postgres EXTRACT(DOW): Sun=0 … Sat=6
}

export interface Anchors {
  S: Date;
  dayBefore: Date;
  tMinus2h: Date;
  tMinus20m: Date;
  tMinus10m: Date;
}

const ASSIGNMENT_COLS = `assignment_id, block_id, user_id, status::text AS status,
  vacancy_origin::text AS vacancy_origin, is_cross_house_pickup, is_float, source_house_id`;

/** The single vacant seat at (house, NY date, HH:MM). Asserts exactly one exists. */
export async function vacantAt(
  db: Client,
  house: string,
  date: string,
  hhmm: string,
): Promise<BlockRef> {
  const { rows } = await db.query(
    `SELECT a.assignment_id, a.block_id, b.block_start_at
       FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
      WHERE a.status = 'vacant' AND b.house_id = $1
        AND ${NY_DATE} = $2::date AND ${NY_HHMM} = $3
      ORDER BY a.assignment_id`,
    [house, date, hhmm],
  );
  expect(rows.length, `no vacant seat at ${house} ${date} ${hhmm}`).toBeGreaterThan(0);
  return {
    assignmentId: rows[0].assignment_id,
    blockId: rows[0].block_id,
    blockStartAt: rows[0].block_start_at,
  };
}

/** The earliest vacant seat in `house` on a NY date (any time). Asserts at least one exists. */
export async function anyVacant(db: Client, house: string, date: string): Promise<BlockRef> {
  const { rows } = await db.query(
    `SELECT a.assignment_id, a.block_id, b.block_start_at
       FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
      WHERE a.status = 'vacant' AND b.house_id = $1 AND ${NY_DATE} = $2::date
      ORDER BY b.block_start_at, a.assignment_id
      LIMIT 1`,
    [house, date],
  );
  expect(rows.length, `no vacant seat in ${house} on ${date}`).toBe(1);
  return {
    assignmentId: rows[0].assignment_id,
    blockId: rows[0].block_id,
    blockStartAt: rows[0].block_start_at,
  };
}

/**
 * A home worker of `house` eligible to claim `blockStartAt`: home_house = house, active, e… SW,
 * NOT 'cannot' on that block, and no existing non-vacant assignment at that block-start. Stable
 * (orders by user_id). Throws if none qualify.
 */
export async function freeHomeWorker(
  db: Client,
  house: string,
  blockStartAt: Date,
  exclude: string[] = [],
): Promise<string> {
  const { rows } = await db.query(
    `SELECT u.user_id
       FROM users u
      WHERE u.home_house_id = $1 AND u.is_active
        AND u.email LIKE 'e.%@pennhousing.test'
        AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.user_id AND r.role = 'sw')
        AND NOT (u.user_id = ANY ($2::uuid[]))
        AND NOT EXISTS (
          SELECT 1 FROM preferences p JOIN shift_blocks b ON b.block_id = p.block_id
           WHERE p.user_id = u.user_id AND p.status = 'cannot' AND b.block_start_at = $3)
        AND NOT EXISTS (
          SELECT 1 FROM shift_block_assignments x JOIN shift_blocks b ON b.block_id = x.block_id
           WHERE x.user_id = u.user_id AND x.status <> 'vacant' AND b.block_start_at = $3)
      ORDER BY u.user_id
      LIMIT 1`,
    [house, exclude, blockStartAt],
  );
  expect(rows.length, `no free home worker for ${house} @ ${blockStartAt.toISOString()}`).toBe(1);
  return rows[0].user_id;
}

/** A worker's scheduled run on a NY date in a house. Asserts it is one contiguous block run. */
export async function scheduledRun(
  db: Client,
  userId: string,
  house: string,
  date: string,
): Promise<Run> {
  const { rows } = await db.query(
    `SELECT a.assignment_id, a.block_id, b.block_start_at,
            ${NY_HHMM} AS hhmm, ${NY_BIDX} AS bidx,
            extract(dow FROM b.block_start_at AT TIME ZONE 'America/New_York')::int AS dow
       FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
      WHERE a.user_id = $1 AND a.status = 'scheduled' AND b.house_id = $2 AND ${NY_DATE} = $3::date
      ORDER BY b.block_start_at`,
    [userId, house, date],
  );
  expect(rows.length, `no scheduled run for ${userId} at ${house} ${date}`).toBeGreaterThanOrEqual(
    4,
  );
  const bidx = rows.map((r) => Number(r.bidx));
  for (let i = 1; i < bidx.length; i += 1) {
    expect(bidx[i], `run not contiguous for ${userId} ${date}`).toBe(bidx[i - 1] + 1);
  }
  return {
    userId,
    assignmentIds: rows.map((r) => r.assignment_id),
    blockIds: rows.map((r) => r.block_id),
    hhmms: rows.map((r) => r.hhmm),
    blockIndexes: bidx,
    firstStartAt: rows[0].block_start_at,
    lastStartAt: rows[rows.length - 1].block_start_at,
    dow: Number(rows[0].dow),
  };
}

/** Find a worker (home = house) who has a full scheduled run on `date`, then return that run. */
export async function workerWithRun(
  db: Client,
  house: string,
  date: string,
  exclude: string[] = [],
): Promise<Run> {
  const { rows } = await db.query(
    `SELECT a.user_id, count(*)::int AS n
       FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
       JOIN users u ON u.user_id = a.user_id
      WHERE a.status = 'scheduled' AND b.house_id = $1 AND ${NY_DATE} = $2::date
        AND u.home_house_id = $1 AND NOT (a.user_id = ANY ($3::uuid[]))
      GROUP BY a.user_id HAVING count(*) >= 4
      ORDER BY a.user_id
      LIMIT 1`,
    [house, date, exclude],
  );
  expect(rows.length, `no worker with a run at ${house} ${date}`).toBe(1);
  return scheduledRun(db, rows[0].user_id, house, date);
}

/** Duration-interval anchors around a block start S (computed in Postgres → DST-safe). */
export async function anchors(db: Client, blockStartAt: Date): Promise<Anchors> {
  const { rows } = await db.query(
    `SELECT $1::timestamptz AS s,
            $1::timestamptz - interval '1 day'     AS day_before,
            $1::timestamptz - interval '2 hours'   AS t_minus_2h,
            $1::timestamptz - interval '20 minutes' AS t_minus_20m,
            $1::timestamptz - interval '10 minutes' AS t_minus_10m`,
    [blockStartAt],
  );
  const r = rows[0];
  return {
    S: r.s,
    dayBefore: r.day_before,
    tMinus2h: r.t_minus_2h,
    tMinus20m: r.t_minus_20m,
    tMinus10m: r.t_minus_10m,
  };
}

export async function getAssignment(db: Client, assignmentId: string): Promise<AssignmentRow> {
  const { rows } = await db.query(
    `SELECT ${ASSIGNMENT_COLS} FROM shift_block_assignments WHERE assignment_id = $1`,
    [assignmentId],
  );
  expect(rows.length, `assignment ${assignmentId} not found`).toBe(1);
  return rows[0] as AssignmentRow;
}

export async function getAssignments(db: Client, ids: string[]): Promise<AssignmentRow[]> {
  const { rows } = await db.query(
    `SELECT ${ASSIGNMENT_COLS} FROM shift_block_assignments WHERE assignment_id = ANY ($1::uuid[])`,
    [ids],
  );
  return rows as AssignmentRow[];
}

/**
 * The seats sitting vacant/permanent_drop on the given blocks — i.e. the seats a just-completed
 * `permanent_drop_slot` vacated. Use this (not all seats on the block) on multi-staff houses like
 * Harnwell, where a co-worker's seat on the same block stays scheduled.
 */
export async function permanentDropSeats(db: Client, blockIds: string[]): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT assignment_id FROM shift_block_assignments
      WHERE block_id = ANY ($1::uuid[]) AND status = 'vacant' AND vacancy_origin = 'permanent_drop'
      ORDER BY assignment_id`,
    [blockIds],
  );
  return rows.map((r) => r.assignment_id as string);
}

/** Live (status, vacancy_origin) of the seats sitting on a set of blocks. */
export async function assignmentsForBlocks(
  db: Client,
  blockIds: string[],
): Promise<AssignmentRow[]> {
  const { rows } = await db.query(
    `SELECT ${ASSIGNMENT_COLS} FROM shift_block_assignments WHERE block_id = ANY ($1::uuid[])`,
    [blockIds],
  );
  return rows as AssignmentRow[];
}

export async function effectiveCap(
  db: Client,
  blockStartAt: Date,
): Promise<{ hours_cap: number; cap_enforcement: string }> {
  const { rows } = await db.query(
    `SELECT c.hours_cap, c.cap_enforcement::text AS cap_enforcement
       FROM effective_weekly_cap(
              date_trunc('week', $1::timestamptz AT TIME ZONE 'America/New_York')::date,
              $1::timestamptz) c`,
    [blockStartAt],
  );
  return { hours_cap: Number(rows[0].hours_cap), cap_enforcement: rows[0].cap_enforcement };
}

export async function notificationsFor(
  db: Client,
  recipientUserId: string,
  type: string,
): Promise<Array<{ notification_id: string; payload: Record<string, unknown> }>> {
  const { rows } = await db.query(
    `SELECT notification_id, payload FROM notifications
      WHERE recipient_user_id = $1 AND type = $2::notification_type
      ORDER BY notification_id`,
    [recipientUserId, type],
  );
  return rows;
}

/**
 * Assert a raised RPC. Wraps the call in a SAVEPOINT and rolls back TO it on failure, so the
 * surrounding transaction stays USABLE for follow-up non-mutation assertions (a bare raised
 * statement otherwise aborts the whole transaction).
 */
export async function expectRpcErrorTx(
  db: Client,
  text: string,
  params: unknown[],
  pattern: RegExp | string,
): Promise<void> {
  await db.query('SAVEPOINT enf');
  let msg: string | null = null;
  try {
    await db.query(text, params);
  } catch (err) {
    msg = err instanceof Error ? err.message : String(err);
  }
  await db.query('ROLLBACK TO SAVEPOINT enf');
  await db.query('RELEASE SAVEPOINT enf');
  expect(msg, `expected RPC to reject with ${String(pattern)}`).not.toBeNull();
  if (pattern instanceof RegExp) expect(msg as string).toMatch(pattern);
  else expect(msg as string).toContain(pattern);
}

/** Assert every row in `rows` has the given status (and optionally vacancy_origin). */
export function expectAll(rows: AssignmentRow[], status: string, vacancyOrigin?: string): void {
  for (const r of rows) {
    expect(r.status).toBe(status);
    if (vacancyOrigin !== undefined) expect(r.vacancy_origin).toBe(vacancyOrigin);
  }
}
