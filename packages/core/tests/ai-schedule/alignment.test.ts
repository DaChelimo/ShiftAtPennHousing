// AI Schedule Agent — the clock-hour rule.
//
// A shift starts and ends on the hour. The only exception is the desk's own
// opening/closing boundary: a house whose window opens at 05:30 is staffed
// from 05:30. These tests pin the predicates, the validator warning, and the
// finalize pass's guarantee that no shipped run is off the hour.

import { describe, expect, it } from 'vitest';

import {
  buildGrid,
  finalizeSchedule,
  isLegalEndIndex,
  isLegalStartIndex,
  largestLegalSubRun,
  runBoundaryIssue,
  splitRuns,
  validateCandidate,
  type AiAssignment,
  type AiScheduleInput,
} from '../../src/ai-schedule/index.js';

import { fixtureBlockId, makeBand, makeInput, makeWorker } from './fixtures.js';

const b = fixtureBlockId;

// Every run starts and ends on a legal boundary.
function allRunsAligned(input: AiScheduleInput, assignments: AiAssignment[]): boolean {
  const grid = buildGrid(input);
  return splitRuns(grid, assignments).every((run) => {
    const day = grid.dayByWeekday.get(run.weekday);
    const first = run.blocks[0];
    const last = run.blocks[run.blocks.length - 1];
    if (day === undefined || first === undefined || last === undefined) return false;
    const start = grid.indexInDay.get(first.blockId);
    const end = grid.indexInDay.get(last.blockId);
    if (start === undefined || end === undefined) return false;
    return runBoundaryIssue(day, start, end) === null;
  });
}

// A summer-style day: desk opens 05:30 and closes at 12:00.
function openAt0530(): AiScheduleInput {
  return makeInput({
    blocks: makeBand(0, 330, 720),
    roster: [makeWorker('alice', { targetHours: 20 })],
  });
}

describe('boundary predicates', () => {
  it('allows starts on the hour and rejects starts on the half hour', () => {
    const day = buildGrid(makeInput({ blocks: makeBand(0, 480, 720) })).days[0]!;
    expect(isLegalStartIndex(day, 0)).toBe(true); // 08:00
    expect(isLegalStartIndex(day, 1)).toBe(false); // 08:30
    expect(isLegalStartIndex(day, 2)).toBe(true); // 09:00
  });

  it('allows ends on the hour and rejects ends on the half hour', () => {
    const day = buildGrid(makeInput({ blocks: makeBand(0, 480, 720) })).days[0]!;
    expect(isLegalEndIndex(day, 0)).toBe(false); // 08:00-08:30 ends on the half hour
    expect(isLegalEndIndex(day, 1)).toBe(true); // 08:30-09:00 ends on the hour
    expect(isLegalEndIndex(day, 7)).toBe(true); // last block of the day, desk closes
  });

  it('treats the desk opening time as a legal start even off the hour', () => {
    const day = buildGrid(openAt0530()).days[0]!;
    expect(day.blocks[0]!.minuteOfDay).toBe(330); // 05:30
    expect(isLegalStartIndex(day, 0)).toBe(true); // desk opens here
    expect(isLegalStartIndex(day, 2)).toBe(false); // 06:30, nothing special
    expect(isLegalStartIndex(day, 1)).toBe(true); // 06:00
  });

  it('treats the desk closing time as a legal end even off the hour', () => {
    // Two segments in one day: 08:00-10:30 (desk closes) then 14:00-18:00.
    const input = makeInput({ blocks: [...makeBand(0, 480, 630), ...makeBand(0, 840, 1080)] });
    const day = buildGrid(input).days[0]!;
    expect(day.blocks[4]!.minuteOfDay).toBe(600); // 10:00-10:30, the last morning block
    expect(isLegalEndIndex(day, 4)).toBe(true); // desk closes at 10:30
    expect(isLegalStartIndex(day, 5)).toBe(true); // 14:00, reopening
  });

  it('flags which end of a run is misaligned', () => {
    const day = buildGrid(makeInput({ blocks: makeBand(0, 480, 720) })).days[0]!;
    expect(runBoundaryIssue(day, 0, 3)).toBe(null); // 08:00-10:00
    expect(runBoundaryIssue(day, 1, 3)).toBe('start'); // 08:30-10:00
    expect(runBoundaryIssue(day, 0, 2)).toBe('end'); // 08:00-09:30
    expect(runBoundaryIssue(day, 1, 2)).toBe('both'); // 08:30-09:30
  });

  it('trims a misaligned run to its largest legal sub-run', () => {
    const day = buildGrid(makeInput({ blocks: makeBand(0, 480, 780) })).days[0]!;
    // 08:30-12:30 (idx 1..8) trims to 09:00-12:00 (idx 2..7).
    expect(largestLegalSubRun(day, 1, 8, 4)).toEqual({ start: 2, end: 7 });
    // 08:30-10:00 (idx 1..3) has only 09:00-10:00 left, under the 2h floor.
    expect(largestLegalSubRun(day, 1, 3, 4)).toBe(null);
  });
});

