import { getEligibleWorkersForSource } from './eligibility.js';
import { normalizeInput, type NormalizedGap, type NormalizedWorker } from './normalize.js';
import {
  coversEveryBlock,
  getLargestConsecutiveSpan,
  getLargestUncoveredRun,
  getLeadingSpan,
} from './spans.js';
import { selectByTiebreaker } from './tiebreaker.js';
import type { BlockId, FloatAssignment, FloatLookupInput, FloatLookupResult } from './types.js';

const HARNWELL_HOUSE_ID = 'harnwell';
const MIN_FLOAT_CHUNK_BLOCKS = 2;
const BLOCK_DURATION_MS = 30 * 60 * 1000;

type CandidateSpan = {
  worker: NormalizedWorker;
  span: BlockId[];
};

function sameBlockIds(left: BlockId[], right: BlockId[]): boolean {
  return left.length === right.length && left.every((blockId, index) => blockId === right[index]);
}

function blockStartTime(gap: NormalizedGap, blockId: BlockId): Date | undefined {
  return gap.blockStartTimes.get(blockId);
}

function workerStartsAtSpan(
  worker: NormalizedWorker,
  span: BlockId[],
  gap: NormalizedGap,
): boolean {
  const spanStart = span[0];

  if (spanStart === undefined) {
    return false;
  }

  const spanStartAt = blockStartTime(gap, spanStart);

  if (worker.shiftStartAt !== undefined && spanStartAt !== undefined) {
    return worker.shiftStartAt.getTime() === spanStartAt.getTime();
  }

  return worker.scheduledBlockIds[0] === spanStart;
}

function workerEndsAtSpan(worker: NormalizedWorker, span: BlockId[], gap: NormalizedGap): boolean {
  const spanEnd = span.at(-1);

  if (spanEnd === undefined) {
    return false;
  }

  const spanEndStartAt = blockStartTime(gap, spanEnd);

  if (worker.shiftEndAt !== undefined && spanEndStartAt !== undefined) {
    return worker.shiftEndAt.getTime() === spanEndStartAt.getTime() + BLOCK_DURATION_MS;
  }

  return worker.scheduledBlockIds.at(-1) === spanEnd;
}

function selectWorkerForSpan(
  candidates: NormalizedWorker[],
  span: BlockId[],
  gap: NormalizedGap,
): NormalizedWorker {
  return selectByTiebreaker(
    candidates,
    (candidate) => workerStartsAtSpan(candidate, span, gap),
    (candidate) => workerEndsAtSpan(candidate, span, gap),
  );
}

function buildAssignment(
  worker: NormalizedWorker,
  sourceHouseId: string,
  span: BlockId[],
): FloatAssignment {
  return {
    workerId: worker.workerId,
    sourceHouseId,
    coveredBlockIds: [...span],
    blocks: [...span],
  };
}

function chooseLargestNonLeadingSpan(
  candidateSpans: CandidateSpan[],
  targetRun: BlockId[],
  allowTrailingPartial: boolean,
): CandidateSpan | null {
  const viable = candidateSpans.filter(
    (candidate) => candidate.span.length >= MIN_FLOAT_CHUNK_BLOCKS,
  );

  if (viable.length === 0) {
    return null;
  }

  const maxLength = Math.max(...viable.map((candidate) => candidate.span.length));
  const maxCandidates = viable.filter((candidate) => candidate.span.length === maxLength);

  // A purely trailing partial leaves the start of this source's current run
  // uncovered and does not improve the leading handoff the fallback is for.
  const nonTrailing = allowTrailingPartial
    ? maxCandidates
    : maxCandidates.filter((candidate) => candidate.span.at(-1) !== targetRun.at(-1));

  return nonTrailing[0] ?? null;
}

