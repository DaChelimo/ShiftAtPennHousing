export type DropOccurrenceProfile = 'regular_school_year' | 'short_break' | 'winter_break' | string;

export type DropFloatStatus = 'none' | 'floated_out' | 'pending_float_out';

export type DropOccurrence = {
  assignmentId: string;
  weekStartDate: string;
  occurrenceStartAt: Date;
  occurrenceDate: string;
  currentOwnerUserId: string | null;
  profile: DropOccurrenceProfile;
  floatStatus: DropFloatStatus;
};

export type PermanentDropScopeInput = {
  droppingUserId: string;
  dropInitiatedAt: Date;
  semesterEndDate: string | null;
  occurrences: DropOccurrence[];
};

export type PermanentDropSkipReason =
  | 'past_or_in_progress'
  | 'beyond_semester'
  | 'break_profile'
  | 'not_owned'
  | 'float_committed';

export type DroppedWeek = {
  assignmentId: string;
  weekStartDate: string;
};

export type DropSkippedWeek = DroppedWeek & {
  reason: PermanentDropSkipReason;
};

export type PermanentDropScopeResult = {
  affected: DroppedWeek[];
  skipped: DropSkippedWeek[];
};

export type FloatCommitmentStatus =
  | 'pending'
  | 'acknowledged'
  | 'declined'
  | 'voided'
  | 'completed'
  | string;

export type FloatCommitmentRef = {
  floatId: string;
  status: FloatCommitmentStatus;
  sourceAssignmentIds: string[];
};

export type FloatCommitmentWarning = {
  floatId: string;
  status: 'pending' | 'acknowledged';
};

export type PickupBlock = {
  blockId: string;
  conflictsWithExisting: boolean;
};

export type PickupWeek = {
  weekStartDate: string;
  blocks: PickupBlock[];
  currentWeeklyHours: number;
  capHours: number;
  capEnforcement: 'soft' | 'hard';
};

export type PermanentPickupInput = {
  weeks: PickupWeek[];
};

export type PickupWeekStatus = 'fully_assigned' | 'partially_assigned' | 'skipped';

export type PickupSkipReason = 'time_conflict' | 'hours_cap';

export type PickupWeekOutcome = {
  weekStartDate: string;
  status: PickupWeekStatus;
  assignedBlockIds: string[];
  skippedBlockIds: string[];
  skipReason: PickupSkipReason | null;
};

export type PermanentPickupResult = {
  weeks: PickupWeekOutcome[];
  assignedBlockIds: string[];
  totalWeeksInScope: number;
  weeksFullyAssigned: number;
  weeksPartiallyAssigned: number;
  weeksSkipped: number;
};
