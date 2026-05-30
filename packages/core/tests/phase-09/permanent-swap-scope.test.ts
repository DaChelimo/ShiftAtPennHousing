// Phase 09 — Swaps: permanent shift swap week scoping (`scopePermanentSwapWeeks`).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md
//     §8.3 (permanent shift swap — on acceptance, bulk-update ALL future
//           weeks where Worker A CURRENTLY owns the slot; SKIP weeks where A
//           no longer owns it; the confirmation popup lists the skipped
//           weeks; permanent swaps apply ONLY to regular school year, not
//           break profiles),
//     §8.4.1 ("Occurrences not currently owned by the dropping worker … are
//           skipped. Only weeks where the … worker is the current owner are
//           affected." — the same ownership-boundary rule §8.3 references);
//   ARCHITECTURE.md §3.5 (permanent_swap), §8.3 / §8.4 bulk-update scope.
//
// THE MODEL (pinned in tests/PHASE_09/TEST_PLAN.md): the permanent-swap
// acceptance RPC bulk-transfers Worker A's recurring slot to Worker B. The
// pure scoping function partitions A's per-week occurrences into:
//   - affected: the weeks the RPC will transfer — FUTURE, regular school
//     year, and CURRENTLY owned by A;
//   - skipped:  every other week, tagged with WHY, for the confirmation
//     popup so both parties see the true scope before accepting.
// A week is skipped when (deterministic precedence):
//     past_occurrence  (start <= acceptedAt; strictly-future required)
//   > break_profile    (short_break / winter_break — claim-based, §8.3)
//   > not_owned_by_worker_a (A dropped it / it was swapped / claimed away)
//
// `scopePermanentSwapWeeks` is PURE: no I/O, no clock, no DB. The Edge
// Function snapshots A's recurring occurrences and the acceptance moment,
// calls this to render the popup, then hands `affected` to the atomic SQL
// bulk-update RPC (supabase/tests/phase-09-swaps.sql).

import { describe, expect, it } from 'vitest';

import { scopePermanentSwapWeeks } from '../../src/swaps/index.js';

import {
  ACCEPTED_AT,
  OTHER_OWNER,
  WORKER_A,
  makeOccurrence,
  makeScopeInput,
  plusWeeks,
  weekLabel,
} from './fixtures.js';

// ---------------------------------------------------------------------
// Core partition — future + regular + owned-by-A = affected; else skipped.
// ---------------------------------------------------------------------

