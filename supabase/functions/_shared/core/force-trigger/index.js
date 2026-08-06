// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/force-trigger/index.js by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
// Phase 08 — Force-Trigger Pathway: public surface.
//
// The two PURE decision surfaces the force-trigger Edge Function (ARCH §6)
// relies on:
//   validateForceTrigger        — the §6.2 pre-flight validation gate;
//   forceTriggerSuccessMarks /  — the block_step_status pre-mark & rollback
//   forceTriggerRollbackSteps     step sets the atomic execution RPC writes.
//
// The atomic execution itself lives in the SQL RPC `force_trigger_float`
// (supabase/migrations) — TypeScript owns only the policy decisions.
export * from './types.js';
export * from './validation.js';
export * from './block-step-status.js';
export * from './summary.js';
