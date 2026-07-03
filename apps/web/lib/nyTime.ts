// America/New_York wall-clock <-> timestamptz helpers for date-input values.
// DST-correct per Hard Invariant #6 (never naive timestamps, never wall-clock
// arithmetic across DST): we resolve NY's offset at the requested local instant by
// formatting it back through the zone, then correct the UTC instant by that offset.

const NY = 'America/New_York';

// The minute-resolution UTC offset (e.g. -240) for `America/New_York` at a given
// instant.
function nyOffsetMinutes(localDate: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    timeZoneName: 'shortOffset',
  });
  const part = dtf.formatToParts(localDate).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  // e.g. "GMT-4", "GMT-4:30", "GMT" (UTC) — parse hours[:minutes].
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
  if (match === null) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? '0'));
}

function nyWallClockIso(dateValue: string, hh: number, mm: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
  const [y, m, d] = dateValue.split('-').map(Number);
  const naiveUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offsetMin = nyOffsetMinutes(new Date(naiveUtc));
  return new Date(naiveUtc - offsetMin * 60 * 1000).toISOString();
}

// A `YYYY-MM-DD` date -> ISO timestamptz at end-of-day (23:59) in America/New_York:
// the latest instant a worker may still submit on the chosen day.
export function nyEndOfDayIso(dateValue: string): string | null {
  return nyWallClockIso(dateValue, 23, 59);
}

// A `YYYY-MM-DD` date -> ISO timestamptz at midnight (00:00) in America/New_York:
// the first operating instant of that day. Used to bound a deadline against a
// period start date (the deadline must fall on/before the period start).
export function nyMidnightIso(dateValue: string): string | null {
  return nyWallClockIso(dateValue, 0, 0);
}
