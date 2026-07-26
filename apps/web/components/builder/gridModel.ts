// Schedule builder — pure grid geometry and run derivation.
//
// Extracted out of ScheduleBuilder.tsx (quarantined for size): everything here
// is a pure function of (blocks, drafts), with no React and no I/O, so the
// grid renderer, the worker-focus panel and the HTML export all read the same
// model of "what is a shift" instead of each re-deriving it.

import type { BuilderBlock } from '../../lib/data/scheduleBuilder';

const NY = 'America/New_York';

export const HOURS_PER_BLOCK = 0.5;

// Fixed pixel height of one 30-min block row. The continuous assignment blocks and the
// selection band are absolutely positioned at `localIndex * CELL_H`, so this MUST match
// the `.bld-cell` height in builder.css.
export const CELL_H = 34;

export function nyTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export type BlockRun = { userId: string; startLocal: number; len: number; blockIds: string[] };
export type LanedRun = BlockRun & { lane: number };

// Coalesce a day's drafts into per-worker contiguous runs (the mobile `Coalesce` pattern):
// a worker drafted across consecutive 30-min blocks becomes ONE run with a single label,
// instead of one card per block.
export function computeRuns(
  dayBlocks: BuilderBlock[],
  drafts: Record<string, string[]>,
): BlockRun[] {
  const has = (idx: number, userId: string) =>
    (drafts[dayBlocks[idx]!.blockId] ?? []).includes(userId);
  const workers = new Set<string>();
  for (const b of dayBlocks) for (const u of drafts[b.blockId] ?? []) workers.add(u);

  const runs: BlockRun[] = [];
  for (const userId of workers) {
    let i = 0;
    while (i < dayBlocks.length) {
      if (!has(i, userId)) {
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < dayBlocks.length && has(j + 1, userId)) j += 1;
      runs.push({
        userId,
        startLocal: i,
        len: j - i + 1,
        blockIds: dayBlocks.slice(i, j + 1).map((b) => b.blockId),
      });
      i = j + 1;
    }
  }
  return runs;
}

// Greedy lane assignment so overlapping runs (multi-headcount houses: Harnwell 2, Quad 3)
// sit side by side instead of stacking on top of each other.
export function assignLanes(runs: BlockRun[]): { laned: LanedRun[]; laneCount: number } {
  const sorted = [...runs].sort(
    (a, b) => a.startLocal - b.startLocal || a.userId.localeCompare(b.userId),
  );
  const laneEnd: number[] = []; // exclusive end (local idx) of the last run placed in each lane
  const laned: LanedRun[] = sorted.map((r) => {
    let lane = laneEnd.findIndex((end) => end <= r.startLocal);
    if (lane === -1) {
      lane = laneEnd.length;
      laneEnd.push(0);
    }
    laneEnd[lane] = r.startLocal + r.len;
    return { ...r, lane };
  });
  return { laned, laneCount: Math.max(1, laneEnd.length) };
}

// An unfilled required seat: a contiguous run of blocks in one lane where the block's
// required_headcount demands a body but none is drafted. This is what makes the staffing
// pattern visible — a Harnwell afternoon (required 2) with one worker shows one ghost seat,
// so the SM sees the second seat is still open (it becomes an open shift on publish).
export type SeatGap = { lane: number; startLocal: number; len: number; req: number };

// Split a run into contiguous segments of constant required_headcount. Each segment renders
// at its OWN width/lane offset, so a run is full width exactly where the desk is single-staff
// and narrows to a half/third exactly at the block where the house doubles/triples up — not
// for the run's whole length. Without this, a run that STARTS single-staff and later crosses
// into a double-staff stretch (e.g. Ben 10:00-14:00 where only 12:00-14:00 is required=2)
// would draw half width the whole way, leaving a misleading empty "lane" beside its
// single-staff portion where no second seat actually exists. Mirrors computeSeatGaps, which
// already breaks ghost seats at every required-headcount change.
export type RunSegment = { startLocal: number; len: number; req: number };

export function runSegments(dayBlocks: BuilderBlock[], run: BlockRun): RunSegment[] {
  const segs: RunSegment[] = [];
  let i = 0;
  while (i < run.len) {
    const req = dayBlocks[run.startLocal + i]?.requiredHeadcount ?? 1;
    let j = i;
    while (j + 1 < run.len && (dayBlocks[run.startLocal + j + 1]?.requiredHeadcount ?? 1) === req) {
      j += 1;
    }
    segs.push({ startLocal: run.startLocal + i, len: j - i + 1, req });
    i = j + 1;
  }
  return segs;
}

