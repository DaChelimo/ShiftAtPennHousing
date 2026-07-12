// AI Schedule Agent — agentic loop harness tests (scripted mock LLM).
//
// Spec: BUILD SPEC agent loop steps 1-6. Pinned behaviors: bounded budget,
// per-day repair, deterministic prune-to-feasible safety net (the returned
// best candidate is ALWAYS free of hard violations), best-of-N selection,
// plateau early stop, and full determinism given a deterministic mock.

import { describe, expect, it } from 'vitest';

import {
  runAiSchedule,
  validateCandidate,
  type AiProgressEvent,
} from '../../src/ai-schedule/index.js';

import { fixtureBlockId, makeBand, makeInput, makeWorker, smallHouseSnapshot } from './fixtures.js';
import { ScriptedLlm } from './mockLlm.js';

const b = fixtureBlockId;

// smallHouseSnapshot: Mon/Tue/Wed 16:00-20:00, 8 single-seat blocks per
// day. Keys: W1=alice (prefers Mon), W2=bob, W3=cara (cannot Tue).
const fullDay = (worker: string) => ({ runs: [{ worker, start: 0, end: 7 }] });

describe('feasible-first', () => {
  it('makes one call per day and fills every seat', async () => {
    const llm = new ScriptedLlm([fullDay('W1'), fullDay('W2'), fullDay('W3')]);
    const result = await runAiSchedule(smallHouseSnapshot(), llm, { candidates: 1 });
    expect(result.diagnostics.llmCallCount).toBe(3);
    expect(result.diagnostics.prunedAssignments).toBe(0);
    expect(result.best?.assignments).toHaveLength(24);
    expect(result.unfilledSeats).toHaveLength(0);
    expect(result.workerHours).toEqual({ alice: 4, bob: 4, cara: 4 });
  });

  it('surfaces surviving warnings on the best candidate', async () => {
    const llm = new ScriptedLlm([
      { runs: [{ worker: 'W1', start: 0, end: 1 }] }, // 1h run: warning
      { runs: [] },
      { runs: [] },
    ]);
    const result = await runAiSchedule(smallHouseSnapshot(), llm, { candidates: 1 });
    expect(result.warnings.some((w) => w.code === 'ONE_HOUR_SHIFT')).toBe(true);
  });
});

describe('violate-then-repair', () => {
  it('feeds violations back and accepts the corrected day', async () => {
    // Tue proposal puts cara (W3) on her cannot day; repair swaps to bob.
    const llm = new ScriptedLlm([
      fullDay('W1'), // Mon propose
      fullDay('W3'), // Tue propose (CANNOT_CONFLICT x8)
      fullDay('W2'), // Tue repair
      fullDay('W1'), // Wed propose
    ]);
    const result = await runAiSchedule(smallHouseSnapshot(), llm, { candidates: 1 });
    expect(result.diagnostics.llmCallCount).toBe(4);
    expect(result.best).not.toBeNull();
    const tueWorkers = new Set(
      (result.best?.assignments ?? [])
        .filter((a) => a.blockId.startsWith('b-1-'))
        .map((a) => a.workerId),
    );
    expect(tueWorkers).toEqual(new Set(['bob']));
    const repairPrompt = llm.requests[2]?.user ?? '';
    expect(repairPrompt).toContain('CANNOT_CONFLICT');
    expect(repairPrompt).toContain('You previously proposed:');
  });
});

describe('budget exhaustion', () => {
  it('returns the pruned partial candidate and reports the stop', async () => {
    const llm = new ScriptedLlm([fullDay('W1'), fullDay('W2')]);
    const result = await runAiSchedule(smallHouseSnapshot(), llm, {
      candidates: 1,
      maxLlmCalls: 2,
    });
    expect(result.diagnostics.stoppedEarly).toBe('budget');
    expect(result.diagnostics.llmCallCount).toBe(2);
    expect(result.best?.assignments).toHaveLength(16); // Mon + Tue only
    const wedSeats = result.unfilledSeats.filter((s) => s.weekday === 2);
    expect(wedSeats).toHaveLength(8);
    expect(wedSeats.every((s) => s.fillable)).toBe(true);
  });
});

describe('cancellation', () => {
  it('makes zero calls and reports no candidate when pre-aborted', async () => {
    const llm = new ScriptedLlm([fullDay('W1'), fullDay('W2'), fullDay('W3')]);
    const controller = new AbortController();
    controller.abort();
    const result = await runAiSchedule(smallHouseSnapshot(), llm, {
      candidates: 1,
      signal: controller.signal,
    });
    expect(result.diagnostics.stoppedEarly).toBe('aborted');
    expect(result.diagnostics.llmCallCount).toBe(0);
    expect(result.best).toBeNull();
    expect(result.unfilledSeats).toHaveLength(24);
  });

  it('stops issuing new calls once aborted mid-run, keeping completed days', async () => {
    const llm = new ScriptedLlm([fullDay('W1'), fullDay('W2'), fullDay('W3')]);
    const controller = new AbortController();
    const result = await runAiSchedule(smallHouseSnapshot(), llm, {
      candidates: 1,
      // Abort as soon as Mon's day-done fires, before Tue's propose call.
      onProgress: (ev: AiProgressEvent) => {
        if (ev.type === 'day-done') controller.abort();
      },
      signal: controller.signal,
    });
    expect(result.diagnostics.stoppedEarly).toBe('aborted');
    expect(result.diagnostics.llmCallCount).toBe(1);
    expect(result.best?.assignments).toHaveLength(8); // Mon only
    const monWorkers = new Set((result.best?.assignments ?? []).map((a) => a.workerId));
    expect(monWorkers).toEqual(new Set(['alice']));
  });
});

