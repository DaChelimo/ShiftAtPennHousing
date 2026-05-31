type PermanentDropScopeInput = {
  droppingUserId: string;
  dropInitiatedAt: Date;
  semesterEndDate: string | null;
  occurrences: {
    assignmentId: string;
    weekStartDate: string;
    occurrenceStartAt: Date;
    occurrenceDate: string;
    currentOwnerUserId: string | null;
    profile: string;
    floatStatus: 'none' | 'floated_out' | 'pending_float_out';
  }[];
};

type PermanentDropSkipReason =
  | 'past_or_in_progress'
  | 'beyond_semester'
  | 'break_profile'
  | 'not_owned'
  | 'float_committed';

type PermanentDropScopeResult = {
  affected: { assignmentId: string; weekStartDate: string }[];
  skipped: { assignmentId: string; weekStartDate: string; reason: PermanentDropSkipReason }[];
};

type FloatCommitmentRef = {
  floatId: string;
  status: string;
  sourceAssignmentIds: string[];
};

type FloatCommitmentWarning = {
  floatId: string;
  status: 'pending' | 'acknowledged';
};

function skipReason(
  input: PermanentDropScopeInput & { semesterEndDate: string },
  occurrence: PermanentDropScopeInput['occurrences'][number],
): PermanentDropSkipReason | null {
  if (occurrence.occurrenceStartAt.getTime() <= input.dropInitiatedAt.getTime()) {
    return 'past_or_in_progress';
  }
  if (occurrence.occurrenceDate > input.semesterEndDate) {
    return 'beyond_semester';
  }
  if (occurrence.profile !== 'regular_school_year') {
    return 'break_profile';
  }
  if (occurrence.currentOwnerUserId !== input.droppingUserId) {
    return 'not_owned';
  }
  if (occurrence.floatStatus === 'floated_out' || occurrence.floatStatus === 'pending_float_out') {
    return 'float_committed';
  }
  return null;
}

export function scopePermanentDrop(input: PermanentDropScopeInput): PermanentDropScopeResult {
  if (input.semesterEndDate === null) {
    throw new Error('Cannot determine semester boundary. Contact administrator.');
  }

  const boundedInput = { ...input, semesterEndDate: input.semesterEndDate };
  const affected: PermanentDropScopeResult['affected'] = [];
  const skipped: PermanentDropScopeResult['skipped'] = [];

  for (const occurrence of input.occurrences) {
    const scoped = {
      assignmentId: occurrence.assignmentId,
      weekStartDate: occurrence.weekStartDate,
    };
    const reason = skipReason(boundedInput, occurrence);
    if (reason === null) {
      affected.push(scoped);
    } else {
      skipped.push({ ...scoped, reason });
    }
  }

  return { affected, skipped };
}

export function findFloatCommitmentWarnings(input: {
  slotAssignmentIds: string[];
  floatCommitments: FloatCommitmentRef[];
}): FloatCommitmentWarning[] {
  const slotAssignmentIds = new Set(input.slotAssignmentIds);

  return input.floatCommitments.flatMap((commitment) => {
    if (commitment.status !== 'pending' && commitment.status !== 'acknowledged') {
      return [];
    }
    if (
      !commitment.sourceAssignmentIds.some((assignmentId) => slotAssignmentIds.has(assignmentId))
    ) {
      return [];
    }
    return [{ floatId: commitment.floatId, status: commitment.status }];
  });
}
