import type { BlockId, ScheduledWorker } from './types.js';

export function selectByTiebreaker<T>(
  candidates: T[],
  startsAtSelectedSpan: (candidate: T) => boolean,
  endsAtSelectedSpan: (candidate: T) => boolean,
): T {
  if (candidates.length === 0) {
    throw new Error('breakTie requires at least one candidate');
  }

  let narrowed = candidates;

  const startAligned = narrowed.filter(startsAtSelectedSpan);
  if (startAligned.length === 1) {
    return startAligned[0]!;
  }
  if (startAligned.length > 1) {
    narrowed = startAligned;
  }

  const endAligned = narrowed.filter(endsAtSelectedSpan);
  if (endAligned.length === 1) {
    return endAligned[0]!;
  }
  if (endAligned.length > 1) {
    narrowed = endAligned;
  }

  return narrowed[0]!;
}

export function breakTie(
  candidates: ScheduledWorker[],
  selectedSpan: BlockId[],
  _gapBlockOrder: BlockId[],
): ScheduledWorker {
  const spanStart = selectedSpan[0];
  const spanEnd = selectedSpan.at(-1);

  return selectByTiebreaker(
    candidates,
    (candidate) => candidate.scheduledBlockIds[0] === spanStart,
    (candidate) => candidate.scheduledBlockIds.at(-1) === spanEnd,
  );
}