describe('prune safety net', () => {
  it('drops what repair never fixes and stays feasible', async () => {
    const doubled = {
      runs: [
        { worker: 'W1', start: 0, end: 7 },
        { worker: 'W1', start: 0, end: 7 }, // duplicates: DOUBLE_BOOK x8
      ],
    };
    const llm = new ScriptedLlm([
      doubled, // Mon propose
      doubled, // Mon repair round 1 (same mistake)
      fullDay('W2'), // Tue
      fullDay('W2'), // Wed
    ]);
    const input = smallHouseSnapshot();
    const result = await runAiSchedule(input, llm, { candidates: 1, repairRounds: 1 });
    expect(result.diagnostics.llmCallCount).toBe(4);
    expect(result.diagnostics.prunedAssignments).toBe(8);
    expect(result.best).not.toBeNull();
    const validation = validateCandidate(input, result.best?.assignments ?? []);
    expect(validation.feasible).toBe(true);
    expect(result.best?.assignments).toHaveLength(24);
  });

  it('prunes an over-cap day from the end of the week deterministically', async () => {
    const input = makeInput({
      capHours: 1.5,
      blocks: makeBand(0, 960, 1200),
      roster: [makeWorker('alice')],
    });
    // 8 blocks proposed against a 3-block cap; repairs keep failing.
    const llm = new ScriptedLlm([fullDay('W1'), fullDay('W1')]);
    const result = await runAiSchedule(input, llm, { candidates: 1, repairRounds: 1 });
    expect(result.best?.assignments).toEqual([
      { blockId: b(0, 960), workerId: 'alice' },
      { blockId: b(0, 990), workerId: 'alice' },
      { blockId: b(0, 1020), workerId: 'alice' },
    ]);
    expect(result.diagnostics.prunedAssignments).toBe(5);
  });
});

describe('best-of-N and plateau', () => {
  it('keeps the higher-scoring candidate', async () => {
    // Candidate 0 (day order Mon,Tue,Wed) covers Mon only. Candidate 1
    // (rotated to Tue,Wed,Mon) covers everything.
    const llm = new ScriptedLlm([
      fullDay('W1'),
      { runs: [] },
      { runs: [] },
      fullDay('W2'), // Tue
      {
        runs: [
          { worker: 'W1', start: 0, end: 3 },
          { worker: 'W2', start: 4, end: 7 },
        ],
      }, // Wed
      fullDay('W1'), // Mon
    ]);
    const result = await runAiSchedule(smallHouseSnapshot(), llm, {
      candidates: 2,
      plateauEpsilon: -1,
    });
    expect(result.diagnostics.candidateScores).toHaveLength(2);
    expect(result.best?.assignments).toHaveLength(24);
    const scores = result.diagnostics.candidateScores;
    expect(result.best?.score).toBe(Math.max(...scores));
  });

  it('stops on plateau without spending the third candidate', async () => {
    const llm = new ScriptedLlm([
      { runs: [] },
      { runs: [] },
      { runs: [] },
      { runs: [] },
      { runs: [] },
      { runs: [] },
    ]);
    const result = await runAiSchedule(smallHouseSnapshot(), llm, {
      candidates: 3,
      plateauEpsilon: 0.5,
    });
    expect(result.diagnostics.stoppedEarly).toBe('plateau');
    expect(result.diagnostics.llmCallCount).toBe(6);
    expect(result.diagnostics.candidateScores).toHaveLength(2);
  });
});

describe('unfillable seats', () => {
  it('surfaces seats no submitter can legally take', async () => {
    const input = makeInput({
      blocks: [...makeBand(0, 960, 1080), ...makeBand(1, 960, 1080)],
      roster: [
        makeWorker('solo', {
          prefs: Object.fromEntries(
            makeBand(0, 960, 1080).map((block) => [block.blockId, 'cannot' as const]),
          ),
        }),
      ],
    });
    const llm = new ScriptedLlm([{ runs: [] }, { runs: [{ worker: 'W1', start: 0, end: 3 }] }]);
    const result = await runAiSchedule(input, llm, { candidates: 1 });
    const monSeats = result.unfilledSeats.filter((s) => s.weekday === 0);
    expect(monSeats).toHaveLength(4);
    expect(monSeats.every((s) => !s.fillable)).toBe(true);
    expect(result.unfilledSeats.filter((s) => s.weekday === 1)).toHaveLength(0);
  });
});

