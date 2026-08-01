// S1 — Admin override: contract types (BSpec §4.3 Phase-3, §11.1, §1.2/§1.5, §9.3).
//
// The PURE decision surface the admin-override web action pre-flights and the SQL
// RPC (admin_assign_worker / admin_remove_worker) mirrors. The validators
// (`evaluateAdminAssignment` / `evaluateAdminRemoval`) are Supabase-free and
// clock-injected (`now: Date`); the authoritative SQL RPC re-checks every hard
// block. House style mirrors force-trigger/validation.ts (discriminated-union
// result, hard-over-advisory precedence) and the Phase2Advisory union in
// scheduling/scheduleBuilderCard.ts.
//
// The validator reasons about a SINGLE representative seat (the placement
// decision); the RPC fans a `permanent` scope out over the recurring slot's
// future occurrences. Status is the binary placement axis (vacant / occupied);
// float commitment is a SEPARATE axis so float-committed seats (S1 OUT) rank
// above reassignment.

export type AdminOverrideScope = 'this_week' | 'permanent';

// Binary placement status: a seat is open (vacant) or held (occupied).
export type AdminSeatStatus = 'vacant' | 'occupied';

// Float-commitment axis. Anything other than 'none' is a committed float and is
// OUT of S1 scope (handled via the float decline/void controls — no-takeback).
export type AdminSeatFloatState =
  | 'none'
  | 'floated_in'
  | 'floated_out'
  | 'pending_float_in'
  | 'pending_float_out';

// The worker's preference for the acting span (preferences.status). 'cannot' is
// the overridable advisory; 'none'/'preferred'/'available' raise no advisory.
export type AdminWorkerPreference = 'preferred' | 'available' | 'cannot' | 'none';

export type AdminCapEnforcement = 'soft' | 'hard';

// The seat the operator is acting on. `occupantUserId` is null when vacant; an
// occupied seat with a null occupant is an anonymous/allied-covered seat that the
// override cannot place into (→ seat_not_assignable).
export type AdminSeatSnapshot = {
  blockHouseId: string;
  blockStartAt: Date;
  status: AdminSeatStatus;
  floatState: AdminSeatFloatState;
  occupantUserId: string | null;
};

export type AdminAssignmentInput = {
  scope: AdminOverrideScope;
  overrideAdvisories: boolean;
  now: Date;
  worker: {
    userId: string;
    isActive: boolean;
    homeHouseId: string;
  };
  seat: AdminSeatSnapshot;
  // The worker's preference for the acting span.
  preference: AdminWorkerPreference;
  // period_targets.opted_out — the "no hours" button.
  optedOut: boolean;
  // The caller pre-computes the weekly projection (AGENTS invariant #4: this is a
  // claim/assign cap; float hours are out of scope). The validator only compares.
  hours: {
    spanHours: number;
    // Weekly total INCLUDING the span being assigned.
    projectedWeeklyHours: number;
    targetHours: number;
    capHours: number;
    capEnforcement: AdminCapEnforcement;
  };
};

export type AdminRemovalInput = {
  scope: AdminOverrideScope;
  now: Date;
  worker: { userId: string };
  seat: AdminSeatSnapshot;
};

// Hard blocks are absolute — never overridable; they take precedence over advisories.
export type AdminHardBlockReason =
  | 'worker_inactive'
  | 'hard_cap_exceeded'
  | 'float_committed'
  | 'seat_not_assignable'
  | 'not_occupied_by_worker'
  | 'cross_house_not_supported';

export type AdminHardBlock = { reason: AdminHardBlockReason };

// Advisories are soft constraints — overridable via the 2-step confirm. The union
// mirrors scheduling/scheduleBuilderCard.ts `Phase2Advisory` (cannot carries the
// block time so the confirm modal can name it).
export type AdminAdvisoryKind = 'cannot' | 'opted_out' | 'soft_cap' | 'over_target';

export type AdminAdvisory =
  | { kind: 'cannot'; blockStartAt: Date }
  | { kind: 'opted_out' }
  | { kind: 'soft_cap' }
  | { kind: 'over_target' };

export type AdminAssignmentResult =
  | { ok: true; advisories: AdminAdvisory[] }
  | { ok: false; hardBlocks: AdminHardBlock[] };

export type AdminRemovalResult = { ok: true } | { ok: false; hardBlocks: AdminHardBlock[] };
