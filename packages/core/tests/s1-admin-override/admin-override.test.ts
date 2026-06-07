// S1 — Admin override: the pure validators `evaluateAdminAssignment` /
// `evaluateAdminRemoval` (web-remediation session S1, audit #1).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §4.3 (Phase-3 post-publish override — assign /
//     reassign / remove on a published block, "same card UI"), §11.1 (the
//     live-calendar manager surface), §1.2/§1.5 (Harnwell-training +
//     float-direction invariants), §9.3 (the weekly hours cap: 20-soft
//     overridable, 40-hard absolute);
//   ARCHITECTURE.md §9.3 (effective_weekly_cap soft vs hard);
//   AGENTS.md hard invariants #1 (Harnwell), #3 (no-takeback — float-committed
//     seats deferred), #4 (cap is soft on assign), #5 (30-min), #6 (NY tz).
//   docs/web-remediation/sessions/S1/TEST_PLAN.md (the §4a behavior contract +
//     pinned decisions D1–D8 below).
//
// THE MODEL (TEST_PLAN §3, mirroring force-trigger/validation.ts): each validator
// returns a DISCRIMINATED-UNION result with a FIXED precedence — HARD BLOCKS
// dominate ADVISORIES. `evaluateAdminAssignment` →
//   { ok: true; advisories: AdminAdvisory[] } | { ok: false; hardBlocks: AdminHardBlock[] }
// `evaluateAdminRemoval` →
//   { ok: true } | { ok: false; hardBlocks: AdminHardBlock[] }
// Reasons / kinds are short snake_case literals fixed by the contract:
//   AdminHardBlock.reason ∈ { worker_inactive, hard_cap_exceeded, block_started,
//     float_committed, seat_not_assignable, not_occupied_by_worker,
//     cross_house_not_supported }
//   AdminAdvisory.kind ∈ { cannot, opted_out, soft_cap, over_target }
// Pinned decisions exercised here: D1 (no T-2h cutoff; block_started iff
// block_start_at <= now), D2 (hard cap absolute — NOT overridable even with
// overrideAdvisories), D3 (float-committed = hard block), D4 (success shape),
// D8 (Harnwell satisfied by same-house construction; the DB trigger is the
// asserted backstop in pgTAP — not re-tested in the pure layer).
//
// TDD-RED: `../../src/admin-override/index.js` does not exist yet; this file +
// fixtures.ts pin the contract and turn GREEN when the implementer lands it.

import { describe, expect, it } from 'vitest';

import { evaluateAdminAssignment, evaluateAdminRemoval } from '../../src/admin-override/index.js';

import {
  BLOCK_HOUSE,
  FUTURE_BLOCK_START,
  INCUMBENT,
  NOW,
  OTHER_HOUSE,
  TARGET_WORKER,
  makeAssignmentInput,
  makeRemovalInput,
  plusHours,
  type AdminHardBlockReason,
} from './fixtures.js';

// Helpers: extract the reasons / kinds regardless of branch, so a wrong branch
// fails loudly instead of throwing on a missing property.
function hardReasons(result: ReturnType<typeof evaluateAdminAssignment>): AdminHardBlockReason[] {
  return result.ok ? [] : result.hardBlocks.map((b) => b.reason);
}
function advisoryKinds(result: ReturnType<typeof evaluateAdminAssignment>): string[] {
  return result.ok ? result.advisories.map((a) => a.kind) : [];
}

// =====================================================================
// ASSIGN — hard blocks (never overridable). BSpec §4.3 / §1.5 / §9.3.
// =====================================================================

