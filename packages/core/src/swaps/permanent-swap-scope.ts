import type {
  BlockId,
  RecurringSlot,
  ScopePermanentSwapInput,
  ScopePermanentSwapResult,
} from './types.js';

export function scopePermanentSwapWeeks(input: ScopePermanentSwapInput): ScopePermanentSwapResult {
  const affected: ScopePermanentSwapResult['affected'] = [];
  const skipped: ScopePermanentSwapResult['skipped'] = [];
  const acceptedAtMs = input.acceptedAt.getTime();

  for (const occurrence of input.occurrences) {
    const base = {
      occurrenceId: occurrence.occurrenceId,
      weekStartDate: occurrence.weekStartDate,
    };

    if (occurrence.occurrenceStartAt.getTime() <= acceptedAtMs) {
      skipped.push({ ...base, reason: 'past_occurrence' });
      continue;
    }

    if (occurrence.profile !== 'regular_school_year') {
      skipped.push({ ...base, reason: 'break_profile' });
      continue;
    }

    if (occurrence.currentOwnerUserId !== input.workerAUserId) {
      skipped.push({ ...base, reason: 'not_owned_by_worker_a' });
      continue;
    }

    affected.push(base);
  }

  return { affected, skipped };
}

export function computePermanentSwapScope(
  workerASlot: RecurringSlot,
  workerACurrentOwnership: Map<string, string>,
): { toSwap: BlockId[]; skipped: { blockId: BlockId; reason: string }[] } {
  const toSwap: BlockId[] = [];
  const skipped: { blockId: BlockId; reason: string }[] = [];

  for (const blockId of workerASlot.blockIds) {
    if (workerACurrentOwnership.has(blockId)) {
      toSwap.push(blockId);
    } else {
      skipped.push({ blockId, reason: 'not_owned_by_worker_a' });
    }
  }

  return { toSwap, skipped };
}
