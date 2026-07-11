// AI Schedule Agent — scorer tests.
//
// Spec: BUILD SPEC soft objectives (preference satisfaction, target fit,
// shift-length quality, fairness, contiguity) + the coverage dominance
// rule: a fillable seat left open must outweigh any single preference
// gain, so the loop can never prefer a prettier-but-thinner schedule.

import { describe, expect, it } from 'vitest';

import {
  AI_SCORE_WEIGHTS,
  scoreCandidate,
  type AiAssignment,
  type AiScheduleInput,
} from '../../src/ai-schedule/index.js';

import { fixtureBlockId, makeBand, makeInput, makeWorker } from './fixtures.js';

const b = fixtureBlockId;

function run(weekday: number, startMin: number, blocks: number, workerId: string): AiAssignment[] {
  const out: AiAssignment[] = [];
  for (let i = 0; i < blocks; i++) {
    out.push({ blockId: b(weekday, startMin + i * 30), workerId });
  }
  return out;
}

describe('breakdown structure', () => {
  it('total equals the sum of the six components', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 1200),
      roster: [
        makeWorker('alice', { targetHours: 3, prefs: { [b(0, 960)]: 'preferred' } }),
        makeWorker('bob', { targetHours: 2 }),
      ],
    });
    const breakdown = scoreCandidate(input, [
      ...run(0, 960, 6, 'alice'),
      ...run(0, 1140, 2, 'bob'),
    ]);
    const sum =
      breakdown.preferenceSatisfaction +
      breakdown.targetFit +
      breakdown.shiftQuality +
      breakdown.contiguity +
      breakdown.fairness +
      breakdown.coverage;
    expect(breakdown.total).toBeCloseTo(sum, 10);
  });

  it('is deterministic', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 1200),
      roster: [makeWorker('alice', { targetHours: 4 })],
    });
    const assignments = run(0, 960, 8, 'alice');
    expect(scoreCandidate(input, assignments)).toEqual(scoreCandidate(input, assignments));
  });
});

describe('preference satisfaction', () => {
  it('a preferred block beats an available one', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 1200),
      roster: [makeWorker('alice', { targetHours: 2, prefs: { [b(0, 960)]: 'preferred' } })],
    });
    const onPreferred = scoreCandidate(input, run(0, 960, 4, 'alice'));
    const offPreferred = scoreCandidate(input, run(0, 990, 4, 'alice'));
    expect(onPreferred.preferenceSatisfaction).toBeGreaterThan(offPreferred.preferenceSatisfaction);
    expect(onPreferred.preferenceSatisfaction - offPreferred.preferenceSatisfaction).toBeCloseTo(
      AI_SCORE_WEIGHTS.preferredBlock - AI_SCORE_WEIGHTS.availableBlock,
      10,
    );
  });
});

describe('target fit', () => {
  const input = (target: number | null): AiScheduleInput =>
    makeInput({
      blocks: makeBand(0, 960, 1200),
      roster: [makeWorker('alice', { targetHours: target })],
    });

  it('penalizes under-target hours', () => {
    const breakdown = scoreCandidate(input(4), run(0, 960, 4, 'alice')); // 2h vs 4h target
    expect(breakdown.targetFit).toBeCloseTo(2 * AI_SCORE_WEIGHTS.underTargetPerHour, 10);
  });

  it('penalizes over-target hours harder per hour', () => {
    const over = scoreCandidate(input(1), run(0, 960, 4, 'alice')); // 2h vs 1h target
    expect(over.targetFit).toBeCloseTo(1 * AI_SCORE_WEIGHTS.overTargetPerHour, 10);
    expect(Math.abs(AI_SCORE_WEIGHTS.overTargetPerHour)).toBeGreaterThan(
      Math.abs(AI_SCORE_WEIGHTS.underTargetPerHour),
    );
  });

  it('a null-target worker contributes zero target fit', () => {
    const breakdown = scoreCandidate(input(null), run(0, 960, 4, 'alice'));
    expect(breakdown.targetFit).toBe(0);
  });
});

