// GENERATED FILE. DO NOT EDIT.
// Vendored from packages/core/dist/float-lookup/spans.d.ts by scripts/vendor-core-into-functions.mjs.
// Edit packages/core/src and re-run: pnpm vendor:core
import type { BlockId } from './types.js';
export declare function getConsecutiveRuns(blockIds: BlockId[], gapBlockOrder: BlockId[]): BlockId[][];
export declare function getLargestUncoveredRun(remainingUncoveredBlocks: BlockId[], gapBlockOrder: BlockId[]): BlockId[];
export declare function getLargestConsecutiveSpan(workerBlockIds: BlockId[], remainingUncoveredBlocks: BlockId[], gapBlockOrder?: string[]): BlockId[];
export declare function getLeadingSpan(workerBlockIds: BlockId[], targetRun: BlockId[]): BlockId[];
export declare function coversEveryBlock(workerBlockIds: BlockId[], span: BlockId[]): boolean;
//# sourceMappingURL=spans.d.ts.map