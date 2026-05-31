// Phase 10 — Permanent drop: slot-occurrence scoping (`scopePermanentDrop`) and
// the float-commitment UI warning (`findFloatCommitmentWarnings`).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md
//     §8.4.1 (permanent drop — bulk-vacate every occurrence of a recurring slot
//            that is FUTURE (strictly after the drop moment), within the
//            CURRENT SEMESTER's regular_school_year period, and CURRENTLY OWNED
//            by the dropping worker; mid-shift / past-this-week / not-owned /
//            embedded-break-date occurrences are excluded; the SQL backstop also
//            skips float-committed seats — no-takeback),
//     §8.4.2 (SM/HM-initiated removal — identical scope),
//     §8.4.4 (boundary cases — drop at end of semester touches only this
//            semester; drop during a short break excludes the break dates);
//   ARCHITECTURE.md §7.1
//     (the `scheduling_periods.end_date` point lookup → `semester_end_date`;
//      "if the lookup returns no row … the system must NOT silently proceed with
//      an unbounded drop … raise an application-layer error"; the bulk-update
//      predicate `block_start_at > drop_initiated_at AND block_start_at::date <=
//      semester_end_date AND oc.profile_name = 'regular_school_year' AND user_id
//      = dropping_user AND status NOT IN ('floated_out','pending_float_out')`;
//      the float-commitment warning: query pending/acknowledged floats whose
//      source-side blocks intersect the slot — FLAG them, do NOT cancel them).
//   AGENTS.md hard invariant #3 (no-takeback: a pending/acknowledged float may
//      not be revoked by an automated system — the permanent drop is one).
//
// THE MODEL (pinned in tests/PHASE_10/TEST_PLAN.md): `scopePermanentDrop` is a
// PURE partition of the dropping worker's recurring-slot occurrences into:
//   - affected: the seats the bulk UPDATE will vacate — FUTURE ∧ in-semester ∧
//     regular_school_year ∧ owned-by-dropper ∧ NOT float-committed;
//   - skipped:  every other occurrence, tagged with WHY, for the confirmation
//     popup so the worker sees the true scope before confirming.
// A single deterministic skip reason is reported per occurrence (precedence):
//     past_or_in_progress  (start <= dropInitiatedAt; strictly-future required)
//   > beyond_semester      (occurrenceDate  >  semesterEndDate; next semester)
//   > break_profile        (profile != regular_school_year; embedded break date)
//   > not_owned            (a different worker holds this week, or it is vacant)
//   > float_committed      (floated_out / pending_float_out — no-takeback)
//
// No I/O, no clock, no DB. The Edge Function snapshots the slot's occurrences +
// the semester boundary and calls this to render the popup, then hands
// `affected` to the atomic SQL RPC `permanent_drop_slot`
// (supabase/tests/phase-10-bulk-ops.sql), whose WHERE-clause is the SQL-side
// re-check of this same partition.

import { describe, expect, it } from 'vitest';

import { findFloatCommitmentWarnings, scopePermanentDrop } from '../../src/permanent-ops/index.js';

import {
  DROPPER,
  DROP_INITIATED_AT,
  OTHER_OWNER,
  SEMESTER_END_DATE,
  makeDropInput,
  makeDropOccurrence,
  makeFloatCommitment,
  plusWeeks,
  weekLabel,
} from './fixtures.js';

// ---------------------------------------------------------------------
// Core partition — future ∧ in-semester ∧ regular ∧ owned ∧ not-float =
// affected; everything else skipped with the dominant reason.
// ---------------------------------------------------------------------

