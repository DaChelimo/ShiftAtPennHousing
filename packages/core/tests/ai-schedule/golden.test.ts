// AI Schedule Agent — golden end-to-end on a Harnwell-like snapshot.
//
// A deterministic greedy "player" (RuleLlm) stands in for the real model;
// assertions pin INVARIANTS (coverage, feasibility, cap, target
// closeness, training rule) rather than brittle exact scores.

import { describe, expect, it } from 'vitest';

import { runAiSchedule, validateCandidate } from '../../src/ai-schedule/index.js';

import { harnwellSnapshot } from './fixtures.js';
import { RuleLlm } from './mockLlm.js';

describe('golden: Harnwell double-PM week', () => {
  it('fills every fillable seat with a legal, balanced schedule', async () => {
    const input = harnwellSnapshot();
    const llm = new RuleLlm(input);
    const result = await runAiSchedule(input, llm, { candidates: 1 });

    expect(result.diagnostics.llmCallCount).toBe(3); // one propose per day, no repairs
    expect(result.best).not.toBeNull();
    const assignments = result.best?.assignments ?? [];

    // Zero hard violations (headcount, Harnwell, cap, cannot, references).
    const validation = validateCandidate(input, assignments);
    expect(validation.feasible).toBe(true);

    // Every seat was fillable here, and all of them got filled: 3 days x
    // (8 single-seat + 12 double-seat) blocks = 96 seat-blocks.
    expect(result.unfilledSeats).toHaveLength(0);
    expect(assignments).toHaveLength(96);

    // The away-home submitter never staffs Harnwell.
    expect(assignments.some((a) => a.workerId === 'x-eve')).toBe(false);

    // Cleo's cannot-mornings are respected.
    const morningBlockIds = new Set(
      input.blocks.filter((block) => block.minuteOfDay < 720).map((block) => block.blockId),
    );
    expect(assignments.some((a) => a.workerId === 'w-cleo' && morningBlockIds.has(a.blockId))).toBe(
      false,
    );

    // Cap respected and targeted workers land near their targets.
    for (const worker of input.roster) {
      const hours = result.workerHours[worker.workerId] ?? 0;
      expect(hours).toBeLessThanOrEqual(input.capHours);
      if (worker.targetHours !== null && worker.workerId !== 'x-eve') {
        expect(Math.abs(hours - worker.targetHours)).toBeLessThanOrEqual(4);
      }
    }

    // Score decomposition invariant.
    const breakdown = result.best?.breakdown;
    expect(breakdown).toBeDefined();
    if (breakdown !== undefined) {
      const sum =
        breakdown.preferenceSatisfaction +
        breakdown.targetFit +
        breakdown.shiftQuality +
        breakdown.contiguity +
        breakdown.fairness +
        breakdown.coverage;
      expect(breakdown.total).toBeCloseTo(sum, 10);
    }
  });
});
