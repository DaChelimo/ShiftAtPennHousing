import type {
  BlockId,
  FloatCandidate,
  FloatLookupInput,
  HouseId,
  SourceHouseRoster,
  WorkerId,
  WorkerRole,
} from './types.js';

export type NormalizedGap = {
  destinationHouseId: HouseId;
  blockIds: BlockId[];
  blockStartTimes: Map<BlockId, Date>;
};

// The worker shape the algorithm operates on. Every list is copied
// from the input on normalization so the algorithm cannot mutate
// caller-owned arrays.
export type NormalizedWorker = {
  workerId: WorkerId;
  homeHouseId: HouseId;
  roles: WorkerRole[];
  isActive: boolean;
  scheduledBlockIds: BlockId[];
  hasConflictingFloat: boolean;
  hasConflictingCrossHousePickup: boolean;
  shiftStartAt: Date;
  shiftEndAt: Date;
};

export type NormalizedSource = {
  houseId: HouseId;
  workers: NormalizedWorker[];
  // Per-block effective headcount. The floor check uses this directly
  // (per-block accounting), with the running tentative counter
  // subtracted per pinned-decision #1.
  headcountByBlockId: Map<BlockId, number>;
};

function normalizeGap(input: FloatLookupInput): NormalizedGap {
  return {
    destinationHouseId: input.gap.destinationHouseId,
    blockIds: input.gap.blocks.map((block) => block.blockId),
    blockStartTimes: new Map(input.gap.blocks.map((block) => [block.blockId, block.blockStartAt])),
  };
}

function normalizeFloatCandidate(candidate: FloatCandidate): NormalizedWorker {
  return {
    workerId: candidate.userId,
    homeHouseId: candidate.homeHouseId,
    roles: [...candidate.roles] as WorkerRole[],
    isActive: candidate.isActive,
    scheduledBlockIds: [...candidate.coveredGapBlockIds],
    hasConflictingFloat: candidate.hasConflictingFloat,
    hasConflictingCrossHousePickup: candidate.hasConflictingCrossHousePickup,
    shiftStartAt: candidate.shiftStartAt,
    shiftEndAt: candidate.shiftEndAt,
  };
}

function normalizeSourceHouseRoster(source: SourceHouseRoster): NormalizedSource {
  return {
    houseId: source.sourceHouseId,
    workers: source.candidates.map(normalizeFloatCandidate),
    headcountByBlockId: new Map(
      Object.entries(source.effectiveHeadcountByBlockId) as Array<[BlockId, number]>,
    ),
  };
}

export function normalizeInput(input: FloatLookupInput): {
  gap: NormalizedGap;
  sources: NormalizedSource[];
} {
  const gap = normalizeGap(input);
  // ARCH §5.2 step 2: sort by precedenceOrder ASC. Quad's
  // float_routing row has precedence 1; Harnwell's has 2. The
  // algorithm never trusts the caller's array order.
  const sources = [...input.sources]
    .sort((left, right) => left.precedenceOrder - right.precedenceOrder)
    .map(normalizeSourceHouseRoster);

  return { gap, sources };
}
