// AI Schedule Agent — deterministic scorer for feasible candidates.
//
// Decomposes into six named components (surfaced in the preview UI);
// invariant: total === sum of components. Pure arithmetic over the
// snapshot; weights live in weights.ts only.

import { buildGrid, hoursByWorker, splitRuns, type AiGrid } from './grid.js';
import type { AiAssignment, AiScheduleInput, AiScoreBreakdown } from './types.js';
import { normalizeAssignments, validateWithGrid } from './validator.js';
import { AI_SCORE_WEIGHTS } from './weights.js';

export function scoreCandidate(
  input: AiScheduleInput,
  assignments: AiAssignment[],
): AiScoreBreakdown {
  const grid = buildGrid(input);
  return scoreWithGrid(input, grid, assignments);
}

export function scoreWithGrid(
  input: AiScheduleInput,
  grid: AiGrid,
  assignments: AiAssignment[],
): AiScoreBreakdown {
  const W = AI_SCORE_WEIGHTS;
  const { valid } = normalizeAssignments(grid, assignments);

  // Preference satisfaction.
  let preferenceSatisfaction = 0;
  const preferredCountOf = new Map<string, number>();
  for (const worker of grid.workers) preferredCountOf.set(worker.workerId, 0);
  for (const a of valid) {
    const worker = grid.workerById.get(a.workerId);
    if (worker === undefined) continue;
    const pref = worker.prefs[a.blockId];
    if (pref === 'preferred') {
      preferenceSatisfaction += W.preferredBlock;
      preferredCountOf.set(a.workerId, (preferredCountOf.get(a.workerId) ?? 0) + 1);
    } else if (pref === undefined) {
      preferenceSatisfaction += W.availableBlock;
    }
    // 'cannot' scores nothing; feasible candidates never contain it.
  }

  // Target-hours fit.
  const hours = hoursByWorker(grid, valid);
  let targetFit = 0;
  const deviations: number[] = [];
  for (const worker of grid.workers) {
    if (worker.targetHours === null) continue;
    const held = hours[worker.workerId] ?? 0;
    const delta = held - worker.targetHours;
    deviations.push(delta);
    if (delta < 0) targetFit += -delta * W.underTargetPerHour;
    if (delta > 0) targetFit += delta * W.overTargetPerHour;
  }

  // Shift-length quality + contiguity.
  const runs = splitRuns(grid, valid);
  let shiftQuality = 0;
  for (const run of runs) {
    const runHours = run.blocks.length * 0.5;
    if (runHours <= 1) {
      shiftQuality += W.shortRunPenalty;
    } else if (runHours >= 2 && runHours <= 5) {
      shiftQuality += W.idealRunBonus;
    }
    if (runHours > 6) {
      shiftQuality += (runHours - 6) * W.longRunPenaltyPerHour;
    }
  }

  let contiguity = 0;
  const runsPerWorkerDay = new Map<string, number>();
  for (const run of runs) {
    const key = `${run.workerId}|${String(run.weekday)}`;
    runsPerWorkerDay.set(key, (runsPerWorkerDay.get(key) ?? 0) + 1);
  }
  for (const count of runsPerWorkerDay.values()) {
    if (count > 1) contiguity += (count - 1) * W.extraRunPenalty;
  }

  // Fairness: spread of preferred blocks across the whole roster, and of
  // hours-vs-target across targeted workers.
  const fairness =
    W.fairnessPreferredSpread * stddev([...preferredCountOf.values()]) +
    W.fairnessHoursSpread * stddev(deviations);

  // Coverage.
  const { unfilledSeats } = validateWithGrid(input, grid, valid);
  let coverage = 0;
  for (const seat of unfilledSeats) {
    coverage += seat.open * (seat.fillable ? W.fillableUnfilledSeat : W.unfillableUnfilledSeat);
  }

  const total =
    preferenceSatisfaction + targetFit + shiftQuality + contiguity + fairness + coverage;
  return { preferenceSatisfaction, targetFit, shiftQuality, contiguity, fairness, coverage, total };
}

// Population standard deviation; 0 for empty/singleton inputs.
function stddev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(variance);
}
