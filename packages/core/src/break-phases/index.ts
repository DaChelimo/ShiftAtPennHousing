import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export interface BreakPhaseOffsets {
  openDays: number;
  alertDays: number;
  closeDays: number;
}

export interface BreakPhases {
  openAt: Date;
  alertAt: Date;
  closeAt: Date;
}

function localMidnightMinusDays(date: Date, days: number, tz: string): Date {
  const local = toZonedTime(date, tz);
  local.setHours(0, 0, 0, 0);
  local.setDate(local.getDate() - days);
  return fromZonedTime(local, tz);
}

export function computeBreakPhases(
  breakStartDate: Date,
  offsets: BreakPhaseOffsets,
  tz: string,
): BreakPhases {
  return {
    openAt: localMidnightMinusDays(breakStartDate, offsets.openDays, tz),
    alertAt: localMidnightMinusDays(breakStartDate, offsets.alertDays, tz),
    closeAt: localMidnightMinusDays(breakStartDate, offsets.closeDays, tz),
  };
}
