'use server';

import { revalidatePath } from 'next/cache';

import { adminHouseId, canBuildSchedule, getSessionUser, isScheduleAdmin } from '../auth';
import { createServiceClient } from '../supabase/server';
import { simNow } from '../time/simClock';

import type { ActionResult } from './builder';

// S1 — Admin override (BSpec §4.3 Phase-3, §11.1). Live inline assign / reassign /
// remove on a published block, this-week-vs-permanent, with a soft-advisory confirm.
// A `this_week` seat of ANY age — past, started, or future — is editable (D1,
// amended 2026-07-29); only the schedule-write authz gate below still applies.
//
// The authoritative enforcement is the SQL RPC (admin_assign_worker /
// admin_remove_worker, migration 20260606000001, past-edit amendment
// 20260729000001) — SECURITY DEFINER, called via the service client (same
// authorized pattern as publishScheduleAction). These actions add the web-layer
// authz gate (canBuildSchedule + admin-house match) and translate the
// snake_case RAISE reasons / the soft-confirm signal into the UI shape.

export type OverrideScope = 'this_week' | 'permanent';

export type AssignAdvisory = { kind: string };

// assignWorker resolves to either a confirm request (soft advisories, nothing
// written) or a completed write. The completed write carries `assignedCount` —
// the number of seats actually filled — so the UI can warn when a write was a
// no-op (e.g. a permanent assign whose future occurrences are all already
// filled). removeWorker only ever completes.
export type AssignOutcome =
  | { needsConfirm: true; advisories: AssignAdvisory[] }
  | { needsConfirm: false; assignedCount: number; scope: OverrideScope };

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
    no_future_occurrences:
      'No future occurrence of this slot remains this term to apply the pattern to.',
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

// Guard: the operator may build the blocks' house. A schedule admin (hm/bm/rsm,
// 2026-06-27 cross-house) may override any house; an sm only their own. The blocks
// must still belong to a single house the operator is authorized for. (The RPC
// re-checks user_can_build_schedule authoritatively; this fails fast + scopes UI.)
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
  const service = createServiceClient();
  const { data: blocks, error } = await service
    .from('shift_blocks')
    .select('block_id, house_id')
    .in('block_id', blockIds);
  if (error !== null) return { ok: false, error: error.message };
  if ((blocks ?? []).length === 0) {
    return { ok: false, error: 'That shift block could not be found.' };
  }
  // sm stays own-house; schedule admins may act on any (single) house.
  if (!isScheduleAdmin(me)) {
    const houseId = adminHouseId(me!);
    if ((blocks ?? []).some((b) => b.house_id !== houseId)) {
      return { ok: false, error: 'You can only override your own house’s schedule.' };
    }
  }
  return { ok: true, operatorUserId: me!.userId };
}

// Assign / replace a worker onto the clicked block(s). `overrideAdvisories=false`
// is the first step: if soft advisories apply, the RPC writes nothing and returns
// needs_confirm with the advisory kinds; the UI re-calls with the flag true.
//
// `incumbentUserId` distinguishes REPLACE (hand a still-occupied seat to a new
// worker) from filling an open shift: when set, the RPC overwrites THAT worker's
// seat on each block instead of preferring a vacant one — without it, a block that
// also carries a vacant seat would get the new worker added beside the incumbent
// (the original reassign bug). Omit it for empty-seat assignment.
export async function assignWorker(input: {
  blockIds: string[];
  userId: string;
  scope: OverrideScope;
  overrideAdvisories: boolean;
  incumbentUserId?: string | null;
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
    p_now: (await simNow()).toISOString(),
    ...(input.incumbentUserId ? { p_incumbent_user_id: input.incumbentUserId } : {}),
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };

  const result = (data ?? {}) as {
    needs_confirm?: boolean;
    advisories?: { kind?: string }[];
    assigned_count?: number;
  };
  if (result.needs_confirm === true) {
    const advisories: AssignAdvisory[] = (result.advisories ?? []).map((a) => ({
      kind: a.kind ?? 'unknown',
    }));
    return { ok: true, data: { needsConfirm: true, advisories } };
  }

  revalidatePath('/calendar');
  return {
    ok: true,
    data: {
      needsConfirm: false,
      assignedCount: result.assigned_count ?? 0,
      scope: input.scope,
    },
  };
}

