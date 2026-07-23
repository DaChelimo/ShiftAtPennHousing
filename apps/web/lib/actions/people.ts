'use server';

import { revalidatePath } from 'next/cache';

import { adminHouseId, getSessionUser, isAdmin, isHouseAdmin } from '../auth';
import { generateSetupLink } from '../data/authLinks';
import { createServiceClient } from '../supabase/server';
import { simNow } from '../time/simClock';

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

export type AppRole = 'sw' | 'sm' | 'hm' | 'rsm' | 'bm';

export type HireWorkerSummary = {
  userId: string;
  name: string;
  email: string;
  homeHouseId: string;
  role: AppRole;
  // Phase D — the set-password link for the freshly created account (best-effort;
  // null if generation failed). The admin can share it so the worker can sign in.
  setupLink: string | null;
};

// Map the RPC's snake_case RAISE reasons (and the propagated step messages) to
// readable copy. Anything unmapped falls through verbatim so nothing is hidden.
function friendlyMessage(raw: string): string {
  const msg = raw.trim();
  const MAP: Record<string, string> = {
    not_authorized: 'You are not authorized to manage workers at this house.',
    worker_not_found: 'That worker could not be found.',
    worker_already_exists: 'A worker with that account already exists.',
    name_required: 'A worker name is required.',
    invalid_email: 'A valid email address is required.',
    house_not_found: 'That house could not be found.',
    invalid_role: 'The initial role is invalid.',
    semester_boundary_not_found:
      'The semester boundary for one of this worker’s shifts could not be determined. Contact an administrator.',
    worker_inactive: 'That worker is inactive and cannot be transferred.',
    destination_house_not_found: 'The destination house could not be found.',
    already_in_destination_house: 'That worker already belongs to the destination house.',
    effective_date_in_past: 'The effective date cannot be in the past.',
    no_upcoming_season:
      'No upcoming season was found. Choose a specific effective date for the transfer.',
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
    p_now: (await simNow()).toISOString(),
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

// T2-6 — Hire a worker (BSpec §4.5 "Hiring"). A new hire is created at any time
// during a period with NO assigned shifts, active from the moment of creation,
// holding standard capabilities for their initial role. Creating a worker spans
// auth.users (admin API, service-role) + public.users + public.user_roles: this
// action creates the auth user via the service client's admin API (the only step
// that cannot run in SQL), then delegates the app-row inserts + validation + the
// authoritative authz re-check to the hire_worker RPC (migration 20260611000004).
// The canonical reusable shape is the hire-worker Edge Function (mobile/external);
// the web admin uses the service client directly, mirroring fireWorker / saveWeeklyCap.
//
// People-admin is HM/BM-only (§6.6/§2.3/§2.6). This action gates isHouseAdmin and
// scopes the hire to the caller's administered house; the RPC re-checks the gate
// house-scoped and authoritatively. Do NOT widen to SM.
export async function hireWorker(input: {
  name: string;
  email: string;
  role: AppRole;
  phone?: string;
}): Promise<ActionResult<HireWorkerSummary>> {
  const me = await getSessionUser();
  if (!isHouseAdmin(me)) {
    return { ok: false, error: 'You are not authorized to hire workers.' };
  }

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name === '') return { ok: false, error: 'A worker name is required.' };
  if (email === '') return { ok: false, error: 'A valid email address is required.' };
  if (!['sw', 'sm', 'hm', 'rsm', 'bm'].includes(input.role)) {
    return { ok: false, error: 'Choose a valid initial role.' };
  }

  const homeHouseId = adminHouseId(me!);
  const service = createServiceClient();

  // ① Create the auth.users row (service-role admin API). Email-confirmed so the
  //    hire can sign in immediately; the deployment's invite/reset flow issues the
  //    credential. A duplicate auth user surfaces as a conflict.
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name },
  });
  if (createError !== null || created?.user == null) {
    const raw = createError?.message ?? 'Could not create the worker account.';
    return { ok: false, error: raw };
  }
  const newUserId = created.user.id;

  // ② Insert the app rows + role via the RPC (authz re-checked, validated, atomic).
  const { data, error } = await service.rpc('hire_worker', {
    p_initiator: me!.userId,
    p_user_id: newUserId,
    p_name: name,
    p_email: email,
    p_home_house_id: homeHouseId,
    p_role: input.role,
    p_phone: input.phone?.trim() || undefined,
  });
  if (error !== null) {
    // Roll back the orphaned auth user — the app rows never landed.
    await service.auth.admin.deleteUser(newUserId).catch(() => undefined);
    return { ok: false, error: friendlyMessage(error.message) };
  }

  const result = (data ?? {}) as {
    user_id?: string;
    name?: string;
    email?: string;
    home_house_id?: string;
    role?: AppRole;
  };

  // Phase D — issue the set-password link so the new hire can actually sign in.
  // Best-effort: a failure here does not undo the successful hire (the admin can
  // re-issue via "Resend invite").
  const setupLink = await generateSetupLink(email);

  revalidatePath('/admin/people');
  return {
    ok: true,
    data: {
      userId: result.user_id ?? newUserId,
      name: result.name ?? name,
      email: result.email ?? email,
      homeHouseId: result.home_house_id ?? homeHouseId,
      role: result.role ?? input.role,
      setupLink,
    },
  };
}

