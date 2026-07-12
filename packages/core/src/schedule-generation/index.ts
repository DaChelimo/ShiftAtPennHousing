// Dev-seeding: auto-build a balanced draft schedule (Feature B).
//
// Coverage-first, shift-length-balanced draft generator. Deterministic: keyed off
// (seed, periodId, houseId). See docs/dev-tooling/PLAN.md Feature B.

import { mulberry32, hashSeed, rngWeighted, rngInt, type Rng } from '../random/seeded.js';

import type {
  DraftAssignment,
  SchedBlock,
  SchedConfig,
  SchedRosterWorker,
  ScheduleResult,
} from './types.js';

export * from './types.js';

const HARNWELL = 'harnwell';

// Preferred contiguous shift lengths in 30-minute blocks: 2h, 3h, 4h, 5h. Weighted
// toward 3-4h. Odd or short band tails are absorbed as whole remainders (a realistic
// 2.5h/1h shift), never by stranding a lone block when it can be avoided.
const PREFERRED_BLOCKS = [4, 6, 8, 10] as const;
const DEFAULT_WEIGHTS: Record<number, number> = { 4: 2, 6: 4, 8: 4, 10: 1.5 };
const MIN_TAIL = 4; // never leave a 1-3 block remainder from a preferred cut

type WorkerState = {
  workerId: string;
  hours: number;
  blocks: Set<string>;
};

// Split a preferred-piece tiling of a segment `length` (in blocks). Guarantees the
// pieces sum to exactly `length`; prefers 2-5h shifts and only emits an odd/short whole
// piece when no preferred cut fits cleanly.
function tileSegment(
  length: number,
  rng: Rng,
  weights: Partial<Record<number, number>>,
): number[] {
  const pieces: number[] = [];
  let rem = length;
  while (rem > 0) {
    const options = PREFERRED_BLOCKS.filter((p) => p <= rem && (rem - p === 0 || rem - p >= MIN_TAIL));
    if (options.length > 0) {
      const p = rngWeighted(
        rng,
        options,
        options.map((o) => weights[o] ?? 1),
      );
      pieces.push(p);
      rem -= p;
    } else {
      // No clean preferred cut (e.g. a 5- or 7-block tail): emit the remainder whole.
      pieces.push(rem);
      rem = 0;
    }
  }
  return pieces;
}

// Maximal runs of consecutive 30-minute blocks (minuteOfDay stepping by 30) within one
// weekday lane. Input must be sorted ascending by minuteOfDay.
function contiguousSegments(blocks: SchedBlock[]): SchedBlock[][] {
  const segments: SchedBlock[][] = [];
  let current: SchedBlock[] = [];
  for (const b of blocks) {
    const prev = current[current.length - 1];
    if (prev === undefined || b.minuteOfDay === prev.minuteOfDay + 30) {
      current.push(b);
    } else {
      segments.push(current);
      current = [b];
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

// Pick the eligible worker with the fewest assigned hours (spread), breaking ties
// deterministically via the rng. A worker is eligible when free on every block of the
// piece (no double-book) and within the weekly cap.
function chooseWorker(
  states: WorkerState[],
  pieceBlockIds: string[],
  cap: number,
  rng: Rng,
): WorkerState | null {
  const addHours = pieceBlockIds.length * 0.5;
  const eligible = states.filter(
    (s) => s.hours + addHours <= cap && pieceBlockIds.every((id) => !s.blocks.has(id)),
  );
  if (eligible.length === 0) return null;
  const minHours = Math.min(...eligible.map((s) => s.hours));
  const tied = eligible.filter((s) => s.hours === minHours);
  return tied[rngInt(rng, 0, tied.length - 1)]!;
}

export function generateBalancedSchedule(
  blocks: SchedBlock[],
  roster: SchedRosterWorker[],
  periodId: string,
  houseId: string,
  isHarnwell: boolean,
  config: SchedConfig,
): ScheduleResult {
  const rng = mulberry32(hashSeed(`${config.seed}|${periodId}|${houseId}`));
  const weights: Partial<Record<number, number>> = {
    ...DEFAULT_WEIGHTS,
    ...(config.shiftLengthWeights ?? {}),
  };
  const cap = config.weeklyCapHours;

  // Harnwell training invariant: only home-Harnwell workers may staff the Harnwell desk
  // (mirrors the assignment-write guard; the draft trigger backstops it in the DB).
  const eligibleRoster = isHarnwell
    ? roster.filter((w) => w.homeHouseId === HARNWELL)
    : roster;

  const states: WorkerState[] = eligibleRoster.map((w) => ({
    workerId: w.workerId,
    hours: 0,
    blocks: new Set<string>(),
  }));

  const assignments: DraftAssignment[] = [];
  // Seats successfully filled, per block, to compute unfilled from laneCount.
  const filledPerBlock = new Map<string, number>();
  const laneCountPerBlock = new Map<string, number>();
  for (const b of blocks) laneCountPerBlock.set(b.blockId, b.laneCount);

  const maxLane = blocks.reduce((m, b) => Math.max(m, b.laneCount), 0);

  // Deterministic iteration: weekday 0..6, lane 0..maxLane-1, segments by start time.
  for (let weekday = 0; weekday <= 6; weekday++) {
    const dayBlocks = blocks
      .filter((b) => b.weekday === weekday)
      .sort((a, b) => a.minuteOfDay - b.minuteOfDay);
    if (dayBlocks.length === 0) continue;

    for (let lane = 0; lane < maxLane; lane++) {
      const laneBlocks = dayBlocks.filter((b) => b.laneCount > lane);
      if (laneBlocks.length === 0) continue;

      for (const segment of contiguousSegments(laneBlocks)) {
        let idx = 0;
        for (const pieceLen of tileSegment(segment.length, rng, weights)) {
          const pieceBlocks = segment.slice(idx, idx + pieceLen);
          idx += pieceLen;
          const pieceBlockIds = pieceBlocks.map((b) => b.blockId);

          const worker = chooseWorker(states, pieceBlockIds, cap, rng);
          if (worker === null) continue; // seats stay unfilled (reported below)

          worker.hours += pieceBlockIds.length * 0.5;
          for (const id of pieceBlockIds) {
            worker.blocks.add(id);
            assignments.push({ periodId, blockId: id, userId: worker.workerId });
            filledPerBlock.set(id, (filledPerBlock.get(id) ?? 0) + 1);
          }
        }
      }
    }
  }

  const unfilled = [...laneCountPerBlock.entries()]
    .map(([blockId, lc]) => ({ blockId, seats: lc - (filledPerBlock.get(blockId) ?? 0) }))
    .filter((u) => u.seats > 0)
    .sort((a, b) => a.blockId.localeCompare(b.blockId));

  const unfilledSeatCount = unfilled.reduce((s, u) => s + u.seats, 0);

  return {
    assignments,
    unfilled,
    assignedCount: assignments.length,
    unfilledSeatCount,
  };
}
