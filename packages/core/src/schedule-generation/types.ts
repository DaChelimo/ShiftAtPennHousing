// Dev-seeding: auto-build a balanced draft schedule — public type surface.
//
// PURE + deterministic. Coverage-first, shift-length-balanced. IGNORES preferences by
// design (contrast the AI agent, which respects them). The web action snapshots each
// open house's template-week blocks + SW roster, calls generateBalancedSchedule, and
// writes the result through the admin_seed_draft_schedule RPC.

// One 30-minute block of the house's template week.
export type SchedBlock = {
  blockId: string;
  weekday: number; // NY weekday, 0 = Mon .. 6 = Sun (matches blockWeekSlot)
  minuteOfDay: number; // minutes since NY midnight, [0, 1440)
  // Seats to fill for this block. NOT the block's own required_headcount: the action
  // sets it to the MINIMUM required_headcount across every block sharing this
  // (weekday, time-of-day) slot in the period, because publish stamps the template
  // week's (isodow, tod) pattern across all weeks and RAISES on any week whose block
  // has a smaller headcount. Seats above this minimum stay vacant (still claimable).
  laneCount: number;
};

export type SchedRosterWorker = {
  workerId: string;
  homeHouseId: string;
};

export type SchedConfig = {
  // Global run seed; combined with (periodId, houseId) for reproducibility.
  seed: string;
  // Effective weekly cap in hours (RPC-resolved from the period profile upstream).
  weeklyCapHours: number;
  // Optional weighting of preferred shift lengths (block counts). Defaults favor 3-4h.
  shiftLengthWeights?: Partial<Record<number, number>>;
};

export type DraftAssignment = {
  periodId: string;
  blockId: string;
  userId: string;
};

export type UnfilledBlock = {
  blockId: string;
  seats: number; // laneCount minus seats the generator could fill
};

export type ScheduleResult = {
  assignments: DraftAssignment[];
  unfilled: UnfilledBlock[];
  assignedCount: number; // total block-seats assigned
  unfilledSeatCount: number; // total block-seats left open
};
