import type { AppRole } from '../auth';
import { createServiceClient } from '../supabase/server';

// ===========================================================================
// Hours report — READ model (presentation + wiring over EXISTING data).
// Design screen §6.10. NEW screen → read layer only; invents no backend.
//
// Per-worker weekly hours, DECOMPOSED into worked-at-home / worked-while-
// floated-out / worked-via-cross-house-pickup, against the week's cap. The
// kind classification mirrors the canonical worker_my_shifts view exactly
// (20260605000001_worker_read_model_views.sql):
//   * scheduled                        -> home base
//   * floated_in / pending_float_in    -> floated out (covering elsewhere)
//   * claimed + is_cross_house_pickup  -> cross-house pickup
//   * claimed (same house)             -> a home pickup, folded into "at home"
// Each 30-min block = 0.5h. Cap via the effective_weekly_cap RPC.
//
// Service client (the authorized house-scoped snapshot used by builder / leave /
// rotor / people); the page gates on canBuildSchedule (SM/HM/BM) + the admin's
// own house — the same managerial-read pattern as coverage.
// ===========================================================================

const NY = 'America/New_York';
const COUNTING_STATUSES = ['scheduled', 'claimed', 'floated_in', 'pending_float_in'] as const;

export type HoursRow = {
  userId: string;
  name: string;
  homeHours: number;
  floatedOutHours: number;
  pickupHours: number;
  totalHours: number;
};

export type HoursReport = {
  houseId: string;
  houseName: string;
  weekStartDate: string;
  cap: number;
  capEnforcement: 'soft' | 'hard';
  rows: HoursRow[];
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
type AsgRow = {
  user_id: string | null;
  status: string;
  is_cross_house_pickup: boolean;
  shift_blocks: EmbeddedBlock | EmbeddedBlock[] | null;
};

function startAtOf(row: AsgRow): string | null {
  const sb = row.shift_blocks;
  if (sb === null) return null;
  return Array.isArray(sb) ? (sb[0]?.block_start_at ?? null) : sb.block_start_at;
}

type Tally = { home: number; floatedOut: number; pickup: number };

export async function getHoursReport(
  houseId: string,
  now: Date = new Date(),
): Promise<HoursReport> {
  const svc = createServiceClient();
  const base: HoursReport = {
    houseId,
    houseName: houseId,
    weekStartDate: mondayOf(nyDate(now.toISOString())),
    cap: 20,
    capEnforcement: 'soft',
    rows: [],
  };

  const { data: house } = await svc
    .from('houses')
    .select('id, name')
    .eq('id', houseId)
    .maybeSingle();
  if (house) base.houseName = house.name;

  // Roster = home-housed people who work shifts (sw/sm/hm, not bm).
  const { data: userRows } = await svc
    .from('users')
    .select('user_id, name')
    .eq('home_house_id', houseId)
    .order('name');
  const users = userRows ?? [];
  const allIds = users.map((u) => u.user_id);
  if (allIds.length === 0) return base;

  const { data: roleRows } = await svc
    .from('user_roles')
    .select('user_id, role')
    .in('user_id', allIds);
  const rolesByUser = new Map<string, AppRole[]>();
  for (const r of roleRows ?? []) {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role as AppRole);
    rolesByUser.set(r.user_id, arr);
  }
  const workers = users.filter((u) => {
    const roles = rolesByUser.get(u.user_id) ?? [];
    return (
      roles.some((r) => r === 'sw' || r === 'sm' || r === 'hm' || r === 'rsm') &&
      !roles.includes('bm')
    );
  });
  const workerIds = workers.map((w) => w.user_id);
  if (workerIds.length === 0) return base;

  // Relevant week: week of the house's most recent block, else the current week.
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

  // Counting-status assignments for the workers whose block lands in the NY week
  // (±12h UTC buffer keeps the bound DST-safe; precise NY filter in JS).
  const lo = new Date(
    new Date(`${weekStart}T00:00:00Z`).getTime() - 12 * 3600 * 1000,
  ).toISOString();
  const hi = new Date(new Date(`${weekEnd}T00:00:00Z`).getTime() + 12 * 3600 * 1000).toISOString();
  const { data: asg } = await svc
    .from('shift_block_assignments')
    .select('user_id, status, is_cross_house_pickup, shift_blocks!inner(block_start_at)')
    .in('user_id', workerIds)
    .in('status', [...COUNTING_STATUSES])
    .gte('shift_blocks.block_start_at', lo)
    .lt('shift_blocks.block_start_at', hi);

  const tally = new Map<string, Tally>();
  for (const row of (asg ?? []) as unknown as AsgRow[]) {
    const startAt = startAtOf(row);
    if (startAt === null || row.user_id === null) continue;
    const d = nyDate(startAt);
    if (d < weekStart || d >= weekEnd) continue;
    const t = tally.get(row.user_id) ?? { home: 0, floatedOut: 0, pickup: 0 };
    if (row.status === 'floated_in' || row.status === 'pending_float_in') t.floatedOut += 1;
    else if (row.status === 'claimed' && row.is_cross_house_pickup) t.pickup += 1;
    else t.home += 1; // scheduled, or a same-house claim
    tally.set(row.user_id, t);
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

  base.rows = workers.map((w) => {
    const t = tally.get(w.user_id) ?? { home: 0, floatedOut: 0, pickup: 0 };
    const homeHours = t.home * 0.5;
    const floatedOutHours = t.floatedOut * 0.5;
    const pickupHours = t.pickup * 0.5;
    return {
      userId: w.user_id,
      name: w.name,
      homeHours,
      floatedOutHours,
      pickupHours,
      totalHours: homeHours + floatedOutHours + pickupHours,
    };
  });
  base.rows.sort((a, b) => b.totalHours - a.totalHours || a.name.localeCompare(b.name));

  return base;
}
