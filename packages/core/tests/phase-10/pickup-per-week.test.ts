// Phase 10 — Permanent pickup: per-week conflict + cap evaluation
// (`evaluatePermanentPickup`).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §8.4.3
//     (evaluate the pickup across all future occurrences of the slot,
//      per-week:
//        • TIME CONFLICT — for each block, if it overlaps a shift the worker
//          already has that week, skip just that block; if ALL blocks conflict,
//          skip the whole week;
//        • HOURS CAP — if projected weekly hours after the non-conflicting
//          blocks would exceed the cap, skip the ENTIRE week — "regardless of
//          whether the cap is soft or hard." Permanent pickup is MORE
//          CONSERVATIVE than a one-off temporary claim: a soft cap that would
//          merely warn-and-allow on a single claim instead SKIPS the week here),
//     §9.2 (the calendar week), §9.3 (soft = 20h, hard = 40h);
//   ARCHITECTURE.md §7.2
//     (step 4b skip-conflict per block; step 4c skip-cap per week, soft OR hard,
//      computed on the NON-conflicting remainder added to current weekly hours
//      at 0.5h/block; step 6: on submit the transaction RE-RUNS the per-week
//      conflict + cap checks against LIVE state — a week that became ineligible
//      between popup and submit is silently removed before the UPDATE);
//   AGENTS.md hard invariant #4 (float-out hours are still the worker's hours —
//      currentWeeklyHours is float-neutral), #5 (30-minute blocks → 0.5h each).
//
// THE MODEL (pinned in tests/PHASE_10/TEST_PLAN.md): `evaluatePermanentPickup`
// is a PURE per-week evaluator. For each week it (1) partitions blocks into
// conflicting / non-conflicting, (2) if NOTHING is non-conflicting → skip the
// week (time_conflict), (3) else if currentWeeklyHours + 0.5×non-conflicting >
// capHours → skip the week (hours_cap, soft OR hard alike), (4) else assign the
// non-conflicting blocks (partially_assigned if any block was conflict-skipped,
// else fully_assigned). It returns each week's outcome, the flattened queued
// block-id set, and the confirmation-popup tallies.
//
// `capEnforcement` is carried on the input for fidelity to the DB shape
// (`effective_weekly_cap` returns it) but is DELIBERATELY IGNORED by the cap
// decision — that deliberate non-branching IS the §8.4.3 divergence from a
// temporary claim, and the soft-cap test below pins it.
//
// No I/O, no clock, no DB. The Edge Function snapshots the slot's per-week state
// and calls this for the popup, then RE-CALLS it against a fresh snapshot at
// transaction time (§8.4.3 stale-popup defense — exercised by the re-check
// tests). The atomic SQL RPC `permanent_pickup_slot` then applies the queued
// set under a race-safe `vacant`/`permanent_drop` predicate
// (supabase/tests/phase-10-bulk-ops.sql).

import { describe, expect, it } from 'vitest';

import { evaluatePermanentPickup } from '../../src/permanent-ops/index.js';

import { makePickupBlock, makePickupInput, makePickupWeek } from './fixtures.js';

// ---------------------------------------------------------------------
// Fully-assigned week — no conflicts, comfortably under cap.
// ---------------------------------------------------------------------

describe('fully-assigned week (§8.4.3)', () => {
  it('a non-conflicting week under cap → fully_assigned, all blocks queued, no skip reason', () => {
    const result = evaluatePermanentPickup(
      makePickupInput({
        weeks: [
          makePickupWeek({
            weekStartDate: '2026-11-02',
            blocks: [makePickupBlock({ blockId: 'b1' }), makePickupBlock({ blockId: 'b2' })],
            currentWeeklyHours: 10,
            capHours: 20,
            capEnforcement: 'soft',
          }),
        ],
      }),
    );

    expect(result.weeks).toEqual([
      {
        weekStartDate: '2026-11-02',
        status: 'fully_assigned',
        assignedBlockIds: ['b1', 'b2'],
        skippedBlockIds: [],
        skipReason: null,
      },
    ]);
    expect(result.assignedBlockIds).toEqual(['b1', 'b2']);
    expect(result).toMatchObject({
      totalWeeksInScope: 1,
      weeksFullyAssigned: 1,
      weeksPartiallyAssigned: 0,
      weeksSkipped: 0,
    });
  });
});

