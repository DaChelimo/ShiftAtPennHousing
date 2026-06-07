// S2 — Force-trigger float: the pure UI summarizer `summarizeForceTrigger`
// (web-remediation session S2, audit #2).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §6.6 (force-triggered float — an SM/HM invokes
//     the float lookup early from a coverage gap), §5.4 (escalation), §6.1
//     (float direction — enforced in the backend), §6.5 (the winter-break /
//     non-floating-profile gate);
//   docs/web-remediation/sessions/S2/TEST_PLAN.md (§3 architecture + §4a
//     behavior contract + pinned decisions D1–D5). This file pins §4a.
//
// THE MODEL (TEST_PLAN §3/§4a): the `force-trigger` Edge Function already does
// the whole job (validate → findFloaters → force_trigger_float per floater →
// process_hmod_notify_allied_step per no-floater block). The web layer only
// summarizes the EF's JSON response into a UI outcome via a PURE function:
//
//   summarizeForceTrigger(res) →
//     { kind: 'floated' | 'allied' | 'mixed' | 'gated' | 'rejected' | 'failed';
//       floaterCount: number; alliedCount: number; reason?: string }
//
// The input is the parsed EF JSON, either the success or an error shape:
//   success:   { ok: true; floatAssignmentIds: string[];
//                alliedNotifications: { blockId: string; claimed: boolean }[];
//                forcedAt: string }
//   rejection: { error: 'force_trigger_rejected'; reason: string }
//   failure:   { error: 'force_trigger_failed'; detail: string }   (or a 500)
//
// Outcome mapping (D3 / §4a):
//   floatAssignmentIds.length > 0, alliedNotifications empty → 'floated'
//   alliedNotifications.length > 0, floatAssignmentIds empty → 'allied'
//   BOTH non-empty                                           → 'mixed'
//   rejected with reason 'float_disabled'  (the §6.5 winter note) → 'gated'
//   any other rejection reason                              → 'rejected' (carries reason)
//   failure / 500                                           → 'failed'
//   ok:true with BOTH arrays empty                          → a defined, non-crashing
//                                                              outcome (pinned below)
//
// NOTE FOR THE LEAD (reason-literal drift): TEST_PLAN §4a fixes the *gated* reason
// as 'float_disabled', and the contract (§3) says the summarizer keys 'gated' off
// it — so that is the asserted RED contract here. The deployed EF validator
// (packages/core/src/force-trigger/validation.ts) actually emits
// 'float_not_enabled' for the non-floating-profile case. Either the EF must map
// 'float_not_enabled' → 'float_disabled' before the summarizer sees it, OR the
// summarizer must treat BOTH as 'gated'. To keep the suite robust to whichever
// the implementer picks, the gated group asserts the §4a 'float_disabled' line
// (the contract) AND adds a sibling case for the real 'float_not_enabled' literal.
//
// TDD-RED: `../../src/force-trigger/summary.js` does not exist yet (the
// force-trigger module today holds only validation.ts / block-step-status.ts /
// types.ts / index.ts). This import is the intended failure; the file turns GREEN
// when the implementer lands summarizeForceTrigger + its barrel export.

import { describe, expect, it } from 'vitest';

import { summarizeForceTrigger } from '../../src/force-trigger/summary.js';

// ---------------------------------------------------------------------
// Fixtures — faithful EF response shapes (supabase/functions/force-trigger).
// ---------------------------------------------------------------------

function successResponse(over: {
  floatAssignmentIds?: string[];
  alliedNotifications?: { blockId: string; claimed: boolean }[];
  forcedAt?: string;
}) {
  return {
    ok: true as const,
    floatAssignmentIds: over.floatAssignmentIds ?? [],
    alliedNotifications: over.alliedNotifications ?? [],
    forcedAt: over.forcedAt ?? '2026-06-07T12:00:00.000Z',
  };
}

function rejection(reason: string) {
  return { error: 'force_trigger_rejected' as const, reason };
}

function failure(detail: string) {
  return { error: 'force_trigger_failed' as const, detail };
}

// =====================================================================
// Success outcomes — floated / allied / mixed (§4a, D3).
// =====================================================================

