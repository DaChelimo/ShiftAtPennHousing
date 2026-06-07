import type { AppRole } from '../auth';
import { createServiceClient } from '../supabase/server';

// ===========================================================================
// People / roster — READ model (presentation + wiring over EXISTING data).
// Design screen §6.6. NEW screen → read layer only; invents no backend.
//
// Reads houses + users (home_house_id scoped) + user_roles (HM/BM people-admin
// RLS, so the service client — the authorized pattern used by the builder /
// leave / rotor reads; the page gates on isHouseAdmin + the admin's own house).
// Weekly hours are computed from counting-status shift_block_assignments in the
// relevant week (any house — a worker's cap is global); the cap comes from the
// effective_weekly_cap RPC.
//
// The Hire / Fire WRITES the design shows have no backing RPC (create-user /
// fire-worker) — the screen surfaces them disabled + flagged, never fabricated.
// See DESIGN_TOKENS.md §6.
// ===========================================================================

const NY = 'America/New_York';

// Assignment statuses that count toward a worker's worked hours (mirrors the
// canonical worker_my_shifts view: scheduled + claimed + floated-in/pending).
const COUNTING_STATUSES = ['scheduled', 'claimed', 'floated_in', 'pending_float_in'] as const;

export type PersonRow = {
  userId: string;
  name: string;
  email: string;
  homeHouseId: string;
  roles: AppRole[];
  isActive: boolean;
  /** SW/SM/HM work shifts; a BM is admin-only (no shifts). */
  hasShifts: boolean;
  weeklyHours: number;
};

export type PeopleData = {
  houseId: string;
  houseName: string;
  weekStartDate: string;
  cap: number;
  capEnforcement: 'soft' | 'hard';
  people: PersonRow[];
};

function nyDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
  return at.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

type EmbeddedBlock = { block_start_at: string };
type AsgWithBlock = {
  user_id: string | null;
  shift_blocks: EmbeddedBlock | EmbeddedBlock[] | null;
};

function startAtOf(row: AsgWithBlock): string | null {
  const sb = row.shift_blocks;
  if (sb === null) return null;
  return Array.isArray(sb) ? (sb[0]?.block_start_at ?? null) : sb.block_start_at;
}

export async function getPeopleData(houseId: string, now: Date = new Date()): Promise<PeopleData> {
  const svc = createServiceClient();
  const base: PeopleData = {
    houseId,
    houseName: houseId,
    weekStartDate: mondayOf(nyDate(now.toISOString())),
    cap: 20,
    capEnforcement: 'soft',
    people: [],
  };

  const { data: house } = await svc
    .from('houses')
    .select('id, name')
    .eq('id', houseId)
    .maybeSingle();
  if (house) base.houseName = house.name;

  const { data: userRows } = await svc
    .from('users')
    .select('user_id, name, email, home_house_id, is_active')
    .eq('home_house_id', houseId)
    .order('name');
  const users = userRows ?? [];
  const rosterIds = users.map((u) => u.user_id);
  if (rosterIds.length === 0) return base;

  const { data: roleRows } = await svc
    .from('user_roles')
    .select('user_id, role')
    .in('user_id', rosterIds);
  const rolesByUser = new Map<string, AppRole[]>();
  for (const r of roleRows ?? []) {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role as AppRole);
    rolesByUser.set(r.user_id, arr);
  }

  // Relevant week: the week of the house's most recent block, so hours reflect a
  // real published schedule; falls back to the current week when there are none.
  const { data: latestBlock } = await svc
    .from('shift_blocks')
    .select('block_start_at')
    .eq('house_id', houseId)
    .order('block_start_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const weekStart = mondayOf(
    latestBlock ? nyDate(latestBlock.block_start_at) : nyDate(now.toISOString()),
  );
  const weekEnd = addDays(weekStart, 7);
  base.weekStartDate = weekStart;

  // Per-user weekly hours: counting-status assignments whose block lands in the NY
  // week. A ±12h UTC buffer on the query bound keeps it DST-safe; the precise NY
  // week filter happens in JS. (Blocks start at 08:00 NY, far from the bound.)
  const lo = new Date(
    new Date(`${weekStart}T00:00:00Z`).getTime() - 12 * 3600 * 1000,
  ).toISOString();
  const hi = new Date(new Date(`${weekEnd}T00:00:00Z`).getTime() + 12 * 3600 * 1000).toISOString();
  const { data: asg } = await svc
    .from('shift_block_assignments')
    .select('user_id, shift_blocks!inner(block_start_at)')
    .in('user_id', rosterIds)
    .in('status', [...COUNTING_STATUSES])
    .gte('shift_blocks.block_start_at', lo)
    .lt('shift_blocks.block_start_at', hi);
  const blocksByUser = new Map<string, number>();
  for (const row of (asg ?? []) as unknown as AsgWithBlock[]) {
    const startAt = startAtOf(row);
    if (startAt === null || row.user_id === null) continue;
    const d = nyDate(startAt);
    if (d >= weekStart && d < weekEnd) {
      blocksByUser.set(row.user_id, (blocksByUser.get(row.user_id) ?? 0) + 1);
    }
  }

  // Campus-wide cap for the week.
  const { data: eff, error: capError } = await svc.rpc('effective_weekly_cap', {
    p_week_start_date: weekStart,
    p_block_start_at: `${weekStart}T00:00:00-05:00`,
  });
  if (capError === null) {
    const cap = eff?.[0] ?? { hours_cap: 20, cap_enforcement: 'soft' as const };
    base.cap = cap.hours_cap;
    base.capEnforcement = cap.cap_enforcement;
  }

  base.people = users.map((u) => {
    const roles = rolesByUser.get(u.user_id) ?? [];
    const hasShifts =
      roles.some((r) => r === 'sw' || r === 'sm' || r === 'hm') && !roles.includes('bm');
    return {
      userId: u.user_id,
      name: u.name,
      email: u.email,
      homeHouseId: u.home_house_id,
      roles,
      isActive: u.is_active,
      hasShifts,
      weeklyHours: (blocksByUser.get(u.user_id) ?? 0) * 0.5,
    };
  });
  // Active first, then keep the name order from the query.
  base.people.sort((a, b) => Number(b.isActive) - Number(a.isActive));

  return base;
}
