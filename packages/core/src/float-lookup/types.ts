export type BlockId = string;
export type WorkerId = string;
export type UserId = WorkerId;
export type HouseId = string;

export type WorkerRole = 'sw' | 'sm' | 'hm' | 'bm';

export type Gap = {
  destinationHouseId: HouseId;
  blockIds: BlockId[];
};

export type GapBlock = {
  blockId: BlockId;
  blockStartAt: Date;
};

export type FloatGap = {
  destinationHouseId: HouseId;
  blocks: GapBlock[];
};

export type ScheduledWorker = {
  workerId: WorkerId;
  homeHouseId: HouseId;
  roles: WorkerRole[];
  isActive: boolean;
  scheduledBlockIds: BlockId[];
  pendingFloatBlockIds: BlockId[];
  crossHousePickupBlockIds: BlockId[];
  currentWeeklyHours: number;
};

export type FloatCandidate = {
  userId: WorkerId;
  homeHouseId: HouseId;
  roles: WorkerRole[];
  isActive: boolean;
  coveredGapBlockIds: BlockId[];
  shiftStartAt: Date;
  shiftEndAt: Date;
  hasConflictingFloat: boolean;
  hasConflictingCrossHousePickup: boolean;
};

export type FloatExclusion = {
  workerId?: WorkerId;
  userId?: WorkerId;
  destinationHouseId: HouseId;
  windowStartBlockId?: BlockId;
  windowEndBlockId?: BlockId;
  windowStartAt?: Date;
  windowEndAt?: Date;
};

export type SourceHouseInfo = {
  houseId: HouseId;
  workers: ScheduledWorker[];
  currentHeadcount: number;
};

export type SourceHouseRoster = {
  sourceHouseId: HouseId;
  precedenceOrder: number;
  candidates: FloatCandidate[];
  effectiveHeadcountByBlockId: Record<BlockId, number>;
};

export type FloatAssignment = {
  workerId: WorkerId;
  sourceHouseId: HouseId;
  coveredBlockIds: BlockId[];
  blocks: BlockId[];
};

export type FloatLookupResult = {
  assignments: FloatAssignment[];
  alliedBlockIds: BlockId[];
};

export type FloatLookupInput = {
  gap: Gap | FloatGap;
  sourceHousesInPriorityOrder?: SourceHouseInfo[];
  sources?: SourceHouseRoster[];
  exclusions: FloatExclusion[];
  gapBlockToStartTime?: Map<BlockId, Date>;
};
