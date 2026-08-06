// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/swaps/eligibility.d.ts by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
type SwapSpanAssignment = {
    assignmentId: string;
    houseId: string;
    kind: 'shift' | 'float' | 'cross_house_pickup';
    inPendingFloat?: boolean;
};
type SwapParticipant = {
    userId: string;
    homeHouseId: string;
    span: SwapSpanAssignment[];
};
type SwapEligibilityViolation = {
    receiverUserId: string | null;
    assignmentId: string | null;
    destinationHouseId: string | null;
    reason: 'harnwell_training_required' | 'single_staff_cannot_float' | 'block_in_pending_float' | 'float_swap_requires_a_float';
};
type SwapEligibilityInput = {
    swapType: 'shift_swap' | 'float_swap';
    initiator: SwapParticipant;
    counterparty: SwapParticipant;
};
type SwapEligibilityResult = {
    eligible: true;
} | {
    eligible: false;
    violations: SwapEligibilityViolation[];
};
type PendingSwapRef = {
    swapId: string;
    assignmentIds: string[];
};
export declare function evaluateSwapEligibility(input: SwapEligibilityInput): SwapEligibilityResult;
export declare function findConflictingPendingSwaps(input: {
    newAssignmentIds: string[];
    pendingSwaps: PendingSwapRef[];
}): string[];
export declare function checkSwapEligibility(partyA: {
    userId: string;
    homeHouseId: string;
    assignmentHouseIds: string[];
}, partyB: {
    userId: string;
    homeHouseId: string;
    assignmentHouseIds: string[];
}): {
    eligible: boolean;
    reason?: string;
};
export {};
//# sourceMappingURL=eligibility.d.ts.map