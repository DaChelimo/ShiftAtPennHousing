export type PreferenceStatus = 'preferred' | 'available' | 'cannot' | 'none';

export type Worker = { userId: string; name: string };

export type SpanBlock = { blockId: string; blockStartAt: Date };

export type PreferenceRecord = {
  userId: string;
  blockId: string;
  status: PreferenceStatus;
};

export type BlockedReason =
  | { kind: 'cannot'; blockId: string; blockStartAt: Date }
  | { kind: 'missing'; blockId: string; blockStartAt: Date };

export type GroupedWorker = {
  worker: Worker;
  blockedReason?: BlockedReason;
};

export type GroupingResult = {
  preferred: GroupedWorker[];
  available: GroupedWorker[];
  blocked: GroupedWorker[];
};

function compareByName(left: GroupedWorker, right: GroupedWorker): number {
  return left.worker.name.localeCompare(right.worker.name, 'en', {
    sensitivity: 'base',
    numeric: true,
  });
}

// Pure transform: every worker passed in lands in exactly one group.
// Callers MUST pre-filter the worker list to those who have submitted
// (any row in preferences OR period_targets for this period). Per BSpec
// §4.2, fully-unsubmitted workers ("none / unspecified") are visible only
// in the Phase-2 full roster, never in the Phase-1 side card. Within
// this function, a worker with no preference row for a block in the span
// is treated as `missing` (BSpec §4.3, last paragraph of Phase 1) — which
// applies only to partial submissions; the fully-unsubmitted filter is a
// caller-layer concern.
export function groupWorkersForSpan(
  workers: Worker[],
  span: SpanBlock[],
  preferences: PreferenceRecord[],
): GroupingResult {
  const preferencesByWorker = new Map<string, Map<string, PreferenceStatus>>();

  for (const preference of preferences) {
    let workerPreferences = preferencesByWorker.get(preference.userId);
    if (workerPreferences === undefined) {
      workerPreferences = new Map<string, PreferenceStatus>();
      preferencesByWorker.set(preference.userId, workerPreferences);
    }

    workerPreferences.set(preference.blockId, preference.status);
  }

  const result: GroupingResult = {
    preferred: [],
    available: [],
    blocked: [],
  };

  for (const worker of workers) {
    const workerPreferences = preferencesByWorker.get(worker.userId) ?? new Map();
    let sawPreferred = false;
    let blockedReason: BlockedReason | undefined;

    for (const block of span) {
      const status = workerPreferences.get(block.blockId);

      if (status === undefined || status === 'none') {
        blockedReason = {
          kind: 'missing',
          blockId: block.blockId,
          blockStartAt: block.blockStartAt,
        };
        break;
      }

      if (status === 'cannot') {
        blockedReason = {
          kind: 'cannot',
          blockId: block.blockId,
          blockStartAt: block.blockStartAt,
        };
        break;
      }

      if (status === 'preferred') {
        sawPreferred = true;
      }
    }

    if (blockedReason !== undefined) {
      result.blocked.push({ worker, blockedReason });
    } else if (sawPreferred) {
      result.preferred.push({ worker });
    } else {
      result.available.push({ worker });
    }
  }

  result.preferred.sort(compareByName);
  result.available.sort(compareByName);
  result.blocked.sort(compareByName);

  return result;
}
