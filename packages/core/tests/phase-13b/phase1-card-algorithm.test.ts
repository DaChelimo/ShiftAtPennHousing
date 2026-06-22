// Phase 13b — Schedule-builder card algorithm (web admin app)
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §4.3 (Schedule Building — Three Phases; DESKTOP ONLY)
//   ARCHITECTURE.md §3.6 (preference_status_enum), §3.9 (draft_block_assignments)
//   AGENTS.md (pure business logic in packages/core; invariant #5: 30-min blocks)
//
// Phase-13b's deliverable is the Next.js SM/HM admin web app. Following the repo
// rule that "pure business logic lives in packages/core; the UI is a thin wrapper"
// (AGENTS Conventions), the schedule-builder's *card* — what the drag-picker shows
// for a dragged span — is a PURE function of (workers, span, preferences). This is
// phase-04's `groupWorkersForSpan` (already shipped + tested) WIRED INTO the web
// card view-model: it adds the three things the UI renders on top of the grouping —
//   (1) selectability   (a blocked worker is non-selectable in Phase 1, §4.3),
//   (2) hours-remaining  (target hours − hours already assigned, §4.3), and
//   (3) the over-target warning flag (§4.3 "would push them over their target hours").
// Phase 2 (Manual Override, identical post-publish per §4.3 Phase 3) is the second
// mode: the SAME drag-picker, but the card downgrades the Phase-1 hard constraints
// (a `cannot` marking, a "no hours" opt-out) to ADVISORY warnings and shows the FULL
// house roster — no worker is excluded or disabled.
//
// Function contract (to be implemented in
// packages/core/src/scheduling/scheduleBuilderCard.ts — TDD-first, does not exist yet;
// this file fails to import until it lands, the phase-04/06..12 red-first pattern):
//
//   // span the drag-picker produced — 2..12 consecutive 30-min blocks (§4.3)
//   const MIN_SPAN_BLOCKS = 2;        // 1 hour
//   const MAX_SPAN_BLOCKS = 12;       // 6 hours
//   type SpanValidation =
//     | { valid: true;  blockCount: number; hours: number }
//     | { valid: false; reason: 'too_short' | 'too_long' | 'not_contiguous' };
//   function validateDragSpan(span: SpanBlock[]): SpanValidation;
//
//   // one row per worker the card draws (the SM's house roster for the period)
//   type WorkerScheduleInfo = {
//     worker: Worker;
//     assignedHours: number;   // hours already assigned to them THIS week
//     targetHours: number;     // their submitted target (0..cap)
//     optedOut: boolean;       // period_targets.opted_out — the "no hours" button
//   };
//
//   // ----- Phase 1 (Preference-Assisted) -----
//   type Phase1Entry = {
//     worker: Worker;
//     status: 'preferred' | 'available' | 'blocked';
//     blockedReason?: BlockedReason;   // present iff status === 'blocked'
//     hoursRemaining: number;          // targetHours − assignedHours (may be negative)
//     selectable: boolean;             // false iff status === 'blocked'
//     wouldExceedTarget: boolean;      // assignedHours + spanHours > targetHours (strict)
//   };
//   type Phase1Card = { preferred: Phase1Entry[]; available: Phase1Entry[]; blocked: Phase1Entry[] };
//   function buildPhase1Card(workers: WorkerScheduleInfo[], span: SpanBlock[], preferences: PreferenceRecord[]): Phase1Card;
//
//   // ----- Phase 2 (Manual Override) / post-publish override -----
//   type Phase2Advisory =
//     | { kind: 'cannot'; blockId: string; blockStartAt: Date }   // first cannot in span order
//     | { kind: 'opted_out' };
//   type Phase2Entry = {
//     worker: Worker;
//     assignedHours: number;           // total assigned hours (§4.3 Phase 2 shows this)
//     hoursRemaining: number;
//     advisories: Phase2Advisory[];    // advisory only — never excludes / disables
//     wouldExceedTarget: boolean;
//   };
//   function buildPhase2Roster(workers: WorkerScheduleInfo[], span: SpanBlock[], preferences: PreferenceRecord[]): Phase2Entry[];
//
// The pinned decisions (see tests/PHASE_13b/TEST_PLAN.md) the tests below enforce:
//   D1  Phase-1 grouping is delegated verbatim to phase-04's `groupWorkersForSpan`
//       (missing-row-for-a-span-block ⇒ blocked, NOT available).
//   D2  Phase-1 selectable ⇔ status !== 'blocked' (blocked = visually disabled, §4.3).
//   D3  hoursRemaining = targetHours − assignedHours; may be 0 or negative.
//   D4  wouldExceedTarget ⇔ assignedHours + spanHours > targetHours (STRICT; at-target = no warning).
//   D5  Phase-2 downgrades `cannot` + `optedOut` to advisories; every worker stays in the
//       flat roster (sorted by name). Missing/`none` rows are NOT advised in Phase 2.
//   D6  Phase-2 advisory order: `cannot` (if any span block) before `opted_out`.
//   D7  validateDragSpan: size 2..12 first, then strict 30-min contiguity.

