// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/force-trigger/types.d.ts by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
import type { BlockStepStatusValue, ChainStepName } from '../orchestrator/types.js';
export type ForceTriggerRole = 'sw' | 'sm' | 'hm' | 'rsm' | 'bm';
export type ForceTriggerBlockStatus = 'scheduled' | 'claimed' | 'floated_in' | 'floated_out' | 'pending_float_in' | 'pending_float_out' | 'allied' | 'vacant';
export type ForceTriggerBlockSnapshot = {
    blockId: string;
    status: ForceTriggerBlockStatus;
    blockStartAt: Date;
    hasPendingFloatIn: boolean;
};
export type ForceTriggerInitiator = {
    rolesAtDestinationHouse: ForceTriggerRole[];
    isCurrentHmod: boolean;
    isScheduleAdmin?: boolean;
};
export type ForceTriggerValidationInput = {
    initiator: ForceTriggerInitiator;
    destinationHouseId: string;
    blocks: ForceTriggerBlockSnapshot[];
    now: Date;
    floatEnabled: boolean;
};
export type ForceTriggerRejectionReason = 'empty_block_set' | 'unauthorized_initiator' | 'block_has_pending_float_in' | 'block_not_vacant' | 'within_two_hours' | 'float_not_enabled';
export type ForceTriggerValidationResult = {
    ok: true;
} | {
    ok: false;
    reason: ForceTriggerRejectionReason;
};
export type ForceTriggerStepMark = {
    stepName: ChainStepName;
    status: BlockStepStatusValue;
};
//# sourceMappingURL=types.d.ts.map