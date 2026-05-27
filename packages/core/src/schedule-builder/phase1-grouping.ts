export type PreferenceStatus = 'preferred' | 'available' | 'cannot' | 'none';

export type WorkerPreferences = Map<string, PreferenceStatus>;

export type SpanGrouping = 'preferred' | 'available' | 'blocked';

// Caller contract: only invoke for workers who have submitted (any row in
// preferences OR period_targets for the period). Per BSpec §4.2,
// fully-unsubmitted workers are confined to the Phase-2 full roster and
// must not be evaluated here. A `none` status inside the span is the
// "missing block within an otherwise-submitted set" case from §4.3.
export function getWorkerSpanGrouping(
  workerPrefs: WorkerPreferences,
  spanBlockIds: string[],
): { grouping: SpanGrouping; blockingReason?: string } {
  let sawPreferred = false;

  for (const blockId of spanBlockIds) {
    const status = workerPrefs.get(blockId) ?? 'none';

    if (status === 'cannot') {
      return {
        grouping: 'blocked',
        blockingReason: `cannot:${blockId}`,
      };
    }

    if (status === 'none') {
      return {
        grouping: 'blocked',
        blockingReason: `missing:${blockId}`,
      };
    }

    if (status === 'preferred') {
      sawPreferred = true;
    }
  }

  return { grouping: sawPreferred ? 'preferred' : 'available' };
}
