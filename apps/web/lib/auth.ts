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

// §4.3 / phase-07 note: who may build/publish a schedule — sm, hm, rsm, or bm.
export function canBuildSchedule(user: SessionUser | null): boolean {
  return (
    !!user &&
    user.roles.some(
      (r) => r.role === 'sm' || r.role === 'hm' || r.role === 'rsm' || r.role === 'bm',
    )
  );
}

// §2.3 / §2.3a / §2.6: HM/RSM/BM administrative powers (people, leave, rotor —
// the RSM cannot serve as HMOD, but the rotor page is still theirs to view/manage
// for their house). BM is admin-only (Building Administrator); the RSM holds all
// HM admin powers. The campus-wide Project Admin superuser sees everything an
// HM/RSM/BM can, so it's included here rather than re-OR'd at every call site.
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

// Project-administrator superuser (user_role_enum 'admin'; operating-seasons + break
// authoring). Campus-wide, house-agnostic.
export function isAdmin(user: SessionUser | null): boolean {
  return !!user && user.roles.some((r) => r.role === 'admin');
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