describe('drop partition (§8.4.1)', () => {
  it('a typical mix → only the bulk-vacatable weeks are affected; the rest are skipped with reasons', () => {
    const past = makeDropOccurrence({
      assignmentId: 'asg-past',
      occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, -1),
      currentOwnerUserId: DROPPER,
    });
    const futureMine1 = makeDropOccurrence({
      assignmentId: 'asg-future-1',
      occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 1),
      currentOwnerUserId: DROPPER,
    });
    const futureOther = makeDropOccurrence({
      assignmentId: 'asg-future-2',
      occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 2),
      currentOwnerUserId: OTHER_OWNER,
    });
    const futureMine2 = makeDropOccurrence({
      assignmentId: 'asg-future-3',
      occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 3),
      currentOwnerUserId: DROPPER,
    });
    const futureFloated = makeDropOccurrence({
      assignmentId: 'asg-future-4',
      occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 4),
      currentOwnerUserId: DROPPER,
      floatStatus: 'floated_out',
    });

    const result = scopePermanentDrop(
      makeDropInput({
        occurrences: [past, futureMine1, futureOther, futureMine2, futureFloated],
      }),
    );

    expect(result.affected).toEqual([
      { assignmentId: 'asg-future-1', weekStartDate: futureMine1.weekStartDate },
      { assignmentId: 'asg-future-3', weekStartDate: futureMine2.weekStartDate },
    ]);
    expect(result.skipped).toEqual([
      {
        assignmentId: 'asg-past',
        weekStartDate: past.weekStartDate,
        reason: 'past_or_in_progress',
      },
      {
        assignmentId: 'asg-future-2',
        weekStartDate: futureOther.weekStartDate,
        reason: 'not_owned',
      },
      {
        assignmentId: 'asg-future-4',
        weekStartDate: futureFloated.weekStartDate,
        reason: 'float_committed',
      },
    ]);
  });

  it('every future regular owned non-float week → all affected, none skipped', () => {
    const occurrences = [1, 2, 3].map((w) =>
      makeDropOccurrence({
        assignmentId: `asg-${w}`,
        occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, w),
        currentOwnerUserId: DROPPER,
      }),
    );

    const result = scopePermanentDrop(makeDropInput({ occurrences }));

    expect(result.affected.map((a) => a.assignmentId)).toEqual(['asg-1', 'asg-2', 'asg-3']);
    expect(result.skipped).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Future boundary (§8.4.1): only occurrences STRICTLY after the drop moment
// are in scope. The occurrence currently being worked (mid-shift) starts at or
// before the drop moment → skipped (the worker finishes that shift).
// ---------------------------------------------------------------------

describe('future boundary — strictly after dropInitiatedAt (mid-shift / past)', () => {
  it('the mid-shift occurrence (starts exactly at the drop moment) is skipped past_or_in_progress', () => {
    const result = scopePermanentDrop(
      makeDropInput({
        occurrences: [
          makeDropOccurrence({
            assignmentId: 'asg-now',
            occurrenceStartAt: DROP_INITIATED_AT,
            currentOwnerUserId: DROPPER,
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('past_or_in_progress');
  });

  it('an occurrence one millisecond after the drop moment IS in scope (affected)', () => {
    const justAfter = new Date(DROP_INITIATED_AT.getTime() + 1);
    const result = scopePermanentDrop(
      makeDropInput({
        occurrences: [
          makeDropOccurrence({
            assignmentId: 'asg-just-after',
            occurrenceStartAt: justAfter,
            currentOwnerUserId: DROPPER,
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([
      { assignmentId: 'asg-just-after', weekStartDate: weekLabel(justAfter) },
    ]);
    expect(result.skipped).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Semester boundary (§8.4.1 / ARCH §7.1): the drop is scoped to the current
// semester's regular_school_year period. `semester_end_date` is the LAST
// operating date (inclusive), so an occurrence ON the boundary is affected and
// one after it is next-semester (out of scope). The boundary is FETCHED from
// `scheduling_periods.end_date` — never computed by walking dates — so the pure
// function simply receives it.
// ---------------------------------------------------------------------

describe('semester boundary — scheduling_periods.end_date (inclusive)', () => {
  it('an occurrence ON the semester end date is affected (boundary is inclusive)', () => {
    // 2026-12-11 noon EST → UTC-slice date 2026-12-11 == SEMESTER_END_DATE.
    const onBoundary = makeDropOccurrence({
      assignmentId: 'asg-boundary',
      occurrenceStartAt: new Date('2026-12-11T12:00:00-05:00'),
      currentOwnerUserId: DROPPER,
    });

    const result = scopePermanentDrop(
      makeDropInput({ semesterEndDate: SEMESTER_END_DATE, occurrences: [onBoundary] }),
    );

    expect(result.affected).toEqual([
      { assignmentId: 'asg-boundary', weekStartDate: onBoundary.weekStartDate },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('an occurrence one week into the next semester is skipped beyond_semester', () => {
    const nextSemester = makeDropOccurrence({
      assignmentId: 'asg-next-semester',
      occurrenceStartAt: new Date('2026-12-18T12:00:00-05:00'),
      currentOwnerUserId: DROPPER,
    });

    const result = scopePermanentDrop(
      makeDropInput({ semesterEndDate: SEMESTER_END_DATE, occurrences: [nextSemester] }),
    );

    expect(result.affected).toEqual([]);
    expect(result.skipped).toEqual([
      {
        assignmentId: 'asg-next-semester',
        weekStartDate: nextSemester.weekStartDate,
        reason: 'beyond_semester',
      },
    ]);
  });

  it('a fall-semester drop does NOT carry into spring: every next-semester week is skipped', () => {
    const thisSemester = makeDropOccurrence({
      assignmentId: 'asg-fall',
      occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 2),
      currentOwnerUserId: DROPPER,
    });
    const spring1 = makeDropOccurrence({
      assignmentId: 'asg-spring-1',
      occurrenceStartAt: new Date('2027-01-21T12:00:00-05:00'),
      currentOwnerUserId: DROPPER,
    });
    const spring2 = makeDropOccurrence({
      assignmentId: 'asg-spring-2',
      occurrenceStartAt: new Date('2027-01-28T12:00:00-05:00'),
      currentOwnerUserId: DROPPER,
    });

    const result = scopePermanentDrop(
      makeDropInput({
        semesterEndDate: SEMESTER_END_DATE,
        occurrences: [thisSemester, spring1, spring2],
      }),
    );

    expect(result.affected.map((a) => a.assignmentId)).toEqual(['asg-fall']);
    expect(result.skipped.map((s) => s.reason)).toEqual(['beyond_semester', 'beyond_semester']);
  });

  it('a null semester boundary is rejected — the drop must NOT silently proceed unbounded (ARCH §7.1)', () => {
    // The DB lookup found no scheduling_periods row covering the drop date; the
    // pure scope refuses rather than vacating an unbounded date range.
    expect(() =>
      scopePermanentDrop(
        makeDropInput({
          semesterEndDate: null,
          occurrences: [makeDropOccurrence({ currentOwnerUserId: DROPPER })],
        }),
      ),
    ).toThrow(/semester boundary/i);
  });
});

// ---------------------------------------------------------------------
// Break-profile exclusion (§8.4.1 / §8.4.4): short-break and winter-break dates
// embedded in the semester are claim-based and have no recurring slot, so an
// occurrence on a break date is excluded. The recurring slot RESUMES on the
// regular_school_year dates after the break.
// ---------------------------------------------------------------------

describe('embedded-break exclusion (§8.4.1)', () => {
  it('a future owned short-break occurrence is skipped break_profile, not affected', () => {
    const result = scopePermanentDrop(
      makeDropInput({
        occurrences: [
          makeDropOccurrence({
            assignmentId: 'asg-break',
            occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 5),
            currentOwnerUserId: DROPPER,
            profile: 'short_break',
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('break_profile');
  });

  it('regular weeks surrounding a Thanksgiving break are still affected (the slot resumes after the break)', () => {
    const before = makeDropOccurrence({
      assignmentId: 'asg-before-break',
      occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 1),
      currentOwnerUserId: DROPPER,
      profile: 'regular_school_year',
    });
    const theBreak = makeDropOccurrence({
      assignmentId: 'asg-the-break',
      occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 2),
      currentOwnerUserId: DROPPER,
      profile: 'short_break',
    });
    const after = makeDropOccurrence({
      assignmentId: 'asg-after-break',
      occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 3),
      currentOwnerUserId: DROPPER,
      profile: 'regular_school_year',
    });

    const result = scopePermanentDrop(makeDropInput({ occurrences: [before, theBreak, after] }));

    expect(result.affected.map((a) => a.assignmentId)).toEqual([
      'asg-before-break',
      'asg-after-break',
    ]);
    expect(result.skipped).toEqual([
      {
        assignmentId: 'asg-the-break',
        weekStartDate: theBreak.weekStartDate,
        reason: 'break_profile',
      },
    ]);
  });
});

// ---------------------------------------------------------------------
// Ownership exclusion (§8.4.1): only weeks the dropping worker CURRENTLY owns
// are vacated. A week swap-transferred or temporarily claimed away — or vacant —
// is skipped not_owned.
// ---------------------------------------------------------------------

describe('ownership exclusion (§8.4.1)', () => {
  it('a future week now owned by another worker is skipped not_owned', () => {
    const result = scopePermanentDrop(
      makeDropInput({
        occurrences: [
          makeDropOccurrence({
            assignmentId: 'asg-other',
            occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 1),
            currentOwnerUserId: OTHER_OWNER,
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('not_owned');
  });

  it('a vacant future week (no current owner) is also skipped not_owned', () => {
    const result = scopePermanentDrop(
      makeDropInput({
        occurrences: [
          makeDropOccurrence({
            assignmentId: 'asg-vacant',
            occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 1),
            currentOwnerUserId: null,
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('not_owned');
  });
});

// ---------------------------------------------------------------------
// Float-commitment preservation (§8.4.1 / invariant #3, no-takeback): a seat the
// worker is committed to float (floated_out or pending_float_out) is NOT vacated
// by the drop — the float commitment survives. Only the float status differs
// from an otherwise-affected week.
// ---------------------------------------------------------------------

describe('float-commitment preservation (no-takeback, §8.4.1)', () => {
  it('a floated_out future owned week is skipped float_committed (the commitment survives the drop)', () => {
    const result = scopePermanentDrop(
      makeDropInput({
        occurrences: [
          makeDropOccurrence({
            assignmentId: 'asg-floated',
            occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 1),
            currentOwnerUserId: DROPPER,
            floatStatus: 'floated_out',
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('float_committed');
  });

  it('a pending_float_out future owned week is likewise skipped float_committed', () => {
    const result = scopePermanentDrop(
      makeDropInput({
        occurrences: [
          makeDropOccurrence({
            assignmentId: 'asg-pending-float',
            occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 1),
            currentOwnerUserId: DROPPER,
            floatStatus: 'pending_float_out',
          }),
        ],
      }),
    );

    expect(result.affected).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('float_committed');
  });

  it('the SAME week with floatStatus none IS affected — float status is the only difference', () => {
    const result = scopePermanentDrop(
      makeDropInput({
        occurrences: [
          makeDropOccurrence({
            assignmentId: 'asg-not-floated',
            occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 1),
            currentOwnerUserId: DROPPER,
            floatStatus: 'none',
          }),
        ],
      }),
    );

    expect(result.affected.map((a) => a.assignmentId)).toEqual(['asg-not-floated']);
    expect(result.skipped).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Skip-reason precedence — when several skip conditions apply to one week the
// reported reason is deterministic:
//   past_or_in_progress > beyond_semester > break_profile > not_owned > float_committed.
// ---------------------------------------------------------------------

describe('skip-reason precedence', () => {
  it('a PAST week that another worker also owns → past_or_in_progress (out of scope before ownership matters)', () => {
    const result = scopePermanentDrop(
      makeDropInput({
        occurrences: [
          makeDropOccurrence({
            assignmentId: 'asg-past-other',
            occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, -2),
            currentOwnerUserId: OTHER_OWNER,
          }),
        ],
      }),
    );

    expect(result.skipped[0]?.reason).toBe('past_or_in_progress');
  });

  it('a next-semester week that is also a break date → beyond_semester (the harder boundary wins)', () => {
    const result = scopePermanentDrop(
      makeDropInput({
        semesterEndDate: SEMESTER_END_DATE,
        occurrences: [
          makeDropOccurrence({
            assignmentId: 'asg-next-break',
            occurrenceStartAt: new Date('2026-12-25T12:00:00-05:00'),
            currentOwnerUserId: DROPPER,
            profile: 'winter_break',
          }),
        ],
      }),
    );

    expect(result.skipped[0]?.reason).toBe('beyond_semester');
  });

  it('an in-semester break week owned by another worker → break_profile (precedes ownership)', () => {
    const result = scopePermanentDrop(
      makeDropInput({
        occurrences: [
          makeDropOccurrence({
            assignmentId: 'asg-break-other',
            occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 2),
            currentOwnerUserId: OTHER_OWNER,
            profile: 'short_break',
          }),
        ],
      }),
    );

    expect(result.skipped[0]?.reason).toBe('break_profile');
  });

  it('an in-semester break week the worker is float-committed to → break_profile (precedes float_committed)', () => {
    const result = scopePermanentDrop(
      makeDropInput({
        occurrences: [
          makeDropOccurrence({
            assignmentId: 'asg-break-floated',
            occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 2),
            currentOwnerUserId: DROPPER,
            profile: 'short_break',
            floatStatus: 'floated_out',
          }),
        ],
      }),
    );

    expect(result.skipped[0]?.reason).toBe('break_profile');
  });
});

// ---------------------------------------------------------------------
// Empty input — no occurrences → empty partition (valid; popup shows 0 weeks).
// ---------------------------------------------------------------------

describe('empty occurrence set', () => {
  it('no occurrences → affected and skipped are both empty', () => {
    const result = scopePermanentDrop(makeDropInput({ occurrences: [] }));
    expect(result).toEqual({ affected: [], skipped: [] });
  });
});

// ---------------------------------------------------------------------
// Purity — same input → same output; no input mutation.
// ---------------------------------------------------------------------

describe('purity (scopePermanentDrop)', () => {
  it('same input → same output across repeated calls', () => {
    const input = makeDropInput({
      occurrences: [
        makeDropOccurrence({
          assignmentId: 'asg-1',
          occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 1),
        }),
        makeDropOccurrence({
          assignmentId: 'asg-2',
          occurrenceStartAt: plusWeeks(DROP_INITIATED_AT, 2),
          currentOwnerUserId: OTHER_OWNER,
        }),
      ],
    });

    expect(scopePermanentDrop(input)).toEqual(scopePermanentDrop(input));
  });

  it('does not mutate the input', () => {
    const input = makeDropInput({ occurrences: [makeDropOccurrence({ assignmentId: 'asg-1' })] });
    const snapshot = JSON.parse(JSON.stringify(input));

    scopePermanentDrop(input);

    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });
});

// =====================================================================
// findFloatCommitmentWarnings — the §8.4.1 / ARCH §7.1 UI warning. Before the
// confirmation popup is rendered, the handler queries float_assignments for
// PENDING or ACKNOWLEDGED floats where the worker is the floater AND a
// source-side block intersects the slot being dropped. Those floats are FLAGGED
// in the popup ("…will NOT be cancelled…") — this function only REPORTS them;
// it never cancels (the no-takeback rule, invariant #3). The SQL backstop
// (scopePermanentDrop's float_committed skip + the RPC's status predicate) is
// the safety net; this is the UX surface.
// =====================================================================

describe('findFloatCommitmentWarnings (§8.4.1 UI warning)', () => {
  const SLOT = ['s1', 's2', 's3'];

  it('flags pending and acknowledged floats whose source side intersects the slot, in input order', () => {
    const warnings = findFloatCommitmentWarnings({
      slotAssignmentIds: SLOT,
      floatCommitments: [
        makeFloatCommitment({
          floatId: 'f-pending',
          status: 'pending',
          sourceAssignmentIds: ['s2'],
        }),
        makeFloatCommitment({
          floatId: 'f-ack',
          status: 'acknowledged',
          sourceAssignmentIds: ['x', 's3'],
        }),
      ],
    });

    expect(warnings).toEqual([
      { floatId: 'f-pending', status: 'pending' },
      { floatId: 'f-ack', status: 'acknowledged' },
    ]);
  });

  it('does NOT flag declined / voided / completed floats (only live commitments warrant a warning)', () => {
    const warnings = findFloatCommitmentWarnings({
      slotAssignmentIds: SLOT,
      floatCommitments: [
        makeFloatCommitment({
          floatId: 'f-declined',
          status: 'declined',
          sourceAssignmentIds: ['s1'],
        }),
        makeFloatCommitment({ floatId: 'f-voided', status: 'voided', sourceAssignmentIds: ['s1'] }),
        makeFloatCommitment({
          floatId: 'f-completed',
          status: 'completed',
          sourceAssignmentIds: ['s2'],
        }),
      ],
    });

    expect(warnings).toEqual([]);
  });

  it('does NOT flag a pending float whose source side does not intersect the slot', () => {
    const warnings = findFloatCommitmentWarnings({
      slotAssignmentIds: SLOT,
      floatCommitments: [
        makeFloatCommitment({
          floatId: 'f-elsewhere',
          status: 'pending',
          sourceAssignmentIds: ['z9'],
        }),
      ],
    });

    expect(warnings).toEqual([]);
  });

  it('no float commitments → no warnings (the common case)', () => {
    expect(findFloatCommitmentWarnings({ slotAssignmentIds: SLOT, floatCommitments: [] })).toEqual(
      [],
    );
  });

  it('reports — but does not cancel — the commitments (the input float refs are returned untouched)', () => {
    const floats = [
      makeFloatCommitment({ floatId: 'f-pending', status: 'pending', sourceAssignmentIds: ['s2'] }),
    ];
    const snapshot = JSON.parse(JSON.stringify(floats));

    const warnings = findFloatCommitmentWarnings({
      slotAssignmentIds: SLOT,
      floatCommitments: floats,
    });

    // The float still exists with its original status — flagged, never revoked.
    expect(warnings.map((w) => w.floatId)).toEqual(['f-pending']);
    expect(JSON.parse(JSON.stringify(floats))).toEqual(snapshot);
  });
});
