// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/force-trigger/block-step-status.js by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
// Phase 08 — Force-Trigger Pathway: block_step_status pre-mark / rollback sets.
//
// Spec sources:
//   ARCHITECTURE.md §4.5 — on SUCCESS the handler writes, in the same
//     transaction as the float assignment, exactly two block_step_status rows
//     per destination block:
//       (block_id, 'broadcast',     'completed_via_force_trigger')
//       (block_id, 'float_lookup',  'completed_via_force_trigger')
//     `hmod_notify_allied` is deliberately NOT pre-marked, so the orchestrator
//     can still fire it if the chain rolls back later.
//   ARCHITECTURE.md §4.5 "Rollback procedure" — on decline/no-ack those two
//     rows flip to `rolled_back`.
//   BEHAVIORAL_SPECIFICATION.md §6.6 #2 (bypass), #8 (no-takeback).
//
// Both helpers are PURE and return FRESH values each call (mutating a result
// must not affect the next call — pinned by the purity tests).
// The exact rows a successful force-trigger writes per destination block.
// Order — broadcast then float_lookup — mirrors the standard chain order.
export function forceTriggerSuccessMarks() {
    return [
        { stepName: 'broadcast', status: 'completed_via_force_trigger' },
        { stepName: 'float_lookup', status: 'completed_via_force_trigger' },
    ];
}
// The exact step names a decline/no-ack rolls back — the same steps (and
// order) that were pre-marked. `hmod_notify_allied` is never in the list
// because it was never pre-marked (mirror of phase-07 pinned #14).
export function forceTriggerRollbackSteps() {
    return ['broadcast', 'float_lookup'];
}
