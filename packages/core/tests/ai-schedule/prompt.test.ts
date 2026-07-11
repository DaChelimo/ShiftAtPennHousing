// AI Schedule Agent — prompt construction + proposal wire-format tests.
//
// The LLM only ever sees worker keys (W1..Wn) and per-day slot indices;
// parseProposal is the sole mapping back to blockIds and must degrade
// malformed responses into MALFORMED_RUN violations, never throws.

import { describe, expect, it } from 'vitest';

import {
  AI_PROPOSAL_JSON_SCHEMA,
  buildGrid,
  buildProposePrompt,
  buildRepairPrompt,
  buildSystemPrompt,
  parseProposal,
  type AiViolation,
} from '../../src/ai-schedule/index.js';

import { fixtureBlockId, makeBand, makeInput, makeWorker, smallHouseSnapshot } from './fixtures.js';

const b = fixtureBlockId;

function firstDay(input: ReturnType<typeof makeInput>) {
  const grid = buildGrid(input);
  const day = grid.days[0];
  if (day === undefined) throw new Error('fixture has no days');
  return { grid, day };
}

describe('propose prompt', () => {
  it('numbers slots in day order with seat counts', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 1050, 2),
      roster: [makeWorker('alice')],
    });
    const { grid, day } = firstDay(input);
    const prompt = buildProposePrompt(input, grid, day, []);
    expect(prompt).toContain('idx | start | seats');
    expect(prompt).toContain('0 | 4:00 PM | 2');
    expect(prompt).toContain('1 | 4:30 PM | 2');
    expect(prompt).toContain('2 | 5:00 PM | 2');
    expect(prompt).toContain('weekday 0');
  });

  it('assigns stable worker keys regardless of roster order', () => {
    const base = smallHouseSnapshot();
    const reversed = { ...base, roster: [...base.roster].reverse() };
    const a = firstDay(base);
    const r = firstDay(reversed);
    expect(buildProposePrompt(base, a.grid, a.day, [])).toEqual(
      buildProposePrompt(reversed, r.grid, r.day, []),
    );
    expect(a.grid.keyByWorkerId.get('alice')).toBe('W1');
    expect(a.grid.keyByWorkerId.get('cara')).toBe('W3');
  });

  it('aligns the pref string with slot indices', () => {
    const input = makeInput({
      blocks: makeBand(0, 960, 1080),
      roster: [
        makeWorker('alice', {
          prefs: { [b(0, 1020)]: 'cannot', [b(0, 960)]: 'preferred' },
        }),
      ],
    });
    const { grid, day } = firstDay(input);
    const prompt = buildProposePrompt(input, grid, day, []);
    expect(prompt).toContain('PACA');
  });

  it('reports assigned-so-far hours from the accumulator', () => {
    const input = smallHouseSnapshot();
    const { grid, day } = firstDay(input);
    const acc = [
      { blockId: b(1, 960), workerId: 'bob' },
      { blockId: b(1, 990), workerId: 'bob' },
    ];
    const prompt = buildProposePrompt(input, grid, day, acc);
    expect(prompt).toContain('W2 | HOME | 6h | 1h |');
  });

  it('flags the Harnwell rule only for Harnwell', () => {
    const harnwell = makeInput({
      houseId: 'harnwell',
      isHarnwell: true,
      blocks: makeBand(0, 960, 990),
      roster: [makeWorker('home', { homeHouseId: 'harnwell' })],
    });
    const { grid, day } = firstDay(harnwell);
    expect(buildSystemPrompt(harnwell, 'coverage-first')).toContain('ONLY workers marked HOME');
    expect(buildProposePrompt(harnwell, grid, day, [])).toContain('Harnwell rule applies');
    const other = smallHouseSnapshot();
    expect(buildSystemPrompt(other, 'coverage-first')).not.toContain('HOME');
  });
});

describe('parseProposal', () => {
  const input = smallHouseSnapshot();

  it('maps an inclusive run to blockIds', () => {
    const { grid, day } = firstDay(input);
    const { assignments, violations } = parseProposal(
      { runs: [{ worker: 'W1', start: 1, end: 3 }] },
      grid,
      day,
    );
    expect(violations).toHaveLength(0);
    expect(assignments).toEqual([
      { blockId: b(0, 990), workerId: 'alice' },
      { blockId: b(0, 1020), workerId: 'alice' },
      { blockId: b(0, 1050), workerId: 'alice' },
    ]);
  });

  it('turns out-of-range indices into MALFORMED_RUN without throwing', () => {
    const { grid, day } = firstDay(input);
    const { assignments, violations } = parseProposal(
      { runs: [{ worker: 'W1', start: 0, end: 99 }] },
      grid,
      day,
    );
    expect(assignments).toHaveLength(0);
    expect(violations[0]?.code).toBe('MALFORMED_RUN');
    expect(violations[0]?.severity).toBe('hard');
  });

  it('turns an unknown worker key into MALFORMED_RUN', () => {
    const { grid, day } = firstDay(input);
    const { violations } = parseProposal({ runs: [{ worker: 'W9', start: 0, end: 1 }] }, grid, day);
    expect(violations[0]?.code).toBe('MALFORMED_RUN');
  });

  it('treats a non-object response as one MALFORMED_RUN', () => {
    const { grid, day } = firstDay(input);
    expect(parseProposal('nonsense', grid, day).violations).toHaveLength(1);
    expect(parseProposal(null, grid, day).violations).toHaveLength(1);
    expect(parseProposal({ notRuns: [] }, grid, day).violations).toHaveLength(1);
  });
});

describe('repair prompt', () => {
  it('replays prior runs and violation codes', () => {
    const input = smallHouseSnapshot();
    const { grid, day } = firstDay(input);
    const dayAssignments = [
      { blockId: b(0, 960), workerId: 'alice' },
      { blockId: b(0, 990), workerId: 'alice' },
    ];
    const violations: AiViolation[] = [
      {
        code: 'CANNOT_CONFLICT',
        severity: 'hard',
        workerId: 'alice',
        blockId: b(0, 960),
        detail: 'worker marked this block cannot',
      },
      {
        code: 'ONE_HOUR_SHIFT',
        severity: 'warning',
        workerId: 'alice',
        blockId: b(0, 960),
        weekday: 0,
        detail: '1h run',
      },
    ];
    const prompt = buildRepairPrompt(input, grid, day, dayAssignments, violations);
    expect(prompt).toContain('You previously proposed:');
    expect(prompt).toContain('W1: slots 0..1');
    expect(prompt).toContain('CANNOT_CONFLICT');
    expect(prompt).toContain('(non-blocking)');
    expect(prompt).toContain('Re-emit the FULL corrected run list');
  });
});

describe('proposal schema', () => {
  it('sets additionalProperties: false on every object node', () => {
    const objects: Record<string, unknown>[] = [];
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return;
      const record = node as Record<string, unknown>;
      if (record.type === 'object') objects.push(record);
      for (const value of Object.values(record)) walk(value);
    };
    walk(AI_PROPOSAL_JSON_SCHEMA);
    expect(objects.length).toBeGreaterThan(0);
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
      expect(Array.isArray(object.required)).toBe(true);
    }
  });

  it('uses no unsupported numeric bounds', () => {
    const text = JSON.stringify(AI_PROPOSAL_JSON_SCHEMA);
    expect(text).not.toContain('minimum');
    expect(text).not.toContain('maximum');
  });
});
