'use server';

import { adminHouseId, getSessionUser, isHouseAdmin } from '../auth';
import { generateSetupLink } from '../data/authLinks';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

// Phase D — account onboarding: invite / password-setup / reset links.
//
// Worker accounts are created (hire) with NO password; GoTrue owns credentials but
// nothing in the app previously issued a set-password link, so a hired worker had no
// way to sign in. These actions close that gap using the GoTrue admin API
// (generateLink) and the app's own /auth/update-password page as the redirect target.
//
// The link-generation itself lives in lib/data/authLinks.ts (a plain server-only helper,
// NOT a Server Action) so the raw generateSetupLink is never exposed as a public HTTP
// endpoint. People-admin is HM/BM/RSM/admin-only (isHouseAdmin) and scoped to the
// caller's administered house (the admin superuser spans all houses); the actions below
// enforce that gate BEFORE generating any link.

export type InviteLink = {
  userId: string;
  name: string;
  email: string;
  // The action link. Present when GoTrue generated it; the admin can share it directly
  // (works even without SMTP configured). Null when generation failed. Treat as a secret:
  // consuming it authenticates as that worker. Do not log or persist it.
  actionLink: string | null;
};

// Resend (or first-time issue) a set-password link for one worker. Gate: the caller is
// an HM/BM/RSM/admin AND the target is home-housed at the caller's administered house
// (the admin superuser spans every house).
export async function resendInvite(input: { userId: string }): Promise<ActionResult<InviteLink>> {
  const me = await getSessionUser();
  if (!isHouseAdmin(me)) {
    return { ok: false, error: 'You are not authorized to invite workers.' };
  }
  const service = createServiceClient();

  const { data: target, error: targetError } = await service
    .from('users')
    .select('user_id, name, email, home_house_id')
    .eq('user_id', input.userId)
    .maybeSingle();
  if (targetError !== null) return { ok: false, error: targetError.message };
  if (target === null) return { ok: false, error: 'That worker could not be found.' };

  // Scope check (the admin superuser bypasses via isAdmin inside adminHouseId? No —
  // adminHouseId is own-house; the top-level admin has no scoped house, so allow admin).
  const me2 = me!;
  const isSuperAdmin = me2.roles.some((r) => r.role === 'admin');
  if (!isSuperAdmin && target.home_house_id !== adminHouseId(me2)) {
    return { ok: false, error: 'You can only invite workers home-housed at your own house.' };
  }

  const actionLink = await generateSetupLink(target.email);
  if (actionLink === null) {
    return { ok: false, error: 'Could not generate a set-password link. Try again.' };
  }
  return {
    ok: true,
    data: { userId: target.user_id, name: target.name, email: target.email, actionLink },
  };
}

// Bulk: issue a set-password link for every ACTIVE worker home-housed at the given
// house (defaults to the caller's administered house). Used when a house goes live so
// the whole roster can be onboarded at once. Admin-only; a schedule/house admin may
// invite any house they administer. Returns one InviteLink per worker (link null on
// individual failure, so one bad address never sinks the batch).
export async function inviteHouseRoster(input?: {
  houseId?: string;
}): Promise<ActionResult<{ links: InviteLink[] }>> {
  const me = await getSessionUser();
  if (!isHouseAdmin(me)) {
    return { ok: false, error: 'You are not authorized to invite workers.' };
  }
  const me2 = me!;
  const isSuperAdmin = me2.roles.some((r) => r.role === 'admin');
  const houseId = input?.houseId ?? adminHouseId(me2);
  if (!isSuperAdmin && houseId !== adminHouseId(me2)) {
    return { ok: false, error: 'You can only invite workers at your own house.' };
  }

  const service = createServiceClient();
  const { data: roster, error } = await service
    .from('users')
    .select('user_id, name, email')
    .eq('home_house_id', houseId)
    .eq('is_active', true)
    .order('name');
  if (error !== null) return { ok: false, error: error.message };

  const links: InviteLink[] = [];
  for (const worker of roster ?? []) {
    // Serial (not Promise.all) to stay within GoTrue's admin rate limits on large rosters.
    const actionLink = await generateSetupLink(worker.email);
    links.push({
      userId: worker.user_id,
      name: worker.name,
      email: worker.email,
      actionLink,
    });
  }
  return { ok: true, data: { links } };
}
