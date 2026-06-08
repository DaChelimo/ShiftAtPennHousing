'use server';

import { revalidatePath } from 'next/cache';

import { adminHouseId, getSessionUser, isHouseAdmin } from '../auth';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

// S4 — Fire a worker (BSpec §4.5). The destructive HR event that unwinds EVERY
// obligation of a fired worker (in-progress vacate→escalate; recurring →
// permanent drop; non-recurring → vacate; pending/acknowledged floats voided;
// pending swaps voided; deactivate) in one atomic transaction.
//
// The authoritative enforcement is the SQL RPC (fire_worker, migration
// 20260606000003) — SECURITY DEFINER, called via the service client (the same
// authorized pattern as the override / publish actions). This action adds the
// web-layer authz gate (isHouseAdmin + the target's home-house match) and
// translates the snake_case RAISE reasons into readable copy. People-admin is
// HM/BM-only (§2.3/§2.6); the RPC re-checks the gate authoritatively.
//
// S5 will add hireWorker to this same file — fireWorker is kept self-contained so
// the two do not collide.

export type FireWorkerSummary = {
  fired: boolean;
  alreadyInactive: boolean;
  inProgressEscalated: boolean;
  recurringSeatsDropped: number;
  nonRecurringVacated: number;
  floatsVoided: number;
  swapsVoided: number;
};

// Map the RPC's snake_case RAISE reasons (and the propagated step messages) to
// readable copy. Anything unmapped falls through verbatim so nothing is hidden.
function friendlyMessage(raw: string): string {
  const msg = raw.trim();
  const MAP: Record<string, string> = {
    not_authorized: 'You are not authorized to fire workers at this house.',
    worker_not_found: 'That worker could not be found.',
    semester_boundary_not_found:
      'The semester boundary for one of this worker’s shifts could not be determined. Contact an administrator.',
  };
  for (const [reason, friendly] of Object.entries(MAP)) {
    if (msg === reason || msg.includes(reason)) return friendly;
  }
  return msg;
}

// Fire a worker, deactivating their account and unwinding every shift / float /
// swap obligation. Gate: the caller is an HM/BM AND the target's home house is
// the caller's administered house (fail-fast — the RPC re-checks authoritatively).
export async function fireWorker(input: {
  userId: string;
}): Promise<ActionResult<FireWorkerSummary>> {
  const me = await getSessionUser();
  if (!isHouseAdmin(me)) {
    return { ok: false, error: 'You are not authorized to fire workers.' };
  }

  const service = createServiceClient();

  // Confirm the target is home-housed at the caller's administered house. The RPC
  // is the authoritative gate; this fails fast + scopes the UI.
  const { data: target, error: targetError } = await service
    .from('users')
    .select('home_house_id')
    .eq('user_id', input.userId)
    .maybeSingle();
  if (targetError !== null) return { ok: false, error: targetError.message };
  if (target === null) return { ok: false, error: 'That worker could not be found.' };
  if (target.home_house_id !== adminHouseId(me!)) {
    return { ok: false, error: 'You can only fire workers home-housed at your own house.' };
  }

  const { data, error } = await service.rpc('fire_worker', {
    p_initiator: me!.userId,
    p_user_id: input.userId,
    p_now: new Date().toISOString(),
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };

  const result = (data ?? {}) as {
    fired?: boolean;
    already_inactive?: boolean;
    in_progress_escalated?: boolean;
    recurring_seats_dropped?: number;
    non_recurring_vacated?: number;
    floats_voided?: number;
    swaps_voided?: number;
  };

  revalidatePath('/admin/people');
  return {
    ok: true,
    data: {
      fired: result.fired ?? false,
      alreadyInactive: result.already_inactive ?? false,
      inProgressEscalated: result.in_progress_escalated ?? false,
      recurringSeatsDropped: result.recurring_seats_dropped ?? 0,
      nonRecurringVacated: result.non_recurring_vacated ?? 0,
      floatsVoided: result.floats_voided ?? 0,
      swapsVoided: result.swaps_voided ?? 0,
    },
  };
}
