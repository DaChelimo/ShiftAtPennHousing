type PickupBlockInput = { blockId: string; conflictsWithExisting: boolean };

// The week's block list is snapshotted from `shift_block_assignments`, which holds one
// row per SEAT. A multi-staff desk (Harnwell required_headcount 2, Quad 3) whose
// recurring slot was permanently dropped by BOTH of its owners lists the same block_id
// twice. An occurrence is 0.5h ONCE, not once per seat (AGENTS.md hard invariant #5) —
// counting the duplicate projects 1.0h, which can push the week over cap and skip it
// whole (§8.4.3), and puts duplicate ids in assignedBlockIds / skippedBlockIds. The
// seats of a block are interchangeable, so one entry per block is the right unit.
function dedupeByBlockId(blocks: PickupBlockInput[]): PickupBlockInput[] {
  const byBlockId = new Map<string, PickupBlockInput>();
  for (const block of blocks) {
    const seen = byBlockId.get(block.blockId);
    byBlockId.set(block.blockId, {
      blockId: block.blockId,
      // A block conflicts if ANY of its seats does — never double-book on a disagreement.
      conflictsWithExisting: (seen?.conflictsWithExisting ?? false) || block.conflictsWithExisting,
    });
  }
  return [...byBlockId.values()];
}

export function evaluatePickupWeek(params: {
  workerCurrentHours: number;
  weekBlocksToAdd: PickupBlockInput[];
  weeklyCap: number;
  capEnforcement: 'soft' | 'hard';
}): { toPickUp: string[]; skipped: { blockId: string; reason: 'conflict' | 'cap' }[] } {
  const blocks = dedupeByBlockId(params.weekBlocksToAdd);
  const conflicting = blocks.filter((block) => block.conflictsWithExisting);
  const available = blocks.filter((block) => !block.conflictsWithExisting);
  const projectedHours = params.workerCurrentHours + available.length * 0.5;

  if (available.length > 0 && projectedHours > params.weeklyCap) {
    return {
      toPickUp: [],
      skipped: blocks.map((block) => ({ blockId: block.blockId, reason: 'cap' })),
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
    // Every occurrence the pickup does NOT take — whole-week cap/conflict skips
    // AND the conflict-skipped blocks of partially-assigned weeks. These must
    // leave the permanent openings feed and route to the weekly feed (§8.4.3:
    // "partial pickups are final"); the SQL RPC re-flags them off permanent_drop.
    skippedBlockIds: weeks.flatMap((week) => week.skippedBlockIds),
    totalWeeksInScope: weeks.length,
    weeksFullyAssigned: weeks.filter((week) => week.status === 'fully_assigned').length,
    weeksPartiallyAssigned: weeks.filter((week) => week.status === 'partially_assigned').length,
    weeksSkipped: weeks.filter((week) => week.status === 'skipped').length,
  };
}
