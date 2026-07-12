// AI Schedule Agent — deterministic finalize pass tests.
//
// The finalize pass turns the LLM skeleton into a complete, >= 2h-continuous
// backbone: it fills open seats on every day, guarantees no sub-2h shift, and
// stays feasible (cap, cannot, Harnwell, headcount all respected).

import { describe, expect, it } from 'vitest';

import {
  buildGrid,
  finalizeSchedule,
  MIN_RUN_BLOCKS,
  splitRuns,
  validateCandidate,
  type AiAssignment,
  type AiScheduleInput,
} from '../../src/ai-schedule/index.js';

import { fixtureBlockId, makeBand, makeInput, makeWorker } from './fixtures.js';

const b = fixtureBlockId;

// Every run in the finalized schedule is at least MIN_RUN_BLOCKS long.
function noShortRuns(input: AiScheduleInput, assignments: AiAssignment[]): boolean {
  const grid = buildGrid(input);
  return splitRuns(grid, assignments).every((r) => r.blocks.length >= MIN_RUN_BLOCKS);
}

describe('continuity guarantee', () => {
  it('extends a 1h skeleton run up to 2 hours', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 1200), // 8 blocks, single seat
      roster: [makeWorker('alice', { targetHours: 20 })],
    });
    const out = finalizeSchedule(input, [
      { blockId: b(0, 960), workerId: 'alice' },
      { blockId: b(0, 990), workerId: 'alice' }, // a 1h stub
    ]);
    expect(noShortRuns(input, out)).toBe(true);
    // alice's run now spans at least 4 blocks starting at 960.
    const aliceBlocks = out.filter((a) => a.workerId === 'alice');
    expect(aliceBlocks.length).toBeGreaterThanOrEqual(MIN_RUN_BLOCKS);
  });

  it('drops a stub that cannot reach 2 hours, leaving the seat open', () => {
    // A two-block day: no run can ever reach 2h, so the stub is dropped.
    const input = makeInput({
      blocks: makeBand(0, 960, 1020), // only 2 blocks
      roster: [makeWorker('alice', { targetHours: 20 })],
    });
    const out = finalizeSchedule(input, [{ blockId: b(0, 960), workerId: 'alice' }]);
    expect(out).toHaveLength(0);
  });

  it('never emits a sub-2h shift even from a fragmented skeleton', () => {
    const input = makeInput({
      blocks: makeBand(0, 600, 1200), // 12 blocks
      roster: [makeWorker('alice', { targetHours: 20 }), makeWorker('bob', { targetHours: 20 })],
    });
    const out = finalizeSchedule(input, [
      { blockId: b(0, 600), workerId: 'alice' }, // isolated stub
      { blockId: b(0, 900), workerId: 'bob' }, // isolated stub
    ]);
    expect(noShortRuns(input, out)).toBe(true);
    expect(validateCandidate(input, out).feasible).toBe(true);
  });
});

describe('coverage fill', () => {
  it('fills an entirely empty day with legal 2h+ runs', () => {
    const input = makeInput({
      blocks: [...makeBand(0, 960, 1200), ...makeBand(1, 960, 1200)], // Mon + Tue, 8 blocks each
      roster: [makeWorker('alice', { targetHours: 20 }), makeWorker('bob', { targetHours: 20 })],
    });
    // Skeleton only staffed Monday; Tuesday is empty.
    const skeleton = makeBand(0, 960, 1200).map((block) => ({
      blockId: block.blockId,
      workerId: 'alice',
    }));
    const out = finalizeSchedule(input, skeleton);
    const tueFilled = out.filter((a) => a.blockId.startsWith('b-1-'));
    expect(tueFilled.length).toBeGreaterThan(0); // Tuesday no longer empty
    expect(noShortRuns(input, out)).toBe(true);
  });

  it('improves coverage over the skeleton without breaking feasibility', () => {
    const input = makeInput({
      blocks: makeBand(0, 600, 1200), // 12 single-seat blocks
      roster: [
        makeWorker('alice', { targetHours: 20 }),
        makeWorker('bob', { targetHours: 20 }),
        makeWorker('cara', { targetHours: 20 }),
      ],
    });
    const skeleton: AiAssignment[] = [
      { blockId: b(0, 600), workerId: 'alice' },
      { blockId: b(0, 630), workerId: 'alice' },
      { blockId: b(0, 660), workerId: 'alice' },
      { blockId: b(0, 690), workerId: 'alice' }, // one 2h run, 8 blocks left open
    ];
    const out = finalizeSchedule(input, skeleton);
    expect(out.length).toBeGreaterThan(skeleton.length);
    expect(validateCandidate(input, out).feasible).toBe(true);
    expect(noShortRuns(input, out)).toBe(true);
  });
});

