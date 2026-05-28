import type { NormalizedGap, NormalizedSource, NormalizedWorker } from './normalize.js';
import type { FloatExclusion, HouseId } from './types.js';

const HARNWELL_HOUSE_ID = 'harnwell';
const QUAD_HOUSE_ID = 'quad';
const BLOCK_DURATION_MS = 30 * 60 * 1000;

// AGENTS hard invariant #2 (BSpec §1.2 absolute): enforced
// algorithmically, never trusted from float_routing config. The
// allowlist is closed; any source house id not in it is rejected.
function isPermittedSourceHouse(sourceHouseId: HouseId, destinationHouseId: HouseId): boolean {
  if (sourceHouseId === HARNWELL_HOUSE_ID) {
    return true;
  }

  if (sourceHouseId === QUAD_HOUSE_ID) {
    return destinationHouseId !== HARNWELL_HOUSE_ID;
  }

  return false;
}

function hasAdminWorkerExclusion(worker: NormalizedWorker): boolean {
  return worker.roles.includes('hm') || worker.roles.includes('bm');
}

// Source-level early exit (pinned-decision #1): the source can admit
// at least one more floater iff some block still has slack after
// accounting for the running tentative counter. Using MAX (not MIN)
// of per-block headcount preserves correctness for sources with
// uneven staffing — a low-headcount block on one end of the gap
// must not disqualify candidates whose coverage avoids that block.
// The per-worker floor check (workerBlocksRespectSourceFloor) then
// enforces the floor on the exact blocks each candidate covers.
function sourceHasFloor(
  source: NormalizedSource,
  tentativeFloatingOut: Map<HouseId, number>,
): boolean {
  const tentativeCount = tentativeFloatingOut.get(source.houseId) ?? 0;

  for (const headcount of source.headcountByBlockId.values()) {
    if (headcount - tentativeCount > 1) {
      return true;
    }
  }
  return false;
}

function workerBlocksRespectSourceFloor(
  worker: NormalizedWorker,
  source: NormalizedSource,
  gap: NormalizedGap,
  tentativeFloatingOut: Map<HouseId, number>,
): boolean {
  const tentativeCount = tentativeFloatingOut.get(source.houseId) ?? 0;
  const gapBlocks = new Set(gap.blockIds);

  return worker.scheduledBlockIds
    .filter((blockId) => gapBlocks.has(blockId))
    .every((blockId) => {
      const headcount = source.headcountByBlockId.get(blockId);
      if (headcount === undefined) {
        // No headcount data for a block the worker claims to cover
        // is a caller bug; fail closed.
        return false;
      }
      return headcount - tentativeCount > 1;
    });
}

type TimeRange = { startAt: Date; endAt: Date };

function getGapWindow(gap: NormalizedGap): TimeRange | null {
  const starts = [...gap.blockStartTimes.values()];

  if (starts.length === 0) {
    return null;
  }

  const startAt = new Date(Math.min(...starts.map((date) => date.getTime())));
  const endAt = new Date(Math.max(...starts.map((date) => date.getTime())) + BLOCK_DURATION_MS);

  return { startAt, endAt };
}

// Half-open intervals — abutting ranges (left.end == right.start) do
// not overlap. Pinned-decision #6.
function rangesOverlap(left: TimeRange, right: TimeRange): boolean {
  return left.startAt < right.endAt && left.endAt > right.startAt;
}

function hasMatchingExclusion(
  worker: NormalizedWorker,
  destinationHouseId: HouseId,
  exclusions: FloatExclusion[],
  gapWindow: TimeRange | null,
): boolean {
  if (gapWindow === null) {
    return false;
  }

  return exclusions.some(
    (exclusion) =>
      exclusion.userId === worker.workerId &&
      exclusion.destinationHouseId === destinationHouseId &&
      rangesOverlap({ startAt: exclusion.windowStartAt, endAt: exclusion.windowEndAt }, gapWindow),
  );
}

export function getEligibleWorkersForSource(
  source: NormalizedSource,
  gap: NormalizedGap,
  exclusions: FloatExclusion[],
  tentativeFloatingOut: Map<HouseId, number>,
): NormalizedWorker[] {
  if (!isPermittedSourceHouse(source.houseId, gap.destinationHouseId)) {
    return [];
  }

  if (!sourceHasFloor(source, tentativeFloatingOut)) {
    return [];
  }

  const gapWindow = getGapWindow(gap);

  return source.workers.filter((worker) => {
    if (worker.homeHouseId !== source.houseId) {
      return false;
    }

    if (!worker.isActive) {
      return false;
    }

    if (hasAdminWorkerExclusion(worker)) {
      return false;
    }

    if (!workerBlocksRespectSourceFloor(worker, source, gap, tentativeFloatingOut)) {
      return false;
    }

    // BSpec §6.1: worker already assigned to a float (pending or
    // acknowledged) whose window overlaps the gap is excluded.
    // The caller pre-computes this as a boolean against the gap window.
    if (worker.hasConflictingFloat) {
      return false;
    }

    // BSpec §6.1: a worker on a cross-house pickup at any house is
    // treated as a worker at that house for headcount, but is NOT
    // floatable during the pickup window.
    if (worker.hasConflictingCrossHousePickup) {
      return false;
    }

    return !hasMatchingExclusion(worker, gap.destinationHouseId, exclusions, gapWindow);
  });
}
