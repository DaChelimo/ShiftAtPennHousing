// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/float-lookup/normalize.js by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
function normalizeGap(input) {
    return {
        destinationHouseId: input.gap.destinationHouseId,
        blockIds: input.gap.blocks.map((block) => block.blockId),
        blockStartTimes: new Map(input.gap.blocks.map((block) => [block.blockId, block.blockStartAt])),
    };
}
function normalizeFloatCandidate(candidate) {
    return {
        workerId: candidate.userId,
        homeHouseId: candidate.homeHouseId,
        roles: [...candidate.roles],
        isActive: candidate.isActive,
        scheduledBlockIds: [...candidate.coveredGapBlockIds],
        hasConflictingFloat: candidate.hasConflictingFloat,
        hasConflictingCrossHousePickup: candidate.hasConflictingCrossHousePickup,
        shiftStartAt: candidate.shiftStartAt,
        shiftEndAt: candidate.shiftEndAt,
    };
}
function normalizeSourceHouseRoster(source) {
    return {
        houseId: source.sourceHouseId,
        workers: source.candidates.map(normalizeFloatCandidate),
        headcountByBlockId: new Map(Object.entries(source.effectiveHeadcountByBlockId)),
    };
}
export function normalizeInput(input) {
    const gap = normalizeGap(input);
    // ARCH §5.2 step 2: sort by precedenceOrder ASC. Quad's
    // float_routing row has precedence 1; Harnwell's has 2. The
    // algorithm never trusts the caller's array order.
    const sources = [...input.sources]
        .sort((left, right) => left.precedenceOrder - right.precedenceOrder)
        .map(normalizeSourceHouseRoster);
    return { gap, sources };
}
