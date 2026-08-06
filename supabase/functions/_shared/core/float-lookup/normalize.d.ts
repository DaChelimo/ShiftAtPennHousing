// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/float-lookup/normalize.d.ts by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
import type { BlockId, FloatLookupInput, HouseId, WorkerId, WorkerRole } from './types.js';
export type NormalizedGap = {
    destinationHouseId: HouseId;
    blockIds: BlockId[];
    blockStartTimes: Map<BlockId, Date>;
};
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
    headcountByBlockId: Map<BlockId, number>;
};
export declare function normalizeInput(input: FloatLookupInput): {
    gap: NormalizedGap;
    sources: NormalizedSource[];
};
//# sourceMappingURL=normalize.d.ts.map