// Derive the ghost seats for a day. Lanes 0..laneCount-1 are the staffing slots; lane `l`
// is "required" at a block when that block's required_headcount > l. A seat is a gap wherever
// a required lane is not covered by a drafted run. Contiguous gaps in the same lane coalesce
// into one placeholder — but a gap also BREAKS when the required headcount changes (noon on a
// Harnwell weekday), so each seat spans a single width and the morning ghost is full width
// while the afternoon ghosts are half width.
export function computeSeatGaps(
  dayBlocks: BuilderBlock[],
  laned: LanedRun[],
  laneCount: number,
): SeatGap[] {
  const covered: boolean[][] = Array.from({ length: laneCount }, () =>
    new Array(dayBlocks.length).fill(false),
  );
  for (const run of laned) {
    for (let k = 0; k < run.len; k += 1) covered[run.lane]![run.startLocal + k] = true;
  }
  const reqOf = (idx: number) => dayBlocks[idx]?.requiredHeadcount ?? 1;

  const gaps: SeatGap[] = [];
  for (let lane = 0; lane < laneCount; lane += 1) {
    let i = 0;
    while (i < dayBlocks.length) {
      const req = reqOf(i);
      if (req <= lane || covered[lane]![i]) {
        i += 1;
        continue;
      }
      let j = i;
      while (
        j + 1 < dayBlocks.length &&
        reqOf(j + 1) === req &&
        reqOf(j + 1) > lane &&
        !covered[lane]![j + 1]
      ) {
        j += 1;
      }
      gaps.push({ lane, startLocal: i, len: j - i + 1, req });
      i = j + 1;
    }
  }
  return gaps;
}

// "08:00-12:00" for a [startLocal, startLocal+len) span — the END is the last block's
// start + 30 min, so the span reads as one continuous block and the 11:30-vs-12:00
// "is that the end?" ambiguity disappears. Shared by both assigned runs and empty seats,
// so an open slot's start/end time is always visible, not just an assigned one's.
export function rangeLabel(dayBlocks: BuilderBlock[], startLocal: number, len: number): string {
  const first = dayBlocks[startLocal]!;
  const last = dayBlocks[startLocal + len - 1]!;
  const end = nyTime(new Date(new Date(last.startAtIso).getTime() + 30 * 60000));
  return `${first.timeLabel}-${end}`;
}

export function runRangeLabel(dayBlocks: BuilderBlock[], run: BlockRun): string {
  return rangeLabel(dayBlocks, run.startLocal, run.len);
}

export function blocksOfDay(blocks: BuilderBlock[], dayKey: string): BuilderBlock[] {
  return blocks.filter((b) => b.dayKey === dayKey);
}

// ---- click-to-focus -------------------------------------------------------

// One drafted shift, resolved enough to render on its own away from the grid.
export type ShiftRun = {
  userId: string;
  dayKey: string;
  blockIds: string[];
  label: string; // "08:00-12:00"
  hours: number;
  startAtIso: string; // for chronological ordering
};

function toShiftRun(dayBlocks: BuilderBlock[], dayKey: string, run: BlockRun): ShiftRun {
  return {
    userId: run.userId,
    dayKey,
    blockIds: run.blockIds,
    label: runRangeLabel(dayBlocks, run),
    hours: run.len * HOURS_PER_BLOCK,
    startAtIso: dayBlocks[run.startLocal]!.startAtIso,
  };
}

// The shift under a click at `blockId`, disambiguated by where the pointer sat
// across the column (colFrac, 0..1) on a multi-seat block: the same rule the
// selection highlight uses to pick a lane. Falls back to the only run covering
// the block when the lane lookup misses, so a click on a visible shift never
// silently does nothing.
export function findShiftAt(
  blocks: BuilderBlock[],
  drafts: Record<string, string[]>,
  blockId: string,
  colFrac: number,
): ShiftRun | null {
  const block = blocks.find((b) => b.blockId === blockId);
  if (block === undefined) return null;
  const dayBlocks = blocksOfDay(blocks, block.dayKey);
  const localIdx = dayBlocks.findIndex((b) => b.blockId === blockId);
  if (localIdx === -1) return null;

  const { laned } = assignLanes(computeRuns(dayBlocks, drafts));
  const covering = laned.filter((r) => localIdx >= r.startLocal && localIdx < r.startLocal + r.len);
  if (covering.length === 0) return null;

  const req = Math.max(1, block.requiredHeadcount);
  const lane = Math.min(req - 1, Math.max(0, Math.floor(colFrac * req)));
  // On a single-seat block there's only ever one possible lane, so fall back to
  // whichever run is covering (protects against colFrac rounding at the lane
  // boundary). On a multi-seat block, a lane with no covering run is a genuinely
  // OPEN seat — the neighboring lane's run must NOT be substituted for it, or a
  // click on an unfilled second seat (e.g. Harnwell's double-staffed afternoon)
  // wrongly focuses whoever holds the OTHER seat instead of opening the assign
  // panel for the seat that's actually empty.
  const hit =
    req <= 1
      ? (covering.find((r) => r.lane === lane) ?? covering[0]!)
      : covering.find((r) => r.lane === lane);
  if (hit === undefined) return null;
  return toShiftRun(dayBlocks, block.dayKey, hit);
}

// Every shift one worker holds this week, in chronological order.
export function workerWeekShifts(
  blocks: BuilderBlock[],
  drafts: Record<string, string[]>,
  userId: string,
): ShiftRun[] {
  const dayKeys = [...new Set(blocks.map((b) => b.dayKey))];
  const shifts: ShiftRun[] = [];
  for (const dayKey of dayKeys) {
    const dayBlocks = blocksOfDay(blocks, dayKey);
    for (const run of computeRuns(dayBlocks, drafts)) {
      if (run.userId !== userId) continue;
      shifts.push(toShiftRun(dayBlocks, dayKey, run));
    }
  }
  return shifts.sort((a, b) => a.startAtIso.localeCompare(b.startAtIso));
}
