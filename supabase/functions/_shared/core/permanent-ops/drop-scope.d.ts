// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/permanent-ops/drop-scope.d.ts by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
type PermanentDropScopeInput = {
    droppingUserId: string;
    dropInitiatedAt: Date;
    semesterEndDate: string | null;
    occurrences: {
        assignmentId: string;
        weekStartDate: string;
        occurrenceStartAt: Date;
        occurrenceDate: string;
        currentOwnerUserId: string | null;
        profile: string;
        floatStatus: 'none' | 'floated_out' | 'pending_float_out';
    }[];
};
type PermanentDropSkipReason = 'past_or_in_progress' | 'beyond_semester' | 'break_profile' | 'not_owned' | 'float_committed';
type PermanentDropScopeResult = {
    affected: {
        assignmentId: string;
        weekStartDate: string;
    }[];
    skipped: {
        assignmentId: string;
        weekStartDate: string;
        reason: PermanentDropSkipReason;
    }[];
};
type FloatCommitmentRef = {
    floatId: string;
    status: string;
    sourceAssignmentIds: string[];
};
type FloatCommitmentWarning = {
    floatId: string;
    status: 'pending' | 'acknowledged';
};
export declare function scopePermanentDrop(input: PermanentDropScopeInput): PermanentDropScopeResult;
export declare function findFloatCommitmentWarnings(input: {
    slotAssignmentIds: string[];
    floatCommitments: FloatCommitmentRef[];
}): FloatCommitmentWarning[];
export {};
//# sourceMappingURL=drop-scope.d.ts.map