// ---------------------------------------------------------------------
// Time conflict (§8.4.3 / ARCH §7.2 step 4b): skip the conflicting block only;
// skip the whole week only when EVERY block conflicts.
// ---------------------------------------------------------------------

describe('time-conflict handling (§8.4.3)', () => {
  it('a partially-conflicting week → only the non-conflicting blocks are picked up (partially_assigned)', () => {
    const result = evaluatePermanentPickup(
      makePickupInput({
        weeks: [
          makePickupWeek({
            weekStartDate: '2026-11-02',
            blocks: [
              makePickupBlock({ blockId: 'b-ok', conflictsWithExisting: false }),
              makePickupBlock({ blockId: 'b-conflict', conflictsWithExisting: true }),
            ],
            currentWeeklyHours: 10,
            capHours: 20,
          }),
        ],
      }),
    );

    expect(result.weeks[0]).toEqual({
      weekStartDate: '2026-11-02',
      status: 'partially_assigned',
      assignedBlockIds: ['b-ok'],
      skippedBlockIds: ['b-conflict'],
      skipReason: 'time_conflict',
    });
    expect(result.assignedBlockIds).toEqual(['b-ok']);
    expect(result).toMatchObject({ weeksPartiallyAssigned: 1 });
  });

  it('a fully-conflicting week → the entire week is skipped time_conflict', () => {
    const result = evaluatePermanentPickup(
      makePickupInput({
        weeks: [
          makePickupWeek({
            weekStartDate: '2026-11-02',
            blocks: [
              makePickupBlock({ blockId: 'b1', conflictsWithExisting: true }),
              makePickupBlock({ blockId: 'b2', conflictsWithExisting: true }),
            ],
            currentWeeklyHours: 0,
            capHours: 20,
          }),
        ],
      }),
    );

    expect(result.weeks[0]).toEqual({
      weekStartDate: '2026-11-02',
      status: 'skipped',
      assignedBlockIds: [],
      skippedBlockIds: ['b1', 'b2'],
      skipReason: 'time_conflict',
    });
    expect(result.assignedBlockIds).toEqual([]);
    expect(result).toMatchObject({ weeksSkipped: 1 });
  });
});

// ---------------------------------------------------------------------
// Hours cap (§8.4.3 / ARCH §7.2 step 4c). The crux of this phase: the SOFT cap
// ALSO skips the week — a temporary claim would warn-and-allow, but a permanent
// pickup commits many weeks at once, so soft-cap weeks are skipped, not warned.
// ---------------------------------------------------------------------

