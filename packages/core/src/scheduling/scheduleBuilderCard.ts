// Phase 13b — Schedule-builder card algorithm (web admin app, §4.3).
//
// PURE (zero Supabase imports). The Next.js SM/HM schedule builder draws, for a
// dragged span, a *card* of the house roster. This module is that card's view-model:
// it delegates the Phase-1 preferred/available/blocked grouping VERBATIM to phase-04's
// already-shipped `groupWorkersForSpan` (phase1Grouping.ts) and layers on the three
// things the UI renders — selectability, hours-remaining, and the over-target warning.
// Phase 2 (Manual Override, identical post-publish per §4.3 Phase 3) downgrades the
// Phase-1 hard constraints (`cannot`, opt-out) to advisory labels over the FULL roster.
//
// Pinned decisions (tests/PHASE_13b/TEST_PLAN.md): D1 grouping delegated to phase-04
// (missing-for-a-span-block ⇒ blocked); D2 selectable ⇔ not blocked; D3 hoursRemaining =
// target − assigned (may be ≤ 0); D4 wouldExceedTarget ⇔ assigned + spanHours > target
// (STRICT, same in both phases); D5 Phase-2 downgrades cannot+optedOut to advisories over
// every worker (missing/none → no advisory); D6 cannot before opted_out; D7 validateDragSpan
// checks size (2..12) before strict 30-min contiguity.

import {
  groupWorkersForSpan,
  type BlockedReason,
  type PreferenceRecord,
  type PreferenceStatus,
  type SpanBlock,
  type Worker,
} from './phase1Grouping.js';

// Re-export the shared primitives so the web layer has a single import surface.
export type { BlockedReason, PreferenceRecord, PreferenceStatus, SpanBlock, Worker };

// span the drag-picker produced — 2..12 consecutive 30-min blocks (§4.3)
export const MIN_SPAN_BLOCKS = 2; // 1 hour
export const MAX_SPAN_BLOCKS = 12; // 6 hours

const BLOCK_MS = 30 * 60 * 1000;
const HOURS_PER_BLOCK = 0.5;

export type SpanValidation =
  | { valid: true; blockCount: number; hours: number }
  | { valid: false; reason: 'too_short' | 'too_long' | 'not_contiguous' };

// D7: size is the headline rule (2..12); contiguity guards a malformed picker payload.
export function validateDragSpan(span: SpanBlock[]): SpanValidation {
  if (span.length < MIN_SPAN_BLOCKS) {
    return { valid: false, reason: 'too_short' };
  }
  if (span.length > MAX_SPAN_BLOCKS) {
    return { valid: false, reason: 'too_long' };
  }

  for (let i = 1; i < span.length; i += 1) {
    const prev = span[i - 1] as SpanBlock;
    const curr = span[i] as SpanBlock;
    if (curr.blockStartAt.getTime() - prev.blockStartAt.getTime() !== BLOCK_MS) {
      return { valid: false, reason: 'not_contiguous' };
    }
  }

  return { valid: true, blockCount: span.length, hours: span.length * HOURS_PER_BLOCK };
}

export type WorkerScheduleInfo = {
  worker: Worker;
  assignedHours: number; // hours already assigned THIS week
  targetHours: number; // submitted target (0..cap)
  optedOut: boolean; // period_targets.opted_out — the "no hours" button
};

// ----- Phase 1 (Preference-Assisted) -----

export type Phase1Entry = {
  worker: Worker;
  status: 'preferred' | 'available' | 'blocked';
  blockedReason?: BlockedReason; // present iff status === 'blocked'
  hoursRemaining: number; // targetHours − assignedHours (may be ≤ 0)
  selectable: boolean; // false iff status === 'blocked'
  wouldExceedTarget: boolean; // assignedHours + spanHours > targetHours (strict)
};

export type Phase1Card = {
  preferred: Phase1Entry[];
  available: Phase1Entry[];
  blocked: Phase1Entry[];
};