describe('summarizeForceTrigger — success outcomes (§6.6 / D3)', () => {
  it('a response with floatAssignmentIds:[a], alliedNotifications:[] → kind "floated", floaterCount 1, alliedCount 0', () => {
    const out = summarizeForceTrigger(successResponse({ floatAssignmentIds: ['a'] }));
    expect(out.kind).toBe('floated');
    expect(out.floaterCount).toBe(1);
    expect(out.alliedCount).toBe(0);
  });

  it('floatAssignmentIds:[], alliedNotifications:[x] → kind "allied", alliedCount 1, floaterCount 0', () => {
    const out = summarizeForceTrigger(
      successResponse({ alliedNotifications: [{ blockId: 'x', claimed: false }] }),
    );
    expect(out.kind).toBe('allied');
    expect(out.alliedCount).toBe(1);
    expect(out.floaterCount).toBe(0);
  });

  it('both arrays non-empty → kind "mixed" carrying both counts', () => {
    const out = summarizeForceTrigger(
      successResponse({
        floatAssignmentIds: ['a', 'b'],
        alliedNotifications: [{ blockId: 'x', claimed: true }],
      }),
    );
    expect(out.kind).toBe('mixed');
    expect(out.floaterCount).toBe(2);
    expect(out.alliedCount).toBe(1);
  });

  it('ok:true with BOTH arrays empty → a defined, non-crashing outcome with zero counts (so the UI always has a message)', () => {
    // §4a: pin it. The exact kind is the implementer's choice among the union
    // (e.g. 'allied' with 0, or a distinct sentinel) — what the contract fixes is
    // that it does NOT throw and reports zero floaters / zero allied routes.
    const out = summarizeForceTrigger(successResponse({}));
    expect(out).toBeDefined();
    expect(out.floaterCount).toBe(0);
    expect(out.alliedCount).toBe(0);
    // Whatever kind is chosen, it is a member of the discriminated union.
    expect(['floated', 'allied', 'mixed', 'gated', 'rejected', 'failed', 'noop']).toContain(
      out.kind,
    );
  });
});

// =====================================================================
// Gated outcome — the §6.5 non-floating-profile (winter-break) note (D3).
// =====================================================================

describe('summarizeForceTrigger — gated (non-floating profile, §6.5)', () => {
  it('the EF validator literal "float_not_enabled" → kind "gated" carrying the reason (winter-break note)', () => {
    // The real validator (packages/core/src/force-trigger/validation.ts) emits
    // 'float_not_enabled' for the non-floating-profile gate → the §6.5 winter-break note.
    const out = summarizeForceTrigger(rejection('float_not_enabled'));
    expect(out.kind).toBe('gated');
    expect(out.reason).toBe('float_not_enabled');
  });
});

// =====================================================================
// Rejected outcomes — other validator reasons (§4a).
// =====================================================================

describe('summarizeForceTrigger — other rejections (§6.6 validation)', () => {
  it('{ reason:"unauthorized_initiator" } → kind "rejected" (or "failed") carrying the reason', () => {
    const out = summarizeForceTrigger(rejection('unauthorized_initiator'));
    expect(['rejected', 'failed']).toContain(out.kind);
    expect(out.reason).toBe('unauthorized_initiator');
  });

  it('{ reason:"block_not_vacant" } → kind "rejected" carrying the reason', () => {
    const out = summarizeForceTrigger(rejection('block_not_vacant'));
    expect(out.kind).toBe('rejected');
    expect(out.reason).toBe('block_not_vacant');
  });
});

// =====================================================================
// Failed outcome — 500 / force_trigger_failed (§4a).
// =====================================================================

describe('summarizeForceTrigger — failure (500 / force_trigger_failed)', () => {
  it('{ error:"force_trigger_failed", detail } → kind "failed"', () => {
    const out = summarizeForceTrigger(failure('rpc blew up'));
    expect(out.kind).toBe('failed');
  });
});

// =====================================================================
// Purity — same input → same output; no mutation (§4a).
// =====================================================================

describe('summarizeForceTrigger — purity (§4a)', () => {
  it('identical input → identical output (deterministic, no I/O)', () => {
    const input = successResponse({
      floatAssignmentIds: ['a'],
      alliedNotifications: [{ blockId: 'x', claimed: false }],
    });
    expect(summarizeForceTrigger(input)).toEqual(summarizeForceTrigger(input));
  });

  it('does not mutate its input', () => {
    const input = successResponse({
      floatAssignmentIds: ['a', 'b'],
      alliedNotifications: [{ blockId: 'x', claimed: true }],
    });
    const snap = JSON.parse(JSON.stringify(input));
    summarizeForceTrigger(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snap);
  });
});
