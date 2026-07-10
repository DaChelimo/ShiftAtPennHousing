// Worker semester-preference painter — PURE view-model (zero Supabase, zero clock).
//
// The web worker portal lets a Student Worker paint their weekly availability for a
// scheduling period: every 30-minute block of a representative week is `preferred`,
// `available`, or `cannot`. Unpainted blocks are `available`. This mirrors the mobile
// shared painter (apps/mobile/.../preferences/Preferences.kt) but lays the week out
// for a laptop: one grid of time-of-day ROWS by weekday COLUMNS, click-drag paintable.
//
// The data layer resolves each block's NY weekday + minute-of-day via `blockWeekSlot`
// (the only tz-aware helper here) and hands this module plain PrefBlock records, so the
// grid/paint/submit logic stays arithmetic and trivially testable.

import { toZonedTime } from 'date-fns-tz';

import type { PreferenceStatus } from '../scheduling/phase1Grouping.js';

// The three actionable brushes. `none` is only a read sentinel (treated as available).
export type PrefBrush = 'available' | 'preferred' | 'cannot';

// Palette order shown in the UI toolbar.
export const PREF_BRUSHES: readonly PrefBrush[] = ['preferred', 'available', 'cannot'] as const;

// Soft weekly-hours default target (stepper increments of 2; §4.4).
export const PREF_DEFAULT_CAP_HOURS = 20;
export const PREF_TARGET_STEP = 2;

const TZ = 'America/New_York';
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

// A block in the representative week, annotated with its NY weekly slot.
// weekday: 0 = Monday … 6 = Sunday. minuteOfDay: minutes since NY midnight.
export type PrefBlock = {
  blockId: string;
  weekday: number;
  minuteOfDay: number;
};

// The tz-aware seam: map a block's absolute start to its NY weekly slot.
export function blockWeekSlot(startAt: Date): { weekday: number; minuteOfDay: number } {
  const local = toZonedTime(startAt, TZ);
  const weekday = (local.getDay() + 6) % 7; // Sun=0..Sat=6 -> Mon=0..Sun=6
  const minuteOfDay = local.getHours() * 60 + local.getMinutes();
  return { weekday, minuteOfDay };
}

// blockId -> brush. Absence means `available` (the neutral default).
export type PrefGrid = Record<string, PrefBrush>;

export function brushOf(grid: PrefGrid, blockId: string): PrefBrush {
  return grid[blockId] ?? 'available';
}

// Return a new grid with `blockId` set to `brush`. Setting `available` clears the
// entry (keeps the grid sparse = only meaningful paint is stored).
export function paint(grid: PrefGrid, blockId: string, brush: PrefBrush): PrefGrid {
  const next = { ...grid };
  if (brush === 'available') {
    delete next[blockId];
  } else {
    next[blockId] = brush;
  }
  return next;
}

// Tap semantics: tapping a block already holding the active brush ERASES it back to
// available; otherwise it paints the active brush.
export function toggledBrushFor(current: PrefBrush, active: PrefBrush): PrefBrush {
  return current === active ? 'available' : active;
}

// Drag semantics ("decide by drag start"): the whole sweep paints the active brush,
// unless it STARTED on a block already holding it, in which case the sweep erases.
export function dragBrushForStart(startCurrent: PrefBrush, active: PrefBrush): PrefBrush {
  return startCurrent === active ? 'available' : active;
}

// Build the initial grid from persisted preference rows. `available`/`none` collapse
// to the sparse default; only `preferred`/`cannot` are stored.
export function buildInitialGrid(rows: { blockId: string; status: PreferenceStatus }[]): PrefGrid {
  const grid: PrefGrid = {};
  for (const r of rows) {
    if (r.status === 'preferred' || r.status === 'cannot') {
      grid[r.blockId] = r.status;
    }
  }
  return grid;
}

// Format a minute-of-day as a 12-hour NY clock label, e.g. 480 -> "8:00 AM".
export function formatMinuteOfDay(minuteOfDay: number): string {
  const h24 = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12)}:${String(m).padStart(2, '0')} ${period}`;
}

export type PrefRow = {
  minuteOfDay: number;
  label: string;
  // One entry per weekday (index 0..6); a blockId when the house operates that
  // slot that day, else null (no shift there — renders as an inert gap).
  cells: (string | null)[];
};

export type PrefWeekLayout = {
  dayLabels: readonly string[];
  rows: PrefRow[];
};

// Assemble the laptop week grid: distinct time-of-day rows (ascending) x 7 day
// columns. A cell is the blockId operating that weekday+slot, or null.
export function buildWeekLayout(blocks: PrefBlock[]): PrefWeekLayout {
  const minutes = [...new Set(blocks.map((b) => b.minuteOfDay))].sort((a, b) => a - b);
  const bySlot = new Map<string, string>();
  for (const b of blocks) {
    bySlot.set(`${String(b.minuteOfDay)}:${String(b.weekday)}`, b.blockId);
  }
  const rows: PrefRow[] = minutes.map((minuteOfDay) => ({
    minuteOfDay,
    label: formatMinuteOfDay(minuteOfDay),
    cells: Array.from(
      { length: 7 },
      (_, weekday) => bySlot.get(`${String(minuteOfDay)}:${String(weekday)}`) ?? null,
    ),
  }));
  return { dayLabels: WEEKDAY_LABELS, rows };
}

// Does a weekday column carry any non-available paint? (drives the day-header dot)
export function dayHasPaint(blocks: PrefBlock[], grid: PrefGrid, weekday: number): boolean {
  return blocks.some((b) => b.weekday === weekday && brushOf(grid, b.blockId) !== 'available');
}

export function clampTarget(hours: number, capHours: number): number {
  if (!Number.isFinite(hours)) return 0;
  return Math.max(0, Math.min(capHours, Math.round(hours)));
}

// Effective target hours: forced to 0 when the worker opts out ("no hours").
export function effectiveTarget(targetHours: number, optedOut: boolean): number {
  return optedOut ? 0 : Math.max(0, targetHours);
}

export type PrefEntry = { block_id: string; status: PreferenceStatus };

// Full-grid upsert payload: every block gets an explicit status (its brush, or
// `available` when unpainted). Matches the mobile submit contract + the EF schema.
export function buildSubmitPayload(blocks: PrefBlock[], grid: PrefGrid): PrefEntry[] {
  return blocks.map((b) => ({ block_id: b.blockId, status: brushOf(grid, b.blockId) }));
}

// Total painted (preferred + available, i.e. willing-to-work) is not needed; the
// meter tracks the worker's chosen TARGET, not painted count. Kept intentionally
// out — target is authoritative per §4.4.