function infoById(workers: WorkerScheduleInfo[]): Map<string, WorkerScheduleInfo> {
  const map = new Map<string, WorkerScheduleInfo>();
  for (const info of workers) {
    map.set(info.worker.userId, info);
  }
  return map;
}

export function buildPhase1Card(
  workers: WorkerScheduleInfo[],
  span: SpanBlock[],
  preferences: PreferenceRecord[],
): Phase1Card {
  const spanHours = span.length * HOURS_PER_BLOCK;
  const byId = infoById(workers);
  const grouping = groupWorkersForSpan(
    workers.map((w) => w.worker),
    span,
    preferences,
  );

  const toEntry = (
    worker: Worker,
    status: Phase1Entry['status'],
    blockedReason: BlockedReason | undefined,
  ): Phase1Entry => {
    const info = byId.get(worker.userId);
    const assignedHours = info?.assignedHours ?? 0;
    const targetHours = info?.targetHours ?? 0;
    const base: Phase1Entry = {
      worker,
      status,
      hoursRemaining: targetHours - assignedHours,
      selectable: status !== 'blocked',
      wouldExceedTarget: assignedHours + spanHours > targetHours,
    };
    return blockedReason === undefined ? base : { ...base, blockedReason };
  };

  return {
    preferred: grouping.preferred.map((g) => toEntry(g.worker, 'preferred', undefined)),
    available: grouping.available.map((g) => toEntry(g.worker, 'available', undefined)),
    blocked: grouping.blocked.map((g) => toEntry(g.worker, 'blocked', g.blockedReason)),
  };
}

// ----- Phase 2 (Manual Override) / post-publish override -----

export type Phase2Advisory =
  | { kind: 'cannot'; blockId: string; blockStartAt: Date } // first cannot in span order
  | { kind: 'opted_out' };

export type Phase2Entry = {
  worker: Worker;
  assignedHours: number; // total assigned hours (§4.3 Phase 2 shows this)
  hoursRemaining: number;
  advisories: Phase2Advisory[]; // advisory only — never excludes / disables
  wouldExceedTarget: boolean;
};

function compareByName(left: Phase2Entry, right: Phase2Entry): number {
  return left.worker.name.localeCompare(right.worker.name, 'en', {
    sensitivity: 'base',
    numeric: true,
  });
}

export function buildPhase2Roster(
  workers: WorkerScheduleInfo[],
  span: SpanBlock[],
  preferences: PreferenceRecord[],
): Phase2Entry[] {
  const spanHours = span.length * HOURS_PER_BLOCK;

  const prefsByWorker = new Map<string, Map<string, PreferenceStatus>>();
  for (const pref of preferences) {
    let workerPrefs = prefsByWorker.get(pref.userId);
    if (workerPrefs === undefined) {
      workerPrefs = new Map<string, PreferenceStatus>();
      prefsByWorker.set(pref.userId, workerPrefs);
    }
    workerPrefs.set(pref.blockId, pref.status);
  }

  const roster = workers.map((info) => {
    const workerPrefs = prefsByWorker.get(info.worker.userId);
    const advisories: Phase2Advisory[] = [];

    // D6: cannot (the first cannot block in span order) listed before opted_out.
    // D5: a missing / `none` row is the norm in Phase 2 and produces NO advisory.
    if (workerPrefs !== undefined) {
      for (const block of span) {
        if (workerPrefs.get(block.blockId) === 'cannot') {
          advisories.push({
            kind: 'cannot',
            blockId: block.blockId,
            blockStartAt: block.blockStartAt,
          });
          break;
        }
      }
    }
    if (info.optedOut) {
      advisories.push({ kind: 'opted_out' });
    }

    return {
      worker: info.worker,
      assignedHours: info.assignedHours,
      hoursRemaining: info.targetHours - info.assignedHours,
      advisories,
      wouldExceedTarget: info.assignedHours + spanHours > info.targetHours,
    } satisfies Phase2Entry;
  });

  roster.sort(compareByName);
  return roster;
}
