// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/float-lookup/index.js by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
import { getEligibleWorkersForSource } from './eligibility.js';
import { normalizeInput } from './normalize.js';
import { coversEveryBlock, getConsecutiveRuns, getLargestConsecutiveSpan, getLeadingSpan, } from './spans.js';
import { selectByTiebreaker } from './tiebreaker.js';
const HARNWELL_HOUSE_ID = 'harnwell';
// Minimum float chunk size (BSpec §6.2 #4). A floater's assigned span must be at
// least this many consecutive 30-minute blocks. Lowered from 2 (1 hour) to 1
// (30 minutes) so single-block gaps are absorbed by floats instead of routed to
// Allied — the goal is to minimize how often paid Allied coverage is procured.
const MIN_FLOAT_CHUNK_BLOCKS = 1;
const BLOCK_DURATION_MS = 30 * 60 * 1000;
function sameBlockIds(left, right) {
    return left.length === right.length && left.every((blockId, index) => blockId === right[index]);
}
function workerStartsAtSpan(worker, span, gap) {
    const spanStart = span[0];
    if (spanStart === undefined) {
        return false;
    }
    const spanStartAt = gap.blockStartTimes.get(spanStart);
    if (spanStartAt === undefined) {
        return false;
    }
    return worker.shiftStartAt.getTime() === spanStartAt.getTime();
}
function workerEndsAtSpan(worker, span, gap) {
    const spanEnd = span.at(-1);
    if (spanEnd === undefined) {
        return false;
    }
    const spanEndStartAt = gap.blockStartTimes.get(spanEnd);
    if (spanEndStartAt === undefined) {
        return false;
    }
    return worker.shiftEndAt.getTime() === spanEndStartAt.getTime() + BLOCK_DURATION_MS;
}
function selectWorkerForSpan(candidates, span, gap) {
    return selectByTiebreaker(candidates, (candidate) => workerStartsAtSpan(candidate, span, gap), (candidate) => workerEndsAtSpan(candidate, span, gap));
}
function buildAssignment(worker, sourceHouseId, span) {
    return {
        workerId: worker.workerId,
        sourceHouseId,
        blocks: [...span],
    };
}
function chooseLargestNonLeadingSpan(candidateSpans, targetRun, allowTrailingPartial) {
    const viable = candidateSpans.filter((candidate) => candidate.span.length >= MIN_FLOAT_CHUNK_BLOCKS);
    if (viable.length === 0) {
        return null;
    }
    const maxLength = Math.max(...viable.map((candidate) => candidate.span.length));
    const maxCandidates = viable.filter((candidate) => candidate.span.length === maxLength);
    // A purely trailing partial leaves the start of the current run
    // uncovered and does not improve the leading handoff the fallback
    // is for. On the first iteration at each source we exclude trailing
    // partials so a Quad-trailing worker cannot preempt a Harnwell-full
    // worker on the next source. After the source has selected at least
    // once, this restriction is lifted: interior-hole scenarios
    // (Integration Scenario 9) need to allow the trailing remainder.
    const nonTrailing = allowTrailingPartial
        ? maxCandidates
        : maxCandidates.filter((candidate) => candidate.span.at(-1) !== targetRun.at(-1));
    return nonTrailing[0] ?? null;
}
// Partial-coverage fallback — tiered selection (pinned decision #16).
//
// Against the current uncovered run, the algorithm tries three tiers
// in order. Each tier hands its tied candidates to the §6.3
// tiebreaker chain (selectByTiebreaker). The first non-empty tier
// yields the selection.
//
//   Tier 1: FULL coverage — workers covering the entire targetRun.
//   Tier 2: LEADING coverage — workers covering the run's start with
//           a leading portion >= MIN_FLOAT_CHUNK_BLOCKS (pinned #13).
//   Tier 3: LARGEST CONSECUTIVE anywhere within the run,
//           >= MIN_FLOAT_CHUNK_BLOCKS, with a non-trailing filter on the
//           first iteration at each source (allowTrailingPartial=false).
//
// If all three tiers yield no candidate, return null; the caller
// breaks out of this source's loop and moves on.
function chooseCandidateForCurrentRun(eligibleWorkers, targetRun, gap, allowTrailingPartial) {
    const fullCoverWorkers = eligibleWorkers.filter((worker) => coversEveryBlock(worker.scheduledBlockIds, targetRun));
    if (fullCoverWorkers.length > 0) {
        return {
            worker: selectWorkerForSpan(fullCoverWorkers, targetRun, gap),
            span: targetRun,
        };
    }
    const leadingSpans = eligibleWorkers
        .map((worker) => ({ worker, span: getLeadingSpan(worker.scheduledBlockIds, targetRun) }))
        .filter((candidate) => candidate.span.length >= MIN_FLOAT_CHUNK_BLOCKS);
    if (leadingSpans.length > 0) {
        const maxLength = Math.max(...leadingSpans.map((candidate) => candidate.span.length));
        const selectedSpan = leadingSpans.find((candidate) => candidate.span.length === maxLength).span;
        const tiedWorkers = leadingSpans
            .filter((candidate) => candidate.span.length === maxLength)
            .map((candidate) => candidate.worker);
        return {
            worker: selectWorkerForSpan(tiedWorkers, selectedSpan, gap),
            span: selectedSpan,
        };
    }
    const largestSpans = eligibleWorkers.map((worker) => ({
        worker,
        span: getLargestConsecutiveSpan(worker.scheduledBlockIds, targetRun, gap.blockIds),
    }));
    const selected = chooseLargestNonLeadingSpan(largestSpans, targetRun, allowTrailingPartial);
    if (selected === null) {
        return null;
    }
    const tiedWorkers = largestSpans
        .filter((candidate) => sameBlockIds(candidate.span, selected.span))
        .map((candidate) => candidate.worker);
    return {
        worker: selectWorkerForSpan(tiedWorkers, selected.span, gap),
        span: selected.span,
    };
}
export function findFloaters(input) {
    const { gap, sources } = normalizeInput(input);
    // BSpec §6.1: Harnwell-as-destination short-circuit. Off-duty
    // Harnwell workers route through the weekly feed, not float lookup.
    if (gap.destinationHouseId === HARNWELL_HOUSE_ID) {
        return { assignments: [], alliedBlockIds: [...gap.blockIds] };
    }
    const assignments = [];
    const remainingUncoveredBlocks = [...gap.blockIds];
    const tentativeFloatingOut = new Map();
    const selectedWorkerIds = new Set();
    const sourcesWithPriorSelection = new Set();
    for (const source of sources) {
        while (remainingUncoveredBlocks.length > 0) {
            // Consider every uncovered run >= the minimum chunk, largest first.
            const candidateRuns = getConsecutiveRuns(remainingUncoveredBlocks, gap.blockIds)
                .filter((run) => run.length >= MIN_FLOAT_CHUNK_BLOCKS)
                .sort((left, right) => right.length - left.length);
            if (candidateRuns.length === 0) {
                break;
            }
            const eligibleWorkers = getEligibleWorkersForSource(source, gap, input.exclusions, tentativeFloatingOut).filter((worker) => !selectedWorkerIds.has(worker.workerId));
            if (eligibleWorkers.length === 0) {
                break;
            }
            const allowTrailingPartial = sourcesWithPriorSelection.has(source.houseId);
            // F-06-001: try each uncovered run (largest first) before abandoning
            // this source. A worker who cannot cover the largest run may still
            // cover a smaller uncovered run; only give up on the source when no
            // run >= MIN_FLOAT_CHUNK_BLOCKS has any eligible worker.
            let selected = null;
            for (const targetRun of candidateRuns) {
                const candidate = chooseCandidateForCurrentRun(eligibleWorkers, targetRun, gap, allowTrailingPartial);
                if (candidate !== null && candidate.span.length >= MIN_FLOAT_CHUNK_BLOCKS) {
                    selected = candidate;
                    break;
                }
            }
            if (selected === null) {
                break;
            }
            assignments.push(buildAssignment(selected.worker, source.houseId, selected.span));
            selectedWorkerIds.add(selected.worker.workerId);
            sourcesWithPriorSelection.add(source.houseId);
            // Pinned decision #1: tentative counter is GLOBAL per source.
            // Increment unconditionally after each selection, regardless of
            // the selected span's length. The floor check
            // (sourceHasFloor / workerBlocksRespectSourceFloor) reads this
            // counter so that a single lookup invocation cannot over-float
            // a source beyond (headcount − 1) selections per pass.
            tentativeFloatingOut.set(source.houseId, (tentativeFloatingOut.get(source.houseId) ?? 0) + 1);
            const covered = new Set(selected.span);
            for (let index = remainingUncoveredBlocks.length - 1; index >= 0; index -= 1) {
                if (covered.has(remainingUncoveredBlocks[index])) {
                    remainingUncoveredBlocks.splice(index, 1);
                }
            }
        }
    }
    return {
        assignments,
        alliedBlockIds: remainingUncoveredBlocks,
    };
}
export function runFloatLookup(input) {
    return findFloaters(input).assignments;
}
export * from './spans.js';
export * from './tiebreaker.js';
export * from './types.js';
export { getEligibleWorkersForSource } from './eligibility.js';
