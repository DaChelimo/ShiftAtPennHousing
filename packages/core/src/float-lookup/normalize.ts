import type {
  BlockId,
  FloatCandidate,
  FloatLookupInput,
  GapBlock,
  HouseId,
  ScheduledWorker,
  SourceHouseInfo,
  SourceHouseRoster,
  WorkerId,
  WorkerRole,
} from './types.js';

export type NormalizedGap = {
  destinationHouseId: HouseId;
  blockIds: BlockId[];
  blockStartTimes: Map<BlockId, Date>;
};

export type NormalizedWorker = ScheduledWorker & {
  shiftStartAt?: Date;
  shiftEndAt?: Date;
};

export type NormalizedSource = {
  houseId: HouseId;
  workers: NormalizedWorker[];
  currentHeadcount: number;
  headcountByBlockId?: Map<BlockId, number>;
};

function isLegacyGap(
  gap: FloatLookupInput['gap'],
): gap is { destinationHouseId: HouseId; blocks: GapBlock[] } {
  return 'blocks' in gap;
}

function normalizeGap(input: FloatLookupInput): NormalizedGap {
  if (isLegacyGap(input.gap)) {
    return {
      destinationHouseId: input.gap.destinationHouseId,
      blockIds: input.gap.blocks.map((block) => block.blockId),
      blockStartTimes: new Map(
        input.gap.blocks.map((block) => [block.blockId, block.blockStartAt]),
      ),
    };
  }

  return {
    destinationHouseId: input.gap.destinationHouseId,
    blockIds: input.gap.blockIds,
    blockStartTimes: input.gapBlockToStartTime ?? new Map<BlockId, Date>(),
  };
}

function getMinimumHeadcount(
  effectiveHeadcountByBlockId: Record<BlockId, number>,
  gapBlockIds: BlockId[],
): number {
  const values = gapBlockIds
    .map((blockId) => effectiveHeadcountByBlockId[blockId])
    .filter((value): value is number => value !== undefined);

  return values.length === 0 ? 0 : Math.min(...values);
}

function normalizeScheduledWorker(worker: ScheduledWorker): NormalizedWorker {
  return {
    ...worker,
    roles: [...worker.roles],
    scheduledBlockIds: [...worker.scheduledBlockIds],
    pendingFloatBlockIds: [...worker.pendingFloatBlockIds],
    crossHousePickupBlockIds: [...worker.crossHousePickupBlockIds],
  };
}

function normalizeFloatCandidate(
  candidate: FloatCandidate,
  gapBlockIds: BlockId[],
): NormalizedWorker {
  return {
    workerId: candidate.userId,
    homeHouseId: candidate.homeHouseId,
    roles: [...candidate.roles] as WorkerRole[],
    isActive: candidate.isActive,
    scheduledBlockIds: [...candidate.coveredGapBlockIds],
    pendingFloatBlockIds: candidate.hasConflictingFloat ? [...gapBlockIds] : [],
    crossHousePickupBlockIds: candidate.hasConflictingCrossHousePickup ? [...gapBlockIds] : [],
    currentWeeklyHours: 0,
    shiftStartAt: candidate.shiftStartAt,
    shiftEndAt: candidate.shiftEndAt,
  };
}

function normalizeSourceHouseInfo(source: SourceHouseInfo): NormalizedSource {
  return {
    houseId: source.houseId,
    workers: source.workers.map(normalizeScheduledWorker),
    currentHeadcount: source.currentHeadcount,
  };
}

function normalizeSourceHouseRoster(
  source: SourceHouseRoster,
  gapBlockIds: BlockId[],
): NormalizedSource {
  const headcountByBlockId = new Map(
    Object.entries(source.effectiveHeadcountByBlockId) as Array<[BlockId, number]>,
  );

  return {
    houseId: source.sourceHouseId,
    workers: source.candidates.map((candidate) => normalizeFloatCandidate(candidate, gapBlockIds)),
    currentHeadcount: getMinimumHeadcount(source.effectiveHeadcountByBlockId, gapBlockIds),
    headcountByBlockId,
  };
}

export function normalizeInput(input: FloatLookupInput): {
  gap: NormalizedGap;
  sources: NormalizedSource[];
  legacyMode: boolean;
} {
  const gap = normalizeGap(input);
  const legacyMode = input.sourceHousesInPriorityOrder === undefined;

  const sources =
    input.sourceHousesInPriorityOrder?.map(normalizeSourceHouseInfo) ??
    [...(input.sources ?? [])]
      .sort((left, right) => left.precedenceOrder - right.precedenceOrder)
      .map((source) => normalizeSourceHouseRoster(source, gap.blockIds));

  return { gap, sources, legacyMode };
}

export function getWorkerId(worker: NormalizedWorker | ScheduledWorker): WorkerId {
  return worker.workerId;
}
