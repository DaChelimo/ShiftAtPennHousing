import { cache } from 'react';

import { createClient } from './supabase/server';

export type AppRole = 'sw' | 'sm' | 'hm' | 'rsm' | 'bm' | 'admin';

export type UserRole = { role: AppRole; scopeHouseId: string | null };

export type SessionUser = {
  userId: string;
  name: string;
  email: string;
  homeHouseId: string;
  roles: UserRole[];
};

// Resolve the signed-in user plus their profile + roles, or null if no session.
//
// Wrapped in React's cache() (cost audit F-07). This is called 84 times across the
// codebase, and BOTH the layout and the page call it on every render — plus every
// (app)/admin/* page, every (worker)/home/* page, and multi-call server actions
// (kbIntake.ts calls it 7 times, builder.ts 5, worker/swaps.ts and worker/shifts.ts 4
// each). Each unwrapped call was 1 GoTrue HTTP round trip + 2 DB queries, so a single
// navigation paid 3 GoTrue calls and 4 DB queries before a byte of page data.
//
// Next.js does NOT dedupe this on its own: automatic request deduplication in the App
// Router applies to fetch() calls the framework instruments, and a supabase-js call
// through @supabase/ssr is not one of them.
//
// cache() is PER-REQUEST, which is the only correct granularity here and the reason this
// is safe. A cross-request cache would be a genuine authorization bug, because
// writeHouseId() and canBuildForHouse() derive write scope from this object. Do not
// replace it with a module-level or global cache.
//
// The proxy's own supabase.auth.getUser() (proxy.ts) deliberately stays: it is the
// redirect gate, it runs before the render pass, and its result is not shareable across
// the proxy/render boundary.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  // getClaims() rather than getUser(): both verify the token (getSession does not, which
  // is why it is not used here), but getUser() is an HTTP call to GoTrue every time —
  // 100-150ms against the hosted project, on top of the identical call the proxy already
  // made for the same request. This project's tokens are ES256, so getClaims verifies the
  // signature locally against a once-per-process JWKS fetch: ~3-6ms. The user id is the
  // only thing this function needed from the response; name/email/house come from the
  // `users` row below, which is the authoritative profile anyway.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (userId === undefined) return null;

  // Neither query depends on the other's result (both key off user.id alone), so
  // run them concurrently instead of paying two sequential round trips — this
  // project points at a remote Supabase instance (~165ms/call), not local docker,
  // so serial vs. parallel here is the difference between ~330ms and ~165ms on
  // every single navigation (getSessionUser is called by the layout AND the page).
  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase
      .from('users')
      .select('user_id, name, email, home_house_id')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('user_roles').select('role, scope_house_id').eq('user_id', userId),
  ]);
  if (profile === null || profile === undefined) return null;

  return {
    userId: profile.user_id,
    name: profile.name,
    email: profile.email,
    homeHouseId: profile.home_house_id,
    roles: (roleRows ?? []).map((r) => ({
      role: r.role as AppRole,
      scopeHouseId: r.scope_house_id,
    })),
  };
});

// §2.7: the top-level administrator (house-agnostic superuser). Operated by the
// project owner in v1; authors operating configuration (seasons) and holds every
// power below it in every house. Mirrors the SQL user_is_admin predicate.
export function isAdmin(user: SessionUser | null): boolean {
  return !!user && user.roles.some((r) => r.role === 'admin');
}

// §4.3 / phase-07 note: who may build/publish a schedule — sm, hm, rsm, bm, admin.
export function canBuildSchedule(user: SessionUser | null): boolean {
  return (
    !!user &&
    user.roles.some(
      (r) =>
        r.role === 'sm' ||
        r.role === 'hm' ||
        r.role === 'rsm' ||
        r.role === 'bm' ||
        r.role === 'admin',
    )
  );
}

// §2.3 / §2.3a / §2.6 / §2.7: HM/RSM/BM administrative powers (people, leave, cap).
// BM is admin-only (Building Administrator); the RSM holds all HM admin powers
// EXCEPT the HMOD rotor (see canManageHmodRotor below). The campus-wide Project
// Admin superuser sees everything an HM/RSM/BM can, so it's included here rather
// than re-OR'd at every call site.
export function isHouseAdmin(user: SessionUser | null): boolean {
  return (
    !!user &&
    user.roles.some(
      (r) => r.role === 'hm' || r.role === 'rsm' || r.role === 'bm' || r.role === 'admin',
    )
  );
}