// Float a Harnwell worker out to another house for the clicked block(s) (Harnwell
// pilot workstream G/B2). blockIds are the Harnwell SOURCE blocks the worker
// currently holds; the destination blocks are minted on demand by
// manager_float_worker. Reuses authorizeForBlocks, which already scopes correctly
// to Harnwell (an sm must be Harnwell's own sm; hm/bm/rsm/admin may act on any house
// including Harnwell).
export async function floatWorker(input: {
  blockIds: string[];
  userId: string;
  destinationHouseId: string;
}): Promise<ActionResult<{ floatId: string }>> {
  const authz = await authorizeForBlocks(input.blockIds);
  if (!authz.ok) return { ok: false, error: authz.error };

  const service = createServiceClient();
  const { data: blocks, error: blocksError } = await service
    .from('shift_blocks')
    .select('block_start_at')
    .in('block_id', input.blockIds)
    .order('block_start_at', { ascending: true });
  if (blocksError !== null) return { ok: false, error: blocksError.message };
  if ((blocks ?? []).length === 0) {
    return { ok: false, error: 'No shift blocks were selected.' };
  }

  const starts = (blocks ?? []).map((b) => new Date(b.block_start_at));
  const rangeStart = starts[0]!;
  const rangeEnd = new Date(starts[starts.length - 1]!.getTime() + 30 * 60 * 1000);

  const { data, error } = await service.rpc('manager_float_worker', {
    p_initiator_user_id: authz.operatorUserId,
    p_worker_id: input.userId,
    p_destination_house_id: input.destinationHouseId,
    p_range_start: rangeStart.toISOString(),
    p_range_end: rangeEnd.toISOString(),
    p_now: (await simNow()).toISOString(),
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };

  const result = (data ?? {}) as { float_id?: string };
  revalidatePath('/calendar');
  revalidatePath('/floaters');
  return { ok: true, data: { floatId: result.float_id ?? '' } };
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
    p_now: (await simNow()).toISOString(),
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };

  revalidatePath('/calendar');
  return { ok: true, data: undefined };
}

// Shrink, extend, or cancel a manager-directed float (workstream C). Cancel is
// signalled by omitting both range bounds. Authorization here is house-scoped to
// Harnwell (the float's own source house) since only the source side's manager can
// have floated the worker out in the first place.
export async function editFloat(input: {
  floatId: string;
  rangeStart: string | null;
  rangeEnd: string | null;
}): Promise<
  ActionResult<{ blocksAdded: number; blocksRemoved: number; blocksLostToClaim: number }>
> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) {
    return { ok: false, error: 'You are not authorized to edit this float.' };
  }
  if (!isScheduleAdmin(me) && adminHouseId(me!) !== 'harnwell') {
    return { ok: false, error: 'You can only edit floats sourced from your own house.' };
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc('manager_edit_float', {
    p_initiator_user_id: me!.userId,
    p_float_id: input.floatId,
    p_new_range_start: input.rangeStart,
    p_new_range_end: input.rangeEnd,
    p_now: (await simNow()).toISOString(),
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };

  const result = (data ?? {}) as {
    edited?: boolean;
    reason?: string;
    blocks_added?: number;
    blocks_removed?: number;
    blocks_lost_to_claim?: number;
  };
  if (result.edited !== true) {
    return {
      ok: false,
      error: friendlyMessage(result.reason ?? 'This float could not be edited.'),
    };
  }

  revalidatePath('/calendar');
  revalidatePath('/floaters');
  return {
    ok: true,
    data: {
      blocksAdded: result.blocks_added ?? 0,
      blocksRemoved: result.blocks_removed ?? 0,
      blocksLostToClaim: result.blocks_lost_to_claim ?? 0,
    },
  };
}
