// NY-anchored display formatters shared by the worker web feeds (My Shifts, Open Shifts,
// Swaps). TypeScript ports of the mobile shared formatters in
// apps/mobile/.../shifts/MyShiftPresentation.kt, so both platforms render identical copy.
// All labels are user-facing: hyphen separators only, never em/en dashes (AGENTS.md).

const NY = 'America/New_York';

const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// NY-local wall-clock parts of an instant, DST-correct.
function nyLocal(t: Date): { hour: number; minute: number; isoDow: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(t);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const dowMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const monthMap: Record<string, number> = {
    Jan: 1,
    Feb: 2,
    Mar: 3,
    Apr: 4,
    May: 5,
    Jun: 6,
    Jul: 7,
    Aug: 8,
    Sep: 9,
    Oct: 10,
    Nov: 11,
    Dec: 12,
  };
  // '24' at midnight in some ICU builds → normalize to 0.
  const hour = get('hour') === '24' ? 0 : Number(get('hour'));
  return {
    hour,
    minute: Number(get('minute')),
    isoDow: dowMap[get('weekday')] ?? 1,
    month: monthMap[get('month')] ?? 1,
    day: Number(get('day')),
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/** "HH:mm" in America/New_York. */
export function formatBlockTime(t: Date): string {
  const l = nyLocal(t);
  return `${pad2(l.hour)}:${pad2(l.minute)}`;
}

/** "HH:mm - HH:mm" (hyphen separator). */
export function formatTimeRange(start: Date, end: Date): string {
  return `${formatBlockTime(start)} - ${formatBlockTime(end)}`;
}

/** "Wed · Jun 3" — day-of-week + short month + day, NY-anchored. */
export function formatDayLabel(t: Date): string {
  const l = nyLocal(t);
  return `${DOW_SHORT[l.isoDow - 1]} · ${MONTH_SHORT[l.month - 1]} ${String(l.day)}`;
}

/** "Every Wed" — the recurring day-of-week label for a permanent opening. */
export function formatRecurringDayLabel(t: Date): string {
  const l = nyLocal(t);
  return `Every ${DOW_SHORT[l.isoDow - 1]}`;
}

/** "4h" / "2h 30m" / "30m" — duration arithmetic on instants (DST-safe). */
export function formatDuration(start: Date, end: Date): string {
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${String(h)}h ${String(m)}m`;
  if (h > 0) return `${String(h)}h`;
  return `${String(m)}m`;
}

/** "4h" / "2h 30m" / "30m" from a raw 30-minute block count (time not yet known). */
export function formatHoursFromBlocks(blocks: number): string {
  const mins = blocks * 30;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${String(h)}h ${String(m)}m`;
  if (h > 0) return `${String(h)}h`;
  return `${String(m)}m`;
}

/** "14h" / "14.5h" — strips a whole-number decimal. */
export function formatHours(hours: number): string {
  return hours % 1 === 0 ? `${String(Math.trunc(hours))}h` : `${String(hours)}h`;
}
