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
const BLOCK_MINUTES = 30;

// A run of contiguous 30-min blocks at ONE other house, coalesced into one
// displayed shift (mirrors the coalescing worker-facing screens already do
// for their own cards). Used for both floated-out and cross-house-pickup
// entries — the two categories differ only in which status produced them.
export type ShiftEntry = {
  houseName: string;
  dayLabel: string; // "Wed"
  dateLabel: string; // "Jul 23"
  startLabel: string; // "14:00"
  endLabel: string; // "17:30"
  hours: number;
};

export type HoursRow = {
  userId: string;
  name: string;
  email: string;
  homeHours: number;
  floatedOutHours: number;
  pickupHours: number;
  totalHours: number;
  floatShifts: ShiftEntry[];
  pickupShifts: ShiftEntry[];
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

const DAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short' });
const DATE_FMT = new Intl.DateTimeFormat('en-US', { timeZone: NY, month: 'short', day: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: NY,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// Coalesces a user's blocks at OTHER houses (sorted, deduped by ISO start) into
// displayed shifts: a run of blocks at the SAME house is one shift as long as
// each next block starts exactly BLOCK_MINUTES after the previous one, matching
// how the worker-facing cards coalesce contiguous blocks
// (packages/core/src/worker-shifts). Grouping by house first, THEN coalescing,
// keeps a same-time back-to-back pair at two different houses from merging.
function coalesceShiftsByHouse(
  blocks: { startAt: string; houseId: string }[],
  houseNames: Map<string, string>,
): ShiftEntry[] {
  const byHouse = new Map<string, string[]>();
  for (const b of blocks) {
    const arr = byHouse.get(b.houseId) ?? [];
    arr.push(b.startAt);
    byHouse.set(b.houseId, arr);
  }

  const entries: ShiftEntry[] = [];
  for (const [houseId, startTimesIso] of byHouse) {
    const houseName = houseNames.get(houseId) ?? houseId;
    const sorted = [...new Set(startTimesIso)].sort();
    let runStart: Date | null = null;
    let runEnd: Date | null = null;

    const flush = () => {
      if (runStart === null || runEnd === null) return;
      const endAt = new Date(runEnd.getTime() + BLOCK_MINUTES * 60 * 1000);
      entries.push({
        houseName,
        dayLabel: DAY_FMT.format(runStart),
        dateLabel: DATE_FMT.format(runStart),
        startLabel: TIME_FMT.format(runStart),
        endLabel: TIME_FMT.format(endAt),
        hours: (endAt.getTime() - runStart.getTime()) / (1000 * 60 * 60),
      });
    };

    for (const iso of sorted) {
      const at = new Date(iso);
      if (runEnd !== null && at.getTime() === runEnd.getTime() + BLOCK_MINUTES * 60 * 1000) {
        runEnd = at;
      } else {
        flush();
        runStart = at;
        runEnd = at;
      }
    }
    flush();
  }

  entries.sort((a, b) =>
    `${a.dateLabel}${a.startLabel}`.localeCompare(`${b.dateLabel}${b.startLabel}`),
  );
  return entries;
}

type EmbeddedBlock = { block_start_at: string; house_id: string };
type AsgRow = {
  user_id: string | null;
  status: string;
  is_cross_house_pickup: boolean;
  shift_blocks: EmbeddedBlock | EmbeddedBlock[] | null;
};

function blockOf(row: AsgRow): EmbeddedBlock | null {
  const sb = row.shift_blocks;
  if (sb === null) return null;
  return Array.isArray(sb) ? (sb[0] ?? null) : sb;
}

type HouseBlock = { startAt: string; houseId: string };
type Tally = {
  home: number;
  floatedOut: number;
  pickup: number;
  floatBlocks: HouseBlock[];
  pickupBlocks: HouseBlock[];
};
const emptyTally = (): Tally => ({
  home: 0,
  floatedOut: 0,
  pickup: 0,
  floatBlocks: [],
  pickupBlocks: [],
});

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

  // house/userRows/latestBlock only depend on houseId, so fetch them together
  // instead of paying three sequential round trips (this project points at a
  // remote Supabase instance — each round trip is ~165ms, not local-docker-fast).
  const [{ data: house }, { data: userRows }, { data: latestBlock }] = await Promise.all([
    svc.from('houses').select('id, name').eq('id', houseId).maybeSingle(),
    // Roster = home-housed people who work shifts (sw/sm/hm, not bm).
    svc.from('users').select('user_id, name, email').eq('home_house_id', houseId).order('name'),
    // Relevant week: week of the house's most recent block, else the current week.
    svc
      .from('shift_blocks')
      .select('block_start_at')
      .eq('house_id', houseId)
      .order('block_start_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (house) base.houseName = house.name;

  const users = userRows ?? [];
  const allIds = users.map((u) => u.user_id);
  if (allIds.length === 0) return base;

  const weekStart = mondayOf(
    latestBlock ? nyDate(latestBlock.block_start_at) : nyDate(now.toISOString()),
  );
  const weekEnd = addDays(weekStart, 7);
  base.weekStartDate = weekStart;

  // roleRows depends on the roster above; eff only depends on weekStart (already
  // resolved) — independent of each other, so fetch together.
  const [{ data: roleRows }, { data: eff, error: capError }] = await Promise.all([
    svc.from('user_roles').select('user_id, role').in('user_id', allIds),
    svc.rpc('effective_weekly_cap', {
      p_week_start_date: weekStart,
      p_block_start_at: `${weekStart}T00:00:00-05:00`,
    }),
  ]);
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

  // Counting-status assignments for the workers whose block lands in the NY week
  // (±12h UTC buffer keeps the bound DST-safe; precise NY filter in JS).
  const lo = new Date(
    new Date(`${weekStart}T00:00:00Z`).getTime() - 12 * 3600 * 1000,
  ).toISOString();
  const hi = new Date(new Date(`${weekEnd}T00:00:00Z`).getTime() + 12 * 3600 * 1000).toISOString();
  // house_id rides along with every block: a floated_in/pending_float_in or a
  // cross-house claimed row always lands on a block at ANOTHER house, so this
  // is the destination house for that shift — no extra join needed.
  const { data: asg } = await svc
    .from('shift_block_assignments')
    .select('user_id, status, is_cross_house_pickup, shift_blocks!inner(block_start_at, house_id)')
    .in('user_id', workerIds)
    .in('status', [...COUNTING_STATUSES])
    .gte('shift_blocks.block_start_at', lo)
    .lt('shift_blocks.block_start_at', hi);

  const tally = new Map<string, Tally>();
  for (const row of (asg ?? []) as unknown as AsgRow[]) {
    const block = blockOf(row);
    if (block === null || row.user_id === null) continue;
    const d = nyDate(block.block_start_at);
    if (d < weekStart || d >= weekEnd) continue;
    const t = tally.get(row.user_id) ?? emptyTally();
    const houseBlock = { startAt: block.block_start_at, houseId: block.house_id };
    if (row.status === 'floated_in' || row.status === 'pending_float_in') {
      t.floatedOut += 1;
      t.floatBlocks.push(houseBlock);
    } else if (row.status === 'claimed' && row.is_cross_house_pickup) {
      t.pickup += 1;
      t.pickupBlocks.push(houseBlock);
    } else t.home += 1; // scheduled, or a same-house claim
    tally.set(row.user_id, t);
  }

  if (capError === null) {
    const cap = eff?.[0] ?? { hours_cap: 20, cap_enforcement: 'soft' as const };
    base.cap = cap.hours_cap;
    base.capEnforcement = cap.cap_enforcement;
  }

  // Every house_id seen across all workers' float/pickup blocks, resolved once
  // (not per row) — usually a handful of houses, never the full roster of 13.
  const otherHouseIds = new Set<string>();
  for (const t of tally.values()) {
    for (const b of t.floatBlocks) otherHouseIds.add(b.houseId);
    for (const b of t.pickupBlocks) otherHouseIds.add(b.houseId);
  }
  const houseNames = new Map<string, string>();
  if (otherHouseIds.size > 0) {
    const { data: otherHouses } = await svc
      .from('houses')
      .select('id, name')
      .in('id', [...otherHouseIds]);
    for (const h of otherHouses ?? []) houseNames.set(h.id, h.name);
  }

  base.rows = workers.map((w) => {
    const t = tally.get(w.user_id) ?? emptyTally();
    const homeHours = t.home * 0.5;
    const floatedOutHours = t.floatedOut * 0.5;
    const pickupHours = t.pickup * 0.5;
    return {
      userId: w.user_id,
      name: w.name,
      email: w.email,
      homeHours,
      floatedOutHours,
      pickupHours,
      totalHours: homeHours + floatedOutHours + pickupHours,
      floatShifts: coalesceShiftsByHouse(t.floatBlocks, houseNames),
      pickupShifts: coalesceShiftsByHouse(t.pickupBlocks, houseNames),
    };
  });
  base.rows.sort((a, b) => b.totalHours - a.totalHours || a.name.localeCompare(b.name));

  return base;
}