describe('evaluateAdminAssignment — hard blocks (§4.3 / §1.5 / §9.3)', () => {
  it('assigning an inactive worker → hard block worker_inactive', () => {
    const result = evaluateAdminAssignment(makeAssignmentInput({ workerIsActive: false }));
    expect(result.ok).toBe(false);
    expect(hardReasons(result)).toContain('worker_inactive');
  });

  it('assigning over the week hard (40h) cap → hard block hard_cap_exceeded', () => {
    const result = evaluateAdminAssignment(
      makeAssignmentInput({
        capHours: 40,
        capEnforcement: 'hard',
        projectedWeeklyHours: 42,
      }),
    );
    expect(result.ok).toBe(false);
    expect(hardReasons(result)).toContain('hard_cap_exceeded');
  });

  it('over the hard (40h) cap is STILL a hard block even when overrideAdvisories is set (D2 — hard caps are not overridable)', () => {
    const result = evaluateAdminAssignment(
      makeAssignmentInput({
        capHours: 40,
        capEnforcement: 'hard',
        projectedWeeklyHours: 42,
        overrideAdvisories: true,
      }),
    );
    expect(result.ok).toBe(false);
    expect(hardReasons(result)).toContain('hard_cap_exceeded');
  });

  it('assigning to a block whose start <= now → hard block block_started (D1 — edits never run after start)', () => {
    const result = evaluateAdminAssignment(makeAssignmentInput({ blockStartAt: NOW }));
    expect(result.ok).toBe(false);
    expect(hardReasons(result)).toContain('block_started');
  });

  it('a block that started in the past → hard block block_started', () => {
    const result = evaluateAdminAssignment(
      makeAssignmentInput({ blockStartAt: plusHours(NOW, -1) }),
    );
    expect(result.ok).toBe(false);
    expect(hardReasons(result)).toContain('block_started');
  });

  it('assigning to a floated_out seat → hard block float_committed (D3 — float seats out of scope)', () => {
    const result = evaluateAdminAssignment(
      makeAssignmentInput({ seatStatus: 'occupied', seatFloatState: 'floated_out' }),
    );
    expect(result.ok).toBe(false);
    expect(hardReasons(result)).toContain('float_committed');
  });

  it('assigning to a pending_float_in seat → hard block float_committed', () => {
    const result = evaluateAdminAssignment(
      makeAssignmentInput({ seatStatus: 'occupied', seatFloatState: 'pending_float_in' }),
    );
    expect(result.ok).toBe(false);
    expect(hardReasons(result)).toContain('float_committed');
  });

  it('assigning to a seat that is neither vacant nor a reassignable occupied seat → seat_not_assignable', () => {
    // An "allied"-coverage seat: not vacant (so not a fill) and not a worker-held
    // reassignable seat — the override cannot place a worker here.
    const result = evaluateAdminAssignment(
      makeAssignmentInput({ seatStatus: 'occupied', seatOccupantUserId: null }),
    );
    expect(result.ok).toBe(false);
    expect(hardReasons(result)).toContain('seat_not_assignable');
  });

  it('assigning a worker whose home house ≠ block house → hard block cross_house_not_supported', () => {
    const result = evaluateAdminAssignment(
      makeAssignmentInput({ workerHomeHouseId: OTHER_HOUSE, blockHouseId: BLOCK_HOUSE }),
    );
    expect(result.ok).toBe(false);
    expect(hardReasons(result)).toContain('cross_house_not_supported');
  });
});

// =====================================================================
// ASSIGN — advisories (overridable with confirm). BSpec §4.3 Phase-2/3 / §9.3.
// =====================================================================

describe('evaluateAdminAssignment — advisories (§4.3 / §9.3)', () => {
  it('assigning a worker marked cannot for the block → advisory cannot (carries the block time)', () => {
    const result = evaluateAdminAssignment(makeAssignmentInput({ preference: 'cannot' }));
    expect(result.ok).toBe(true);
    expect(advisoryKinds(result)).toContain('cannot');
    // The advisory carries the offending block time (so the confirm modal can name it).
    const cannot = result.ok ? result.advisories.find((a) => a.kind === 'cannot') : undefined;
    expect(cannot && 'blockStartAt' in cannot ? cannot.blockStartAt : undefined).toEqual(
      FUTURE_BLOCK_START,
    );
  });

  it('assigning an opted-out worker → advisory opted_out', () => {
    const result = evaluateAdminAssignment(makeAssignmentInput({ optedOut: true }));
    expect(result.ok).toBe(true);
    expect(advisoryKinds(result)).toContain('opted_out');
  });

  it('assigning over the week soft (20h) cap → advisory soft_cap', () => {
    const result = evaluateAdminAssignment(
      makeAssignmentInput({
        capHours: 20,
        capEnforcement: 'soft',
        projectedWeeklyHours: 22,
      }),
    );
    expect(result.ok).toBe(true);
    expect(advisoryKinds(result)).toContain('soft_cap');
  });

  it('assigning beyond the worker target hours → advisory over_target', () => {
    const result = evaluateAdminAssignment(
      makeAssignmentInput({
        targetHours: 4,
        spanHours: 2,
        projectedWeeklyHours: 6, // over the 4h target, under the 20h soft cap
      }),
    );
    expect(result.ok).toBe(true);
    expect(advisoryKinds(result)).toContain('over_target');
  });

  it('a worker with no preference / none for the span → no advisory, assignable', () => {
    const result = evaluateAdminAssignment(makeAssignmentInput({ preference: 'none' }));
    expect(result).toEqual({ ok: true, advisories: [] });
  });

  it('a preferred, within-target, within-cap worker → { ok: true, advisories: [] }', () => {
    const result = evaluateAdminAssignment(
      makeAssignmentInput({
        preference: 'preferred',
        targetHours: 20,
        projectedWeeklyHours: 4,
        capHours: 20,
        capEnforcement: 'soft',
      }),
    );
    expect(result).toEqual({ ok: true, advisories: [] });
  });

  it('an available, within-target, within-cap worker → { ok: true, advisories: [] }', () => {
    const result = evaluateAdminAssignment(makeAssignmentInput({ preference: 'available' }));
    expect(result).toEqual({ ok: true, advisories: [] });
  });
});

