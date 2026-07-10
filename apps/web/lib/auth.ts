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
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('user_id, name, email, home_house_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profile === null || profile === undefined) return null;

  const { data: roleRows } = await supabase
    .from('user_roles')
    .select('role, scope_house_id')
    .eq('user_id', user.id);

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
}

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

// §2.3 / §2.3a / §2.6 / §2.7: HM/RSM/BM administrative powers (people, leave, rotor —
// the RSM cannot serve as HMOD, but the rotor page is still theirs to view/manage
// for their house). BM is admin-only; the RSM holds all HM admin powers. The admin
// holds these powers in EVERY house (superuser).
export function isHouseAdmin(user: SessionUser | null): boolean {
  return (
    !!user &&
    user.roles.some(
      (r) => r.role === 'hm' || r.role === 'rsm' || r.role === 'bm' || r.role === 'admin',
    )
  );
}

// §2.3a: an RSM has read-only visibility into every house's schedule.
export function isRsm(user: SessionUser | null): boolean {
  return !!user && user.roles.some((r) => r.role === 'rsm');
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