import { describe, expect, it } from 'vitest';

import {
  MIN_SPAN_BLOCKS,
  buildPhase1Card,
  buildPhase2Roster,
  validateDragSpan,
  type Phase1Card,
  type Phase2Entry,
  type PreferenceRecord,
  type SpanBlock,
  type Worker,
  type WorkerScheduleInfo,
} from '../../src/scheduling/scheduleBuilderCard.js';

// ----- fixtures ----------------------------------------------------

const BLOCK_MS = 30 * 60 * 1000;

// A contiguous span of `n` 30-min blocks starting at 2026-02-02 10:00 NY (EST, -05:00).
const span = (n: number): SpanBlock[] =>
  Array.from({ length: n }, (_, i) => {
    const start = new Date('2026-02-02T10:00:00-05:00').getTime() + i * BLOCK_MS;
    const d = new Date(start);
    const hh = String(d.getUTCHours()).padStart(2, '0'); // labels are cosmetic; ids must be unique
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return { blockId: `b-${hh}:${mm}`, blockStartAt: d };
  });

const span2 = (): SpanBlock[] => span(2); // 1h: b-15:00, b-15:30 (UTC labels; -05:00 ⇒ 10:00/10:30 NY)
const span4 = (): SpanBlock[] => span(4);

// the two block ids of span2 (UTC-derived labels) — referenced by preference fixtures
const [B0, B1] = span2().map((b) => b.blockId) as [string, string];
const SPAN4_IDS = span4().map((b) => b.blockId) as [string, string, string, string];

const alice: Worker = { userId: 'u-alice', name: 'Alice' };
const bob: Worker = { userId: 'u-bob', name: 'Bob' };
const carol: Worker = { userId: 'u-carol', name: 'Carol' };
const dave: Worker = { userId: 'u-dave', name: 'Dave' };

const info = (
  worker: Worker,
  assignedHours: number,
  targetHours: number,
  optedOut = false,
): WorkerScheduleInfo => ({ worker, assignedHours, targetHours, optedOut });

const prefs = (entries: Array<[Worker, string, PreferenceRecord['status']]>): PreferenceRecord[] =>
  entries.map(([worker, blockId, status]) => ({ userId: worker.userId, blockId, status }));

const names = (entries: Array<{ worker: Worker }>): string[] => entries.map((e) => e.worker.name);

// =====================================================================
// validateDragSpan — any contiguous run of 30-min blocks (the 2..12 size limits
// were lifted; the SM may pick a single block or a span of any length).
// =====================================================================

