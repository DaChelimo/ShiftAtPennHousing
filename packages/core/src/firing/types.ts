// S4 — Fire a worker: PURE planner contract types (BSpec §4.5, §5.4/§5.5, §6).
//
// The PURE decision oracle the firing flow reasons with, and the parallel mirror
// of the authoritative SQL RPC (fire_worker, migration 20260606000003) — which
// re-derives the SAME plan in SQL and is the one that actually writes. The planner
// is Supabase-free and clock-injected (`now` is an ISO-8601 string on the
// snapshot; never read a clock inside the logic). It is NOT called by the RPC
// (exactly as evaluateAdminAssignment is not called by admin_assign_worker).
//
// House style mirrors admin-override/types.ts (a flat snapshot in, a flat plan
// out, deterministic sorted output so assertions are order-stable).
//
// Scope note (PIN 2): `assignments` carries ONLY scheduled/claimed seats. The
// worker's float seats (floated_in/out, pending_float_in/out) are represented by
// `floats`, NOT in `assignments` — their seat-level reconciliation (reopen
// destination / restore-then-drop source) is the RPC's SQL job, out of the
// planner's scope. This keeps the planner a clean classifier.

// The planner classifies ONLY these two seat statuses.
export type FiringSeatStatus = 'scheduled' | 'claimed';

export type FiringAssignment = {
  assignmentId: string;
  blockId: string;
  houseId: string;
  /** ISO-8601 timestamptz. */
  blockStartAt: string;
  /** Postgres DOW: 0=Sun … 6=Sat, NY-local. */
  dayOfWeek: number;
  /** 'HH:MM' 24h NY-local. */
  blockStartLocal: string;
  status: FiringSeatStatus;
  /** The block's required_headcount. */
  requiredHeadcount: number;
  /** Count of OTHER counting-status seats on this block (EXCLUDES the fired worker). */
  othersPresentCount: number;
};

export type FiringFloat = { floatId: string; status: 'pending' | 'acknowledged' };

export type FiringSwap = { swapId: string };

export type FiringSnapshot = {
  /** ISO-8601. */
  now: string;
  worker: { userId: string; homeHouseId: string; isActive: boolean };
  /** The worker's OWN scheduled/claimed seats ONLY (no float seats). */
  assignments: FiringAssignment[];
  /** pending|acknowledged floats where user_id = worker (pre-filtered). */
  floats: FiringFloat[];
  /** pending swaps where the worker is initiator OR counterparty (pre-filtered). */
  swaps: FiringSwap[];
};

// One permanent_drop_slot call per (houseId, dayOfWeek) slot.
export type FiringSlot = { houseId: string; dayOfWeek: number; blockStartLocals: string[] };

export type FiringPlan = {
  /** worker.isActive === false → true, everything else empty/false. */
  alreadyInactive: boolean;
  /** The seat straddling now (≤ now < +30min), with whether vacating drops below headcount. */
  inProgress: { assignmentId: string; blockId: string; needsEscalation: boolean } | null;
  /** Grouped distinct future recurring slots → one permanent_drop_slot call each. */
  recurringSlotsToDrop: FiringSlot[];
  /** assignmentIds of future claimed seats. */
  nonRecurringToVacate: string[];
  /** floatIds. */
  floatsToVoid: string[];
  /** swapIds. */
  swapsToVoid: string[];
  /** true unless alreadyInactive. */
  deactivate: boolean;
};
