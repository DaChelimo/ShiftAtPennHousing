// Phase 11 — Claim-based break scheduling: the phase-boundary timing math.
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md
//     §4.4 (claim-based scheduling — "All time offsets in this section (T-14d,
//          T-3d, T-1d) are measured from the FIRST DAY of the break period. The
//          picker opens, the alert fires, and the picker closes based on the
//          break's start date — not on each individual date within the break … A
//          five-day Thanksgiving break (Wednesday–Sunday) opens its picker 14
//          days before the Wednesday, sends the T-3d alert on the Sunday before,
//          and closes the picker at the moment T-1d before the Wednesday. All
//          dates within the break share these same phase boundaries."; the T-3d
//          nag — "alerts workers who have not claimed any shifts AND have not
//          affirmatively indicated they want zero hours"; the close at the EXACT
//          T-1d moment),
//     §3.2 (cap by break: 40h hard for thanksgiving/fall/spring/winter; 20h soft
//          for spring fling);
//   ARCHITECTURE.md §2.9 (break_periods.start_date is THE anchor; the offsets
//          live on operating_profiles.claim_phase_{open,alert,close}_offset and
//          drive the durations — start_date provides the anchor; §9.3 default-cap
//          distinguishes spring fling (20 soft) from other breaks (40 hard) via
//          break_periods.break_type);
//   AGENTS.md hard invariant #6 (timestamptz in America/New_York; NEVER do
//          wall-clock arithmetic for DST-crossing intervals — use the calendar
//          day, anchored to NY-local midnight, not a fixed 24h × N duration).
//
// THE MODEL (pinned in tests/PHASE_11/TEST_PLAN.md). The break-claim timing is a
// PURE function of (break_periods.start_date, the three day-offsets). Each phase
// boundary is NY-LOCAL MIDNIGHT of (start_date − offsetDays), computed by
// CALENDAR-DAY arithmetic on the date — NOT by subtracting offsetDays × 24h from
// the start-date instant (which silently lands an hour early across a DST
// transition, invariant #6). Anchoring to start_date means every date inside the
// break shares ONE open/alert/close — the picker closes for the whole break
// simultaneously at the start-anchored T-1d.
//
//   - pre_open      now <  openAt   (T-14d): the break is not yet highlighted; no
//                                    calendar picker.
//   - claim_window  openAt ≤ now < closeAt: the calendar picker is open; shifts
//                                    are claimed via the picker, FCFS; dropped
//                                    shifts return to the calendar claim pool.
//   - open_feed     now ≥ closeAt   (T-1d, EXACT): the picker is closed for the
//                                    whole break; unclaimed shifts move to the
//                                    open-shifts feed. A claim submitted AT the
//                                    closeAt instant is already in open_feed.
//
// No I/O, no clock, no DB. The break-claim orchestrator/Edge Functions snapshot
// break_periods + the profile offsets and call these to decide which phase a
// `now` is in, whether to render the highlight, who to nag at T-3d, and which cap
// to enforce. The DB-side surface (the T-14d clearing, the calendar-pool ↔
// open-shifts-feed transition, the FCFS claim) is exercised in
// supabase/tests/phase-11-break-transitions.sql.
//
// TDD-RED: `packages/core/src/break-claim/` is not yet written; this suite (and
// the type imports below) fail at the import line until the phase-11 module
// lands — the same TDD discipline phase-06/07/08/09/10 used.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BREAK_CLAIM_OFFSETS,
  breakClaimPhaseAt,
  breakHoursCap,
  computeBreakClaimBoundaries,
  isBreakHighlighted,
  selectBreakClaimNagRecipients,
} from '../../src/break-claim/index.js';
import type {
  BreakClaimOffsets,
  BreakClaimPhaseInput,
  BreakPeriodRef,
  BreakType,
} from '../../src/break-claim/types.js';

// ---------------------------------------------------------------------
// Fixtures. Break periods are date ranges (start/end are YYYY-MM-DD, inclusive).
// The canonical break is a five-day Thanksgiving 2025-style window — Wed→Sun —
// living entirely in EST (DST ends 2026-11-01, so 2026-11-11/22/24 are all
// −05:00). Boundaries land at NY-local midnight of (start − N days).
// ---------------------------------------------------------------------