describe('validateDragSpan — span size + contiguity (D7)', () => {
  it('exposes a 1-block minimum (a single 30-min block is a valid pick)', () => {
    expect(MIN_SPAN_BLOCKS).toBe(1);
  });

  it('a single block is valid (30 min) — no 1-hour minimum any more', () => {
    expect(validateDragSpan(span(1))).toEqual({ valid: true, blockCount: 1, hours: 0.5 });
  });

  it('a 2-block contiguous span is valid (1 hour)', () => {
    expect(validateDragSpan(span(2))).toEqual({ valid: true, blockCount: 2, hours: 1 });
  });

  it('a 12-block contiguous span is valid (6 hours)', () => {
    expect(validateDragSpan(span(12))).toEqual({ valid: true, blockCount: 12, hours: 6 });
  });

  it('a 13-block span is valid (6.5 hours) — no 6-hour maximum any more', () => {
    expect(validateDragSpan(span(13))).toEqual({ valid: true, blockCount: 13, hours: 6.5 });
  });

  it('a 32-block contiguous span (a full 08:00–24:00 day) is valid (16 hours)', () => {
    expect(validateDragSpan(span(32))).toEqual({ valid: true, blockCount: 32, hours: 16 });
  });

  it('an empty span is too_short', () => {
    expect(validateDragSpan([])).toEqual({ valid: false, reason: 'too_short' });
  });

  it('a span with a 30-min gap between blocks is not_contiguous', () => {
    const s: SpanBlock[] = [
      { blockId: 'b-10:00', blockStartAt: new Date('2026-02-02T10:00:00-05:00') },
      // 10:30 skipped
      { blockId: 'b-11:00', blockStartAt: new Date('2026-02-02T11:00:00-05:00') },
    ];
    expect(validateDragSpan(s)).toEqual({ valid: false, reason: 'not_contiguous' });
  });

  it('an out-of-order (descending) span is not_contiguous', () => {
    const ordered = span(2);
    const reversed: SpanBlock[] = [ordered[1] as SpanBlock, ordered[0] as SpanBlock];
    expect(validateDragSpan(reversed)).toEqual({ valid: false, reason: 'not_contiguous' });
  });
});

// =====================================================================
// buildPhase1Card — grouping delegation (D1)
// =====================================================================

describe('buildPhase1Card — delegates grouping to phase-04 (D1)', () => {
  it('partitions workers into preferred / available / blocked and tags each entry with its status', () => {
    const card: Phase1Card = buildPhase1Card(
      [info(carol, 0, 10), info(bob, 0, 10), info(alice, 0, 10)],
      span2(),
      prefs([
        // Alice: preferred for one + available for the other → PREFERRED
        [alice, B0, 'preferred'],
        [alice, B1, 'available'],
        // Bob: available for both → AVAILABLE
        [bob, B0, 'available'],
        [bob, B1, 'available'],
        // Carol: cannot for one → BLOCKED
        [carol, B0, 'cannot'],
        [carol, B1, 'available'],
      ]),
    );
    expect(names(card.preferred)).toEqual(['Alice']);
    expect(names(card.available)).toEqual(['Bob']);
    expect(names(card.blocked)).toEqual(['Carol']);
    expect(card.preferred[0]?.status).toBe('preferred');
    expect(card.available[0]?.status).toBe('available');
    expect(card.blocked[0]?.status).toBe('blocked');
  });

  it('keeps each group alphabetically ordered by worker name', () => {
    const card = buildPhase1Card(
      [info(bob, 0, 10), info(alice, 0, 10)],
      span2(),
      prefs([
        [alice, B0, 'available'],
        [alice, B1, 'available'],
        [bob, B0, 'available'],
        [bob, B1, 'available'],
      ]),
    );
    expect(names(card.available)).toEqual(['Alice', 'Bob']);
  });

  it('a worker with NO preference for any span block lands in BLOCKED, not available (D1)', () => {
    // Dave submitted preferences for the period, but none cover the dragged span.
    const card = buildPhase1Card(
      [info(dave, 0, 10)],
      span2(),
      prefs([
        [dave, 'b-99:00', 'preferred'],
        [dave, 'b-99:30', 'available'],
      ]),
    );
    expect(names(card.available)).toEqual([]);
    expect(names(card.blocked)).toEqual(['Dave']);
    expect(card.blocked[0]?.blockedReason).toEqual({
      kind: 'missing',
      blockId: B0,
      blockStartAt: span2()[0]?.blockStartAt,
    });
  });

  it('carries the blockedReason (cannot) identifying the first triggering block', () => {
    const card = buildPhase1Card(
      [info(carol, 0, 10)],
      span4(),
      prefs([
        [carol, SPAN4_IDS[0], 'available'],
        [carol, SPAN4_IDS[1], 'cannot'], // first cannot
        [carol, SPAN4_IDS[2], 'cannot'],
        [carol, SPAN4_IDS[3], 'available'],
      ]),
    );
    expect(card.blocked[0]?.blockedReason).toEqual({
      kind: 'cannot',
      blockId: SPAN4_IDS[1],
      blockStartAt: span4()[1]?.blockStartAt,
    });
  });
});

// =====================================================================
// buildPhase1Card — selectability (D2)
// =====================================================================

