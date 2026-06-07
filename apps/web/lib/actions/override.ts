'use server';

import { revalidatePath } from 'next/cache';

import { adminHouseId, canBuildSchedule, getSessionUser } from '../auth';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

// S1 — Admin override (BSpec §4.3 Phase-3, §11.1). Live inline assign / reassign /
// remove on a published block, this-week-vs-permanent, with a soft-advisory confirm.
//
// The authoritative enforcement is the SQL RPC (admin_assign_worker /
// admin_remove_worker, migration 20260606000001) — SECURITY DEFINER, called via the
// service client (same authorized pattern as publishScheduleAction). These actions
// add the web-layer authz gate (canBuildSchedule + admin-house match) and translate
// the snake_case RAISE reasons / the soft-confirm signal into the UI shape.

export type OverrideScope = 'this_week' | 'permanent';

export type AssignAdvisory = { kind: string };

// assignWorker resolves to either a confirm request (soft advisories, nothing
// written) or a completed write. removeWorker only ever completes.
export type AssignOutcome =
  | { needsConfirm: true; advisories: AssignAdvisory[] }
  | { needsConfirm: false };

// Map the RPC's snake_case hard-block reasons (and the Harnwell DB trigger message)
// to readable copy. Anything unmapped falls through verbatim so nothing is hidden.
function friendlyMessage(raw: string): string {
  const msg = raw.trim();
  // Harnwell training backstop (DB trigger check_violation): the raised text
  // mentions "non-Harnwell" / "Harnwell". Surface the training rule.
  if (/harnwell/i.test(msg)) {
    return 'Only Harnwell-trained workers (home house Harnwell) may staff the Harnwell desk.';
  }
  const MAP: Record<string, string> = {
    not_authorized: 'You are not authorized to override this house’s schedule.',
    cross_house_not_supported:
      'That worker’s home house is not this house. Cross-house placement uses pickup/float, not override.',
    user_inactive: 'That worker is inactive and cannot be assigned.',
    worker_inactive: 'That worker is inactive and cannot be assigned.',
    block_started: 'That shift has already started — it can no longer be edited.',
    float_committed:
      'This seat is committed to a float. Use the float decline / void controls instead.',
    seat_not_assignable: 'This seat cannot be assigned directly.',
    not_occupied_by_worker: 'That worker no longer holds this seat.',
    hard_cap_exceeded: 'This assignment would exceed the worker’s hard weekly hours cap.',
    block_not_found: 'That shift block could not be found.',
    empty_block_set: 'No shift blocks were selected.',
    invalid_scope: 'Invalid scope.',
  };
  // The Postgres error message may be exactly the reason, or prefixed; match the
  // first known token defensively.
  for (const [reason, friendly] of Object.entries(MAP)) {
    if (msg === reason || msg.includes(reason)) return friendly;
  }
  return msg;
}

// Guard: the operator may build this house's schedule AND the blocks belong to that
// same house. (The RPC re-checks authoritatively; this fails fast + scopes the UI.)
async function authorizeForBlocks(
  blockIds: string[],
): Promise<{ ok: true; operatorUserId: string } | { ok: false; error: string }> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) {
    return { ok: false, error: 'You are not authorized to override the schedule.' };
  }
  if (blockIds.length === 0) {
    return { ok: false, error: 'No shift blocks were selected.' };
  }
  const houseId = adminHouseId(me!);
  const service = createServiceClient();
  const { data: blocks, error } = await service
    .from('shift_blocks')
    .select('block_id, house_id')
    .in('block_id', blockIds);
  if (error !== null) return { ok: false, error: error.message };
  if ((blocks ?? []).length === 0) {
    return { ok: false, error: 'That shift block could not be found.' };
  }
  if ((blocks ?? []).some((b) => b.house_id !== houseId)) {
    return { ok: false, error: 'You can only override your own house’s schedule.' };
  }
  return { ok: true, operatorUserId: me!.userId };
}

// Assign / reassign a worker onto the clicked block(s). `overrideAdvisories=false`
// is the first step: if soft advisories apply, the RPC writes nothing and returns
// needs_confirm with the advisory kinds; the UI re-calls with the flag true.
export async function assignWorker(input: {
  blockIds: string[];
  userId: string;
  scope: OverrideScope;
  overrideAdvisories: boolean;
}): Promise<ActionResult<AssignOutcome>> {
  const authz = await authorizeForBlocks(input.blockIds);
  if (!authz.ok) return { ok: false, error: authz.error };

  const service = createServiceClient();
  const { data, error } = await service.rpc('admin_assign_worker', {
    p_operator_user_id: authz.operatorUserId,
    p_block_ids: input.blockIds,
    p_user_id: input.userId,
    p_scope: input.scope,
    p_override_advisories: input.overrideAdvisories,
    p_now: new Date().toISOString(),
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };

  const result = (data ?? {}) as {
    needs_confirm?: boolean;
    advisories?: { kind?: string }[];
  };
  if (result.needs_confirm === true) {
    const advisories: AssignAdvisory[] = (result.advisories ?? []).map((a) => ({
      kind: a.kind ?? 'unknown',
    }));
    return { ok: true, data: { needsConfirm: true, advisories } };
  }

  revalidatePath('/calendar');
  return { ok: true, data: { needsConfirm: false } };
}

// Remove a worker from the clicked block(s) — vacates the seat (this_week →
// temporary_drop, permanent → permanent_drop). No soft-confirm path.
export async function removeWorker(input: {
  blockIds: string[];
  userId: string;
  scope: OverrideScope;
}): Promise<ActionResult<undefined>> {
  const authz = await authorizeForBlocks(input.blockIds);
  if (!authz.ok) return { ok: false, error: authz.error };

  const service = createServiceClient();
  const { error } = await service.rpc('admin_remove_worker', {
    p_operator_user_id: authz.operatorUserId,
    p_block_ids: input.blockIds,
    p_user_id: input.userId,
    p_scope: input.scope,
    p_now: new Date().toISOString(),
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };

  revalidatePath('/calendar');
  return { ok: true, data: undefined };
}