function chooseCandidateForCurrentRun(
  eligibleWorkers: NormalizedWorker[],
  targetRun: BlockId[],
  gap: NormalizedGap,
  allowTrailingPartial: boolean,
): CandidateSpan | null {
  const fullCoverWorkers = eligibleWorkers.filter((worker) =>
    coversEveryBlock(worker.scheduledBlockIds, targetRun),
  );

  if (fullCoverWorkers.length > 0) {
    return {
      worker: selectWorkerForSpan(fullCoverWorkers, targetRun, gap),
      span: targetRun,
    };
  }

  const leadingSpans = eligibleWorkers
    .map((worker) => ({ worker, span: getLeadingSpan(worker.scheduledBlockIds, targetRun) }))
    .filter((candidate) => candidate.span.length >= MIN_FLOAT_CHUNK_BLOCKS);

  if (leadingSpans.length > 0) {
    const maxLength = Math.max(...leadingSpans.map((candidate) => candidate.span.length));
    const selectedSpan = leadingSpans.find(
      (candidate) => candidate.span.length === maxLength,
    )!.span;
    const tiedWorkers = leadingSpans
      .filter((candidate) => candidate.span.length === maxLength)
      .map((candidate) => candidate.worker);

    return {
      worker: selectWorkerForSpan(tiedWorkers, selectedSpan, gap),
      span: selectedSpan,
    };
  }

  const largestSpans = eligibleWorkers.map((worker) => ({
    worker,
    span: getLargestConsecutiveSpan(worker.scheduledBlockIds, targetRun, gap.blockIds),
  }));
  const selected = chooseLargestNonLeadingSpan(largestSpans, targetRun, allowTrailingPartial);

  if (selected === null) {
    return null;
  }

  const tiedWorkers = largestSpans
    .filter((candidate) => sameBlockIds(candidate.span, selected.span))
    .map((candidate) => candidate.worker);

  return {
    worker: selectWorkerForSpan(tiedWorkers, selected.span, gap),
    span: selected.span,
  };
}

export function findFloaters(input: FloatLookupInput): FloatLookupResult {
  const { gap, sources, legacyMode } = normalizeInput(input);

  if (gap.destinationHouseId === HARNWELL_HOUSE_ID) {
    return { assignments: [], alliedBlockIds: [...gap.blockIds] };
  }

  const assignments: FloatAssignment[] = [];
  const remainingUncoveredBlocks = [...gap.blockIds];
  const tentativeFloatingOut = new Map<string, number>();
  const selectedWorkerIds = new Set<string>();
  const selectedSpanLengthsBySource = new Map<string, number[]>();

  for (const source of sources) {
    while (remainingUncoveredBlocks.length > 0) {
      const targetRun = getLargestUncoveredRun(remainingUncoveredBlocks, gap.blockIds);

      if (targetRun.length < MIN_FLOAT_CHUNK_BLOCKS) {
        break;
      }

      const eligibleWorkers = getEligibleWorkersForSource(
        source,
        gap,
        input.exclusions,
        tentativeFloatingOut,
      ).filter((worker) => !selectedWorkerIds.has(worker.workerId));

      if (eligibleWorkers.length === 0) {
        break;
      }

      const selected = chooseCandidateForCurrentRun(
        eligibleWorkers,
        targetRun,
        gap,
        !legacyMode || (selectedSpanLengthsBySource.get(source.houseId)?.length ?? 0) > 0,
      );

      if (selected === null || selected.span.length < MIN_FLOAT_CHUNK_BLOCKS) {
        break;
      }

      assignments.push(buildAssignment(selected.worker, source.houseId, selected.span));
      selectedWorkerIds.add(selected.worker.workerId);
      const priorSpanLengths = selectedSpanLengthsBySource.get(source.houseId) ?? [];
      selectedSpanLengthsBySource.set(source.houseId, [...priorSpanLengths, selected.span.length]);

      if (!legacyMode || selected.span.length === MIN_FLOAT_CHUNK_BLOCKS) {
        tentativeFloatingOut.set(
          source.houseId,
          (tentativeFloatingOut.get(source.houseId) ?? 0) + 1,
        );
      }

      const covered = new Set(selected.span);
      for (let index = remainingUncoveredBlocks.length - 1; index >= 0; index -= 1) {
        if (covered.has(remainingUncoveredBlocks[index]!)) {
          remainingUncoveredBlocks.splice(index, 1);
        }
      }
    }
  }

  return {
    assignments,
    alliedBlockIds: remainingUncoveredBlocks,
  };
}

export function runFloatLookup(input: FloatLookupInput): FloatAssignment[] {
  return findFloaters(input).assignments;
}

export * from './eligibility.js';
export * from './spans.js';
export * from './tiebreaker.js';
export * from './types.js';