export type TransferWorkerSummary = {
  transferred: boolean;
  fromHouse: string;
  toHouse: string;
  effectiveDate: string; // 'YYYY-MM-DD'
  appliedNow: boolean; // true = home house changed immediately; false = scheduled
};

// Transfer a worker between houses (season-scoped membership, migration
// 20260719000001). Either the SOURCE or the DESTINATION house's HM/BM (or an
// admin) may transfer; the RPC re-checks authoritatively. A same-day effective
// date applies immediately (flips home house + vacates old-house future shifts);
// a future date records the move and the daily job applies it on the day. Passing
// no effective date defaults to the next season boundary.
//
// The worker keeps working their current house until the effective date; only the
// forward-looking surfaces (preferences + the upcoming-season builder roster) look
// ahead to the destination.
export async function transferWorker(input: {
  userId: string;
  destHouseId: string;
  effectiveDate?: string | null;
  note?: string;
}): Promise<ActionResult<TransferWorkerSummary>> {
  const me = await getSessionUser();
  if (!isHouseAdmin(me)) {
    return { ok: false, error: 'You are not authorized to transfer workers.' };
  }

  const service = createServiceClient();

  // Fail-fast either-side authz: the caller must administer the worker's current
  // house OR the destination (admins bypass). The RPC is the authoritative gate.
  const { data: target, error: targetError } = await service
    .from('users')
    .select('home_house_id, is_active')
    .eq('user_id', input.userId)
    .maybeSingle();
  if (targetError !== null) return { ok: false, error: targetError.message };
  if (target === null) return { ok: false, error: 'That worker could not be found.' };

  const myHouse = adminHouseId(me!);
  if (!isAdmin(me) && myHouse !== target.home_house_id && myHouse !== input.destHouseId) {
    return {
      ok: false,
      error: 'You can only transfer workers into or out of the house you manage.',
    };
  }

  // 'now' resolves to today's NY date from the sim clock so an immediate transfer
  // matches the RPC's app_now-based "today"; null defaults to the next season
  // boundary inside the RPC; a specific 'YYYY-MM-DD' passes through.
  let effectiveDate: string | undefined;
  if (input.effectiveDate === 'now') {
    effectiveDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
      await simNow(),
    );
  } else {
    effectiveDate = input.effectiveDate ?? undefined;
  }

  const { data, error } = await service.rpc('transfer_worker', {
    p_initiator: me!.userId,
    p_user_id: input.userId,
    p_dest_house_id: input.destHouseId,
    p_effective_date: effectiveDate,
    p_note: input.note?.trim() || undefined,
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };

  const result = (data ?? {}) as {
    from_house?: string;
    to_house?: string;
    effective_date?: string;
    applied_now?: boolean;
  };

  revalidatePath('/admin/people');
  return {
    ok: true,
    data: {
      transferred: true,
      fromHouse: result.from_house ?? target.home_house_id,
      toHouse: result.to_house ?? input.destHouseId,
      effectiveDate: result.effective_date ?? '',
      appliedNow: result.applied_now ?? false,
    },
  };
}
