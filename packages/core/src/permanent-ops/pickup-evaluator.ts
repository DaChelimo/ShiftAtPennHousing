export function evaluatePickupWeek(params: {
  workerCurrentHours: number;
  weekBlocksToAdd: { blockId: string; conflictsWithExisting: boolean }[];
  weeklyCap: number;
  capEnforcement: 'soft' | 'hard';
}): { toPickUp: string[]; skipped: { blockId: string; reason: 'conflict' | 'cap' }[] } {
  const conflicting = params.weekBlocksToAdd.filter((block) => block.conflictsWithExisting);
  const available = params.weekBlocksToAdd.filter((block) => !block.conflictsWithExisting);
  const projectedHours = params.workerCurrentHours + available.length * 0.5;

  if (available.length > 0 && projectedHours > params.weeklyCap) {
    return {
      toPickUp: [],
      skipped: params.weekBlocksToAdd.map((block) => ({ blockId: block.blockId, reason: 'cap' })),
    };
  }

  return {
    toPickUp: available.map((block) => block.blockId),
    skipped: conflicting.map((block) => ({ blockId: block.blockId, reason: 'conflict' })),
  };
}

export function evaluatePermanentPickup(input: {
  weeks: {
    weekStartDate: string;
    blocks: { blockId: string; conflictsWithExisting: boolean }[];
    currentWeeklyHours: number;
    capHours: number;
    capEnforcement: 'soft' | 'hard';
  }[];
}) {
  const weeks = input.weeks.map((week) => {
    const evaluation = evaluatePickupWeek({
      workerCurrentHours: week.currentWeeklyHours,
      weekBlocksToAdd: week.blocks,
      weeklyCap: week.capHours,
      capEnforcement: week.capEnforcement,
    });
    const skippedBlockIds = evaluation.skipped.map((block) => block.blockId);

    if (evaluation.toPickUp.length === 0) {
      return {
        weekStartDate: week.weekStartDate,
        status: 'skipped' as const,
        assignedBlockIds: [],
        skippedBlockIds,
        skipReason: evaluation.skipped.some((block) => block.reason === 'cap')
          ? ('hours_cap' as const)
          : ('time_conflict' as const),
      };
    }

    if (skippedBlockIds.length > 0) {
      return {
        weekStartDate: week.weekStartDate,
        status: 'partially_assigned' as const,
        assignedBlockIds: evaluation.toPickUp,
        skippedBlockIds,
        skipReason: 'time_conflict' as const,
      };
    }

    return {
      weekStartDate: week.weekStartDate,
      status: 'fully_assigned' as const,
      assignedBlockIds: evaluation.toPickUp,
      skippedBlockIds: [],
      skipReason: null,
    };
  });

  return {
    weeks,
    assignedBlockIds: weeks.flatMap((week) => week.assignedBlockIds),
    totalWeeksInScope: weeks.length,
    weeksFullyAssigned: weeks.filter((week) => week.status === 'fully_assigned').length,
    weeksPartiallyAssigned: weeks.filter((week) => week.status === 'partially_assigned').length,
    weeksSkipped: weeks.filter((week) => week.status === 'skipped').length,
  };
}