describe('week partition (§8.3)', () => {
  it('a typical mix → only future, regular, A-owned weeks are affected; the rest are skipped with reasons', () => {
    const past = makeOccurrence({
      occurrenceId: 'occ-past',
      occurrenceStartAt: plusWeeks(ACCEPTED_AT, -1),
      currentOwnerUserId: WORKER_A,
    });
    const futureMine1 = makeOccurrence({
      occurrenceId: 'occ-future-1',
      occurrenceStartAt: plusWeeks(ACCEPTED_AT, 1),
      currentOwnerUserId: WORKER_A,
    });
    const futureOther = makeOccurrence({
      occurrenceId: 'occ-future-2',
      occurrenceStartAt: plusWeeks(ACCEPTED_AT, 2),
      currentOwnerUserId: OTHER_OWNER,
    });
    const futureMine2 = makeOccurrence({
      occurrenceId: 'occ-future-3',
      occurrenceStartAt: plusWeeks(ACCEPTED_AT, 3),
      currentOwnerUserId: WORKER_A,
    });
    const futureBreak = makeOccurrence({
      occurrenceId: 'occ-future-4',
      occurrenceStartAt: plusWeeks(ACCEPTED_AT, 4),
      currentOwnerUserId: WORKER_A,
      profile: 'short_break',
    });

    const result = scopePermanentSwapWeeks(
      makeScopeInput({
        occurrences: [past, futureMine1, futureOther, futureMine2, futureBreak],
      }),
    );

    expect(result.affected).toEqual([
      { occurrenceId: 'occ-future-1', weekStartDate: futureMine1.weekStartDate },
      { occurrenceId: 'occ-future-3', weekStartDate: futureMine2.weekStartDate },
    ]);
    expect(result.skipped).toEqual([
      { occurrenceId: 'occ-past', weekStartDate: past.weekStartDate, reason: 'past_occurrence' },
      {
        occurrenceId: 'occ-future-2',
        weekStartDate: futureOther.weekStartDate,
        reason: 'not_owned_by_worker_a',
      },
      {
        occurrenceId: 'occ-future-4',
        weekStartDate: futureBreak.weekStartDate,
        reason: 'break_profile',
      },
    ]);
  });

  it('all future regular weeks owned by A → every one is affected, none skipped', () => {
    const occurrences = [1, 2, 3].map((w) =>
      makeOccurrence({
        occurrenceId: `occ-${w}`,
        occurrenceStartAt: plusWeeks(ACCEPTED_AT, w),
        currentOwnerUserId: WORKER_A,
      }),
    );

    const result = scopePermanentSwapWeeks(makeScopeInput({ occurrences }));

    expect(result.affected.map((a) => a.occurrenceId)).toEqual(['occ-1', 'occ-2', 'occ-3']);
    expect(result.skipped).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Edge: A no longer owns ANY future week → the swap affects 0 weeks.
// The brief asks: is this allowed? YES — the popup simply shows 0 affected.
// ---------------------------------------------------------------------

describe('zero-week swap edge (§8.3)', () => {
  it('every future regular week was claimed/swapped away from A → 0 affected, all skipped not_owned', () => {
    const occurrences = [1, 2, 3].map((w) =>
      makeOccurrence({
        occurrenceId: `occ-${w}`,
        occurrenceStartAt: plusWeeks(ACCEPTED_AT, w),
        currentOwnerUserId: OTHER_OWNER,
      }),
    );

    const result = scopePermanentSwapWeeks(makeScopeInput({ occurrences }));

    expect(result.affected).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      'not_owned_by_worker_a',
      'not_owned_by_worker_a',
      'not_owned_by_worker_a',
    ]);
  });

  it('an unowned (vacant) future week is also skipped not_owned_by_worker_a', () => {
    const result = scopePermanentSwapWeeks(
      makeScopeInput({
        occurrences: [
          makeOccurrence({
            occurrenceId: 'occ-vacant',
            occurrenceStartAt: plusWeeks(ACCEPTED_AT, 1),
            currentOwnerUserId: null,
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([]);
    expect(result.skipped).toEqual([
      {
        occurrenceId: 'occ-vacant',
        weekStartDate: weekLabel(plusWeeks(ACCEPTED_AT, 1)),
        reason: 'not_owned_by_worker_a',
      },
    ]);
  });
});

// ---------------------------------------------------------------------
// Break-profile exclusion (§8.3): permanent swaps apply ONLY to regular
// school year. Break occurrences are claim-based and individually owned.
// ---------------------------------------------------------------------

describe('break-profile exclusion (§8.3)', () => {
  it('a future A-owned short-break week is skipped break_profile, not affected', () => {
    const result = scopePermanentSwapWeeks(
      makeScopeInput({
        occurrences: [
          makeOccurrence({
            occurrenceId: 'occ-break',
            occurrenceStartAt: plusWeeks(ACCEPTED_AT, 2),
            currentOwnerUserId: WORKER_A,
            profile: 'short_break',
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([]);
    expect(result.skipped).toEqual([
      {
        occurrenceId: 'occ-break',
        weekStartDate: weekLabel(plusWeeks(ACCEPTED_AT, 2)),
        reason: 'break_profile',
      },
    ]);
  });

  it('a future A-owned winter-break week is excluded too (only Harnwell operates; claim-based)', () => {
    const result = scopePermanentSwapWeeks(
      makeScopeInput({
        occurrences: [
          makeOccurrence({
            occurrenceId: 'occ-winter',
            occurrenceStartAt: plusWeeks(ACCEPTED_AT, 6),
            currentOwnerUserId: WORKER_A,
            profile: 'winter_break',
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('break_profile');
  });

  it('regular-school-year weeks surrounding a break are still affected (break does not split the slot)', () => {
    // §8.4.1: the recurring slot resumes for regular dates after the break.
    const before = makeOccurrence({
      occurrenceId: 'occ-before-break',
      occurrenceStartAt: plusWeeks(ACCEPTED_AT, 1),
      currentOwnerUserId: WORKER_A,
      profile: 'regular_school_year',
    });
    const theBreak = makeOccurrence({
      occurrenceId: 'occ-the-break',
      occurrenceStartAt: plusWeeks(ACCEPTED_AT, 2),
      currentOwnerUserId: WORKER_A,
      profile: 'short_break',
    });
    const after = makeOccurrence({
      occurrenceId: 'occ-after-break',
      occurrenceStartAt: plusWeeks(ACCEPTED_AT, 3),
      currentOwnerUserId: WORKER_A,
      profile: 'regular_school_year',
    });

    const result = scopePermanentSwapWeeks(
      makeScopeInput({ occurrences: [before, theBreak, after] }),
    );

    expect(result.affected.map((a) => a.occurrenceId)).toEqual([
      'occ-before-break',
      'occ-after-break',
    ]);
    expect(result.skipped).toEqual([
      {
        occurrenceId: 'occ-the-break',
        weekStartDate: theBreak.weekStartDate,
        reason: 'break_profile',
      },
    ]);
  });
});

// ---------------------------------------------------------------------
// Future boundary (§8.3): only weeks STRICTLY after the acceptance moment
// are in scope. The week whose occurrence starts exactly at acceptedAt is
// past (already begun / current), not future.
// ---------------------------------------------------------------------

describe('future boundary — strictly after acceptedAt', () => {
  it('an occurrence starting exactly at acceptedAt is skipped past_occurrence (not strictly future)', () => {
    const result = scopePermanentSwapWeeks(
      makeScopeInput({
        occurrences: [
          makeOccurrence({
            occurrenceId: 'occ-now',
            occurrenceStartAt: ACCEPTED_AT,
            currentOwnerUserId: WORKER_A,
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('past_occurrence');
  });

  it('an occurrence one millisecond after acceptedAt IS in scope (affected)', () => {
    const justAfter = new Date(ACCEPTED_AT.getTime() + 1);
    const result = scopePermanentSwapWeeks(
      makeScopeInput({
        occurrences: [
          makeOccurrence({
            occurrenceId: 'occ-just-after',
            occurrenceStartAt: justAfter,
            currentOwnerUserId: WORKER_A,
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([
      { occurrenceId: 'occ-just-after', weekStartDate: weekLabel(justAfter) },
    ]);
    expect(result.skipped).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Skip-reason precedence — when several skip reasons apply to one week, the
// reported reason is deterministic: past > break > not_owned.
// ---------------------------------------------------------------------

describe('skip-reason precedence (past > break > not_owned)', () => {
  it('a PAST week that A also no longer owns → past_occurrence (out of scope before ownership matters)', () => {
    const result = scopePermanentSwapWeeks(
      makeScopeInput({
        occurrences: [
          makeOccurrence({
            occurrenceId: 'occ-past-other',
            occurrenceStartAt: plusWeeks(ACCEPTED_AT, -2),
            currentOwnerUserId: OTHER_OWNER,
          }),
        ],
      }),
    );

    expect(result.skipped).toEqual([
      {
        occurrenceId: 'occ-past-other',
        weekStartDate: weekLabel(plusWeeks(ACCEPTED_AT, -2)),
        reason: 'past_occurrence',
      },
    ]);
  });

  it('a FUTURE break week that A also no longer owns → break_profile (precedes ownership)', () => {
    const result = scopePermanentSwapWeeks(
      makeScopeInput({
        occurrences: [
          makeOccurrence({
            occurrenceId: 'occ-break-other',
            occurrenceStartAt: plusWeeks(ACCEPTED_AT, 2),
            currentOwnerUserId: OTHER_OWNER,
            profile: 'short_break',
          }),
        ],
      }),
    );

    expect(result.skipped[0]?.reason).toBe('break_profile');
  });
});

// ---------------------------------------------------------------------
// Worker-A identity drives ownership (not the counterparty / acceptor).
// ---------------------------------------------------------------------

describe('ownership is evaluated against Worker A (the initiator)', () => {
  it('weeks owned by Worker B (the counterparty) are skipped not_owned_by_worker_a', () => {
    // The swap transfers A's slot to B. A week B already owns is not part of
    // A's slot to give — it is skipped, not affected.
    const result = scopePermanentSwapWeeks(
      makeScopeInput({
        workerAUserId: WORKER_A,
        occurrences: [
          makeOccurrence({
            occurrenceId: 'occ-b-owns',
            occurrenceStartAt: plusWeeks(ACCEPTED_AT, 1),
            currentOwnerUserId: 'user-b',
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('not_owned_by_worker_a');
  });
});

// ---------------------------------------------------------------------
// Empty input — no occurrences → empty scope (valid; popup shows 0/0).
// ---------------------------------------------------------------------

describe('empty occurrence set', () => {
  it('no occurrences → affected and skipped are both empty', () => {
    const result = scopePermanentSwapWeeks(makeScopeInput({ occurrences: [] }));
    expect(result).toEqual({ affected: [], skipped: [] });
  });
});

// ---------------------------------------------------------------------
// Purity — same input → same output; no input mutation.
// ---------------------------------------------------------------------

describe('purity', () => {
  it('same input → same output across repeated calls', () => {
    const input = makeScopeInput({
      occurrences: [
        makeOccurrence({ occurrenceId: 'occ-1', occurrenceStartAt: plusWeeks(ACCEPTED_AT, 1) }),
        makeOccurrence({
          occurrenceId: 'occ-2',
          occurrenceStartAt: plusWeeks(ACCEPTED_AT, 2),
          currentOwnerUserId: OTHER_OWNER,
        }),
      ],
    });

    expect(scopePermanentSwapWeeks(input)).toEqual(scopePermanentSwapWeeks(input));
  });

  it('does not mutate the input', () => {
    const input = makeScopeInput({
      occurrences: [makeOccurrence({ occurrenceId: 'occ-1' })],
    });
    const snapshot = JSON.parse(JSON.stringify(input));

    scopePermanentSwapWeeks(input);

    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });
});