function makeBreak(opts: Partial<BreakPeriodRef> = {}): BreakPeriodRef {
  return {
    breakType: opts.breakType ?? 'thanksgiving',
    // 2026-11-25 is the Wednesday before Thanksgiving (Thu 2026-11-26).
    startDate: opts.startDate ?? '2026-11-25',
    endDate: opts.endDate ?? '2026-11-29',
  };
}

function makeInput(
  brk: Partial<BreakPeriodRef> = {},
  offsets?: BreakClaimOffsets,
): BreakClaimPhaseInput {
  const base: BreakClaimPhaseInput = { break: makeBreak(brk) };
  return offsets ? { ...base, offsets } : base;
}

// NY-local-midnight instants for the canonical Thanksgiving break. All EST.
const TG_OPEN = new Date('2026-11-11T00:00:00-05:00'); // start − 14d
const TG_ALERT = new Date('2026-11-22T00:00:00-05:00'); // start − 3d
const TG_CLOSE = new Date('2026-11-24T00:00:00-05:00'); // start − 1d

// =====================================================================
// computeBreakClaimBoundaries — the three boundaries, anchored to start_date,
// at NY-local midnight, using the default 14/3/1 day offsets.
// =====================================================================

describe('computeBreakClaimBoundaries (§4.4 — anchored to break start_date)', () => {
  it('default offsets land open/alert/close at NY-local midnight of (start − 14/3/1)', () => {
    const b = computeBreakClaimBoundaries(makeInput());

    expect(b.openAt).toEqual(TG_OPEN);
    expect(b.alertAt).toEqual(TG_ALERT);
    expect(b.closeAt).toEqual(TG_CLOSE);
  });

  it('the default offsets are 14 / 3 / 1 calendar days', () => {
    expect(DEFAULT_BREAK_CLAIM_OFFSETS).toEqual({
      openOffsetDays: 14,
      alertOffsetDays: 3,
      closeOffsetDays: 1,
    });
  });

  it('boundaries depend ONLY on start_date — a 1-day and a 5-day break with the same start share them', () => {
    const fiveDay = computeBreakClaimBoundaries(
      makeInput({ startDate: '2026-11-25', endDate: '2026-11-29' }),
    );
    const oneDay = computeBreakClaimBoundaries(
      makeInput({ startDate: '2026-11-25', endDate: '2026-11-25' }),
    );

    // Every date inside the break shares the same open/alert/close — the end
    // date never enters the computation (§4.4 "not on each individual date").
    expect(oneDay).toEqual(fiveDay);
  });

  it('is config-driven — custom offsets shift the boundaries (start − 10/5/2), not hardcoded 14/3/1', () => {
    const b = computeBreakClaimBoundaries(
      makeInput({}, { openOffsetDays: 10, alertOffsetDays: 5, closeOffsetDays: 2 }),
    );

    expect(b.openAt).toEqual(new Date('2026-11-15T00:00:00-05:00')); // 2026-11-25 − 10d
    expect(b.alertAt).toEqual(new Date('2026-11-20T00:00:00-05:00')); // − 5d
    expect(b.closeAt).toEqual(new Date('2026-11-23T00:00:00-05:00')); // − 2d
  });

  it('offsets are CALENDAR days, not business days — a Saturday-start break offsets straight across weekends', () => {
    // 2026-11-28 is a Saturday. start − 14d = 2026-11-14, itself a Saturday: the
    // offset does NOT skip to the nearest weekday.
    const b = computeBreakClaimBoundaries(
      makeInput({ startDate: '2026-11-28', endDate: '2026-11-29' }),
    );

    expect(b.openAt).toEqual(new Date('2026-11-14T00:00:00-05:00')); // Saturday, not adjusted
    expect(b.closeAt).toEqual(new Date('2026-11-27T00:00:00-05:00')); // Friday
  });
});

// =====================================================================
// DST correctness (invariant #6). A break starting the day AFTER spring-forward
// (DST begins 2026-03-08) must anchor each boundary to NY-LOCAL MIDNIGHT of the
// offset date — NOT subtract offsetDays × 24h from the start-date instant.
// =====================================================================

