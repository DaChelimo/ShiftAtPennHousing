// AI Schedule Agent — shift boundary alignment (the "no :30 shifts" rule).
//
// Humans reason about desk shifts in whole hours: "come in at 8" or "come in
// at 9", never "come in at 8:30". A half-hour boundary is always worse than
// either hour around it, so the generated backbone never produces one.
//
// THE RULE: a shift starts only on the hour and ends only on the hour. The
// single exception is the desk's own opening/closing boundary. A house whose
// window opens at 05:30 (the summer profile) must be staffed from 05:30, so
// the first slot of a contiguous coverage segment is always a legal start and
// the last slot is always a legal end. Nothing else off the hour is legal.
//
// Blocks stay 30 minutes (block atomicity, AGENTS §4 #3) — this constrains
// where a RUN of blocks may begin and end, never the block grid itself.
//
// Pure index arithmetic over one day's sorted block list; no clock, no tz
// parsing (weekday/minuteOfDay are resolved upstream by blockWeekSlot).

import type { AiGridDay } from './grid.js';

const MINUTES_PER_BLOCK = 30;

function onTheHour(minuteOfDay: number): boolean {
  return minuteOfDay % 60 === 0;
}

// True when index i begins a contiguous coverage segment: it is the day's
// first block, or the previous block does not end where this one starts (the
// desk is closed in between, e.g. a midday closure splitting the day).
export function isSegmentStart(day: AiGridDay, i: number): boolean {
  const here = day.blocks[i];
  if (here === undefined) return false;
  const prev = day.blocks[i - 1];
  return prev === undefined || here.minuteOfDay - prev.minuteOfDay !== MINUTES_PER_BLOCK;
}

// True when index i ends a contiguous coverage segment (desk closes after it).
export function isSegmentEnd(day: AiGridDay, i: number): boolean {
  const here = day.blocks[i];
  if (here === undefined) return false;
  const next = day.blocks[i + 1];
  return next === undefined || next.minuteOfDay - here.minuteOfDay !== MINUTES_PER_BLOCK;
}

// A shift may START at index i when the block begins on the hour, or when it
// is the first block the desk is open for (nobody can arrive earlier).
export function isLegalStartIndex(day: AiGridDay, i: number): boolean {
  const block = day.blocks[i];
  if (block === undefined) return false;
  return onTheHour(block.minuteOfDay) || isSegmentStart(day, i);
}

// A shift may END with index i when that block's END lands on the hour, or
// when it is the last block the desk is open for (nobody can stay later).
export function isLegalEndIndex(day: AiGridDay, i: number): boolean {
  const block = day.blocks[i];
  if (block === undefined) return false;
  return onTheHour(block.minuteOfDay + MINUTES_PER_BLOCK) || isSegmentEnd(day, i);
}

export type BoundaryIssue = 'start' | 'end' | 'both' | null;

// Which end(s) of the inclusive run [startIdx, endIdx] sit on an illegal
// half-hour boundary. null means the run is aligned.
export function runBoundaryIssue(day: AiGridDay, startIdx: number, endIdx: number): BoundaryIssue {
  const badStart = !isLegalStartIndex(day, startIdx);
  const badEnd = !isLegalEndIndex(day, endIdx);
  if (badStart && badEnd) return 'both';
  if (badStart) return 'start';
  if (badEnd) return 'end';
  return null;
}

// The largest legal sub-run inside [startIdx, endIdx]: trim from each end
// until both boundaries are legal, keeping at least minBlocks blocks. Returns
// null when no legal sub-run of that length exists (the caller drops the run
// and leaves the seat open rather than shipping a misaligned shift).
export function largestLegalSubRun(
  day: AiGridDay,
  startIdx: number,
  endIdx: number,
  minBlocks: number,
): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (let s = startIdx; s <= endIdx; s++) {
    if (!isLegalStartIndex(day, s)) continue;
    for (let e = endIdx; e >= s; e--) {
      if (e - s + 1 < minBlocks) break;
      if (!isLegalEndIndex(day, e)) continue;
      if (best === null || e - s > best.end - best.start) best = { start: s, end: e };
      break; // longest end for this start; a shorter one can never beat it
    }
  }
  return best;
}