// §2.5: the HMOD rotor is planned by the HMs and BMs themselves — the RSM is never
// HMOD-eligible (ARCH §21.2) and, unlike the rest of isHouseAdmin's surface, does not
// get to plan the rotor either. Deliberately narrower than isHouseAdmin.
export function canManageHmodRotor(user: SessionUser | null): boolean {
  return !!user && user.roles.some((r) => r.role === 'hm' || r.role === 'bm' || r.role === 'admin');
}

// §2.3a: an RSM has read-only visibility into every house's schedule.
export function isRsm(user: SessionUser | null): boolean {
  return !!user && user.roles.some((r) => r.role === 'rsm');
}

// 2026-07-13 ruling: a plain Student Manager gets read-only cross-house VIEW of the
// live schedule/calendar (like a worker can), so the house switcher unlocks for
// them. This is a VIEW-only widening: every SM write stays pinned to their home
// house via isScheduleAdmin / adminHouseId (SM is excluded from isScheduleAdmin).
export function isStudentManager(user: SessionUser | null): boolean {
  return !!user && user.roles.some((r) => r.role === 'sm');
}

// §2.1: does this user hold the Student Worker role? Workers get the /home
// worker experience (their own shifts, open pickups, break claims, preferences).
export function isWorker(user: SessionUser | null): boolean {
  return !!user && user.roles.some((r) => r.role === 'sw');
}

// Does this user have ANY admin surface (schedule build / house admin / superuser)?
// Pure Student Workers do not — the admin console layout redirects them to /home,
// and dual-role users get a "Switch to worker view" affordance. Equivalent to
// canBuildSchedule today (which already spans sm/hm/rsm/bm/admin) but named for
// intent so the routing decision reads clearly at call sites.
export function hasAdminSurface(user: SessionUser | null): boolean {
  return canBuildSchedule(user) || isHouseAdmin(user);
}

// 2026-06-27 cross-house decision: the elevated admin tier — HM, BM, RSM — may
// EDIT any house's SCHEDULE (build/publish/override/force-trigger + builder
// inputs), not only their own. Mirrors the SQL user_is_schedule_admin predicate.
// SM is deliberately excluded — it stays own-house. (People admin / leave / cap
// remain own-house via isHouseAdmin + adminHouseId.)
export function isScheduleAdmin(user: SessionUser | null): boolean {
  return (
    !!user &&
    user.roles.some(
      (r) => r.role === 'hm' || r.role === 'rsm' || r.role === 'bm' || r.role === 'admin',
    )
  );
}

// May this user build the schedule for `houseId`? A schedule admin (hm/bm/rsm)
// may build any house; everyone else (sm) only their own scoped house. The DB
// re-checks this authoritatively via user_can_build_schedule, so this is the
// fail-fast / clean-error web gate for the cross-house write actions.
export function canBuildForHouse(user: SessionUser | null, houseId: string): boolean {
  if (user === null) return false;
  return isScheduleAdmin(user) || adminHouseId(user) === houseId;
}

// The house a SCHEDULE write/read should target: a schedule admin honors the
// requested (viewed) house when it's real; everyone else is pinned to their own
// admin house. Write-side analogue of resolveCalendarHouse (@shift/core). Used by
// the schedule-build pages so an HM viewing another house edits THAT house.
export function writeHouseId(
  user: SessionUser,
  requestedHouseId: string | null | undefined,
  validHouseIds: string[],
): string {
  if (
    isScheduleAdmin(user) &&
    requestedHouseId != null &&
    validHouseIds.includes(requestedHouseId)
  ) {
    return requestedHouseId;
  }
  return adminHouseId(user);
}

// §9.3: cap modification is campus-wide HM/RSM/BM authority, not house-scoped.
export const canModifyWeeklyCap = isHouseAdmin;

// The house this admin administers (first sm/hm/rsm/bm scope). Falls back to home
// house. Every WRITE is scoped through this id, so an RSM viewing another house
// (via the switcher) still cannot edit it — their admin house stays their own.
export function adminHouseId(user: SessionUser): string {
  const scoped = user.roles.find(
    (r) =>
      (r.role === 'sm' || r.role === 'hm' || r.role === 'rsm' || r.role === 'bm') &&
      r.scopeHouseId !== null,
  );
  return scoped?.scopeHouseId ?? user.homeHouseId;
}
