export type PreferenceStatus = 'preferred' | 'available' | 'cannot' | 'none';

export type WorkerPreferences = Map<string, PreferenceStatus>;

export type SpanGrouping = 'preferred' | 'available' | 'blocked';

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
