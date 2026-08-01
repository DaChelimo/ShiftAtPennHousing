// Allied coverage-request lifecycle — the pure state machine that replaced
// archive-on-window-end.
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION §5.4 / §10.1; ARCHITECTURE §4.2 / §4.6.
//   Plan: docs/allied-coverage-alerting/PLAN.md
//   Migration: supabase/migrations/20260729000010_allied_coverage_ladder.sql
//
// THE BUG THIS SUITE EXISTS TO PREVENT
// ------------------------------------
// The predecessor, `alliedLifecycle` in ../../src/inbox/index.ts, archived an Allied
// alert once its coverage window ended "resolved or NOT", then DISCARDED it 24 hours
// later. A desk that genuinely went unstaffed therefore produced a clean-looking inbox
// the next morning and left no record anywhere.
//
// The first test below pins the new rule and, in the same breath, demonstrates the old
// one still classifying that exact situation as 'discarded'. If someone ever
// reintroduces auto-clearing, the first assertion fails.

import { describe, expect, it } from 'vitest';

import {
  alliedLifecycle,
  coverageRequestState,
  coverageSortKey,
  isActionRequired,
  isMissedCoverageIncident,
  outcomeLabel,
  requiresCloseNote,
  rungDeadlineIso,
  rungLabel,
  type CoverageRequestInput,
} from '../../src/index.js';

const NOW = '2026-07-29T20:00:00.000Z';

function req(over: Partial<CoverageRequestInput> = {}): CoverageRequestInput {
  return {
    windowStartIso: '2026-07-29T22:00:00.000Z',
    windowEndIso: '2026-07-29T23:00:00.000Z',
    acknowledgedAtIso: null,
    closedAtIso: null,
    outcome: null,
    currentRung: 'rsm',
    rungFiredAtIso: '2026-07-29T19:30:00.000Z',
    ...over,
  };
}

describe('an open request never auto-clears', () => {
  it('is still overdue and action-required three days after its window ended', () => {
    // The window ended on the 29th; it is now the 1st. Nobody ever closed it.
    const stale = req({
      windowStartIso: '2026-07-29T22:00:00.000Z',
      windowEndIso: '2026-07-29T23:00:00.000Z',
    });
    const threeDaysLater = '2026-08-01T23:00:00.000Z';

    expect(coverageRequestState(stale, threeDaysLater)).toBe('overdue');
    expect(isActionRequired(stale, threeDaysLater)).toBe(true);
    expect(isMissedCoverageIncident(stale, threeDaysLater)).toBe(true);

    // ...and this is what the predecessor did with the very same situation. Kept as a
    // live demonstration that the old model dropped it on the floor, not as an
    // endorsement of that behavior.
    expect(
      alliedLifecycle(
        {
          type: 'hmod_urgent',
          scheduledForIso: null,
          resolvedAtIso: null,
          blockStartIso: '2026-07-29T22:00:00.000Z',
          blockEndIso: '2026-07-29T23:00:00.000Z',
        },
        threeDaysLater,
      ),
    ).toBe('discarded');
  });

  it('an ACKNOWLEDGED request whose window elapsed is still overdue, not finished', () => {
    // Somebody said "I am handling this" and then never recorded what happened. That
    // is the case most likely to be quietly lost, so it must stay visible.
    const acked = req({ acknowledgedAtIso: '2026-07-29T20:05:00.000Z' });
    expect(coverageRequestState(acked, '2026-07-30T02:00:00.000Z')).toBe('overdue');
    expect(isMissedCoverageIncident(acked, '2026-07-30T02:00:00.000Z')).toBe(true);
  });
});

describe('coverageRequestState', () => {
  it('starts at awaiting_ack', () => {
    expect(coverageRequestState(req(), NOW)).toBe('awaiting_ack');
  });

  it('moves to acknowledged while the window is still ahead', () => {
    expect(coverageRequestState(req({ acknowledgedAtIso: '2026-07-29T20:01:00.000Z' }), NOW)).toBe(
      'acknowledged',
    );
  });

  it('closed wins over everything, including a long-past window', () => {
    const closed = req({
      closedAtIso: '2026-07-29T22:30:00.000Z',
      outcome: 'allied_secured',
    });
    expect(coverageRequestState(closed, '2026-09-01T00:00:00.000Z')).toBe('closed');
    expect(isActionRequired(closed, '2026-09-01T00:00:00.000Z')).toBe(false);
  });

  it('flips to overdue exactly at the window end, not a moment later', () => {
    expect(coverageRequestState(req(), '2026-07-29T22:59:59.999Z')).toBe('awaiting_ack');
    expect(coverageRequestState(req(), '2026-07-29T23:00:00.000Z')).toBe('overdue');
  });

  it('compares as dates, so a mixed-offset timestamp still orders correctly', () => {
    // 19:00-04:00 is 23:00Z: the same instant as the window end, expressed differently.
    // A lexical string compare would get this wrong.
    expect(coverageRequestState(req(), '2026-07-29T19:00:00.000-04:00')).toBe('overdue');
  });
});

