// Phase 08 — Force-Trigger Pathway: endpoint validation (the five §6.2 checks).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §6.6 #1 (initiation window + profile gate);
//   ARCHITECTURE.md §6.2 (the five validation checks). "If any check fails,
//   the request is rejected with a descriptive error." — there is NO partial
//   execution.
//
// `validateForceTrigger` is PURE: no I/O, no clock, no DB. The caller (the
// force-trigger Edge Function, ARCH §6) assembles the snapshot from DB reads,
// then calls this as a pre-flight gate before invoking the atomic execution
// RPC. It returns the FIRST failing reason in a fixed precedence, or { ok: true }.
//
// Pinned decisions (tests/PHASE_08/TEST_PLAN.md):
//   #1 authorization is OR (admin-role-at-destination OR current HMOD);
//   #2 the 2-hour window is STRICT — valid iff (earliestStart - now) > 2h;
//   #3 a pending float-in is its OWN reason, ranked above generic not-vacant;
//   #4 deterministic precedence: empty → unauthorized → pending_float_in →
//      not_vacant → within_two_hours → float_not_enabled;
//   #5 the window is checked against the EARLIEST block start across ALL
//      blocks — a single too-soon block rejects the whole request.

import type {
  ForceTriggerRole,
  ForceTriggerValidationInput,
  ForceTriggerValidationResult,
} from './types.js';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// SM/HM/RSM/BM hold admin powers at their scoped house (BSpec §2.7: BM == HM;
// §2.3a: RSM == HM minus HMOD). `sw` is never an admin role. The role list is
// already filtered to the destination house by the caller (ARCH §6.2 #1).
const ADMIN_ROLES: ReadonlySet<ForceTriggerRole> = new Set(['sm', 'hm', 'rsm', 'bm']);

export function validateForceTrigger(
  input: ForceTriggerValidationInput,
): ForceTriggerValidationResult {
  const { initiator, blocks, now, floatEnabled } = input;

  // 1. At least one target block.
  if (blocks.length === 0) {
    return { ok: false, reason: 'empty_block_set' };
  }

  // 2. Initiator authorized — any elevated schedule admin (hm/bm/rsm, anywhere;
  //    2026-06-27 cross-house decision) OR an admin role scoped to the
  //    destination (covers sm own-house) OR the currently-on-duty HMOD
  //    (pinned #1: OR, not AND).
  const isAuthorized =
    initiator.isScheduleAdmin === true ||
    initiator.isCurrentHmod ||
    initiator.rolesAtDestinationHouse.some((role) => ADMIN_ROLES.has(role));
  if (!isAuthorized) {
    return { ok: false, reason: 'unauthorized_initiator' };
  }

  // 3. No block already targeted by a pending float-in (pinned #3 — this
  //    specific reason outranks the generic not-vacant check).
  if (blocks.some((block) => block.hasPendingFloatIn)) {
    return { ok: false, reason: 'block_has_pending_float_in' };
  }

  // 4. Every target block is currently vacant (pinned #5 — whole-request:
  //    one non-vacant block rejects all, no partial execution).
  if (blocks.some((block) => block.status !== 'vacant')) {
    return { ok: false, reason: 'block_not_vacant' };
  }

  // 5. The earliest block start is STRICTLY more than 2 hours out (pinned
  //    #2). At exactly T-2h the standard chain's float_lookup already fires,
  //    so force-trigger there is redundant and rejected.
  const earliestStartMs = Math.min(...blocks.map((block) => block.blockStartAt.getTime()));
  if (earliestStartMs - now.getTime() <= TWO_HOURS_MS) {
    return { ok: false, reason: 'within_two_hours' };
  }

  // 6. The blocks' date belongs to a float-enabled profile (no source pool
  //    exists during a non-floating profile, e.g. winter break).
  if (!floatEnabled) {
    return { ok: false, reason: 'float_not_enabled' };
  }

  return { ok: true };
}