describe('planning pass', () => {
  it('runs one planning call first and threads the strategy into propose prompts', async () => {
    const llm = new ScriptedLlm([
      { strategy: 'Anchor Alice on Monday; spread Bob and Cara across Tue and Wed.' },
      fullDay('W1'),
      fullDay('W2'),
      fullDay('W3'),
    ]);
    const result = await runAiSchedule(smallHouseSnapshot(), llm, {
      candidates: 1,
      planningPass: true,
    });
    expect(result.diagnostics.llmCallCount).toBe(4); // 1 plan + 3 days
    expect(llm.requests[0]?.user).toContain('Set the strategy');
    expect(llm.requests[0]?.user).not.toContain('SLOTS');
    expect(llm.requests[1]?.user).toContain('YOUR WEEK STRATEGY');
    expect(llm.requests[1]?.user).toContain('Anchor Alice on Monday');
    expect(result.best?.assignments).toHaveLength(24);
  });

  it('skips planning by default (no extra call, no strategy section)', async () => {
    const llm = new ScriptedLlm([fullDay('W1'), fullDay('W2'), fullDay('W3')]);
    const result = await runAiSchedule(smallHouseSnapshot(), llm, { candidates: 1 });
    expect(result.diagnostics.llmCallCount).toBe(3);
    expect(llm.requests[0]?.user).not.toContain('YOUR WEEK STRATEGY');
  });
});

describe('progress events', () => {
  it('emits a granular, ordered event stream with per-day assignments', async () => {
    const events: AiProgressEvent[] = [];
    const llm = new ScriptedLlm([
      { strategy: 'plan' },
      fullDay('W1'),
      fullDay('W2'),
      fullDay('W3'),
    ]);
    await runAiSchedule(smallHouseSnapshot(), llm, {
      candidates: 1,
      planningPass: true,
      onProgress: (e) => events.push(e),
    });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('planning');
    expect(types[1]).toBe('planned');
    expect(types.filter((t) => t === 'day-start')).toHaveLength(3);
    expect(types.filter((t) => t === 'day-done')).toHaveLength(3);
    expect(types[types.length - 1]).toBe('finalizing');
    const done = events.find((e) => e.type === 'day-done');
    expect(done?.type === 'day-done' ? done.assignments.length : 0).toBe(8);
  });

  it('emits a day-repair event when a day needs fixing', async () => {
    const events: AiProgressEvent[] = [];
    const llm = new ScriptedLlm([
      fullDay('W1'), // Mon
      fullDay('W3'), // Tue propose (cara cannot Tue) -> repair
      fullDay('W2'), // Tue repair
      fullDay('W1'), // Wed
    ]);
    await runAiSchedule(smallHouseSnapshot(), llm, {
      candidates: 1,
      onProgress: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === 'day-repair')).toBe(true);
  });

  it('runs cleanly with no onProgress handler', async () => {
    const llm = new ScriptedLlm([fullDay('W1'), fullDay('W2'), fullDay('W3')]);
    const result = await runAiSchedule(smallHouseSnapshot(), llm, { candidates: 1 });
    expect(result.best).not.toBeNull();
  });
});

describe('finalize option', () => {
  it('fills days the LLM left empty and guarantees >= 2h runs', async () => {
    // The LLM only staffs Monday (with a 1h stub); Tue and Wed come back empty.
    const llm = new ScriptedLlm([
      { runs: [{ worker: 'W1', start: 0, end: 1 }] }, // Mon: 1h stub
      { runs: [] }, // Tue: empty
      { runs: [] }, // Wed: empty
    ]);
    const input = smallHouseSnapshot();
    const result = await runAiSchedule(input, llm, { candidates: 1, finalize: true });
    const assignments = result.best?.assignments ?? [];
    // Every day now has coverage (no empty day).
    for (const prefix of ['b-0-', 'b-1-', 'b-2-']) {
      expect(assignments.some((a) => a.blockId.startsWith(prefix))).toBe(true);
    }
    // No sub-2h shift survives, and the result stays feasible.
    expect(result.warnings.filter((w) => w.code === 'ONE_HOUR_SHIFT')).toHaveLength(0);
    expect(validateCandidate(input, assignments).feasible).toBe(true);
  });

  it('leaves the schedule untouched when finalize is off (default)', async () => {
    const llm = new ScriptedLlm([
      { runs: [{ worker: 'W1', start: 0, end: 1 }] },
      { runs: [] },
      { runs: [] },
    ]);
    const result = await runAiSchedule(smallHouseSnapshot(), llm, { candidates: 1 });
    // Only Monday's 2 blocks; Tue/Wed stay empty.
    expect(result.best?.assignments).toHaveLength(2);
  });
});

describe('determinism', () => {
  it('two runs with identical mocks produce deep-equal results', async () => {
    const script = [fullDay('W1'), fullDay('W3'), fullDay('W2'), fullDay('W1')];
    const a = await runAiSchedule(smallHouseSnapshot(), new ScriptedLlm(script), {
      candidates: 1,
    });
    const bResult = await runAiSchedule(smallHouseSnapshot(), new ScriptedLlm(script), {
      candidates: 1,
    });
    expect(a).toEqual(bResult);
  });
});