describe('DST: calendar-day anchoring, not fixed-duration subtraction (invariant #6)', () => {
  it('a Monday-after-spring-forward start anchors open to local midnight of (start − 14d)', () => {
    // start 2026-03-09 is EDT (−04:00); start − 14d = 2026-02-23 is EST (−05:00).
    const b = computeBreakClaimBoundaries(
      makeInput({ breakType: 'spring_break', startDate: '2026-03-09', endDate: '2026-03-13' }),
    );

    // CORRECT (calendar day → NY midnight): 2026-02-23 00:00 EST.
    expect(b.openAt).toEqual(new Date('2026-02-23T00:00:00-05:00'));
    // A fixed-duration `startMidnight − 14×24h` would land 2026-02-22T23:00−05:00
    // (an hour early, wrong calendar day) — explicitly NOT this:
    expect(b.openAt).not.toEqual(new Date('2026-02-22T23:00:00-05:00'));
  });

  it('close anchors to local midnight of the spring-forward day itself (00:00 exists; only 02:00–03:00 is skipped)', () => {
    const b = computeBreakClaimBoundaries(
      makeInput({ breakType: 'spring_break', startDate: '2026-03-09', endDate: '2026-03-13' }),
    );

    // start − 1d = 2026-03-08, the spring-forward day; its midnight is still EST.
    expect(b.closeAt).toEqual(new Date('2026-03-08T00:00:00-05:00'));
  });
});

// =====================================================================
// breakClaimPhaseAt — which phase a `now` falls in. The window is half-open:
// [openAt, closeAt). openAt is inclusive (picker opens); closeAt is EXCLUSIVE
// (the picker is already closed at the T-1d instant).
// =====================================================================

describe('breakClaimPhaseAt — half-open window [openAt, closeAt) (§4.4)', () => {
  const input = makeInput();

  it('before openAt → pre_open', () => {
    expect(breakClaimPhaseAt(input, new Date(TG_OPEN.getTime() - 1))).toBe('pre_open');
  });

  it('exactly at openAt → claim_window (the picker opens at T-14d, inclusive)', () => {
    expect(breakClaimPhaseAt(input, TG_OPEN)).toBe('claim_window');
  });

  it('at the T-3d alert moment → still claim_window (the nag does not change the phase)', () => {
    expect(breakClaimPhaseAt(input, TG_ALERT)).toBe('claim_window');
  });

  it('one millisecond before closeAt → claim_window', () => {
    expect(breakClaimPhaseAt(input, new Date(TG_CLOSE.getTime() - 1))).toBe('claim_window');
  });

  it('EXACTLY at closeAt → open_feed — a claim submitted at the T-1d instant is closed (§4.4)', () => {
    expect(breakClaimPhaseAt(input, TG_CLOSE)).toBe('open_feed');
  });

  it('after closeAt → open_feed', () => {
    expect(breakClaimPhaseAt(input, new Date(TG_CLOSE.getTime() + 1))).toBe('open_feed');
  });

  it('a moment INSIDE the break (its 3rd day) is open_feed — the whole break closed at the start-anchored T-1d', () => {
    // 2026-11-27 is the 3rd day of the break. Its OWN naive T-1d would be
    // 2026-11-26 — but the picker closed at the break-start-anchored 2026-11-24.
    expect(breakClaimPhaseAt(input, new Date('2026-11-27T12:00:00-05:00'))).toBe('open_feed');
  });
});

// =====================================================================
// isBreakHighlighted — the calendar gets a distinct background the moment the
// claim window opens (§4.4 "visually highlighted … to signal the special
// period"). It is the field the UI reads; true iff the break is no longer
// pre_open (now ≥ openAt).
// =====================================================================

describe('isBreakHighlighted (§4.4 — distinct calendar background from T-14d)', () => {
  const input = makeInput();

  it('not highlighted before openAt', () => {
    expect(isBreakHighlighted(input, new Date(TG_OPEN.getTime() - 1))).toBe(false);
  });

  it('highlighted exactly at openAt (the T-14d clearing/highlight moment)', () => {
    expect(isBreakHighlighted(input, TG_OPEN)).toBe(true);
  });

  it('stays highlighted through the claim window and after the picker closes', () => {
    expect(isBreakHighlighted(input, TG_ALERT)).toBe(true);
    expect(isBreakHighlighted(input, TG_CLOSE)).toBe(true);
    expect(isBreakHighlighted(input, new Date('2026-11-27T12:00:00-05:00'))).toBe(true);
  });
});

