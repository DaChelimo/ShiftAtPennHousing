// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/force-trigger/summary.d.ts by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
export type ForceTriggerResponse = {
    ok: true;
    floatAssignmentIds?: unknown;
    alliedNotifications?: unknown;
    forcedAt?: unknown;
} | {
    error: 'force_trigger_rejected';
    reason?: unknown;
} | {
    error: 'force_trigger_failed';
    detail?: unknown;
} | Record<string, unknown> | null | undefined;
export type ForceTriggerSummary = {
    kind: 'floated' | 'allied' | 'mixed' | 'gated' | 'rejected' | 'failed';
    floaterCount: number;
    alliedCount: number;
    reason?: string;
};
export declare function summarizeForceTrigger(res: ForceTriggerResponse): ForceTriggerSummary;
//# sourceMappingURL=summary.d.ts.map