describe('buildPhase1Card — blocked workers are non-selectable (D2)', () => {
  it('preferred and available entries are selectable; blocked entries are not', () => {
    const card = buildPhase1Card(
      [info(alice, 0, 10), info(bob, 0, 10), info(carol, 0, 10)],
      span2(),
      prefs([
        [alice, B0, 'preferred'],
        [alice, B1, 'preferred'],
        [bob, B0, 'available'],
        [bob, B1, 'available'],
        [carol, B0, 'cannot'],
        [carol, B1, 'available'],
      ]),
    );
    expect(card.preferred[0]?.selectable).toBe(true);
    expect(card.available[0]?.selectable).toBe(true);
    expect(card.blocked[0]?.selectable).toBe(false);
  });

  it('a worker blocked only by a missing row is also non-selectable', () => {
    const card = buildPhase1Card([info(dave, 0, 10)], span2(), []);
    expect(card.blocked[0]?.selectable).toBe(false);
  });
});

// =====================================================================
// buildPhase1Card — hours-remaining (D3) + over-target warning (D4)
// =====================================================================

describe('buildPhase1Card — hours-remaining figure (D3)', () => {
  it('hoursRemaining = targetHours − assignedHours', () => {
    const card = buildPhase1Card(
      [info(alice, 6, 10)],
      span2(),
      prefs([
        [alice, B0, 'preferred'],
        [alice, B1, 'available'],
      ]),
    );
    expect(card.preferred[0]?.hoursRemaining).toBe(4);
  });

  it('hoursRemaining is 0 when the worker is exactly at target', () => {
    const card = buildPhase1Card(
      [info(bob, 10, 10)],
      span2(),
      prefs([
        [bob, B0, 'available'],
        [bob, B1, 'available'],
      ]),
    );
    expect(card.available[0]?.hoursRemaining).toBe(0);
  });

  it('hoursRemaining can be negative when the worker is already over target', () => {
    const card = buildPhase1Card(
      [info(bob, 12, 10)],
      span2(),
      prefs([
        [bob, B0, 'available'],
        [bob, B1, 'available'],
      ]),
    );
    expect(card.available[0]?.hoursRemaining).toBe(-2);
  });
});

describe('buildPhase1Card — over-target warning flag (D4)', () => {
  it('wouldExceedTarget is false when the span keeps the worker at or below target', () => {
    // assigned 6 + span 1h = 7 <= target 10
    const card = buildPhase1Card(
      [info(alice, 6, 10)],
      span2(),
      prefs([
        [alice, B0, 'available'],
        [alice, B1, 'available'],
      ]),
    );
    expect(card.available[0]?.wouldExceedTarget).toBe(false);
  });

  it('wouldExceedTarget is false at EXACTLY the target (boundary is inclusive — no warning)', () => {
    // assigned 9 + span 1h = 10 == target 10 → no warning (strict over)
    const card = buildPhase1Card(
      [info(alice, 9, 10)],
      span2(),
      prefs([
        [alice, B0, 'available'],
        [alice, B1, 'available'],
      ]),
    );
    expect(card.available[0]?.wouldExceedTarget).toBe(false);
  });

  it('wouldExceedTarget is true when the span pushes the worker strictly over target', () => {
    // assigned 9.5 + span 1h = 10.5 > target 10 → warning
    const card = buildPhase1Card(
      [info(alice, 9.5, 10)],
      span2(),
      prefs([
        [alice, B0, 'available'],
        [alice, B1, 'available'],
      ]),
    );
    expect(card.available[0]?.wouldExceedTarget).toBe(true);
  });

  it('the over-target warning scales with span length (6-hour span)', () => {
    // assigned 0 + span 6h = 6 > target 4 → warning
    const card = buildPhase1Card(
      [info(alice, 0, 4)],
      span(12),
      span(12).map((b) => ({
        userId: alice.userId,
        blockId: b.blockId,
        status: 'available' as const,
      })),
    );
    expect(card.available[0]?.wouldExceedTarget).toBe(true);
  });
});

// =====================================================================
// buildPhase2Roster — full roster, advisory downgrade (D5, D6)
// =====================================================================

