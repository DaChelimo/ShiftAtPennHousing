import type { BusyRange } from './data/leave';

// §2.6 #1 availability hint for the replacement picker. Pure string/date arithmetic on
// plain `date` values (yyyy-mm-dd), which compare correctly lexicographically — no
// Date parsing, so no timezone shift can move a day.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-03-10" → "Mar 10". Returns the input unchanged if it is not an ISO date. */
export function formatDay(date: string): string {
  if (!ISO_DATE.test(date)) return date;
  const [, month, day] = date.split('-');
  return `${MONTHS[Number(month) - 1]} ${Number(day)}`;
}

/** Every leave of the candidate's that overlaps the requested window, inclusive. */
export function overlappingLeaves(
  busy: BusyRange[],
  startDate: string,
  endDate: string,
): BusyRange[] {
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate) || endDate < startDate) return [];
  return busy.filter((r) => r.startDate <= endDate && r.endDate >= startDate);
}

/**
 * Short availability label for a candidate over the requested window. `null` while the
 * window is incomplete, so the picker shows nothing rather than a misleading "Available".
 */
export function availabilityLabel(
  busy: BusyRange[],
  startDate: string,
  endDate: string,
): string | null {
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate) || endDate < startDate) return null;
  const clashes = overlappingLeaves(busy, startDate, endDate);
  if (clashes.length === 0) return 'Available';
  const first = clashes[0];
  const span =
    first.startDate === first.endDate
      ? formatDay(first.startDate)
      : `${formatDay(first.startDate)} to ${formatDay(first.endDate)}`;
  return clashes.length > 1 ? `On leave ${span} and more` : `On leave ${span}`;
}
