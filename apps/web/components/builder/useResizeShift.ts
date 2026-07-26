// Extracted out of ScheduleBuilder.tsx (quarantined for size, AGENTS.md 5.2).
//
// A shift's start/end changed, either by dragging its handle in the grid or by
// editing its times in the focus panel: both funnel through the same
// old -> new blockId set and the same add/remove primitives ScheduleBuilder
// already has (commitAssign, onRemoveSpan). commitAssign already refuses to
// extend into a block whose seats are full, so an edge that runs into someone
// else's shift just stops there instead of erroring, matching how a normal
// assign-drag behaves.

import { useCallback } from 'react';

import type { BuilderBlock } from '../../lib/data/scheduleBuilder';

import type { ShiftRun } from './gridModel';

export function useResizeShift({
  blocks,
  commitAssign,
  onRemoveSpan,
  setFocus,
}: {
  blocks: BuilderBlock[];
  commitAssign: (userId: string, blockIds: string[]) => void;
  onRemoveSpan: (userId: string, blockIds: string[]) => void;
  setFocus: (updater: (prev: ShiftRun | null) => ShiftRun | null) => void;
}): (userId: string, dayKey: string, oldBlockIds: string[], newBlockIds: string[]) => void {
  return useCallback(
    (userId: string, dayKey: string, oldBlockIds: string[], newBlockIds: string[]) => {
      const oldSet = new Set(oldBlockIds);
      const newSet = new Set(newBlockIds);
      const toRemove = oldBlockIds.filter((id) => !newSet.has(id));
      const toAdd = newBlockIds.filter((id) => !oldSet.has(id));
      if (toRemove.length > 0) onRemoveSpan(userId, toRemove);
      if (toAdd.length > 0) commitAssign(userId, toAdd);
      // Re-target focus at the new span so the panel keeps following this exact
      // shift even when its start block itself moved (a top-handle drag).
      const newStartBlock = blocks.find((b) => b.blockId === newBlockIds[0]);
      if (newStartBlock !== undefined) {
        setFocus((prev) =>
          prev === null
            ? prev
            : {
                userId,
                dayKey,
                blockIds: newBlockIds,
                label: prev.label,
                hours: prev.hours,
                startAtIso: newStartBlock.startAtIso,
              },
        );
      }
    },
    [blocks, commitAssign, onRemoveSpan, setFocus],
  );
}
