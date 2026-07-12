import {
  blockWeekSlot,
  buildInitialGrid,
  PREF_DEFAULT_CAP_HOURS,
  weekContains,
  weekStart,
  type PrefBlock,
  type PrefGrid,
} from '@shift/core';

import { nyMidnightIso } from '../../nyTime';
import { createClient } from '../../supabase/server';

// Either request-scoped client works: the signed-in worker's RLS client (the
// worker's own board) or a service-role client (a schedule builder reading /
// authoring another worker's board cross-house — see /admin/preferences/[userId]).
type PreferenceClient = Awaited<ReturnType<typeof createClient>>;

// ===========================================================================
// Worker semester-preference board — READ model (the SW's own submission).
//
// Wires the EXISTING backend the mobile worker app uses (no new tables):
//   * Active period    — scheduling_periods (RLS shows only open/published rows);
//                        pick most recent unpublished, else most recent overall
//                        (mirrors mobile PreferencesRepository + web admin loader).
//   * Template week    — the representative Mon..Sun of the period's start week;
//                        shift_blocks at the worker's home house, annotated with
//                        their NY weekday + minute-of-day for the paint grid.
//   * Prefill          — own `preferences` rows (brush) + `period_targets`
//                        (target hours / opted out).
//   * Deadline         — preference_deadline_is_open semantics evaluated against
//                        the request's `now` (sim-clock aware).
//
// Read as the signed-in worker (RLS-scoped), so it only ever returns their data.
// A schedule builder authoring on a worker's behalf passes a service-role client
// (see the `client` param) to read that worker's board across houses.
// ===========================================================================

const NY = 'America/New_York';

export type WorkerPreferencePeriod = {
  periodId: string;
  periodName: string;
  startDate: string;
  endDate: string;
  deadlineIso: string | null;
  deadlineLabel: string | null;
};

export type WorkerPreferenceBoard = {
  period: WorkerPreferencePeriod | null;
  blocks: PrefBlock[];
  initialGrid: PrefGrid;
  targetHours: number;
  optedOut: boolean;
  capHours: number;
  /** May the worker still submit? False once the deadline passes (read-only). */
  deadlineOpen: boolean;
  /** Has the worker already submitted for this period (prefs or a target row)? */
  submitted: boolean;
};

function formatDeadline(iso: string | null): string | null {
  if (iso === null) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

// The empty board (no visible period) — the page renders a "no window open" state.
function emptyBoard(): WorkerPreferenceBoard {
  return {
    period: null,
    blocks: [],
    initialGrid: {},
    targetHours: PREF_DEFAULT_CAP_HOURS,
    optedOut: false,
    capHours: PREF_DEFAULT_CAP_HOURS,
    deadlineOpen: false,
    submitted: false,
  };
}

export async function getWorkerPreferenceBoard(
  userId: string,
  homeHouseId: string,
  now: Date,
  client?: PreferenceClient,
): Promise<WorkerPreferenceBoard> {
  const supabase = client ?? (await createClient());

  // 1. Visible periods (RLS narrows to open/published); pick most recent
  //    unpublished, else most recent overall.
  const { data: periodRows } = await supabase
    .from('scheduling_periods')
    .select('period_id, period_name, start_date, end_date, preference_deadline, published_at')
    .order('start_date', { ascending: false });
  const periods = periodRows ?? [];
  if (periods.length === 0) return emptyBoard();
  const active = periods.find((p) => p.published_at === null) ?? periods[0];

  const deadlineIso = active.preference_deadline;
  const period: WorkerPreferencePeriod = {
    periodId: active.period_id,
    periodName: active.period_name,
    startDate: active.start_date,
    endDate: active.end_date,
    deadlineIso,
    deadlineLabel: formatDeadline(deadlineIso),
  };
  const deadlineOpen = deadlineIso === null || now.getTime() <= new Date(deadlineIso).getTime();

  // 2. Representative week: Monday on/before the period start (NY), through +8d
  //    (generous upper bound), then trimmed DST-correctly by weekContains.
  const startMidnightIso = nyMidnightIso(active.start_date);
  if (startMidnightIso === null) return { ...emptyBoard(), period };
  const week = weekStart(new Date(startMidnightIso));
  const upperBound = new Date(week.getTime() + 8 * 24 * 60 * 60 * 1000);

  const { data: blockRows } = await supabase
    .from('shift_blocks')
    .select('block_id, block_start_at')
    .eq('house_id', homeHouseId)
    .gte('block_start_at', week.toISOString())
    .lt('block_start_at', upperBound.toISOString())
    .order('block_start_at', { ascending: true });

  const blocks: PrefBlock[] = (blockRows ?? [])
    .filter((b) => weekContains(week, new Date(b.block_start_at)))
    .map((b) => {
      const { weekday, minuteOfDay } = blockWeekSlot(new Date(b.block_start_at));
      return { blockId: b.block_id, weekday, minuteOfDay };
    });

  // 3. Prefill: own preference rows + target row for this period.
  const blockIds = new Set(blocks.map((b) => b.blockId));
  const { data: prefRows } = await supabase
    .from('preferences')
    .select('block_id, status')
    .eq('user_id', userId)
    .eq('period_id', active.period_id);
  const relevantPrefs = (prefRows ?? []).filter((p) => blockIds.has(p.block_id));
  const initialGrid = buildInitialGrid(
    relevantPrefs.map((p) => ({ blockId: p.block_id, status: p.status })),
  );

  const { data: targetRow } = await supabase
    .from('period_targets')
    .select('target_hours, opted_out')
    .eq('user_id', userId)
    .eq('period_id', active.period_id)
    .maybeSingle();

  const submitted = relevantPrefs.length > 0 || targetRow !== null;

  return {
    period,
    blocks,
    initialGrid,
    targetHours: targetRow?.target_hours ?? PREF_DEFAULT_CAP_HOURS,
    optedOut: targetRow?.opted_out ?? false,
    capHours: PREF_DEFAULT_CAP_HOURS,
    deadlineOpen,
    submitted,
  };
}
