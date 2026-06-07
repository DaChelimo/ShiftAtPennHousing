// S1 — Admin override: PURE validators (BSpec §4.3 Phase-3, §11.1, §9.3, §1.2/§1.5).
//
// `evaluateAdminAssignment` / `evaluateAdminRemoval` are PURE: no I/O, no DB; the
// clock is injected (`now: Date`). They are the pre-flight decision surface the
// web action calls and the mirror of the authoritative SQL RPCs
// (admin_assign_worker / admin_remove_worker), which re-check every hard block.
//
// House style mirrors force-trigger/validation.ts (fixed precedence — hard reasons
// dominate advisories) and the Phase2Advisory union in scheduleBuilderCard.ts.
//
// Pinned decisions (docs/web-remediation/sessions/S1/TEST_PLAN.md):
//   D1 admin power, not a worker claim — no T-2h cutoff, but a started/past block
//      (blockStartAt <= now) is rejected (`block_started`).
//   D2 the 40h HARD cap is absolute — `hard_cap_exceeded` is never overridable; the
//      20h SOFT cap is an advisory.
//   D3 float-committed seats are OUT of scope → `float_committed`.
//   D8 same-house scope satisfies Harnwell training by construction (the DB
//      trigger remains the absolute backstop, asserted in pgTAP).
//   D9 cap projection is pre-computed by the caller as hours.projectedWeeklyHours
//      (weekly total INCLUDING the span); the validator compares it to the cap.

import {
  type AdminAdvisory,
  type AdminAssignmentInput,
  type AdminAssignmentResult,
  type AdminHardBlock,
  type AdminHardBlockReason,
  type AdminRemovalInput,
  type AdminRemovalResult,
  type AdminSeatSnapshot,
} from './types.js';

export * from './types.js';

// A started/past seat: its block has already begun (D1). Strict `<=` — at exactly
// `now` the block has begun (edits / escalation never run after start).
function isStarted(seat: AdminSeatSnapshot, now: Date): boolean {
  return seat.blockStartAt.getTime() <= now.getTime();
}

// A committed float occupies this seat (S1 OUT — use the float decline/void path).
function isFloatCommitted(seat: AdminSeatSnapshot): boolean {
  return seat.floatState !== 'none';
}

// Assignable: a vacant seat (fill) or an occupied seat with a real occupant
// (reassign). An occupied seat with no occupant is anonymous/allied coverage the
// override cannot place into. Float commitment ranks above this and is handled first.
function isAssignableSeat(seat: AdminSeatSnapshot): boolean {
  if (seat.status === 'vacant') return true;
  return seat.status === 'occupied' && seat.occupantUserId !== null;
}

export function evaluateAdminAssignment(input: AdminAssignmentInput): AdminAssignmentResult {
  const { worker, seat, hours, now } = input;

  const hardBlocks: AdminHardBlock[] = [];
  const push = (reason: AdminHardBlockReason): void => {
    hardBlocks.push({ reason });
  };

  // Hard blocks (absolute; collected in fixed precedence — hard dominates advisories).
  // 1. Cross-house target — same-house override only (S1 OUT).
  if (worker.homeHouseId !== seat.blockHouseId) {
    push('cross_house_not_supported');
  }
  // 2. Inactive worker.
  if (!worker.isActive) {
    push('worker_inactive');
  }
  // 3. The seat's block has already started/past (D1).
  if (isStarted(seat, now)) {
    push('block_started');
  }
  // 4. Float-committed seat (S1 OUT) — ranked above the generic assignability check.
  if (isFloatCommitted(seat)) {
    push('float_committed');
  } else if (!isAssignableSeat(seat)) {
    // 5. Neither a vacant fill nor a reassignable occupied seat.
    push('seat_not_assignable');
  }
  // 6. Over the HARD (40h) cap — absolute, never overridable (D2/D9).
  if (hours.capEnforcement === 'hard' && hours.projectedWeeklyHours > hours.capHours) {
    push('hard_cap_exceeded');
  }

  if (hardBlocks.length > 0) {
    return { ok: false, hardBlocks };
  }

  // Advisories (soft constraints, overridable via the 2-step confirm).
  const advisories: AdminAdvisory[] = [];
  if (input.preference === 'cannot') {
    advisories.push({ kind: 'cannot', blockStartAt: seat.blockStartAt });
  }
  if (input.optedOut) {
    advisories.push({ kind: 'opted_out' });
  }
  if (hours.capEnforcement === 'soft' && hours.projectedWeeklyHours > hours.capHours) {
    advisories.push({ kind: 'soft_cap' });
  }
  if (hours.projectedWeeklyHours > hours.targetHours) {
    advisories.push({ kind: 'over_target' });
  }

  return { ok: true, advisories };
}

export function evaluateAdminRemoval(input: AdminRemovalInput): AdminRemovalResult {
  const { worker, seat, now } = input;

  const hardBlocks: AdminHardBlock[] = [];
  const push = (reason: AdminHardBlockReason): void => {
    hardBlocks.push({ reason });
  };

  // 1. The seat's block has already started/past (D1).
  if (isStarted(seat, now)) {
    push('block_started');
  }
  // 2. Float-committed seat (S1 OUT).
  if (isFloatCommitted(seat)) {
    push('float_committed');
  }
  // 3. The seat is not an occupied seat held by the named worker.
  if (seat.status !== 'occupied' || seat.occupantUserId !== worker.userId) {
    push('not_occupied_by_worker');
  }

  if (hardBlocks.length > 0) {
    return { ok: false, hardBlocks };
  }
  return { ok: true };
}
