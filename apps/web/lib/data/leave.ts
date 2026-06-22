import { adminHouseId, type SessionUser } from '../auth';
import { createServiceClient } from '../supabase/server';

export type ReplacementOption = { userId: string; name: string; role: string };

export type ActiveLeave = {
  leaveId: string;
  startDate: string;
  endDate: string;
  replacementName: string | null;
};

export type LeaveAdminData = {
  candidates: ReplacementOption[];
  defaultReplacementUserId: string | null;
  myActiveLeaves: ActiveLeave[];
};

function roleLabel(role: string): string {
  if (role === 'bm') return 'Building Manager';
  if (role === 'hm') return 'Housing Manager';
  if (role === 'rsm') return 'Residential Services Manager';
  return 'Project administrator';
}

// §2.6 replacement picker. Cross-house reads use the service client: an HM legitimately
// needs to see HMs/BMs at other houses as candidates, and to walk active leave chains for
// cycle prevention — both beyond their own-house RLS scope. Reads only; the write is the
// HM's own leave row (server action, user-scoped).
export async function getLeaveAdminData(me: SessionUser): Promise<LeaveAdminData> {
  const svc = createServiceClient();
  const myHouse = adminHouseId(me);

  // HM/RSM/BM candidates with their (first) admin role + house. §2.3a adds the
  // RSM to the leave hierarchy (RSM → HM → BM …).
  const { data: roleRows } = await svc
    .from('user_roles')
    .select('user_id, role, scope_house_id')
    .in('role', ['hm', 'rsm', 'bm']);

  const roleByUser = new Map<string, { role: string; house: string | null }>();
  for (const r of roleRows ?? []) {
    if (!roleByUser.has(r.user_id)) {
      roleByUser.set(r.user_id, { role: r.role, house: r.scope_house_id });
    }
  }
  const adminUserIds = [...roleByUser.keys()];

  const { data: userRows } = await svc
    .from('users')
    .select('user_id, name, is_active')
    .in(
      'user_id',
      adminUserIds.length > 0 ? adminUserIds : ['00000000-0000-0000-0000-000000000000'],
    );
  const nameById = new Map<string, string>();
  const activeById = new Map<string, boolean>();
  for (const u of userRows ?? []) {
    nameById.set(u.user_id, u.name);
    activeById.set(u.user_id, u.is_active);
  }

  // Active leave chain: user → their current replacement. Used to detect cycles.
  const { data: leaveRows } = await svc
    .from('hm_leave')
    .select('user_id, replacement_user_id, start_date, end_date, status')
    .eq('status', 'active');
  const replacementOf = new Map<string, string | null>();
  for (const l of leaveRows ?? []) {
    replacementOf.set(l.user_id, l.replacement_user_id);
  }

  // A candidate is in `me`'s INCOMING chain iff following their forward replacement
  // chain reaches `me` — selecting them would create a cycle (§2.6).
  const reachesMe = (start: string): boolean => {
    const seen = new Set<string>();
    let cursor: string | null | undefined = replacementOf.get(start);
    while (cursor != null && !seen.has(cursor)) {
      if (cursor === me.userId) return true;
      seen.add(cursor);
      cursor = replacementOf.get(cursor) ?? null;
    }
    return false;
  };

  // Project administrator — always a valid terminal replacement, never excluded (§2.6).
  const { data: cfg } = await svc
    .from('system_config')
    .select('config_value')
    .eq('config_key', 'project_administrator_user_id')
    .maybeSingle();
  const projectAdminId = (cfg?.config_value as string | undefined) ?? null;

  // Default replacement (§2.6 #1, §2.3a): same-house, role-aware by the LEAVER's
  // own rank — an RSM defaults down to the HM; an HM defaults to the BM; a BM
  // defaults to the HM. The RSM is offered as a fallback to everyone.
  const sameHouseAdmins = adminUserIds.filter(
    (id) => id !== me.userId && roleByUser.get(id)?.house === myHouse,
  );
  const myAdminRole =
    me.roles.find((r) => r.role === 'rsm' || r.role === 'hm' || r.role === 'bm')?.role ?? null;
  const preferenceOrder =
    myAdminRole === 'rsm'
      ? ['hm', 'bm', 'rsm']
      : myAdminRole === 'hm'
        ? ['bm', 'rsm', 'hm']
        : ['hm', 'rsm', 'bm'];
  const defaultReplacementUserId =
    preferenceOrder
      .map((role) => sameHouseAdmins.find((id) => roleByUser.get(id)?.role === role))
      .find((id) => id !== undefined) ?? null;

  const optionIds = new Set<string>();
  for (const id of adminUserIds) {
    if (id === me.userId) continue;
    if (activeById.get(id) === false) continue;
    if (reachesMe(id)) continue; // incoming-chain exclusion
    optionIds.add(id);
  }
  // The default and the project administrator are always offered.
  if (defaultReplacementUserId !== null) optionIds.add(defaultReplacementUserId);

  const candidates: ReplacementOption[] = [...optionIds].map((id) => ({
    userId: id,
    name: nameById.get(id) ?? id,
    role: roleLabel(roleByUser.get(id)?.role ?? 'hm'),
  }));

  if (projectAdminId !== null && !optionIds.has(projectAdminId)) {
    const { data: adminUser } = await svc
      .from('users')
      .select('name')
      .eq('user_id', projectAdminId)
      .maybeSingle();
    candidates.push({
      userId: projectAdminId,
      name: adminUser?.name ?? 'Project Administrator',
      role: roleLabel('admin'),
    });
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  // My own active leaves (for the "I'm back" early-return control).
  const { data: mine } = await svc
    .from('hm_leave')
    .select('leave_id, start_date, end_date, replacement_user_id')
    .eq('user_id', me.userId)
    .eq('status', 'active')
    .order('start_date');
  const myActiveLeaves: ActiveLeave[] = (mine ?? []).map((l) => ({
    leaveId: l.leave_id,
    startDate: l.start_date,
    endDate: l.end_date,
    replacementName:
      l.replacement_user_id !== null ? (nameById.get(l.replacement_user_id) ?? null) : null,
  }));

  return { candidates, defaultReplacementUserId, myActiveLeaves };
}
