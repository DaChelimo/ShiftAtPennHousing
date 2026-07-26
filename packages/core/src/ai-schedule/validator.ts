// AI Schedule Agent — deterministic hard-constraint validator.
//
// Never trusts the LLM: every hard operational rule is re-checked here on
// pure snapshot data. Never throws; malformed references become violations
// so the repair loop can react. Severity 'hard' blocks feasibility;
// 'warning' (ONE_HOUR_SHIFT) is fed to repair prompts and penalized by the
// scorer but never blocks a candidate.

import { formatMinuteOfDay } from '../preferences/index.js';

import { runBoundaryIssue, type BoundaryIssue } from './alignment.js';
import { MIN_RUN_BLOCKS } from './finalize.js';
import { buildGrid, splitRuns, type AiGrid } from './grid.js';
import type {
  AiAssignment,
  AiScheduleInput,
  AiUnfilledSeat,
  AiValidationResult,
  AiViolation,
} from './types.js';

const HARNWELL_HOUSE_ID = 'harnwell';

// Assignments that survive reference checks + dedupe, in stable order.
export function normalizeAssignments(
  grid: AiGrid,
  assignments: AiAssignment[],
): { valid: AiAssignment[]; violations: AiViolation[] } {
  const violations: AiViolation[] = [];
  const seen = new Set<string>();
  const valid: AiAssignment[] = [];
  for (const a of assignments) {
    if (!grid.blockById.has(a.blockId)) {
      violations.push({
        code: 'UNKNOWN_BLOCK',
        severity: 'hard',
        blockId: a.blockId,
        workerId: a.workerId,
        detail: `assignment references unknown block ${a.blockId}`,
      });
      continue;
    }
    if (!grid.workerById.has(a.workerId)) {
      violations.push({
        code: 'UNKNOWN_WORKER',
        severity: 'hard',
        blockId: a.blockId,
        workerId: a.workerId,
        detail: `assignment references unknown worker ${a.workerId}`,
      });
      continue;
    }
    const pairKey = `${a.workerId}|${a.blockId}`;
    if (seen.has(pairKey)) {
      const block = grid.blockById.get(a.blockId);
      violations.push({
        code: 'DOUBLE_BOOK',
        severity: 'hard',
        blockId: a.blockId,
        workerId: a.workerId,
        weekday: block?.weekday,
        detail: `worker assigned to block ${a.blockId} more than once`,
      });
      continue;
    }
    seen.add(pairKey);
    valid.push({ blockId: a.blockId, workerId: a.workerId });
  }
  return { valid, violations };
}

export function validateCandidate(
  input: AiScheduleInput,
  assignments: AiAssignment[],
): AiValidationResult {
  const grid = buildGrid(input);
  return validateWithGrid(input, grid, assignments);
}

