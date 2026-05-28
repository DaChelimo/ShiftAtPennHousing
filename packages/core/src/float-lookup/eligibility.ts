import type { NormalizedGap, NormalizedSource, NormalizedWorker } from './normalize.js';
import type {
  BlockId,
  FloatExclusion,
  Gap,
  HouseId,
  ScheduledWorker,
  SourceHouseInfo,
} from './types.js';

const HARNWELL_HOUSE_ID = 'harnwell';
const QUAD_HOUSE_ID = 'quad';
const BLOCK_DURATION_MS = 30 * 60 * 1000;

function isPermittedSourceHouse(sourceHouseId: HouseId, destinationHouseId: HouseId): boolean {
  if (sourceHouseId === HARNWELL_HOUSE_ID) {
    return true;
  }

  if (sourceHouseId === QUAD_HOUSE_ID) {
    return destinationHouseId !== HARNWELL_HOUSE_ID;
  }

  return false;
}

function hasAdminWorkerExclusion(worker: ScheduledWorker): boolean {
  return worker.roles.includes('hm') || worker.roles.includes('bm');
}

function sourceHasFloor(
  source: NormalizedSource,
  tentativeFloatingOut: Map<HouseId, number>,
): boolean {
  const tentativeCount = tentativeFloatingOut.get(source.houseId) ?? 0;
  return source.currentHeadcount - tentativeCount > 1;
}

function workerBlocksRespectSourceFloor(
  worker: NormalizedWorker,
  source: NormalizedSource,
  gap: NormalizedGap,
  tentativeFloatingOut: Map<HouseId, number>,
): boolean {
  if (source.headcountByBlockId === undefined) {
    return true;
  }

  const tentativeCount = tentativeFloatingOut.get(source.houseId) ?? 0;
  const gapBlocks = new Set(gap.blockIds);

  return worker.scheduledBlockIds
    .filter((blockId) => gapBlocks.has(blockId))
    .every((blockId) => {
      const headcount = source.headcountByBlockId?.get(blockId) ?? source.currentHeadcount;
      return headcount - tentativeCount > 1;
    });
}

function getGapWindow(gap: NormalizedGap): { startAt: Date; endAt: Date } | null {
  const starts = gap.blockIds
    .map((blockId) => gap.blockStartTimes.get(blockId))
    .filter((value): value is Date => value !== undefined);

  if (starts.length === 0) {
    return null;
  }

  const startAt = new Date(Math.min(...starts.map((date) => date.getTime())));
  const endAt = new Date(Math.max(...starts.map((date) => date.getTime())) + BLOCK_DURATION_MS);

  return { startAt, endAt };
}

function rangesOverlap(
  left: { startAt: Date; endAt: Date },
  right: { startAt: Date; endAt: Date },
): boolean {
  return left.startAt < right.endAt && left.endAt > right.startAt;
}

function blockIdsOverlapGap(
  blockIds: BlockId[],
  gap: NormalizedGap,
  gapWindow: { startAt: Date; endAt: Date } | null,
): boolean {
  const gapBlockIds = new Set(gap.blockIds);

  if (blockIds.some((blockId) => gapBlockIds.has(blockId))) {
    return true;
  }

  if (gapWindow === null) {
    return false;
  }

  return blockIds.some((blockId) => {
    const startAt = gap.blockStartTimes.get(blockId);

    if (startAt === undefined) {
      return false;
    }

    return rangesOverlap(
      { startAt, endAt: new Date(startAt.getTime() + BLOCK_DURATION_MS) },
      gapWindow,
    );
  });
}

function exclusionWorkerId(exclusion: FloatExclusion): string | undefined {
  return exclusion.workerId ?? exclusion.userId;
}

function exclusionOverlapsGap(
  exclusion: FloatExclusion,
  gap: NormalizedGap,
  gapWindow: { startAt: Date; endAt: Date } | null,
): boolean {
  if (
    exclusion.windowStartAt !== undefined &&
    exclusion.windowEndAt !== undefined &&
    gapWindow !== null
  ) {
    return rangesOverlap(
      { startAt: exclusion.windowStartAt, endAt: exclusion.windowEndAt },
      gapWindow,
    );
  }

  if (exclusion.windowStartBlockId === undefined || exclusion.windowEndBlockId === undefined) {
    return false;
  }

  const startAt = gap.blockStartTimes.get(exclusion.windowStartBlockId);
  const endBlockStartAt = gap.blockStartTimes.get(exclusion.windowEndBlockId);

  if (startAt !== undefined && endBlockStartAt !== undefined && gapWindow !== null) {
    return rangesOverlap(
      {
        startAt,
        endAt: new Date(endBlockStartAt.getTime() + BLOCK_DURATION_MS),
      },
      gapWindow,
    );
  }

  const startIndex = gap.blockIds.indexOf(exclusion.windowStartBlockId);
  const endIndex = gap.blockIds.indexOf(exclusion.windowEndBlockId);

  if (startIndex === -1 || endIndex === -1) {
    return false;
  }

  const [fromIndex, toIndex] =
    startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  return gap.blockIds.slice(fromIndex, toIndex + 1).length > 0;
}

function hasMatchingExclusion(
  worker: NormalizedWorker,
  destinationHouseId: HouseId,
  exclusions: FloatExclusion[],
  gap: NormalizedGap,
  gapWindow: { startAt: Date; endAt: Date } | null,
): boolean {
  return exclusions.some(
    (exclusion) =>
      exclusionWorkerId(exclusion) === worker.workerId &&
      exclusion.destinationHouseId === destinationHouseId &&
      exclusionOverlapsGap(exclusion, gap, gapWindow),
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

    if (blockIdsOverlapGap(worker.pendingFloatBlockIds, gap, gapWindow)) {
      return false;
    }

    if (blockIdsOverlapGap(worker.crossHousePickupBlockIds, gap, gapWindow)) {
      return false;
    }

    return !hasMatchingExclusion(worker, gap.destinationHouseId, exclusions, gap, gapWindow);
  });
}

export function getEligibleWorkers(
  source: SourceHouseInfo,
  gap: Gap,
  exclusions: FloatExclusion[],
  tentativeFloatingOut: Map<HouseId, number>,
): ScheduledWorker[] {
  return getEligibleWorkersForSource(
    {
      houseId: source.houseId,
      workers: source.workers,
      currentHeadcount: source.currentHeadcount,
    },
    {
      destinationHouseId: gap.destinationHouseId,
      blockIds: gap.blockIds,
      blockStartTimes: new Map<BlockId, Date>(),
    },
    exclusions,
    tentativeFloatingOut,
  );
}
