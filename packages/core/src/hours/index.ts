import {
  checkClaimAgainstCap,
  computeWeeklyHours as computeWeeklyHoursWithWeekRef,
  type AssignmentForHours,
} from '../scheduling/hours.js';

export type Assignment = AssignmentForHours;

export { checkClaimAgainstCap, type AssignmentForHours } from '../scheduling/hours.js';

// D12: expose the §9.1 decomposition (the canonical, tested implementation in
// scheduling/hours.ts) at the package root under a distinct name, so the full
// HoursDecomposition is reachable without the bare-`computeWeeklyHours` name
// collision. The scalar helper below remains for the simple total-hours case.
export {
  computeWeeklyHours as computeWeeklyHoursDecomposition,
  type HoursDecomposition,
} from '../scheduling/hours.js';

export function computeWeeklyHours(assignments: Assignment[], weekStart: Date): number {
  return computeWeeklyHoursWithWeekRef(assignments, { weekStartAt: weekStart }).totalHours;
}

export function checkHoursCap(
  currentHours: number,
  additionalBlocks: number,
  cap: number,
  enforcement: 'soft' | 'hard',
): { allowed: boolean; warning: boolean; projectedHours: number } {
  const projectedHours = currentHours + additionalBlocks * 0.5;
  const result = checkClaimAgainstCap({
    currentWeeklyHours: currentHours,
    proposedClaimBlocks: additionalBlocks,
    hoursCap: cap,
    capEnforcement: enforcement,
  });

  return {
    allowed: result.ok,
    warning: result.ok && 'warning' in result && result.warning === 'soft_cap_exceeded',
    projectedHours,
  };
}