describe('hours-cap handling — soft AND hard both skip (§8.4.3)', () => {
  it('SOFT cap exceeded → the whole week is SKIPPED (not warned) — the §8.4.3 divergence from a temporary claim', () => {
    const result = evaluatePermanentPickup(
      makePickupInput({
        weeks: [
          makePickupWeek({
            weekStartDate: '2026-11-02',
            blocks: [makePickupBlock({ blockId: 'b1' })],
            currentWeeklyHours: 20, // already at the 20h soft cap…
            capHours: 20,
            capEnforcement: 'soft', // …a temporary claim would WARN; pickup SKIPS.
          }),
        ],
      }),
    );

    expect(result.weeks[0]).toEqual({
      weekStartDate: '2026-11-02',
      status: 'skipped',
      assignedBlockIds: [],
      skippedBlockIds: ['b1'],
      skipReason: 'hours_cap',
    });
    expect(result.assignedBlockIds).toEqual([]);
  });

  it('HARD cap exceeded → the whole week is skipped hours_cap', () => {
    const result = evaluatePermanentPickup(
      makePickupInput({
        weeks: [
          makePickupWeek({
            weekStartDate: '2026-11-02',
            blocks: [makePickupBlock({ blockId: 'b1' })],
            currentWeeklyHours: 40,
            capHours: 40,
            capEnforcement: 'hard',
          }),
        ],
      }),
    );

    expect(result.weeks[0]?.status).toBe('skipped');
    expect(result.weeks[0]?.skipReason).toBe('hours_cap');
    expect(result.assignedBlockIds).toEqual([]);
  });

  it('projected EXACTLY at the cap is allowed; one block over is skipped (boundary is strict >)', () => {
    const exactlyAtCap = evaluatePermanentPickup(
      makePickupInput({
        weeks: [
          makePickupWeek({
            blocks: [makePickupBlock({ blockId: 'b1' })],
            currentWeeklyHours: 19.5, // + 0.5 = 20.0, not > 20
            capHours: 20,
          }),
        ],
      }),
    );
    expect(exactlyAtCap.weeks[0]?.status).toBe('fully_assigned');
    expect(exactlyAtCap.assignedBlockIds).toEqual(['b1']);

    const oneOver = evaluatePermanentPickup(
      makePickupInput({
        weeks: [
          makePickupWeek({
            blocks: [makePickupBlock({ blockId: 'b1' })],
            currentWeeklyHours: 20, // + 0.5 = 20.5, > 20
            capHours: 20,
          }),
        ],
      }),
    );
    expect(oneOver.weeks[0]?.status).toBe('skipped');
    expect(oneOver.weeks[0]?.skipReason).toBe('hours_cap');
  });

  it('the cap is computed on the NON-conflicting remainder — removing a conflicting block can keep the week under cap', () => {
    // 2 blocks, 1 conflicts. Counting BOTH would project 19.5 + 1.0 = 20.5 (> 20,
    // a cap skip); counting only the non-conflicting block projects 20.0 (== cap,
    // allowed). The conflict check (4b) precedes the cap check (4c), so this is a
    // PARTIAL assignment for time_conflict, not a whole-week cap skip.
    const result = evaluatePermanentPickup(
      makePickupInput({
        weeks: [
          makePickupWeek({
            weekStartDate: '2026-11-02',
            blocks: [
              makePickupBlock({ blockId: 'b-ok', conflictsWithExisting: false }),
              makePickupBlock({ blockId: 'b-conflict', conflictsWithExisting: true }),
            ],
            currentWeeklyHours: 19.5,
            capHours: 20,
          }),
        ],
      }),
    );

    expect(result.weeks[0]).toEqual({
      weekStartDate: '2026-11-02',
      status: 'partially_assigned',
      assignedBlockIds: ['b-ok'],
      skippedBlockIds: ['b-conflict'],
      skipReason: 'time_conflict',
    });
  });

  it('when the non-conflicting remainder STILL exceeds the cap → the whole week is skipped hours_cap', () => {
    const result = evaluatePermanentPickup(
      makePickupInput({
        weeks: [
          makePickupWeek({
            blocks: [
              makePickupBlock({ blockId: 'b1', conflictsWithExisting: false }),
              makePickupBlock({ blockId: 'b2', conflictsWithExisting: false }),
              makePickupBlock({ blockId: 'b3', conflictsWithExisting: false }),
            ],
            currentWeeklyHours: 19, // + 1.5 = 20.5 > 20
            capHours: 20,
          }),
        ],
      }),
    );

    expect(result.weeks[0]?.status).toBe('skipped');
    expect(result.weeks[0]?.skipReason).toBe('hours_cap');
    expect(result.weeks[0]?.skippedBlockIds).toEqual(['b1', 'b2', 'b3']);
  });
});

// ---------------------------------------------------------------------
// Multi-week confirmation summary (§8.4.3 step 4 / ARCH §7.2 step 5): the popup
// shows total / fully / partial / skipped tallies, and the queued set is the
// flattened union of every week's assigned blocks.
// ---------------------------------------------------------------------

