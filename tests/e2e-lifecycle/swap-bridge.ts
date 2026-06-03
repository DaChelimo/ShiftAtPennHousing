// e2e-lifecycle harness — swap bridge (PLAN §3 S5, §4 row 13).
//
// Swap *creation* is the `create-swap` Edge Function in production (POST → it validates eligibility,
// then INSERTs a `swap_requests` row with a per-type `expires_at`). Mirroring how S4 bypassed
// `orchestrator-tick`, this file replicates that INSERT against the harness `pg` superuser
// connection — same row + the same `expires_at` anchors as `create-swap`'s `computeExpiresAt`
// (supabase/functions/create-swap/index.ts + _shared/swap-http.ts) — so a scenario drives the exact
// swap the Edge Function would create, deterministically and in-transaction. ACCEPTANCE
// (`accept_swap` / `apply_permanent_swap`) and EXPIRY (`expire_pending_swaps`) are pure RPCs the
// scenarios call directly with an injected `p_now`.
//
// expires_at anchors (create-swap computeExpiresAt):
//   shift_swap     — T-3h of the EARLIEST block start across both spans
//   float_swap     — 24h after the LATEST span end (latest start + the 30-min block width)
//   permanent_swap — created_at + 7 days
// created_at defaults to 1 day before the earliest span block start (deterministic; "before the
// shift"), matching the create-swap convention that a swap is proposed ahead of the shift.

import type { Client } from 'pg';

export type SwapType = 'shift_swap' | 'float_swap' | 'permanent_swap';

export interface CreateSwapOpts {
  swapType: SwapType;
  initiator: string;
  counterparty: string;
  initiatorAssignmentIds: string[];
  /** Required (non-empty) for shift_swap / float_swap; NULL for an unresolved permanent_swap. */
  counterpartyAssignmentIds?: string[] | null;
  recurringPattern?: Record<string, unknown> | null;
  /** Override the creation instant (drives permanent_swap's +7d expiry). */
  createdAt?: Date;
}

export interface CreatedSwap {
  swapId: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Replicate the `create-swap` INSERT: compute the per-type `expires_at` (and `created_at`) in
 * Postgres from the span's block starts, then write the pending `swap_requests` row. The
 * `swap_requests` trigger validates that every referenced assignment exists, so the ids must be
 * real (these tests pass live seat ids). Returns the new swap_id + its computed timestamps.
 */
export async function createSwap(db: Client, opts: CreateSwapOpts): Promise<CreatedSwap> {
  const {
    swapType,
    initiator,
    counterparty,
    initiatorAssignmentIds,
    counterpartyAssignmentIds = null,
    recurringPattern = null,
    createdAt = null,
  } = opts;

  const allIds = [...initiatorAssignmentIds, ...(counterpartyAssignmentIds ?? [])];

  // The 30-minute block width is a hard invariant (AGENTS §Hard Invariants #5), so the float_swap
  // anchor adds a literal 30 minutes for the block end — identical to create-swap reading
  // system_config.shift_block_minutes (which is 30 here).
  const { rows: t } = await db.query(
    `WITH spans AS (
       SELECT min(b.block_start_at) AS earliest, max(b.block_start_at) AS latest
         FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
        WHERE a.assignment_id = ANY($1::uuid[])
     ),
     created AS (
       SELECT COALESCE($2::timestamptz, (SELECT earliest FROM spans) - interval '1 day') AS c
     )
     SELECT (SELECT c FROM created) AS created_at,
            CASE $3::text
              WHEN 'shift_swap' THEN (SELECT earliest FROM spans) - interval '3 hours'
              WHEN 'float_swap' THEN (SELECT latest FROM spans) + interval '30 minutes' + interval '24 hours'
              ELSE (SELECT c FROM created) + interval '7 days'
            END AS expires_at`,
    [allIds, createdAt, swapType],
  );
  const createdAtVal: Date = t[0].created_at;
  const expiresAt: Date = t[0].expires_at;

  const { rows } = await db.query(
    `INSERT INTO swap_requests
       (swap_type, initiator_user_id, counterparty_user_id,
        initiator_assignment_ids, counterparty_assignment_ids, recurring_pattern,
        status, created_at, expires_at)
     VALUES ($1::swap_type_enum, $2::uuid, $3::uuid, $4::uuid[], $5::uuid[], $6::jsonb,
             'pending', $7::timestamptz, $8::timestamptz)
     RETURNING swap_id`,
    [
      swapType,
      initiator,
      counterparty,
      initiatorAssignmentIds,
      counterpartyAssignmentIds,
      recurringPattern === null ? null : JSON.stringify(recurringPattern),
      createdAtVal,
      expiresAt,
    ],
  );

  return { swapId: rows[0].swap_id as string, createdAt: createdAtVal, expiresAt };
}

/** A timestamptz shifted by a Postgres interval (DST-safe; never JS wall-clock math). */
export async function tsShift(
  db: Client,
  ts: Date,
  op: '+' | '-',
  interval: string,
): Promise<Date> {
  const { rows } = await db.query(
    `SELECT $1::timestamptz ${op === '+' ? '+' : '-'} $2::interval AS t`,
    [ts, interval],
  );
  return rows[0].t as Date;
}
