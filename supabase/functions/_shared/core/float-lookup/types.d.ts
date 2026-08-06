// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/float-lookup/types.d.ts by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
export type BlockId = string;
export type WorkerId = string;
export type UserId = WorkerId;
export type HouseId = string;
export type WorkerRole = 'sw' | 'sm' | 'hm' | 'rsm' | 'bm' | 'admin';
export type GapBlock = {
    blockId: BlockId;
    blockStartAt: Date;
};
export type FloatGap = {
    destinationHouseId: HouseId;
    blocks: GapBlock[];
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
    userId: WorkerId;
    destinationHouseId: HouseId;
    windowStartAt: Date;
    windowEndAt: Date;
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
    blocks: BlockId[];
};
export type FloatLookupResult = {
    assignments: FloatAssignment[];
    alliedBlockIds: BlockId[];
};
export type FloatLookupInput = {
    gap: FloatGap;
    sources: SourceHouseRoster[];
    exclusions: FloatExclusion[];
};
//# sourceMappingURL=types.d.ts.map