// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/float-lookup/spans.js by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
export function getConsecutiveRuns(blockIds, gapBlockOrder) {
    const order = new Map(gapBlockOrder.map((blockId, index) => [blockId, index]));
    const orderedBlocks = blockIds
        .filter((blockId) => order.has(blockId))
        .sort((left, right) => order.get(left) - order.get(right));
    const runs = [];
    for (const blockId of orderedBlocks) {
        const currentIndex = order.get(blockId);
        const lastRun = runs.at(-1);
        const previousBlockId = lastRun?.at(-1);
        const previousIndex = previousBlockId === undefined ? undefined : order.get(previousBlockId);
        if (lastRun !== undefined &&
            previousIndex !== undefined &&
            currentIndex === previousIndex + 1) {
            lastRun.push(blockId);
        }
        else {
            runs.push([blockId]);
        }
    }
    return runs;
}
export function getLargestUncoveredRun(remainingUncoveredBlocks, gapBlockOrder) {
    return getConsecutiveRuns(remainingUncoveredBlocks, gapBlockOrder).reduce((best, run) => (run.length > best.length ? run : best), []);
}
export function getLargestConsecutiveSpan(workerBlockIds, remainingUncoveredBlocks, gapBlockOrder = remainingUncoveredBlocks) {
    const remaining = new Set(remainingUncoveredBlocks);
    const workerCoverage = workerBlockIds.filter((blockId) => remaining.has(blockId));
    return getConsecutiveRuns(workerCoverage, gapBlockOrder).reduce((best, run) => (run.length > best.length ? run : best), []);
}
export function getLeadingSpan(workerBlockIds, targetRun) {
    const workerCoverage = new Set(workerBlockIds);
    const leadingSpan = [];
    for (const blockId of targetRun) {
        if (!workerCoverage.has(blockId)) {
            break;
        }
        leadingSpan.push(blockId);
    }
    return leadingSpan;
}
export function coversEveryBlock(workerBlockIds, span) {
    const workerCoverage = new Set(workerBlockIds);
    return span.every((blockId) => workerCoverage.has(blockId));
}
