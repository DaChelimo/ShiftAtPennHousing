import { weekContains } from '../time/index.js';

const HOURS_PER_BLOCK = 0.5;

export type AssignmentForHours = {
  blockStartAt: Date;
  isFloat: boolean;
  isCrossHousePickup: boolean;
};

export type WeekRef = {
  weekStartAt: Date;
};

export type HoursDecomposition = {
  totalHours: number;
  atHomeHours: number;
  floatOutHours: number;
  crossHousePickupHours: number;
};

export type CapCheckInput = {
  currentWeeklyHours: number;
  proposedClaimBlocks: number;
  hoursCap: number;
  capEnforcement: 'soft' | 'hard';
};

export type CapCheckResult =
  | { ok: true; warning?: 'soft_cap_exceeded' }
  | { ok: false; reason: 'hard_cap_exceeded' };

export function computeWeeklyHours(
  assignments: AssignmentForHours[],
  week: WeekRef,
): HoursDecomposition {
  const result: HoursDecomposition = {
    totalHours: 0,
    atHomeHours: 0,
    floatOutHours: 0,
    crossHousePickupHours: 0,
  };

  for (const assignment of assignments) {
    if (!weekContains(week.weekStartAt, assignment.blockStartAt)) {
      continue;
    }

    result.totalHours += HOURS_PER_BLOCK;

    if (assignment.isFloat) {
      result.floatOutHours += HOURS_PER_BLOCK;
    } else if (assignment.isCrossHousePickup) {
      result.crossHousePickupHours += HOURS_PER_BLOCK;
    } else {
      result.atHomeHours += HOURS_PER_BLOCK;
    }
  }

  return result;
}

export function checkClaimAgainstCap(input: CapCheckInput): CapCheckResult {
  if (input.proposedClaimBlocks === 0) {
    return { ok: true };
  }

  const projectedHours = input.currentWeeklyHours + input.proposedClaimBlocks * HOURS_PER_BLOCK;

  if (projectedHours <= input.hoursCap) {
    return { ok: true };
  }

  if (input.capEnforcement === 'hard') {
    return { ok: false, reason: 'hard_cap_exceeded' };
  }

  return { ok: true, warning: 'soft_cap_exceeded' };
}
