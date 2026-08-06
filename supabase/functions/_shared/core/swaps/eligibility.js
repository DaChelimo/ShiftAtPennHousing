// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/swaps/eligibility.js by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
const HARNWELL_HOUSE_ID = 'harnwell';
const MULTI_STAFF_FLOAT_SOURCE_HOUSE_IDS = new Set(['quad', 'harnwell']);
function evaluateTransferredSpan(receiver, span) {
    const violations = [];
    for (const assignment of span) {
        if (assignment.inPendingFloat === true) {
            violations.push({
                receiverUserId: receiver.userId,
                assignmentId: assignment.assignmentId,
                destinationHouseId: assignment.houseId,
                reason: 'block_in_pending_float',
            });
            continue;
        }
        if (assignment.houseId === HARNWELL_HOUSE_ID && receiver.homeHouseId !== HARNWELL_HOUSE_ID) {
            violations.push({
                receiverUserId: receiver.userId,
                assignmentId: assignment.assignmentId,
                destinationHouseId: assignment.houseId,
                reason: 'harnwell_training_required',
            });
            continue;
        }
        if (assignment.kind === 'float' &&
            assignment.houseId !== HARNWELL_HOUSE_ID &&
            !MULTI_STAFF_FLOAT_SOURCE_HOUSE_IDS.has(receiver.homeHouseId)) {
            violations.push({
                receiverUserId: receiver.userId,
                assignmentId: assignment.assignmentId,
                destinationHouseId: assignment.houseId,
                reason: 'single_staff_cannot_float',
            });
        }
    }
    return violations;
}
export function evaluateSwapEligibility(input) {
    const violations = [
        ...evaluateTransferredSpan(input.counterparty, input.initiator.span),
        ...evaluateTransferredSpan(input.initiator, input.counterparty.span),
    ];
    if (input.swapType === 'float_swap' &&
        ![...input.initiator.span, ...input.counterparty.span].some((assignment) => assignment.kind === 'float')) {
        violations.push({
            receiverUserId: null,
            assignmentId: null,
            destinationHouseId: null,
            reason: 'float_swap_requires_a_float',
        });
    }
    return violations.length === 0 ? { eligible: true } : { eligible: false, violations };
}
export function findConflictingPendingSwaps(input) {
    const touched = new Set(input.newAssignmentIds);
    return input.pendingSwaps
        .filter((swap) => swap.assignmentIds.some((assignmentId) => touched.has(assignmentId)))
        .map((swap) => swap.swapId);
}
export function checkSwapEligibility(partyA, partyB) {
    const partyAGivesHarnwell = partyA.assignmentHouseIds.includes(HARNWELL_HOUSE_ID);
    const partyBGivesHarnwell = partyB.assignmentHouseIds.includes(HARNWELL_HOUSE_ID);
    if ((partyAGivesHarnwell && partyB.homeHouseId !== HARNWELL_HOUSE_ID) ||
        (partyBGivesHarnwell && partyA.homeHouseId !== HARNWELL_HOUSE_ID)) {
        return { eligible: false, reason: 'harnwell_training_required' };
    }
    return { eligible: true };
}
