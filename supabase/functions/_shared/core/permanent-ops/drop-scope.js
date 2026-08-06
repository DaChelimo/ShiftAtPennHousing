// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/permanent-ops/drop-scope.js by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
function skipReason(input, occurrence) {
    if (occurrence.occurrenceStartAt.getTime() <= input.dropInitiatedAt.getTime()) {
        return 'past_or_in_progress';
    }
    if (occurrence.occurrenceDate > input.semesterEndDate) {
        return 'beyond_semester';
    }
    if (occurrence.profile !== 'regular_school_year') {
        return 'break_profile';
    }
    if (occurrence.currentOwnerUserId !== input.droppingUserId) {
        return 'not_owned';
    }
    if (occurrence.floatStatus === 'floated_out' || occurrence.floatStatus === 'pending_float_out') {
        return 'float_committed';
    }
    return null;
}
export function scopePermanentDrop(input) {
    if (input.semesterEndDate === null) {
        throw new Error('Cannot determine semester boundary. Contact administrator.');
    }
    const boundedInput = { ...input, semesterEndDate: input.semesterEndDate };
    const affected = [];
    const skipped = [];
    for (const occurrence of input.occurrences) {
        const scoped = {
            assignmentId: occurrence.assignmentId,
            weekStartDate: occurrence.weekStartDate,
        };
        const reason = skipReason(boundedInput, occurrence);
        if (reason === null) {
            affected.push(scoped);
        }
        else {
            skipped.push({ ...scoped, reason });
        }
    }
    return { affected, skipped };
}
export function findFloatCommitmentWarnings(input) {
    const slotAssignmentIds = new Set(input.slotAssignmentIds);
    return input.floatCommitments.flatMap((commitment) => {
        if (commitment.status !== 'pending' && commitment.status !== 'acknowledged') {
            return [];
        }
        if (!commitment.sourceAssignmentIds.some((assignmentId) => slotAssignmentIds.has(assignmentId))) {
            return [];
        }
        return [{ floatId: commitment.floatId, status: commitment.status }];
    });
}