describe('respects all hard constraints', () => {
  it('never exceeds the weekly cap', () => {
    const input = makeInput({
      capHours: 2, // 4 blocks max per worker
      blocks: makeBand(0, 600, 1200),
      roster: [makeWorker('alice', { targetHours: 2 })],
    });
    const out = finalizeSchedule(input, [{ blockId: b(0, 600), workerId: 'alice' }]);
    expect(out.filter((a) => a.workerId === 'alice').length).toBeLessThanOrEqual(4);
    expect(validateCandidate(input, out).feasible).toBe(true);
  });

  it('never staffs a cannot block', () => {
    const cannot: Record<string, 'preferred' | 'cannot'> = {};
    for (const block of makeBand(0, 600, 720)) cannot[block.blockId] = 'cannot';
    const input = makeInput({
      blocks: makeBand(0, 600, 1200),
      roster: [makeWorker('alice', { targetHours: 20, prefs: cannot })],
    });
    const out = finalizeSchedule(input, []);
    expect(out.some((a) => a.workerId === 'alice' && cannot[a.blockId] === 'cannot')).toBe(false);
    expect(noShortRuns(input, out)).toBe(true);
  });

  it('never staffs an away-home worker on Harnwell', () => {
    const input = makeInput({
      houseId: 'harnwell',
      isHarnwell: true,
      blocks: makeBand(0, 600, 1200),
      roster: [
        makeWorker('home', { homeHouseId: 'harnwell', targetHours: 20 }),
        makeWorker('visitor', { homeHouseId: 'rodin', targetHours: 20 }),
      ],
    });
    const out = finalizeSchedule(input, []);
    expect(out.some((a) => a.workerId === 'visitor')).toBe(false);
    expect(validateCandidate(input, out).feasible).toBe(true);
  });

  it('never exceeds a block headcount', () => {
    const input = makeInput({
      blocks: makeBand(0, 600, 1200, 1), // single seat
      roster: [makeWorker('alice', { targetHours: 20 }), makeWorker('bob', { targetHours: 20 })],
    });
    const out = finalizeSchedule(input, []);
    const perBlock = new Map<string, number>();
    for (const a of out) perBlock.set(a.blockId, (perBlock.get(a.blockId) ?? 0) + 1);
    expect([...perBlock.values()].every((c) => c <= 1)).toBe(true);
  });

  it('fills both seats of a double-headcount block', () => {
    const input = makeInput({
      blocks: makeBand(0, 600, 1200, 2), // two seats
      roster: [makeWorker('alice', { targetHours: 20 }), makeWorker('bob', { targetHours: 20 })],
    });
    const out = finalizeSchedule(input, []);
    const perBlock = new Map<string, number>();
    for (const a of out) perBlock.set(a.blockId, (perBlock.get(a.blockId) ?? 0) + 1);
    expect([...perBlock.values()].some((c) => c === 2)).toBe(true);
    expect(noShortRuns(input, out)).toBe(true);
  });
});

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    const input = makeInput({
      blocks: [...makeBand(0, 600, 1200), ...makeBand(1, 600, 1200)],
      roster: [
        makeWorker('alice', { targetHours: 10 }),
        makeWorker('bob', { targetHours: 10 }),
        makeWorker('cara', { targetHours: 10 }),
      ],
    });
    expect(finalizeSchedule(input, [])).toEqual(finalizeSchedule(input, []));
  });
});