describe('multi-week confirmation summary', () => {
  it('a fully + partial + cap-skip + conflict-skip mix → correct tallies and flattened queue', () => {
    const result = evaluatePermanentPickup(
      makePickupInput({
        weeks: [
          makePickupWeek({
            weekStartDate: '2026-11-02',
            blocks: [makePickupBlock({ blockId: 'w1-b1' })],
            currentWeeklyHours: 10,
            capHours: 20,
          }),
          makePickupWeek({
            weekStartDate: '2026-11-09',
            blocks: [
              makePickupBlock({ blockId: 'w2-b1', conflictsWithExisting: false }),
              makePickupBlock({ blockId: 'w2-b2', conflictsWithExisting: true }),
            ],
            currentWeeklyHours: 10,
            capHours: 20,
          }),
          makePickupWeek({
            weekStartDate: '2026-11-16',
            blocks: [makePickupBlock({ blockId: 'w3-b1' })],
            currentWeeklyHours: 40,
            capHours: 40,
            capEnforcement: 'hard',
          }),
          makePickupWeek({
            weekStartDate: '2026-11-23',
            blocks: [makePickupBlock({ blockId: 'w4-b1', conflictsWithExisting: true })],
            currentWeeklyHours: 0,
            capHours: 20,
          }),
        ],
      }),
    );

    expect(result.weeks.map((w) => [w.weekStartDate, w.status, w.skipReason])).toEqual([
      ['2026-11-02', 'fully_assigned', null],
      ['2026-11-09', 'partially_assigned', 'time_conflict'],
      ['2026-11-16', 'skipped', 'hours_cap'],
      ['2026-11-23', 'skipped', 'time_conflict'],
    ]);
    expect(result.assignedBlockIds).toEqual(['w1-b1', 'w2-b1']);
    // The flattened skip set drives the SQL RPC's feed-removal pass: it carries
    // the partial-week conflict block (w2-b2) AND both whole-week skips (w3-b1
    // cap, w4-b1 conflict). All three must leave the permanent openings feed.
    expect(result.skippedBlockIds).toEqual(['w2-b2', 'w3-b1', 'w4-b1']);
    expect(result).toMatchObject({
      totalWeeksInScope: 4,
      weeksFullyAssigned: 1,
      weeksPartiallyAssigned: 1,
      weeksSkipped: 2,
    });
  });
});

// ---------------------------------------------------------------------
// Re-check at transaction time (§8.4.3 / ARCH §7.2 step 6). The popup snapshot
// and the submit snapshot are two separate inputs to the SAME pure evaluator. A
// week eligible in the popup but ineligible at submit (the picker gained a
// conflict, or the cap was lowered) is silently dropped from the queued set.
// ---------------------------------------------------------------------

describe('transaction-time re-check (stale-popup defense, §8.4.3)', () => {
  it('a week that GAINED a conflict between popup and submit is silently dropped from the queue', () => {
    const popupSnapshot = makePickupInput({
      weeks: [
        makePickupWeek({
          weekStartDate: '2026-11-02',
          blocks: [makePickupBlock({ blockId: 'b1', conflictsWithExisting: false })],
          currentWeeklyHours: 10,
          capHours: 20,
        }),
      ],
    });
    const popup = evaluatePermanentPickup(popupSnapshot);
    expect(popup.assignedBlockIds).toEqual(['b1']);

    // Between popup and submit the picker was assigned a conflicting shift.
    const submitSnapshot = makePickupInput({
      weeks: [
        makePickupWeek({
          weekStartDate: '2026-11-02',
          blocks: [makePickupBlock({ blockId: 'b1', conflictsWithExisting: true })],
          currentWeeklyHours: 10,
          capHours: 20,
        }),
      ],
    });
    const submit = evaluatePermanentPickup(submitSnapshot);

    expect(submit.assignedBlockIds).toEqual([]);
    expect(submit.weeks[0]?.status).toBe('skipped');
    expect(submit.weeks[0]?.skipReason).toBe('time_conflict');
  });

  it('a week whose cap was LOWERED (40h → 20h) between popup and submit is silently dropped', () => {
    const week = (capHours: number) =>
      makePickupWeek({
        weekStartDate: '2026-11-02',
        blocks: [makePickupBlock({ blockId: 'b1' })],
        currentWeeklyHours: 25, // fine under 40, over once lowered to 20
        capHours,
        capEnforcement: capHours === 40 ? 'hard' : 'soft',
      });

    const popup = evaluatePermanentPickup(makePickupInput({ weeks: [week(40)] }));
    expect(popup.assignedBlockIds).toEqual(['b1']);

    const submit = evaluatePermanentPickup(makePickupInput({ weeks: [week(20)] }));
    expect(submit.assignedBlockIds).toEqual([]);
    expect(submit.weeks[0]?.skipReason).toBe('hours_cap');
  });
});

