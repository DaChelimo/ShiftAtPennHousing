export type SwapType = 'shift_swap' | 'float_swap' | 'permanent_swap';

export type SwapAssignmentKind = 'shift' | 'float' | 'cross_house_pickup';

export type SwapSpanAssignment = {
  assignmentId: string;
  houseId: string;
  kind: SwapAssignmentKind;
  inPendingFloat?: boolean;
};

export type SwapParticipant = {
  userId: string;
  homeHouseId: string;
  span: SwapSpanAssignment[];
};

export type SwapEligibilityInput = {
  swapType: 'shift_swap' | 'float_swap';
  initiator: SwapParticipant;
  counterparty: SwapParticipant;
};

export type SwapIneligibilityReason =
  | 'harnwell_training_required'
  | 'single_staff_cannot_float'
  | 'block_in_pending_float'
  | 'float_swap_requires_a_float';

export type SwapEligibilityViolation = {
  receiverUserId: string | null;
  assignmentId: string | null;
  destinationHouseId: string | null;
  reason: SwapIneligibilityReason;
};

export type SwapEligibilityResult =
  | { eligible: true }
  | { eligible: false; violations: SwapEligibilityViolation[] };

export type PendingSwapRef = {
  swapId: string;
  assignmentIds: string[];
};

export type RecurringOccurrenceProfile =
  | 'regular_school_year'
  | 'short_break'
  | 'winter_break'
  | string;

export type RecurringOccurrence = {
  occurrenceId: string;
  weekStartDate: string;
  occurrenceStartAt: Date;
  currentOwnerUserId: string | null;
  profile: RecurringOccurrenceProfile;
};

export type ScopedWeek = {
  occurrenceId: string;
  weekStartDate: string;
};

export type PermanentSwapSkipReason = 'past_occurrence' | 'break_profile' | 'not_owned_by_worker_a';

export type SkippedWeek = ScopedWeek & {
  reason: PermanentSwapSkipReason;
};

export type ScopePermanentSwapInput = {
  workerAUserId: string;
  acceptedAt: Date;
  occurrences: RecurringOccurrence[];
};

export type ScopePermanentSwapResult = {
  affected: ScopedWeek[];
  skipped: SkippedWeek[];
};

export type BlockId = string;

export type RecurringSlot = {
  blockIds: BlockId[];
};
