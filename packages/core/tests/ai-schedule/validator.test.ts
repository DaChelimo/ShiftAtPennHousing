// AI Schedule Agent — validator tests.
//
// Spec: BUILD SPEC hard constraints 1-7 (headcount, Harnwell training,
// double-book, weekly cap, cannot, contiguity warning, coverage) plus the
// unknown-reference codes. The validator is the deterministic gate the LLM
// can never talk its way past.

import { describe, expect, it } from 'vitest';

import { validateCandidate, type AiAssignment } from '../../src/ai-schedule/index.js';

import { fixtureBlockId, makeBand, makeInput, makeWorker } from './fixtures.js';

const b = fixtureBlockId;

function codes(input: ReturnType<typeof makeInput>, assignments: AiAssignment[]): string[] {
  return validateCandidate(input, assignments).violations.map((v) => v.code);
}

describe('reference checks', () => {
  const input = makeInput({
    blocks: makeBand(0, 960, 1080),
    roster: [makeWorker('alice')],
  });

  it('flags unknown blocks and workers as hard violations', () => {
    const result = validateCandidate(input, [
      { blockId: 'nope', workerId: 'alice' },
      { blockId: b(0, 960), workerId: 'ghost' },
    ]);
    expect(result.feasible).toBe(false);
    expect(result.violations.map((v) => v.code).sort()).toEqual([
      'UNKNOWN_BLOCK',
      'UNKNOWN_WORKER',
    ]);
  });

  it('flags a duplicated worker+block pair as DOUBLE_BOOK', () => {
    const result = validateCandidate(input, [
      { blockId: b(0, 960), workerId: 'alice' },
      { blockId: b(0, 960), workerId: 'alice' },
    ]);
    expect(result.feasible).toBe(false);
    expect(result.violations.some((v) => v.code === 'DOUBLE_BOOK')).toBe(true);
  });
});

describe('OVER_HEADCOUNT', () => {
  it('rejects a third worker on a two-seat block, once per block', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 990, 2),
      roster: [makeWorker('alice'), makeWorker('bob'), makeWorker('cara')],
    });
    const result = validateCandidate(input, [
      { blockId: b(0, 960), workerId: 'alice' },
      { blockId: b(0, 960), workerId: 'bob' },
      { blockId: b(0, 960), workerId: 'cara' },
    ]);
    expect(result.feasible).toBe(false);
    expect(result.violations.filter((v) => v.code === 'OVER_HEADCOUNT')).toHaveLength(1);
  });

  it('accepts a full two-seat block', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 990, 2),
      roster: [makeWorker('alice'), makeWorker('bob')],
    });
    const result = validateCandidate(input, [
      { blockId: b(0, 960), workerId: 'alice' },
      { blockId: b(0, 960), workerId: 'bob' },
    ]);
    expect(result.violations.filter((v) => v.severity === 'hard')).toHaveLength(0);
  });
});

describe('HARNWELL_TRAINING', () => {
  it('rejects an away-home worker on a Harnwell snapshot, once per worker', () => {
    const input = makeInput({
      houseId: 'harnwell',
      isHarnwell: true,
      blocks: makeBand(0, 960, 1080),
      roster: [makeWorker('home', { homeHouseId: 'harnwell' }), makeWorker('visitor')],
    });
    const result = validateCandidate(input, [
      { blockId: b(0, 960), workerId: 'visitor' },
      { blockId: b(0, 990), workerId: 'visitor' },
      { blockId: b(0, 1020), workerId: 'home' },
    ]);
    expect(result.feasible).toBe(false);
    const harnwell = result.violations.filter((v) => v.code === 'HARNWELL_TRAINING');
    expect(harnwell).toHaveLength(1);
    expect(harnwell[0]?.workerId).toBe('visitor');
  });

  it('never fires outside Harnwell', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 990),
      roster: [makeWorker('visitor', { homeHouseId: 'gutmann' })],
    });
    expect(codes(input, [{ blockId: b(0, 960), workerId: 'visitor' }])).not.toContain(
      'HARNWELL_TRAINING',
    );
  });
});

describe('CANNOT_CONFLICT and missing prefs', () => {
  const input = makeInput({
    blocks: makeBand(0, 960, 1020),
    roster: [makeWorker('alice', { prefs: { [b(0, 960)]: 'cannot' } })],
  });

  it('cannot is a hard no for that worker+block', () => {
    const result = validateCandidate(input, [{ blockId: b(0, 960), workerId: 'alice' }]);
    expect(result.feasible).toBe(false);
    expect(result.violations.some((v) => v.code === 'CANNOT_CONFLICT')).toBe(true);
  });

  it('a missing pref row counts as available', () => {
    const result = validateCandidate(input, [{ blockId: b(0, 990), workerId: 'alice' }]);
    expect(result.violations.filter((v) => v.severity === 'hard')).toHaveLength(0);
  });
});

