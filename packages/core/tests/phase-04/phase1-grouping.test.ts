// Phase 04 — Phase-1 card grouping algorithm
// Spec sources: BEHAVIORAL_SPECIFICATION.md §4.3 (Phase 1 — Preference-Assisted Build);
//               ARCHITECTURE.md §3.6 (preference_status_enum).
//
// The schedule-builder UI lets an SM drag a span of 2–12 consecutive
// 30-min blocks. A side card appears showing every worker in the house
// grouped into one of three cards: preferred / available / blocked.
//
// Grouping rules (BEH §4.3, paraphrased verbatim):
//   - PREFERRED for the span: marked `preferred` for ≥1 block in the span
//     AND at least `available` for every other block in the span.
//   - AVAILABLE for the span: at least `available` for every block in
//     the span (no `preferred` markings, no `cannot`, no missing rows).
//   - BLOCKED for the span: marked `cannot` for any block, OR has no
//     preference row for any block in the span. Missing rows are treated,
//     for Phase-1 grouping ONLY, as `cannot` ("no preference submitted
//     for block [HH:MM]" reason).
//
// Function contract (to be implemented in
// packages/core/src/scheduling/phase1Grouping.ts):
//
//   type PreferenceStatus = 'preferred' | 'available' | 'cannot';
//
//   type Worker = { userId: string; name: string };
//
//   type SpanBlock = { blockId: string; blockStartAt: Date };
//
//   type PreferenceRecord = {
//     userId: string;
//     blockId: string;
//     status: PreferenceStatus;
//   };
//
//   type BlockedReason =
//     | { kind: 'cannot'; blockId: string; blockStartAt: Date }
//     | { kind: 'missing'; blockId: string; blockStartAt: Date };
//
//   type GroupedWorker = {
//     worker: Worker;
//     blockedReason?: BlockedReason;  // present iff in blocked
//   };
//
//   type GroupingResult = {
//     preferred: GroupedWorker[];
//     available: GroupedWorker[];
//     blocked:   GroupedWorker[];
//   };
//
//   function groupWorkersForSpan(
//     workers: Worker[],
//     span: SpanBlock[],          // length 2..12, ordered by blockStartAt
//     preferences: PreferenceRecord[]
//   ): GroupingResult
//
// Workers within each output group are sorted by name ascending.
// `blockedReason` identifies the FIRST block (in span order) that
// triggered the block — either a `cannot` or a missing row. Tied blocks
// are broken by span order, not by record-insertion order.
//
// TDD-first: the implementation does not yet exist. The tests import
// from `../../src/scheduling/phase1Grouping.js`; that path will fail
// at compile time until the implementation lands.

import { describe, expect, it } from 'vitest';

import {
  groupWorkersForSpan,
  type GroupingResult,
  type PreferenceRecord,
  type SpanBlock,
  type Worker,
} from '../../src/scheduling/phase1Grouping.js';

// ----- helpers -----------------------------------------------------

const span2 = (): SpanBlock[] => [
  { blockId: 'b-10:00', blockStartAt: new Date('2026-02-02T10:00:00-05:00') },
  { blockId: 'b-10:30', blockStartAt: new Date('2026-02-02T10:30:00-05:00') },
];

const span4 = (): SpanBlock[] => [
  { blockId: 'b-10:00', blockStartAt: new Date('2026-02-02T10:00:00-05:00') },
  { blockId: 'b-10:30', blockStartAt: new Date('2026-02-02T10:30:00-05:00') },
  { blockId: 'b-11:00', blockStartAt: new Date('2026-02-02T11:00:00-05:00') },
  { blockId: 'b-11:30', blockStartAt: new Date('2026-02-02T11:30:00-05:00') },
];

