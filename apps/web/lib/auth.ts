import { createClient } from './supabase/server';

export type AppRole = 'sw' | 'sm' | 'hm' | 'bm';

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

// §4.3 / phase-07 note: who may build/publish a schedule — sm, hm, or bm.
export function canBuildSchedule(user: SessionUser | null): boolean {
  return !!user && user.roles.some((r) => r.role === 'sm' || r.role === 'hm' || r.role === 'bm');
}

// §2.3 / §2.6: HM/BM-only administrative powers (leave, rotor). BM is admin-only.
export function isHouseAdmin(user: SessionUser | null): boolean {
  return !!user && user.roles.some((r) => r.role === 'hm' || r.role === 'bm');
}

// §9.3: cap modification is campus-wide HM/BM authority, not house-scoped.
export const canModifyWeeklyCap = isHouseAdmin;

// The house this admin administers (first sm/hm/bm scope). Falls back to home house.
export function adminHouseId(user: SessionUser): string {
  const scoped = user.roles.find(
    (r) => (r.role === 'sm' || r.role === 'hm' || r.role === 'bm') && r.scopeHouseId !== null,
  );
  return scoped?.scopeHouseId ?? user.homeHouseId;
}
