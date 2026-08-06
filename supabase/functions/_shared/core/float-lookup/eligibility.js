// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/float-lookup/eligibility.js by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
const BLOCK_DURATION_MS = 30 * 60 * 1000;
// Float direction is now CONFIG-DRIVEN WITH HARD GUARDS (stakeholder decision
// 2026-07-02; amends AGENTS hard invariant #2 from the old class-based allowlist).
// Which houses may source floats, and to which destinations, is the admin-authored
// float_routing matrix the orchestrator snapshots into `sources`. The two ABSOLUTE
// guards remain enforced in code, independent of that config:
//   1. Harnwell is never a destination — handled by the caller's short-circuit in
//      index.ts (the whole gap routes to Allied before any source is examined), and
//      backstopped by the float_routing legality trigger (20260702000005).
//   2. A source desk never drops below one present worker — sourceHasFloor /
//      workerBlocksRespectSourceFloor below, using per-block effective headcount.
//      This is what makes a single-staffed source (headcount 1) unable to lend, and
//      is why the old class allowlist is redundant: a house can only source while it
//      is genuinely multi-staffed for the covered blocks.
// The Harnwell TRAINING invariant (no non-Harnwell worker staffs Harnwell) is
// independent of float direction and is enforced at every assignment write point by
// the DB trigger (enforce_harnwell_assignment_training); Harnwell never being a
// float destination means no float ever targets it anyway.
function hasAdminWorkerExclusion(worker) {
    // RSM, like HM and BM, is never an automatic float candidate. The top-level
    // admin (house-agnostic superuser) is likewise never floated.
    return (worker.roles.includes('hm') ||
        worker.roles.includes('rsm') ||
        worker.roles.includes('bm') ||
        worker.roles.includes('admin'));
}
// Source-level early exit (pinned-decision #1): the source can admit
// at least one more floater iff some block still has slack after
// accounting for the running tentative counter. Using MAX (not MIN)
// of per-block headcount preserves correctness for sources with
// uneven staffing — a low-headcount block on one end of the gap
// must not disqualify candidates whose coverage avoids that block.
// The per-worker floor check (workerBlocksRespectSourceFloor) then
// enforces the floor on the exact blocks each candidate covers.
function sourceHasFloor(source, tentativeFloatingOut) {
    const tentativeCount = tentativeFloatingOut.get(source.houseId) ?? 0;
    for (const headcount of source.headcountByBlockId.values()) {
        if (headcount - tentativeCount > 1) {
            return true;
        }
    }
    return false;
}
function workerBlocksRespectSourceFloor(worker, source, gap, tentativeFloatingOut) {
    const tentativeCount = tentativeFloatingOut.get(source.houseId) ?? 0;
    const gapBlocks = new Set(gap.blockIds);
    return worker.scheduledBlockIds
        .filter((blockId) => gapBlocks.has(blockId))
        .every((blockId) => {
        const headcount = source.headcountByBlockId.get(blockId);
        if (headcount === undefined) {
            // No headcount data for a block the worker claims to cover
            // is a caller bug; fail closed.
            return false;
        }
        return headcount - tentativeCount > 1;
    });
}
function getGapWindow(gap) {
    const starts = [...gap.blockStartTimes.values()];
    if (starts.length === 0) {
        return null;
    }
    const startAt = new Date(Math.min(...starts.map((date) => date.getTime())));
    const endAt = new Date(Math.max(...starts.map((date) => date.getTime())) + BLOCK_DURATION_MS);
    return { startAt, endAt };
}
// Half-open intervals — abutting ranges (left.end == right.start) do
// not overlap. Pinned-decision #6.
function rangesOverlap(left, right) {
    return left.startAt < right.endAt && left.endAt > right.startAt;
}
function hasMatchingExclusion(worker, destinationHouseId, exclusions, gapWindow) {
    if (gapWindow === null) {
        return false;
    }
    return exclusions.some((exclusion) => exclusion.userId === worker.workerId &&
        exclusion.destinationHouseId === destinationHouseId &&
        rangesOverlap({ startAt: exclusion.windowStartAt, endAt: exclusion.windowEndAt }, gapWindow));
}
export function getEligibleWorkersForSource(source, gap, exclusions, tentativeFloatingOut) {
    // Source eligibility is the floor guard alone (guard #2 above): the source must
    // retain >= 1 worker after lending. Which houses reach this function at all is
    // decided upstream by the float_routing snapshot + the Harnwell-destination
    // short-circuit; there is no longer a hardcoded class allowlist.
    if (!sourceHasFloor(source, tentativeFloatingOut)) {
        return [];
    }
    const gapWindow = getGapWindow(gap);
    return source.workers.filter((worker) => {
        if (worker.homeHouseId !== source.houseId) {
            return false;
        }
        if (!worker.isActive) {
            return false;
        }
        if (hasAdminWorkerExclusion(worker)) {
            return false;
        }
        if (!workerBlocksRespectSourceFloor(worker, source, gap, tentativeFloatingOut)) {
            return false;
        }
        // BSpec §6.1: worker already assigned to a float (pending or
        // acknowledged) whose window overlaps the gap is excluded.
        // The caller pre-computes this as a boolean against the gap window.
        if (worker.hasConflictingFloat) {
            return false;
        }
        // BSpec §6.1: a worker on a cross-house pickup at any house is
        // treated as a worker at that house for headcount, but is NOT
        // floatable during the pickup window.
        if (worker.hasConflictingCrossHousePickup) {
            return false;
        }
        return !hasMatchingExclusion(worker, gap.destinationHouseId, exclusions, gapWindow);
    });
}
