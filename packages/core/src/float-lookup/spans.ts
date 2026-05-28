import type { BlockId } from './types.js';

export function getConsecutiveRuns(blockIds: BlockId[], gapBlockOrder: BlockId[]): BlockId[][] {
  const order = new Map(gapBlockOrder.map((blockId, index) => [blockId, index]));
  const orderedBlocks = blockIds
    .filter((blockId) => order.has(blockId))
    .sort((left, right) => order.get(left)! - order.get(right)!);

  const runs: BlockId[][] = [];

  for (const blockId of orderedBlocks) {
    const currentIndex = order.get(blockId)!;
    const lastRun = runs.at(-1);
    const previousBlockId = lastRun?.at(-1);
    const previousIndex = previousBlockId === undefined ? undefined : order.get(previousBlockId);

    if (
      lastRun !== undefined &&
      previousIndex !== undefined &&
      currentIndex === previousIndex + 1
    ) {
      lastRun.push(blockId);
    } else {
      runs.push([blockId]);
    }
  }

  return runs;
}

export function getLargestUncoveredRun(
  remainingUncoveredBlocks: BlockId[],
  gapBlockOrder: BlockId[],
): BlockId[] {
  return getConsecutiveRuns(remainingUncoveredBlocks, gapBlockOrder).reduce<BlockId[]>(
    (best, run) => (run.length > best.length ? run : best),
    [],
  );
}

export function getLargestConsecutiveSpan(
  workerBlockIds: BlockId[],
  remainingUncoveredBlocks: BlockId[],
  gapBlockOrder = remainingUncoveredBlocks,
): BlockId[] {
  const remaining = new Set(remainingUncoveredBlocks);
  const workerCoverage = workerBlockIds.filter((blockId) => remaining.has(blockId));

  return getConsecutiveRuns(workerCoverage, gapBlockOrder).reduce<BlockId[]>(
    (best, run) => (run.length > best.length ? run : best),
    [],
  );
}

export function getLeadingSpan(workerBlockIds: BlockId[], targetRun: BlockId[]): BlockId[] {
  const workerCoverage = new Set(workerBlockIds);
  const leadingSpan: BlockId[] = [];

  for (const blockId of targetRun) {
    if (!workerCoverage.has(blockId)) {
      break;
    }

    leadingSpan.push(blockId);
  }

  return leadingSpan;
}

export function coversEveryBlock(workerBlockIds: BlockId[], span: BlockId[]): boolean {
  const workerCoverage = new Set(workerBlockIds);
  return span.every((blockId) => workerCoverage.has(blockId));
}
