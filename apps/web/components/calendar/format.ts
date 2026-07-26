import type { CalState } from '../../lib/data/calendar';
import type { IconName, TagKind } from '../ui';

// Grid geometry (matches the design: 23px per 30-min block, 34px day header).
export const BLOCK_H = 23;
export const HEAD_H = 34;
// Fallback origin/span for callers with no CalendarModel in scope (kept in sync
// with lib/data/calendar.ts's DEFAULT_DAY_START_MIN). The house/week grid itself
// no longer uses these constants directly — it reads model.dayStartMin /
// model.blocksPerDay, which are DERIVED from the earliest block actually seen
// that week, so an earlier-opening house/season isn't clipped. See
// [[project_operating_seasons]] band-window notes in AGENTS.md.
export const DEFAULT_DAY_START_MIN = 8 * 60; // 08:00
export const BLOCKS = 32; // 08:00 → 24:00 (fallback span only)
export const HALF = BLOCKS / 2; // split point for single-staff day view (16:00)

// Block index → NY wall-clock label, relative to `originMin` (minutes since
// midnight of the grid's first row). Defaults to the 08:00 fallback origin for
// callers that don't have a model's derived dayStartMin in scope.
export function blockLabel(b: number, originMin: number = DEFAULT_DAY_START_MIN): string {
  const total = originMin + b * 30;
  const hour = Math.floor(total / 60);
  const min = total % 60;
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function spanLabel(start: number, end: number, originMin?: number): string {
  return `${blockLabel(start, originMin)}-${blockLabel(end, originMin)}`;
}

// A shift card's own time label should never depend on the grid's shared
// origin — it's derived straight from the block's real timestamp, so it's
// correct even for a shift that starts before the column's usual open (e.g. an
// early summer Harnwell shift) and even if the grid origin logic ever changes.
function nyMinutesOfIso(iso: string): number {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function shiftOriginMinutes(shift: { startAtIso: string; startBlock: number }): number {
  return nyMinutesOfIso(shift.startAtIso) - shift.startBlock * 30;
}

// One decimal place, no trailing ".0" — the shared hours format across the calendar
// (header chips, cap hints, edit-section labels).
export function fmtH(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function blocksToHours(start: number, end: number): string {
  return fmtH((end - start) / 2);
}

// --- date-key (YYYY-MM-DD) math, calendar-only (no time zone needed) ---
function parse(key: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}
export function addDaysKey(key: string, n: number): string {
  const at = parse(key);
  at.setUTCDate(at.getUTCDate() + n);
  return at.toISOString().slice(0, 10);
}
export function weeksBetween(aKey: string, bKey: string): number {
  return Math.round((parse(aKey).getTime() - parse(bKey).getTime()) / (7 * 86400000));
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDateKey(key: string): string {
  const at = parse(key);
  return `${MON[at.getUTCMonth()]} ${at.getUTCDate()}`;
}
export function fmtRange(mondayKey: string): string {
  return `${fmtDateKey(mondayKey)} - ${fmtDateKey(addDaysKey(mondayKey, 6))}`;
}
export function relWeekLabel(weekKey: string, thisMondayKey: string): string {
  const n = weeksBetween(weekKey, thisMondayKey);
  if (n === 0) return 'This week';
  return n < 0 ? `${Math.abs(n)}w ago` : `In ${n}w`;
}

// --- CalState → visual meta (card class + status tag) ---
type StateMeta = {
  cls: string;
  tag: { kind: TagKind; label: string; icon?: IconName } | null;
  dot: boolean;
};

export const CAL_STATE_META: Record<CalState, StateMeta> = {
  scheduled: { cls: 'sc-scheduled', tag: null, dot: false },
  floatin: {
    cls: 'sc-float',
    tag: { kind: 'green', label: 'Float-in', icon: 'arrowRight' },
    dot: false,
  },
  pickup: { cls: 'sc-scheduled', tag: { kind: 'gray', label: 'Picked up' }, dot: true },
  xpickup: { cls: 'sc-float', tag: { kind: 'green', label: 'Picked up' }, dot: true },
  'pending-in': {
    cls: 'sc-float',
    tag: { kind: 'amber', label: 'Pending', icon: 'clock' },
    dot: false,
  },
  allied: { cls: 'sc-allied', tag: { kind: 'teal', label: 'Allied', icon: 'shield' }, dot: false },
  gap: { cls: 'sc-gap', tag: { kind: 'outline', label: 'Open shift' }, dot: false },
  'perm-gap': { cls: 'sc-perm', tag: { kind: 'magenta', label: 'Permanent opening' }, dot: false },
};

// Fallback display name for a card with no assigned worker.
export function emptyCardName(state: CalState): string {
  if (state === 'allied') return 'Allied';
  if (state === 'perm-gap') return 'Permanent opening';
  return 'Open shift';
}
