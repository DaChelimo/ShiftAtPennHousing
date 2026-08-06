// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/orchestrator/types.d.ts by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
export type ChainStepName = string;
export type BlockStepStatusValue = 'fired' | 'completed_via_force_trigger' | 'rolled_back';
export type ChainStep = {
    stepName: ChainStepName;
    offsetMinutes: number;
    trigger?: 'on_float_failure';
};
export type EvaluateChainStepsInput = {
    blockStartAt: Date;
    now: Date;
    chain: ChainStep[];
    stepStatus: Record<ChainStepName, BlockStepStatusValue>;
};
export type ChainStepEvaluation = {
    stepName: ChainStepName;
    trigger?: 'on_float_failure';
};
export type NotificationRecipient = 'rsm' | 'hm' | 'hmod';
export type ResolveNotificationRecipientInput = {
    now: Date;
    blockStartAt: Date;
};
export type SourceSideAtTriggerTime = {
    kind: 'automated';
} | {
    kind: 'force_triggered_still_vacant';
} | {
    kind: 'force_triggered_claimed_by_other';
} | {
    kind: 'force_triggered_covered_by_allied';
};
export type DecideNoAckActionInput = {
    triggerAt: Date;
    floatStartAt: Date;
    acknowledgedAt: Date | null;
    declinedAt: Date | null;
    initiatedBy: 'automated' | 'force_triggered';
    sourceSideAtTriggerTime: SourceSideAtTriggerTime;
};
export type SourceSideAction = {
    type: 'none';
} | {
    type: 'restore_floater_original_assignment';
} | {
    type: 'mark_floater_displaced';
};
export type NoAckOutcome = {
    kind: 'skip';
    reason: 'acknowledged' | 'declined';
} | {
    kind: 'void_and_reescalate';
    voidFloat: true;
    addToFloatExclusions: true;
    destinationToVacant: true;
    rolledBackSteps: ('broadcast' | 'float_lookup')[];
    sourceSideAction: SourceSideAction;
    escalationNextStep: 'hmod_notify_allied';
};
//# sourceMappingURL=types.d.ts.map