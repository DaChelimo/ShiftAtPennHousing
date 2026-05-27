import { fromZonedTime, toZonedTime } from 'date-fns-tz';

const TZ = 'America/New_York';
const BLOCK_MINUTES = 30;
const BLOCK_MS = BLOCK_MINUTES * 60 * 1000;

// Snap backward to the nearest 30-minute boundary in America/New_York.
export function blockBoundary(t: Date): Date {
  const local = toZonedTime(t, TZ);
  const elapsedSinceBoundaryMs =
    ((local.getMinutes() % BLOCK_MINUTES) * 60 + local.getSeconds()) * 1000 +
    local.getMilliseconds();

  return new Date(t.getTime() - elapsedSinceBoundaryMs);
}

// Add n * 30 minutes as elapsed duration, not wall-clock time.
export function addBlocks(t: Date, n: number): Date {
  return new Date(t.getTime() + n * BLOCK_MS);
}

// Monday 00:00:00 in America/New_York for the week containing t.
export function weekStart(t: Date): Date {
  const local = toZonedTime(t, TZ);
  const daysSinceMonday = (local.getDay() + 6) % 7;

  local.setDate(local.getDate() - daysSinceMonday);
  local.setHours(0, 0, 0, 0);

  return fromZonedTime(local, TZ);
}

// True if t falls within the local calendar week starting at week.
export function weekContains(week: Date, t: Date): boolean {
  const localWeek = toZonedTime(week, TZ);
  localWeek.setDate(localWeek.getDate() + 7);
  localWeek.setHours(0, 0, 0, 0);

  const weekEnd = fromZonedTime(localWeek, TZ);
  return t.getTime() >= week.getTime() && t.getTime() < weekEnd.getTime();
}

export function dayType(t: Date): 'weekday' | 'weekend' {
  const day = toZonedTime(t, TZ).getDay();
  return day === 0 || day === 6 ? 'weekend' : 'weekday';
}

export function blocksBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / BLOCK_MS;
}