describe('buildPhase2Roster — shows every worker, sorted by name (D5)', () => {
  it('includes a fully-unsubmitted worker (no preferences, no advisory) and sorts by name', () => {
    // Carol never submitted anything → excluded from Phase-1, but visible in Phase-2.
    const roster: Phase2Entry[] = buildPhase2Roster(
      [info(carol, 0, 0), info(alice, 0, 10), info(bob, 0, 10)],
      span2(),
      prefs([
        [alice, B0, 'available'],
        [alice, B1, 'available'],
        [bob, B0, 'available'],
        [bob, B1, 'available'],
      ]),
    );
    expect(names(roster)).toEqual(['Alice', 'Bob', 'Carol']);
    const carolEntry = roster.find((e) => e.worker.userId === carol.userId);
    expect(carolEntry?.advisories).toEqual([]);
  });

  it('exposes total assigned hours and hours-remaining per worker', () => {
    const roster = buildPhase2Roster([info(bob, 7.5, 10)], span2(), []);
    expect(roster[0]?.assignedHours).toBe(7.5);
    expect(roster[0]?.hoursRemaining).toBe(2.5);
  });
});

describe('buildPhase2Roster — cannot is downgraded to advisory, not a hard block (D5)', () => {
  it('a cannot worker STAYS in the flat roster (not removed/disabled) and carries a cannot advisory', () => {
    const roster = buildPhase2Roster(
      [info(alice, 0, 10), info(carol, 0, 10)],
      span4(),
      prefs([
        [alice, SPAN4_IDS[0], 'available'],
        [alice, SPAN4_IDS[1], 'available'],
        [alice, SPAN4_IDS[2], 'available'],
        [alice, SPAN4_IDS[3], 'available'],
        [carol, SPAN4_IDS[0], 'available'],
        [carol, SPAN4_IDS[1], 'cannot'], // first (and only) cannot
        [carol, SPAN4_IDS[2], 'available'],
        [carol, SPAN4_IDS[3], 'available'],
      ]),
    );
    // both present
    expect(names(roster)).toEqual(['Alice', 'Carol']);
    // Alice (clean) has no advisory
    expect(roster.find((e) => e.worker.userId === alice.userId)?.advisories).toEqual([]);
    // Carol has exactly the cannot advisory identifying the first cannot block
    expect(roster.find((e) => e.worker.userId === carol.userId)?.advisories).toEqual([
      { kind: 'cannot', blockId: SPAN4_IDS[1], blockStartAt: span4()[1]?.blockStartAt },
    ]);
  });

  it('a missing / unsubmitted span block produces NO advisory in Phase 2 (only explicit cannot does)', () => {
    // Dave has a pref outside the span but none inside it → blocked in Phase 1, but in
    // Phase 2 a missing row is the norm (every fully-unsubmitted worker shows here), so
    // it carries no advisory.
    const roster = buildPhase2Roster(
      [info(dave, 0, 10)],
      span2(),
      prefs([[dave, 'b-99:00', 'preferred']]),
    );
    expect(roster[0]?.advisories).toEqual([]);
  });
});

describe('buildPhase2Roster — opted-out advisory (D5, D6)', () => {
  it('an opted-out worker carries an opted_out advisory', () => {
    const roster = buildPhase2Roster([info(alice, 0, 0, true)], span2(), []);
    expect(roster[0]?.advisories).toEqual([{ kind: 'opted_out' }]);
  });

  it('cannot + opted_out both apply: cannot is listed before opted_out (D6)', () => {
    const roster = buildPhase2Roster(
      [info(alice, 0, 0, true)],
      span2(),
      prefs([
        [alice, B0, 'cannot'],
        [alice, B1, 'available'],
      ]),
    );
    expect(roster[0]?.advisories).toEqual([
      { kind: 'cannot', blockId: B0, blockStartAt: span2()[0]?.blockStartAt },
      { kind: 'opted_out' },
    ]);
  });
});

describe('buildPhase2Roster — over-target warning matches Phase 1 (D4)', () => {
  it('wouldExceedTarget uses the same strict rule as Phase 1', () => {
    const roster = buildPhase2Roster([info(alice, 9, 10), info(bob, 9.5, 10)], span2(), []);
    // Alice: 9 + 1 = 10 == target → no warning
    expect(roster.find((e) => e.worker.userId === alice.userId)?.wouldExceedTarget).toBe(false);
    // Bob: 9.5 + 1 = 10.5 > target → warning
    expect(roster.find((e) => e.worker.userId === bob.userId)?.wouldExceedTarget).toBe(true);
  });
});