describe('CAP_EXCEEDED', () => {
  const input = makeInput({
    capHours: 1,
    blocks: makeBand(0, 960, 1080),
    roster: [makeWorker('alice')],
  });

  it('exactly at cap is legal', () => {
    const result = validateCandidate(input, [
      { blockId: b(0, 960), workerId: 'alice' },
      { blockId: b(0, 990), workerId: 'alice' },
    ]);
    expect(result.violations.filter((v) => v.code === 'CAP_EXCEEDED')).toHaveLength(0);
  });

  it('half an hour over cap is a hard violation', () => {
    const result = validateCandidate(input, [
      { blockId: b(0, 960), workerId: 'alice' },
      { blockId: b(0, 990), workerId: 'alice' },
      { blockId: b(0, 1020), workerId: 'alice' },
    ]);
    expect(result.feasible).toBe(false);
    expect(result.violations.some((v) => v.code === 'CAP_EXCEEDED')).toBe(true);
  });
});

describe('ONE_HOUR_SHIFT warning', () => {
  const input = makeInput({
    blocks: makeBand(0, 960, 1200),
    roster: [makeWorker('alice')],
  });

  it('a two-block run warns but stays feasible', () => {
    const result = validateCandidate(input, [
      { blockId: b(0, 960), workerId: 'alice' },
      { blockId: b(0, 990), workerId: 'alice' },
    ]);
    expect(result.feasible).toBe(true);
    const warning = result.violations.find((v) => v.code === 'ONE_HOUR_SHIFT');
    expect(warning?.severity).toBe('warning');
    expect(warning?.weekday).toBe(0);
  });

  it('a three-block run does not warn', () => {
    const result = validateCandidate(input, [
      { blockId: b(0, 960), workerId: 'alice' },
      { blockId: b(0, 990), workerId: 'alice' },
      { blockId: b(0, 1020), workerId: 'alice' },
    ]);
    expect(result.violations.filter((v) => v.code === 'ONE_HOUR_SHIFT')).toHaveLength(0);
  });

  it('a gap splits a day into separate runs, each judged alone', () => {
    const result = validateCandidate(input, [
      { blockId: b(0, 960), workerId: 'alice' },
      // gap at 990
      { blockId: b(0, 1020), workerId: 'alice' },
    ]);
    expect(result.violations.filter((v) => v.code === 'ONE_HOUR_SHIFT')).toHaveLength(2);
  });
});

describe('unfilled seats and fillability', () => {
  it('counts open seats per block', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 990, 2),
      roster: [makeWorker('alice'), makeWorker('bob')],
    });
    const result = validateCandidate(input, [{ blockId: b(0, 960), workerId: 'alice' }]);
    expect(result.unfilledSeats).toEqual([
      expect.objectContaining({ blockId: b(0, 960), open: 1, fillable: true }),
    ]);
  });

  it('a seat everyone marked cannot is unfillable', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 990),
      roster: [makeWorker('alice', { prefs: { [b(0, 960)]: 'cannot' } })],
    });
    const result = validateCandidate(input, []);
    expect(result.unfilledSeats[0]?.fillable).toBe(false);
  });

  it('a Harnwell seat is unfillable when only away-home workers remain', () => {
    const input = makeInput({
      houseId: 'harnwell',
      isHarnwell: true,
      blocks: makeBand(0, 960, 990),
      roster: [makeWorker('visitor', { homeHouseId: 'rodin' })],
    });
    const result = validateCandidate(input, []);
    expect(result.unfilledSeats[0]?.fillable).toBe(false);
  });

  it('a seat is unfillable when every worker is already at cap', () => {
    const input = makeInput({
      capHours: 0.5,
      blocks: makeBand(0, 960, 1020),
      roster: [makeWorker('alice')],
    });
    const result = validateCandidate(input, [{ blockId: b(0, 960), workerId: 'alice' }]);
    const open = result.unfilledSeats.find((s) => s.blockId === b(0, 990));
    expect(open?.fillable).toBe(false);
  });

  it('reports nothing when every seat is filled', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 990),
      roster: [makeWorker('alice')],
    });
    const result = validateCandidate(input, [{ blockId: b(0, 960), workerId: 'alice' }]);
    expect(result.unfilledSeats).toHaveLength(0);
  });
});