// Grid-reusing variant for the loop's hot path.
export function validateWithGrid(
  input: AiScheduleInput,
  grid: AiGrid,
  assignments: AiAssignment[],
): AiValidationResult {
  const { valid, violations } = normalizeAssignments(grid, assignments);

  // Per-block occupancy.
  const byBlock = new Map<string, AiAssignment[]>();
  for (const a of valid) {
    const list = byBlock.get(a.blockId);
    if (list === undefined) {
      byBlock.set(a.blockId, [a]);
    } else {
      list.push(a);
    }
  }
  for (const day of grid.days) {
    for (const block of day.blocks) {
      const count = byBlock.get(block.blockId)?.length ?? 0;
      if (count > block.requiredHeadcount) {
        violations.push({
          code: 'OVER_HEADCOUNT',
          severity: 'hard',
          blockId: block.blockId,
          weekday: block.weekday,
          detail: `${String(count)} workers on a ${String(block.requiredHeadcount)}-seat block`,
        });
      }
    }
  }

  // Harnwell training invariant (AGENTS hard invariant #1): one hard
  // violation per offending worker; every block of a Harnwell snapshot is
  // a Harnwell block, so the whole worker is implicated.
  if (input.isHarnwell) {
    const flagged = new Set<string>();
    for (const a of valid) {
      const worker = grid.workerById.get(a.workerId);
      if (worker === undefined || worker.homeHouseId === HARNWELL_HOUSE_ID) continue;
      if (flagged.has(a.workerId)) continue;
      flagged.add(a.workerId);
      violations.push({
        code: 'HARNWELL_TRAINING',
        severity: 'hard',
        workerId: a.workerId,
        detail: `worker's home house is ${worker.homeHouseId}; only Harnwell residents may staff Harnwell`,
      });
    }
  }

  // Cannot is a hard no for that worker+block.
  for (const a of valid) {
    const worker = grid.workerById.get(a.workerId);
    if (worker?.prefs[a.blockId] === 'cannot') {
      const block = grid.blockById.get(a.blockId);
      violations.push({
        code: 'CANNOT_CONFLICT',
        severity: 'hard',
        workerId: a.workerId,
        blockId: a.blockId,
        weekday: block?.weekday,
        detail: `worker marked this block cannot`,
      });
    }
  }

  // Weekly cap (0.5h per block; exactly-at-cap is legal).
  const hoursOf = new Map<string, number>();
  for (const a of valid) {
    hoursOf.set(a.workerId, (hoursOf.get(a.workerId) ?? 0) + 0.5);
  }
  for (const workerId of [...hoursOf.keys()].sort((a, b) => a.localeCompare(b))) {
    const hours = hoursOf.get(workerId) ?? 0;
    if (hours > input.capHours) {
      violations.push({
        code: 'CAP_EXCEEDED',
        severity: 'hard',
        workerId,
        detail: `${String(hours)}h assigned exceeds the ${String(input.capHours)}h weekly cap`,
      });
    }
  }

  // Shift-shape warnings: runs shorter than the 2-hour minimum, and runs that
  // start or end on a half hour. Advisory here (fed to the repair prompt); the
  // finalize pass is what guarantees the output has neither.
  for (const run of splitRuns(grid, valid)) {
    const first = run.blocks[0];
    const last = run.blocks[run.blocks.length - 1];
    if (first === undefined || last === undefined) continue;
    if (run.blocks.length < MIN_RUN_BLOCKS) {
      violations.push({
        code: 'ONE_HOUR_SHIFT',
        severity: 'warning',
        workerId: run.workerId,
        blockId: first.blockId,
        weekday: run.weekday,
        detail: `${String(run.blocks.length * 0.5)}h run; every shift must be at least 2 hours`,
      });
    }
    const day = grid.dayByWeekday.get(run.weekday);
    const startIdx = grid.indexInDay.get(first.blockId);
    const endIdx = grid.indexInDay.get(last.blockId);
    if (day === undefined || startIdx === undefined || endIdx === undefined) continue;
    const issue = runBoundaryIssue(day, startIdx, endIdx);
    if (issue === null) continue;
    violations.push({
      code: 'HALF_HOUR_BOUNDARY',
      severity: 'warning',
      workerId: run.workerId,
      blockId: issue === 'end' ? last.blockId : first.blockId,
      weekday: run.weekday,
      detail: boundaryDetail(issue, first.minuteOfDay, last.minuteOfDay + 30),
    });
  }

  const unfilledSeats = computeUnfilledSeats(input, grid, valid, byBlock, hoursOf);
  const feasible = !violations.some((v) => v.severity === 'hard');
  return { feasible, violations, unfilledSeats };
}

function boundaryDetail(issue: BoundaryIssue, startMin: number, endMin: number): string {
  const span = `${formatMinuteOfDay(startMin)}-${formatMinuteOfDay(endMin % 1440)}`;
  const which = issue === 'both' ? 'starts and ends' : issue === 'start' ? 'starts' : 'ends';
  return `${span} ${which} on a half hour; shifts begin and end on the hour unless the desk opens or closes then`;
}

function computeUnfilledSeats(
  input: AiScheduleInput,
  grid: AiGrid,
  valid: AiAssignment[],
  byBlock: Map<string, AiAssignment[]>,
  hoursOf: Map<string, number>,
): AiUnfilledSeat[] {
  const seats: AiUnfilledSeat[] = [];
  for (const day of grid.days) {
    for (const block of day.blocks) {
      const occupants = byBlock.get(block.blockId) ?? [];
      const open = block.requiredHeadcount - occupants.length;
      if (open <= 0) continue;
      const occupantIds = new Set(occupants.map((a) => a.workerId));
      const fillable = grid.workers.some((worker) => {
        if (occupantIds.has(worker.workerId)) return false;
        if (worker.prefs[block.blockId] === 'cannot') return false;
        if (input.isHarnwell && worker.homeHouseId !== HARNWELL_HOUSE_ID) return false;
        const hours = hoursOf.get(worker.workerId) ?? 0;
        return hours + 0.5 <= input.capHours;
      });
      seats.push({
        blockId: block.blockId,
        weekday: block.weekday,
        minuteOfDay: block.minuteOfDay,
        open,
        fillable,
      });
    }
  }
  return seats;
}
