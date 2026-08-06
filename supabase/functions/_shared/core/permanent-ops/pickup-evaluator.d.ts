// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/permanent-ops/pickup-evaluator.d.ts by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
type PickupBlockInput = {
    blockId: string;
    conflictsWithExisting: boolean;
};
export declare function evaluatePickupWeek(params: {
    workerCurrentHours: number;
    weekBlocksToAdd: PickupBlockInput[];
    weeklyCap: number;
    capEnforcement: 'soft' | 'hard';
}): {
    toPickUp: string[];
    skipped: {
        blockId: string;
        reason: 'conflict' | 'cap';
    }[];
};
export declare function evaluatePermanentPickup(input: {
    weeks: {
        weekStartDate: string;
        blocks: {
            blockId: string;
            conflictsWithExisting: boolean;
        }[];
        currentWeeklyHours: number;
        capHours: number;
        capEnforcement: 'soft' | 'hard';
    }[];
}): {
    weeks: ({
        weekStartDate: string;
        status: "skipped";
        assignedBlockIds: never[];
        skippedBlockIds: string[];
        skipReason: "time_conflict" | "hours_cap";
    } | {
        weekStartDate: string;
        status: "partially_assigned";
        assignedBlockIds: string[];
        skippedBlockIds: string[];
        skipReason: "time_conflict";
    } | {
        weekStartDate: string;
        status: "fully_assigned";
        assignedBlockIds: string[];
        skippedBlockIds: never[];
        skipReason: null;
    })[];
    assignedBlockIds: string[];
    skippedBlockIds: string[];
    totalWeeksInScope: number;
    weeksFullyAssigned: number;
    weeksPartiallyAssigned: number;
    weeksSkipped: number;
};
export {};
//# sourceMappingURL=pickup-evaluator.d.ts.map