const span12 = (): SpanBlock[] =>
  Array.from({ length: 12 }, (_, i) => {
    const minutes = i * 30;
    const hh = String(10 + Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return {
      blockId: `b-${hh}:${mm}`,
      blockStartAt: new Date(`2026-02-02T${hh}:${mm}:00-05:00`),
    };
  });

const alice: Worker = { userId: 'u-alice', name: 'Alice' };
const bob: Worker = { userId: 'u-bob', name: 'Bob' };
const carol: Worker = { userId: 'u-carol', name: 'Carol' };

const prefs = (entries: Array<[Worker, string, PreferenceRecord['status']]>): PreferenceRecord[] =>
  entries.map(([worker, blockId, status]) => ({
    userId: worker.userId,
    blockId,
    status,
  }));

const groupNames = (group: GroupingResult['preferred']): string[] =>
  group.map((g) => g.worker.name);

// ----- PREFERRED group ---------------------------------------------

describe('groupWorkersForSpan — PREFERRED group', () => {
  it('worker with preferred for every block lands in preferred', () => {
    const result = groupWorkersForSpan(
      [alice],
      span2(),
      prefs([
        [alice, 'b-10:00', 'preferred'],
        [alice, 'b-10:30', 'preferred'],
      ]),
    );
    expect(groupNames(result.preferred)).toEqual(['Alice']);
    expect(groupNames(result.available)).toEqual([]);
    expect(groupNames(result.blocked)).toEqual([]);
  });

  it('worker with preferred for one block and available for the rest lands in preferred', () => {
    const result = groupWorkersForSpan(
      [alice],
      span4(),
      prefs([
        [alice, 'b-10:00', 'preferred'],
        [alice, 'b-10:30', 'available'],
        [alice, 'b-11:00', 'available'],
        [alice, 'b-11:30', 'available'],
      ]),
    );
    expect(groupNames(result.preferred)).toEqual(['Alice']);
  });

  it('worker with preferred-or-available mix and zero cannot/missing → preferred', () => {
    const result = groupWorkersForSpan(
      [alice],
      span4(),
      prefs([
        [alice, 'b-10:00', 'available'],
        [alice, 'b-10:30', 'preferred'],
        [alice, 'b-11:00', 'available'],
        [alice, 'b-11:30', 'preferred'],
      ]),
    );
    expect(groupNames(result.preferred)).toEqual(['Alice']);
  });
});

// ----- AVAILABLE group ---------------------------------------------

describe('groupWorkersForSpan — AVAILABLE group', () => {
  it('worker with available for every block (no preferred) → available', () => {
    const result = groupWorkersForSpan(
      [alice],
      span2(),
      prefs([
        [alice, 'b-10:00', 'available'],
        [alice, 'b-10:30', 'available'],
      ]),
    );
    expect(groupNames(result.preferred)).toEqual([]);
    expect(groupNames(result.available)).toEqual(['Alice']);
    expect(groupNames(result.blocked)).toEqual([]);
  });

  it('available across a 4-block span → available, not preferred', () => {
    const result = groupWorkersForSpan(
      [alice],
      span4(),
      prefs([
        [alice, 'b-10:00', 'available'],
        [alice, 'b-10:30', 'available'],
        [alice, 'b-11:00', 'available'],
        [alice, 'b-11:30', 'available'],
      ]),
    );
    expect(groupNames(result.available)).toEqual(['Alice']);
    expect(groupNames(result.preferred)).toEqual([]);
  });
});

// ----- BLOCKED group: explicit `cannot` ---------------------------

describe('groupWorkersForSpan — BLOCKED via explicit cannot', () => {
  it('worker with cannot for any block in span → blocked, reason identifies the block', () => {
    const result = groupWorkersForSpan(
      [alice],
      span4(),
      prefs([
        [alice, 'b-10:00', 'preferred'],
        [alice, 'b-10:30', 'available'],
        [alice, 'b-11:00', 'cannot'], // <- blocker
        [alice, 'b-11:30', 'available'],
      ]),
    );
    expect(groupNames(result.preferred)).toEqual([]);
    expect(groupNames(result.available)).toEqual([]);
    expect(groupNames(result.blocked)).toEqual(['Alice']);
    expect(result.blocked[0]?.blockedReason).toEqual({
      kind: 'cannot',
      blockId: 'b-11:00',
      blockStartAt: new Date('2026-02-02T11:00:00-05:00'),
    });
  });

  it('multiple cannots → reason identifies the FIRST block in span order', () => {
    const result = groupWorkersForSpan(
      [alice],
      span4(),
      prefs([
        [alice, 'b-10:00', 'available'],
        [alice, 'b-10:30', 'cannot'], // <- earliest cannot
        [alice, 'b-11:00', 'cannot'],
        [alice, 'b-11:30', 'available'],
      ]),
    );
    expect(result.blocked[0]?.blockedReason?.kind).toBe('cannot');
    expect((result.blocked[0]?.blockedReason as { blockId: string }).blockId).toBe('b-10:30');
  });

  it('one cannot among 12 blocks → still blocked', () => {
    const span = span12();
    const all = span.map(
      (b, i) =>
        [alice, b.blockId, i === 7 ? 'cannot' : 'available'] as [
          Worker,
          string,
          PreferenceRecord['status'],
        ],
    );
    const result = groupWorkersForSpan([alice], span, prefs(all));
    expect(groupNames(result.blocked)).toEqual(['Alice']);
    expect((result.blocked[0]?.blockedReason as { blockId: string }).blockId).toBe(
      span[7]?.blockId,
    );
  });
});

// ----- BLOCKED group: missing rows --------------------------------

describe('groupWorkersForSpan — BLOCKED via missing preference rows', () => {
  it('worker with no preferences at all → blocked, reason = missing on first block of span', () => {
    const result = groupWorkersForSpan([alice], span4(), []);
    expect(groupNames(result.blocked)).toEqual(['Alice']);
    expect(result.blocked[0]?.blockedReason).toEqual({
      kind: 'missing',
      blockId: 'b-10:00',
      blockStartAt: new Date('2026-02-02T10:00:00-05:00'),
    });
  });

  it('worker missing preference for ONE block in span → blocked with missing reason', () => {
    const result = groupWorkersForSpan(
      [alice],
      span4(),
      prefs([
        [alice, 'b-10:00', 'preferred'],
        [alice, 'b-10:30', 'available'],
        // b-11:00 omitted
        [alice, 'b-11:30', 'available'],
      ]),
    );
    expect(groupNames(result.blocked)).toEqual(['Alice']);
    expect(result.blocked[0]?.blockedReason).toEqual({
      kind: 'missing',
      blockId: 'b-11:00',
      blockStartAt: new Date('2026-02-02T11:00:00-05:00'),
    });
  });

  it('cannot wins over missing when both present — cannot is the stronger signal and appears earlier in span', () => {
    const result = groupWorkersForSpan(
      [alice],
      span4(),
      prefs([
        [alice, 'b-10:00', 'available'],
        [alice, 'b-10:30', 'cannot'], // explicit cannot earlier in span
        // b-11:00 omitted (missing)
        [alice, 'b-11:30', 'available'],
      ]),
    );
    expect(groupNames(result.blocked)).toEqual(['Alice']);
    expect(result.blocked[0]?.blockedReason?.kind).toBe('cannot');
    expect((result.blocked[0]?.blockedReason as { blockId: string }).blockId).toBe('b-10:30');
  });

  it('missing earlier than cannot → reason is missing (span-order tie-break is by block position, not severity)', () => {
    // span order: 10:00 (preferred), 10:30 (missing), 11:00 (cannot), 11:30 (preferred)
    // First triggering block in span order is the missing one at 10:30.
    const result = groupWorkersForSpan(
      [alice],
      span4(),
      prefs([
        [alice, 'b-10:00', 'preferred'],
        // b-10:30 missing
        [alice, 'b-11:00', 'cannot'],
        [alice, 'b-11:30', 'preferred'],
      ]),
    );
    expect(groupNames(result.blocked)).toEqual(['Alice']);
    expect(result.blocked[0]?.blockedReason?.kind).toBe('missing');
    expect((result.blocked[0]?.blockedReason as { blockId: string }).blockId).toBe('b-10:30');
  });
});

// ----- multi-worker grouping --------------------------------------

describe('groupWorkersForSpan — multi-worker grouping and ordering', () => {
  it('partitions three workers into three groups and sorts each by name', () => {
    // Provide workers in reverse-name order to verify alphabetic sort.
    const result = groupWorkersForSpan(
      [carol, bob, alice],
      span2(),
      prefs([
        // Alice: preferred for one + available for other → PREFERRED
        [alice, 'b-10:00', 'preferred'],
        [alice, 'b-10:30', 'available'],
        // Bob: available + available → AVAILABLE
        [bob, 'b-10:00', 'available'],
        [bob, 'b-10:30', 'available'],
        // Carol: cannot on first → BLOCKED
        [carol, 'b-10:00', 'cannot'],
        [carol, 'b-10:30', 'available'],
      ]),
    );
    expect(groupNames(result.preferred)).toEqual(['Alice']);
    expect(groupNames(result.available)).toEqual(['Bob']);
    expect(groupNames(result.blocked)).toEqual(['Carol']);
  });

  it('two workers in the same group are ordered alphabetically by name', () => {
    const result = groupWorkersForSpan(
      [bob, alice],
      span2(),
      prefs([
        [alice, 'b-10:00', 'available'],
        [alice, 'b-10:30', 'available'],
        [bob, 'b-10:00', 'available'],
        [bob, 'b-10:30', 'available'],
      ]),
    );
    expect(groupNames(result.available)).toEqual(['Alice', 'Bob']);
  });

  it('every worker passed in appears in exactly one group (no drops, no duplicates)', () => {
    const workers = [alice, bob, carol];
    const result = groupWorkersForSpan(
      workers,
      span2(),
      prefs([
        [alice, 'b-10:00', 'preferred'],
        [alice, 'b-10:30', 'preferred'],
        [bob, 'b-10:00', 'available'],
        [bob, 'b-10:30', 'available'],
        // Carol has no preferences at all
      ]),
    );
    const total = result.preferred.length + result.available.length + result.blocked.length;
    expect(total).toBe(workers.length);
    const allIds = [...result.preferred, ...result.available, ...result.blocked]
      .map((g) => g.worker.userId)
      .sort();
    expect(allIds).toEqual([alice.userId, bob.userId, carol.userId].sort());
  });
});

// ----- preference scoping (cross-block contamination guard) -------

describe('groupWorkersForSpan — irrelevant preferences are ignored', () => {
  it('preferences for blocks outside the dragged span do not affect grouping', () => {
    const result = groupWorkersForSpan(
      [alice],
      span2(),
      prefs([
        [alice, 'b-10:00', 'available'],
        [alice, 'b-10:30', 'available'],
        // Out-of-span preferences below should be ignored entirely.
        [alice, 'b-99:99', 'cannot'],
        [alice, 'b-XX:XX', 'preferred'],
      ]),
    );
    expect(groupNames(result.available)).toEqual(['Alice']);
    expect(groupNames(result.blocked)).toEqual([]);
  });

  it('preferences for other users do not leak into the target user grouping', () => {
    const result = groupWorkersForSpan(
      [alice],
      span2(),
      prefs([
        [alice, 'b-10:00', 'preferred'],
        [alice, 'b-10:30', 'preferred'],
        [bob, 'b-10:00', 'cannot'], // Bob's cannot must not bleed into Alice
        [bob, 'b-10:30', 'cannot'],
      ]),
    );
    expect(groupNames(result.preferred)).toEqual(['Alice']);
  });
});

// ----- span size edges --------------------------------------------

describe('groupWorkersForSpan — span size 2 (min) and 12 (max)', () => {
  it('span size = 2: smallest valid span groups correctly', () => {
    const result = groupWorkersForSpan(
      [alice],
      span2(),
      prefs([
        [alice, 'b-10:00', 'preferred'],
        [alice, 'b-10:30', 'available'],
      ]),
    );
    expect(groupNames(result.preferred)).toEqual(['Alice']);
  });

  it('span size = 12 (6 hours): largest valid span groups correctly', () => {
    const span = span12();
    const allAvailable = span.map(
      (b) => [alice, b.blockId, 'available'] as [Worker, string, PreferenceRecord['status']],
    );
    const result = groupWorkersForSpan([alice], span, prefs(allAvailable));
    expect(groupNames(result.available)).toEqual(['Alice']);
  });
});