// =====================================================================
// ASSIGN — precedence: a hard block dominates any advisory. BSpec §4.3.
// =====================================================================

describe('evaluateAdminAssignment — hard precedence over advisories (§4.3)', () => {
  it('when both a hard block and an advisory apply → result is ok:false with the hard block', () => {
    // An inactive worker who is ALSO over soft cap and marked cannot: the hard
    // block wins; the result is the hard-block branch (no advisories branch).
    const result = evaluateAdminAssignment(
      makeAssignmentInput({
        workerIsActive: false,
        preference: 'cannot',
        capHours: 20,
        capEnforcement: 'soft',
        projectedWeeklyHours: 22,
      }),
    );
    expect(result.ok).toBe(false);
    expect(hardReasons(result)).toContain('worker_inactive');
  });

  it('a hard cap + an opted-out advisory → hard_cap_exceeded (hard branch, advisory not surfaced as success)', () => {
    const result = evaluateAdminAssignment(
      makeAssignmentInput({
        capHours: 40,
        capEnforcement: 'hard',
        projectedWeeklyHours: 42,
        optedOut: true,
      }),
    );
    expect(result.ok).toBe(false);
    expect(hardReasons(result)).toContain('hard_cap_exceeded');
  });
});

// =====================================================================
// REMOVE. BSpec §4.3 (remove a worker from a published seat).
// =====================================================================

describe('evaluateAdminRemoval (§4.3)', () => {
  it('removing a scheduled/claimed seat occupied by the named worker → ok:true', () => {
    const result = evaluateAdminRemoval(
      makeRemovalInput({ seatStatus: 'occupied', seatOccupantUserId: TARGET_WORKER }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('removing a block already started → hard block block_started (D1)', () => {
    const result = evaluateAdminRemoval(makeRemovalInput({ blockStartAt: NOW }));
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.hardBlocks.map((b) => b.reason)).toContain('block_started');
  });

  it('removing a float-committed seat → hard block float_committed (D3)', () => {
    const result = evaluateAdminRemoval(makeRemovalInput({ seatFloatState: 'floated_out' }));
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.hardBlocks.map((b) => b.reason)).toContain('float_committed');
  });

  it('removing where the seat is not occupied by the named worker → not_occupied_by_worker', () => {
    const result = evaluateAdminRemoval(
      makeRemovalInput({ workerUserId: TARGET_WORKER, seatOccupantUserId: INCUMBENT }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.hardBlocks.map((b) => b.reason)).toContain(
      'not_occupied_by_worker',
    );
  });

  it('removing a vacant seat (no occupant) → not_occupied_by_worker', () => {
    const result = evaluateAdminRemoval(
      makeRemovalInput({ seatStatus: 'vacant', seatOccupantUserId: null }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.hardBlocks.map((b) => b.reason)).toContain(
      'not_occupied_by_worker',
    );
  });
});

// =====================================================================
// Purity — same input + injected `now` → same output; no input mutation.
// =====================================================================

describe('purity (§4a — deterministic, injected clock)', () => {
  it('evaluateAdminAssignment: identical input + injected now → identical output', () => {
    const input = makeAssignmentInput({ preference: 'cannot', optedOut: true });
    expect(evaluateAdminAssignment(input)).toEqual(evaluateAdminAssignment(input));
  });

  it('evaluateAdminRemoval: identical input + injected now → identical output', () => {
    const input = makeRemovalInput({ seatFloatState: 'pending_float_out' });
    expect(evaluateAdminRemoval(input)).toEqual(evaluateAdminRemoval(input));
  });

  it('the validators do not mutate their input', () => {
    const a = makeAssignmentInput({ preference: 'cannot' });
    const r = makeRemovalInput();
    const aSnap = JSON.parse(JSON.stringify(a));
    const rSnap = JSON.parse(JSON.stringify(r));
    evaluateAdminAssignment(a);
    evaluateAdminRemoval(r);
    expect(JSON.parse(JSON.stringify(a))).toEqual(aSnap);
    expect(JSON.parse(JSON.stringify(r))).toEqual(rSnap);
  });
});
