import { fromZonedTime } from 'date-fns-tz';

import type {
  BreakCap,
  BreakClaimBoundaries,
  BreakClaimOffsets,
  BreakClaimPhase,
  BreakClaimPhaseInput,
  BreakNagCandidate,
  BreakType,
} from './types.js';

const BREAK_TIMEZONE = 'America/New_York';

export const DEFAULT_BREAK_CLAIM_OFFSETS: BreakClaimOffsets = {
  openOffsetDays: 14,
  alertOffsetDays: 3,
  closeOffsetDays: 1,
};

function localMidnightMinusDays(startDate: string, days: number): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (match === null) {
    throw new Error(`Invalid break start date: ${startDate}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  calendarDate.setUTCDate(calendarDate.getUTCDate() - days);

  const offsetDate = [
    String(calendarDate.getUTCFullYear()).padStart(4, '0'),
    String(calendarDate.getUTCMonth() + 1).padStart(2, '0'),
    String(calendarDate.getUTCDate()).padStart(2, '0'),
  ].join('-');

  return fromZonedTime(`${offsetDate}T00:00:00`, BREAK_TIMEZONE);
}

export function computeBreakClaimBoundaries(input: BreakClaimPhaseInput): BreakClaimBoundaries {
  const offsets = input.offsets ?? DEFAULT_BREAK_CLAIM_OFFSETS;
  return {
    openAt: localMidnightMinusDays(input.break.startDate, offsets.openOffsetDays),
    alertAt: localMidnightMinusDays(input.break.startDate, offsets.alertOffsetDays),
    closeAt: localMidnightMinusDays(input.break.startDate, offsets.closeOffsetDays),
  };
}

export function breakClaimPhaseAt(input: BreakClaimPhaseInput, now: Date): BreakClaimPhase {
  const boundaries = computeBreakClaimBoundaries(input);
  if (now.getTime() < boundaries.openAt.getTime()) {
    return 'pre_open';
  }
  if (now.getTime() < boundaries.closeAt.getTime()) {
    return 'claim_window';
  }
  return 'open_feed';
}

export function isBreakHighlighted(input: BreakClaimPhaseInput, now: Date): boolean {
  return now.getTime() >= computeBreakClaimBoundaries(input).openAt.getTime();
}

export function breakHoursCap(breakType: BreakType): BreakCap {
  if (breakType === 'spring_fling' || breakType === 'other') {
    return { capHours: 20, capEnforcement: 'soft' };
  }
  return { capHours: 40, capEnforcement: 'hard' };
}

export function selectBreakClaimNagRecipients(candidates: BreakNagCandidate[]): string[] {
  return candidates
    .filter((candidate) => !candidate.hasClaimedAnyShift && !candidate.hasIndicatedZeroHours)
    .map((candidate) => candidate.userId);
}

export type {
  BreakCap,
  BreakClaimBoundaries,
  BreakClaimOffsets,
  BreakClaimPhase,
  BreakClaimPhaseInput,
  BreakNagCandidate,
  BreakPeriodRef,
  BreakType,
} from './types.js';
