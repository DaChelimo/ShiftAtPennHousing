// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/orchestrator/evaluate.js by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
const MINUTE_MS = 60 * 1000;
function stepFireAt(blockStartAt, step) {
    return blockStartAt.getTime() + step.offsetMinutes * MINUTE_MS;
}
function toEvaluation(step) {
    return step.trigger === undefined
        ? { stepName: step.stepName }
        : { stepName: step.stepName, trigger: step.trigger };
}
// C-2 audit fix: rolled_back rows should fire when the orchestrator's
// tick lands in the SAME minute bucket as the step's offset moment —
// not only at exact millisecond equality. pg_cron schedules `* * * * *`
// at HH:MM:00 boundaries; HTTP latency makes `new Date()` inside the
// Edge Function land at HH:MM:00.150 or later. Strict equality means
// production ticks would essentially never re-fire a rolled_back step.
// Minute-bucket comparison preserves the BSpec §6.6 #7 second-bullet
// rule ("broadcast skipped after T-3h has passed" → returns empty for
// any later minute) while tolerating sub-minute cron jitter.
function sameMinuteBucket(nowMs, fireAt) {
    return Math.floor(nowMs / MINUTE_MS) === Math.floor(fireAt / MINUTE_MS);
}
export function evaluateChainSteps(input) {
    const nowMs = input.now.getTime();
    const blockStartMs = input.blockStartAt.getTime();
    if (nowMs >= blockStartMs || input.chain.length === 0) {
        return [];
    }
    const maxReachedMissingOffset = input.chain.reduce((maxOffset, step) => {
        if (input.stepStatus[step.stepName] !== undefined ||
            nowMs < stepFireAt(input.blockStartAt, step)) {
            return maxOffset;
        }
        return maxOffset === null ? step.offsetMinutes : Math.max(maxOffset, step.offsetMinutes);
    }, null);
    return input.chain.flatMap((step) => {
        const status = input.stepStatus[step.stepName];
        const fireAt = stepFireAt(input.blockStartAt, step);
        const offsetReached = nowMs >= fireAt;
        if (!offsetReached) {
            return [];
        }
        if (status === 'fired' || status === 'completed_via_force_trigger') {
            return [];
        }
        if (status === 'rolled_back') {
            return sameMinuteBucket(nowMs, fireAt) ? [toEvaluation(step)] : [];
        }
        if (maxReachedMissingOffset !== null && step.offsetMinutes < maxReachedMissingOffset) {
            return [];
        }
        return [toEvaluation(step)];
    });
}