// =====================================================================
// selectBreakClaimNagRecipients — the T-3d nag (§4.4). Alert workers who have
// claimed NO shifts AND have not affirmatively indicated they want zero hours.
// Workers with ≥1 claim, or who opted out of break hours, are NOT nagged.
//
// This is the PURE rule; it takes `hasIndicatedZeroHours` as an already-resolved
// boolean. That flag is sourced per (break, worker) from the `break_optouts`
// table (BSpec §4.4 "Indicating zero break hours"; ARCH §2.9) — the orchestrator
// reads it via `worker_opted_out_of_break(user, break)` (pinned on the DB side in
// supabase/tests/phase-11-break-transitions.sql §J) and `hasClaimedAnyShift` from
// the worker's claimed break assignments, then calls this to pick recipients.
// =====================================================================

describe('selectBreakClaimNagRecipients (§4.4 — T-3d nag)', () => {
  it('nags only workers with zero claims who did NOT opt out of break hours', () => {
    const recipients = selectBreakClaimNagRecipients([
      { userId: 'has-a-claim', hasClaimedAnyShift: true, hasIndicatedZeroHours: false },
      { userId: 'nags-this-one', hasClaimedAnyShift: false, hasIndicatedZeroHours: false },
      { userId: 'opted-out', hasClaimedAnyShift: false, hasIndicatedZeroHours: true },
      { userId: 'claimed-and-opted-out', hasClaimedAnyShift: true, hasIndicatedZeroHours: true },
    ]);

    expect(recipients).toEqual(['nags-this-one']);
  });

  it('a worker with ≥1 claim is never nagged (§4.4)', () => {
    expect(
      selectBreakClaimNagRecipients([
        { userId: 'u', hasClaimedAnyShift: true, hasIndicatedZeroHours: false },
      ]),
    ).toEqual([]);
  });

  it('a worker who affirmatively indicated zero hours is never nagged (§4.4)', () => {
    expect(
      selectBreakClaimNagRecipients([
        { userId: 'u', hasClaimedAnyShift: false, hasIndicatedZeroHours: true },
      ]),
    ).toEqual([]);
  });

  it('preserves input order across multiple recipients', () => {
    expect(
      selectBreakClaimNagRecipients([
        { userId: 'a', hasClaimedAnyShift: false, hasIndicatedZeroHours: false },
        { userId: 'b', hasClaimedAnyShift: true, hasIndicatedZeroHours: false },
        { userId: 'c', hasClaimedAnyShift: false, hasIndicatedZeroHours: false },
      ]),
    ).toEqual(['a', 'c']);
  });

  it('no candidates → no recipients', () => {
    expect(selectBreakClaimNagRecipients([])).toEqual([]);
  });
});

// =====================================================================
// breakHoursCap — the cap is selected by break_type (§3.2 / §9.3 / ARCH §2.9):
// 40h HARD for thanksgiving, fall break, spring break, winter break; 20h SOFT
// for spring fling. ('other' is not a hard break → 20h soft, matching the
// effective_weekly_cap DB classification in batch_b.)
// =====================================================================

describe('breakHoursCap (§3.2 / §9.3 — cap distinguished by break_type)', () => {
  it.each<[BreakType, number, 'soft' | 'hard']>([
    ['thanksgiving', 40, 'hard'],
    ['fall_break', 40, 'hard'],
    ['spring_break', 40, 'hard'],
    ['winter_break', 40, 'hard'],
  ])('%s → %dh %s (hard ceiling, not overridable)', (breakType, capHours, capEnforcement) => {
    expect(breakHoursCap(breakType)).toEqual({ capHours, capEnforcement });
  });

  it('spring_fling → 20h soft (overridable)', () => {
    expect(breakHoursCap('spring_fling')).toEqual({ capHours: 20, capEnforcement: 'soft' });
  });

  it("'other' break type → 20h soft (matches the effective_weekly_cap default classification)", () => {
    expect(breakHoursCap('other')).toEqual({ capHours: 20, capEnforcement: 'soft' });
  });
});

// =====================================================================
// Purity — deterministic, no input mutation.
// =====================================================================

describe('purity', () => {
  it('computeBreakClaimBoundaries is deterministic and does not mutate its input', () => {
    const input = makeInput();
    const snapshot = JSON.parse(JSON.stringify(input));

    expect(computeBreakClaimBoundaries(input)).toEqual(computeBreakClaimBoundaries(input));
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });

  it('breakClaimPhaseAt is deterministic for a given (input, now)', () => {
    const input = makeInput();
    const now = TG_ALERT;
    expect(breakClaimPhaseAt(input, now)).toBe(breakClaimPhaseAt(input, now));
  });
});