describe('validator', () => {
  it('warns on a shift that starts on the half hour, without blocking feasibility', () => {
    const input = makeInput({
      blocks: makeBand(0, 480, 720), // 08:00-12:00
      roster: [makeWorker('alice', { targetHours: 20 })],
    });
    // 08:30-11:00: legal length, illegal start.
    const assignments = [510, 540, 570, 600, 630].map((m) => ({
      blockId: b(0, m),
      workerId: 'alice',
    }));
    const result = validateCandidate(input, assignments);
    expect(result.feasible).toBe(true);
    const warning = result.violations.find((v) => v.code === 'HALF_HOUR_BOUNDARY');
    expect(warning?.severity).toBe('warning');
    expect(warning?.workerId).toBe('alice');
  });

  it('does not warn on a shift bounded by the desk opening time', () => {
    const input = openAt0530();
    // 05:30-08:00, off the hour at the start only because the desk opens then.
    const assignments = [330, 360, 390, 420, 450].map((m) => ({
      blockId: b(0, m),
      workerId: 'alice',
    }));
    const result = validateCandidate(input, assignments);
    expect(result.violations.some((v) => v.code === 'HALF_HOUR_BOUNDARY')).toBe(false);
  });
});

describe('finalize guarantee', () => {
  it('grows a half-hour start onto the hour', () => {
    const input = makeInput({
      blocks: makeBand(0, 480, 720), // 08:00-12:00
      roster: [makeWorker('alice', { targetHours: 20 })],
    });
    // Skeleton: 08:30-10:30.
    const out = finalizeSchedule(
      input,
      [510, 540, 570, 600].map((m) => ({ blockId: b(0, m), workerId: 'alice' })),
    );
    expect(allRunsAligned(input, out)).toBe(true);
    expect(out.some((a) => a.blockId === b(0, 480))).toBe(true); // grew back to 08:00
  });

  it('trims a half-hour boundary it cannot grow past, leaving the seat open', () => {
    // The day is exactly 08:30-11:00, so there is no 08:00 block to grow into:
    // the run must give the half hour back rather than start at 08:30.
    const input = makeInput({
      blocks: makeBand(0, 510, 660),
      roster: [makeWorker('alice', { targetHours: 20 })],
    });
    const out = finalizeSchedule(input, [{ blockId: b(0, 510), workerId: 'alice' }]);
    expect(allRunsAligned(input, out)).toBe(true);
    // 08:30 is the desk's opening block, so it IS a legal start here.
    expect(out.some((a) => a.blockId === b(0, 510))).toBe(true);
  });

  it('fills a 05:30-opening day from the opening block, on the hour thereafter', () => {
    const input = makeInput({
      blocks: makeBand(0, 330, 720), // 05:30-12:00, 13 blocks
      roster: [makeWorker('alice', { targetHours: 20 }), makeWorker('bob', { targetHours: 20 })],
    });
    const out = finalizeSchedule(input, []);
    expect(allRunsAligned(input, out)).toBe(true);
    expect(validateCandidate(input, out).feasible).toBe(true);
    // The opening block is staffed: coverage does not lose the odd half hour.
    expect(out.some((a) => a.blockId === b(0, 330))).toBe(true);
  });

  it('never emits an off-the-hour boundary from a fragmented skeleton', () => {
    const input = makeInput({
      blocks: [...makeBand(0, 330, 720), ...makeBand(1, 480, 1080, 2)],
      roster: [
        makeWorker('alice', { targetHours: 20 }),
        makeWorker('bob', { targetHours: 20 }),
        makeWorker('cara', { targetHours: 20 }),
      ],
    });
    const skeleton: AiAssignment[] = [
      { blockId: b(0, 390), workerId: 'alice' }, // 06:30 stub
      { blockId: b(1, 510), workerId: 'bob' }, // 08:30 stub
      { blockId: b(1, 540), workerId: 'bob' },
      { blockId: b(1, 570), workerId: 'cara' }, // 09:30 stub
    ];
    const out = finalizeSchedule(input, skeleton);
    expect(allRunsAligned(input, out)).toBe(true);
    expect(validateCandidate(input, out).feasible).toBe(true);
    expect(
      validateCandidate(input, out).violations.some((v) => v.code === 'HALF_HOUR_BOUNDARY'),
    ).toBe(false);
  });

  it('keeps every shift at least 2 hours while aligning it', () => {
    const input = makeInput({
      blocks: makeBand(0, 480, 1080),
      roster: [makeWorker('alice', { targetHours: 6 }), makeWorker('bob', { targetHours: 6 })],
    });
    const out = finalizeSchedule(input, []);
    const grid = buildGrid(input);
    expect(splitRuns(grid, out).every((r) => r.blocks.length >= 4)).toBe(true);
    expect(allRunsAligned(input, out)).toBe(true);
  });
});