// ---------------------------------------------------------------------
// Zero eligible weeks (§8.4.3 boundary): every week conflicts or exceeds cap.
// The pickup SUCCEEDS but affects 0 rows — the queued set is empty. (The slot is
// still removed from the permanent openings feed; that is the SQL RPC's job,
// covered in phase-10-bulk-ops.sql.)
// ---------------------------------------------------------------------

describe('zero eligible weeks (§8.4.3 boundary)', () => {
  it('all weeks conflict or exceed cap → empty queue, all weeks skipped, result still valid', () => {
    const result = evaluatePermanentPickup(
      makePickupInput({
        weeks: [
          makePickupWeek({
            weekStartDate: '2026-11-02',
            blocks: [makePickupBlock({ blockId: 'b1', conflictsWithExisting: true })],
            currentWeeklyHours: 0,
            capHours: 20,
          }),
          makePickupWeek({
            weekStartDate: '2026-11-09',
            blocks: [makePickupBlock({ blockId: 'b2' })],
            currentWeeklyHours: 20,
            capHours: 20,
            capEnforcement: 'soft',
          }),
        ],
      }),
    );

    expect(result.assignedBlockIds).toEqual([]);
    // Nothing is picked up, so every block must be re-flagged out of the
    // permanent feed (the slot leaves the feed even on a zero-assignment pickup).
    expect(result.skippedBlockIds).toEqual(['b1', 'b2']);
    expect(result).toMatchObject({
      totalWeeksInScope: 2,
      weeksFullyAssigned: 0,
      weeksPartiallyAssigned: 0,
      weeksSkipped: 2,
    });
    expect(result.weeks.map((w) => w.skipReason)).toEqual(['time_conflict', 'hours_cap']);
  });
});

// ---------------------------------------------------------------------
// Empty input — no weeks → empty result (valid; popup shows 0 of 0 weeks).
// ---------------------------------------------------------------------

describe('empty week set', () => {
  it('no weeks → empty queue and zero tallies', () => {
    const result = evaluatePermanentPickup(makePickupInput({ weeks: [] }));
    expect(result).toEqual({
      weeks: [],
      assignedBlockIds: [],
      skippedBlockIds: [],
      totalWeeksInScope: 0,
      weeksFullyAssigned: 0,
      weeksPartiallyAssigned: 0,
      weeksSkipped: 0,
    });
  });
});

// ---------------------------------------------------------------------
// Purity — same input → same output; no input mutation.
// ---------------------------------------------------------------------

describe('purity (evaluatePermanentPickup)', () => {
  it('same input → same output across repeated calls', () => {
    const input = makePickupInput({
      weeks: [
        makePickupWeek({
          blocks: [
            makePickupBlock({ blockId: 'b1' }),
            makePickupBlock({ blockId: 'b2', conflictsWithExisting: true }),
          ],
          currentWeeklyHours: 10,
          capHours: 20,
        }),
      ],
    });

    expect(evaluatePermanentPickup(input)).toEqual(evaluatePermanentPickup(input));
  });

  it('does not mutate the input', () => {
    const input = makePickupInput({
      weeks: [makePickupWeek({ blocks: [makePickupBlock({ blockId: 'b1' })] })],
    });
    const snapshot = JSON.parse(JSON.stringify(input));

    evaluatePermanentPickup(input);

    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });
});