describe('isMissedCoverageIncident', () => {
  it('counts a desk that went unstaffed', () => {
    const closed = req({
      closedAtIso: '2026-07-29T23:30:00.000Z',
      outcome: 'desk_unstaffed',
    });
    expect(isMissedCoverageIncident(closed, '2026-07-30T00:00:00.000Z')).toBe(true);
  });

  it('does not count a request that was closed as covered', () => {
    for (const outcome of ['allied_secured', 'covered_internally', 'no_longer_needed'] as const) {
      const closed = req({ closedAtIso: '2026-07-29T23:30:00.000Z', outcome });
      expect(isMissedCoverageIncident(closed, '2026-07-30T00:00:00.000Z')).toBe(false);
    }
  });

  it('does not count a request still inside its window', () => {
    expect(isMissedCoverageIncident(req(), NOW)).toBe(false);
  });
});

describe('rungDeadlineIso', () => {
  it('counts down from when the current rung fired', () => {
    expect(rungDeadlineIso(req(), 60)).toBe('2026-07-29T20:30:00.000Z');
  });

  it('respects a shorter configured timeout', () => {
    expect(rungDeadlineIso(req(), 20)).toBe('2026-07-29T19:50:00.000Z');
  });

  it('is null on the terminal rung: there is nobody above the HMOD', () => {
    expect(rungDeadlineIso(req({ currentRung: 'hmod' }), 60)).toBeNull();
    expect(rungDeadlineIso(req({ currentRung: 'admin' }), 60)).toBeNull();
  });

  it('is null once acknowledged or closed: the ladder has stopped', () => {
    expect(rungDeadlineIso(req({ acknowledgedAtIso: NOW }), 60)).toBeNull();
    expect(rungDeadlineIso(req({ closedAtIso: NOW, outcome: 'allied_secured' }), 60)).toBeNull();
  });
});

describe('coverageSortKey', () => {
  it('puts overdue requests ahead of every upcoming one', () => {
    const overdue = req({
      windowStartIso: '2026-07-29T18:00:00.000Z',
      windowEndIso: '2026-07-29T19:00:00.000Z',
    });
    const upcoming = req();
    expect(coverageSortKey(overdue, NOW)).toBeLessThan(coverageSortKey(upcoming, NOW));
  });

  it('orders upcoming requests soonest-window first', () => {
    const soon = req({ windowStartIso: '2026-07-29T21:00:00.000Z' });
    const later = req({ windowStartIso: '2026-07-29T23:30:00.000Z' });
    expect(coverageSortKey(soon, NOW)).toBeLessThan(coverageSortKey(later, NOW));
  });
});

describe('labels and close-note rule', () => {
  it('requires a note only for desk_unstaffed, matching the RPC guard', () => {
    expect(requiresCloseNote('desk_unstaffed')).toBe(true);
    expect(requiresCloseNote('allied_secured')).toBe(false);
    expect(requiresCloseNote('covered_internally')).toBe(false);
    expect(requiresCloseNote('no_longer_needed')).toBe(false);
  });

  it('spells the rungs out for managers, not as role codes', () => {
    expect(rungLabel('rsm')).toBe('Residential Services Manager');
    expect(rungLabel('hmod')).toBe('Housing Manager on duty');
  });

  it('has user-facing labels free of em dashes and en dashes', () => {
    const all = [
      rungLabel('rsm'),
      rungLabel('hm'),
      rungLabel('hmod'),
      rungLabel('admin'),
      outcomeLabel('allied_secured'),
      outcomeLabel('covered_internally'),
      outcomeLabel('desk_unstaffed'),
      outcomeLabel('no_longer_needed'),
    ];
    for (const label of all) {
      expect(label).not.toMatch(/[–—]/);
    }
  });
});