describe('shift-length quality and contiguity', () => {
  const input = makeInput({
    // Two long days so an 8h run fits.
    blocks: [...makeBand(0, 600, 1200), ...makeBand(1, 600, 1200)],
    roster: [makeWorker('alice', { targetHours: null })],
  });

  it('rewards an ideal 3h run and penalizes a 1h run', () => {
    const ideal = scoreCandidate(input, run(0, 600, 6, 'alice'));
    expect(ideal.shiftQuality).toBeCloseTo(AI_SCORE_WEIGHTS.idealRunBonus, 10);
    const short = scoreCandidate(input, run(0, 600, 2, 'alice'));
    expect(short.shiftQuality).toBeCloseTo(AI_SCORE_WEIGHTS.shortRunPenalty, 10);
  });

  it('penalizes hours beyond six in one run', () => {
    const long = scoreCandidate(input, run(0, 600, 16, 'alice')); // 8h
    expect(long.shiftQuality).toBeCloseTo(2 * AI_SCORE_WEIGHTS.longRunPenaltyPerHour, 10);
  });

  it('penalizes a fragmented worker-day per extra run', () => {
    const fragmented = scoreCandidate(input, [
      ...run(0, 600, 4, 'alice'),
      ...run(0, 780, 4, 'alice'), // gap at 720/750
    ]);
    expect(fragmented.contiguity).toBeCloseTo(AI_SCORE_WEIGHTS.extraRunPenalty, 10);
    const contiguous = scoreCandidate(input, run(0, 600, 8, 'alice'));
    expect(contiguous.contiguity).toBe(0);
  });
});

describe('fairness', () => {
  it('drops when preferred blocks concentrate on one worker', () => {
    const prefs: Record<string, 'preferred' | 'cannot'> = {
      [b(0, 960)]: 'preferred',
      [b(0, 990)]: 'preferred',
      [b(0, 1020)]: 'preferred',
      [b(0, 1050)]: 'preferred',
    };
    const input = makeInput({
      blocks: makeBand(0, 960, 1200),
      roster: [
        makeWorker('alice', { targetHours: null, prefs }),
        makeWorker('bob', { targetHours: null, prefs }),
      ],
    });
    // Both cover 4 preferred-ish blocks; skewed gives all four preferred to alice.
    const skewed = scoreCandidate(input, [...run(0, 960, 4, 'alice'), ...run(0, 1080, 4, 'bob')]);
    const split = scoreCandidate(input, [
      ...run(0, 960, 2, 'alice'),
      ...run(0, 1020, 2, 'bob'),
      ...run(0, 1080, 2, 'alice'),
      ...run(0, 1140, 2, 'bob'),
    ]);
    expect(split.fairness).toBeGreaterThan(skewed.fairness);
  });
});

describe('coverage dominance', () => {
  it('filling a fillable seat beats leaving it open, even at the cost of a short run', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 1020),
      roster: [
        makeWorker('alice', { targetHours: null, prefs: { [b(0, 960)]: 'preferred' } }),
        makeWorker('bob', { targetHours: null }),
      ],
    });
    const thin = scoreCandidate(input, [{ blockId: b(0, 960), workerId: 'alice' }]);
    const full = scoreCandidate(input, [
      { blockId: b(0, 960), workerId: 'alice' },
      { blockId: b(0, 990), workerId: 'bob' },
    ]);
    expect(full.total).toBeGreaterThan(thin.total);
  });

  it('a fillable open seat is penalized far harder than an unfillable one', () => {
    const fillable = makeInput({
      blocks: makeBand(0, 960, 990),
      roster: [makeWorker('alice', { targetHours: null })],
    });
    const unfillable = makeInput({
      blocks: makeBand(0, 960, 990),
      roster: [makeWorker('alice', { targetHours: null, prefs: { [b(0, 960)]: 'cannot' } })],
    });
    const fillableScore = scoreCandidate(fillable, []);
    const unfillableScore = scoreCandidate(unfillable, []);
    expect(fillableScore.coverage).toBeCloseTo(AI_SCORE_WEIGHTS.fillableUnfilledSeat, 10);
    expect(unfillableScore.coverage).toBeCloseTo(AI_SCORE_WEIGHTS.unfillableUnfilledSeat, 10);
  });

  it('one fillable open seat outweighs any single preference gain', () => {
    expect(Math.abs(AI_SCORE_WEIGHTS.fillableUnfilledSeat)).toBeGreaterThan(
      AI_SCORE_WEIGHTS.preferredBlock + Math.abs(AI_SCORE_WEIGHTS.shortRunPenalty),
    );
  });
});
