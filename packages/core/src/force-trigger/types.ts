// Phase 08 — Force-Trigger Pathway: contract types (BSpec §6.6, ARCH §4.5, §6).
//
// These are the PURE decision-surface types the force-trigger Edge Function
// (ARCH §6) uses: the validation pre-flight gate and the block_step_status
// pre-mark / rollback step sets. The execution itself is an atomic SQL RPC
// (force_trigger_float) — see supabase/migrations.
//
// The test fixtures re-export these (packages/core/tests/phase-08/fixtures.ts),
// so any drift between the implementation and the tests surfaces as a
// TypeScript error.

import type { BlockStepStatusValue, ChainStepName } from '../orchestrator/types.js';

export type ForceTriggerRole = 'sw' | 'sm' | 'hm' | 'bm';

export type ForceTriggerBlockStatus =
  | 'scheduled'
  | 'claimed'
  | 'floated_in'
  | 'floated_out'
  | 'pending_float_in'
  | 'pending_float_out'
  | 'allied'
  | 'vacant';

export type ForceTriggerBlockSnapshot = {
  blockId: string;
  status: ForceTriggerBlockStatus;
  blockStartAt: Date;
  hasPendingFloatIn: boolean; // a pending float-in already targets this block
};

export type ForceTriggerInitiator = {
  // The initiator's sm/hm/bm roles SCOPED to the destination house (the
  // caller filters the role list to this destination before building the
  // snapshot).
  rolesAtDestinationHouse: ForceTriggerRole[];
  // The initiator is the currently-on-duty HMOD (resolved via hmod_rotor
  // + hm_leave at request time). Authority spans all 13 houses.
  isCurrentHmod: boolean;
};

export type ForceTriggerValidationInput = {
  initiator: ForceTriggerInitiator;
  destinationHouseId: string;
  blocks: ForceTriggerBlockSnapshot[];
  now: Date;
  floatEnabled: boolean; // the blocks' date maps to a float-enabled profile
};

export type ForceTriggerRejectionReason =
  | 'empty_block_set'
  | 'unauthorized_initiator'
  | 'block_has_pending_float_in'
  | 'block_not_vacant'
  | 'within_two_hours'
  | 'float_not_enabled';

export type ForceTriggerValidationResult =
  | { ok: true }
  | { ok: false; reason: ForceTriggerRejectionReason };

export type ForceTriggerStepMark = {
  stepName: ChainStepName;
  status: BlockStepStatusValue;
};
