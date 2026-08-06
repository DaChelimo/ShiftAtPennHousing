// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/force-trigger/types.js by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
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
export {};
