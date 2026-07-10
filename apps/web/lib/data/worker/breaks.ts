import { blockWeekSlot, formatMinuteOfDay } from '@shift/core';

import { createClient } from '../../supabase/server';

// ===========================================================================
// Worker break-claim board — READ model (the SW's own claimable break shifts).
//
// Wires the existing backend the mobile worker app uses (no new tables):
//   * Active break     — soonest break_periods row not yet ended.
//   * Claim phase      — break_claim_phase RPC (pre_open | claim_window | open_feed);
//                        claiming only succeeds in claim_window.
//   * Claimable grid   — house_schedule_grid rows for the worker's home house across
//                        the break window, grouped per block into seat states
//                        (claimable / mine / full).
//   * Opt-out          — break_optouts row presence ("no break hours").
//
// The seeded break profiles run 08:00-00:00 (no after-midnight blocks), so blocks
// map cleanly to their NY calendar date columns.
// ===========================================================================

const NY = 'America/New_York';

export type BreakSeatState = 'claimable' | 'mine' | 'full';

export type BreakCell = {
  blockId: string;
  state: BreakSeatState;
  vacant: number;
  required: number;
} | null;

export type BreakRow = {
  minuteOfDay: number;
  label: string;
  cells: BreakCell[]; // indexed by date column
};

export type WorkerBreakBoard = {
  break: { breakId: string; breakName: string; startDate: string; endDate: string } | null;
  phase: string;
  claimable: boolean;
  optedOut: boolean;
  houseName: string;
  dates: string[];
  dateLabels: string[];
  rows: BreakRow[];
};

function nyDateOf(iso: string): string {
  // 'YYYY-MM-DD' NY calendar date of an absolute instant.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
  return parts;
}

function dateLabel(dateIso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${dateIso}T12:00:00-05:00`));
}

// Inclusive list of YYYY-MM-DD dates from start to end.
function datesBetween(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function emptyBoard(): WorkerBreakBoard {
  return {
    break: null,
    phase: 'pre_open',
    claimable: false,
    optedOut: false,
    houseName: '',
    dates: [],
    dateLabels: [],
    rows: [],
  };
}

export async function getWorkerBreakBoard(
  userId: string,
  homeHouseId: string,
  now: Date,
): Promise<WorkerBreakBoard> {
  const supabase = await createClient();
  const todayNy = nyDateOf(now.toISOString());

  // 1. Soonest break not yet ended.
  const { data: breakRows } = await supabase
    .from('break_periods')
    .select('break_id, break_name, start_date, end_date')
    .gte('end_date', todayNy)
    .order('start_date', { ascending: true })
    .limit(1);
  const brk = (breakRows ?? [])[0];
  if (brk === undefined) return emptyBoard();

  // 2. Claim phase.
  const { data: phaseVal } = await supabase.rpc('break_claim_phase', {
    p_break_id: brk.break_id,
    p_as_of: now.toISOString(),
  });
  const phase = typeof phaseVal === 'string' ? phaseVal : 'pre_open';

  // 3. Opt-out.
  const { count: optCount } = await supabase
    .from('break_optouts')
    .select('*', { count: 'exact', head: true })
    .eq('break_id', brk.break_id)
    .eq('user_id', userId);
  const optedOut = (optCount ?? 0) > 0;

  // 4. Grid rows across the break window at the home house.
  const windowStart = new Date(`${brk.start_date}T00:00:00-05:00`);
  const windowEnd = new Date(`${brk.end_date}T23:59:59-04:00`);
  const { data: gridRows } = await supabase
    .from('house_schedule_grid')
    .select('id, start_at, status, user_id, block_id, required_headcount, house_name')
    .eq('house_id', homeHouseId)
    .gte('start_at', windowStart.toISOString())
    .lte('start_at', windowEnd.toISOString())
    .order('start_at', { ascending: true });

  const houseName = (gridRows ?? [])[0]?.house_name ?? '';
  const dates = datesBetween(brk.start_date, brk.end_date);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  // Group seat rows per block.
  type Agg = {
    blockId: string;
    date: string;
    minuteOfDay: number;
    vacant: number;
    required: number;
    mine: boolean;
  };
  const byBlock = new Map<string, Agg>();
  for (const r of gridRows ?? []) {
    if (r.block_id === null || r.start_at === null) continue;
    const date = nyDateOf(r.start_at);
    if (!dateIndex.has(date)) continue;
    const { minuteOfDay } = blockWeekSlot(new Date(r.start_at));
    const agg =
      byBlock.get(r.block_id) ??
      ({
        blockId: r.block_id,
        date,
        minuteOfDay,
        vacant: 0,
        required: r.required_headcount ?? 1,
        mine: false,
      } satisfies Agg);
    if (r.status === 'vacant') agg.vacant += 1;
    if (r.user_id === userId) agg.mine = true;
    byBlock.set(r.block_id, agg);
  }

  // Assemble time-row x date-column grid.
  const minutes = [...new Set([...byBlock.values()].map((a) => a.minuteOfDay))].sort(
    (a, b) => a - b,
  );
  const cellAt = new Map<string, BreakCell>();
  for (const a of byBlock.values()) {
    const state: BreakSeatState = a.mine ? 'mine' : a.vacant > 0 ? 'claimable' : 'full';
    cellAt.set(`${String(a.minuteOfDay)}:${a.date}`, {
      blockId: a.blockId,
      state,
      vacant: a.vacant,
      required: a.required,
    });
  }
  const rows: BreakRow[] = minutes.map((minuteOfDay) => ({
    minuteOfDay,
    label: formatMinuteOfDay(minuteOfDay),
    cells: dates.map((d) => cellAt.get(`${String(minuteOfDay)}:${d}`) ?? null),
  }));

  return {
    break: {
      breakId: brk.break_id,
      breakName: brk.break_name,
      startDate: brk.start_date,
      endDate: brk.end_date,
    },
    phase,
    claimable: phase === 'claim_window',
    optedOut,
    houseName,
    dates,
    dateLabels: dates.map(dateLabel),
    rows,
  };
}
