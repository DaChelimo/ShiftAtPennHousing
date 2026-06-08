// S3 — Allied "resolved" state + unresolved-only inbox: the pure inbox-filter
// predicates `isDue` / `isResolvedAllied` / `belongsInInboxView`
// (web-remediation session S3, audit #3 — reframed).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §5.4 (escalation — T-2h float-lookup failure →
//     HMOD notified that Allied coverage is required; "once Allied is assigned,
//     the gap is considered resolved"), §10.1 (HM/BM/HMOD routing), §10.3 (the
//     Allied-procurement notification content);
//   docs/design-brief.md §6.4 (the Action inbox — read/unread, urgency, grouping,
//     clean empty state);
//   docs/web-remediation/sessions/S3/TEST_PLAN.md (§4b behavior contract + pinned
//     decision D6 — this file pins §4b). Audit #18b: "due" = no schedule, or
//     scheduled at/before now.
//
// THE MODEL (TEST_PLAN D6): `packages/core/src/inbox/index.ts` is a PURE module
// (zero Supabase imports) the data layer (`apps/web/lib/data/inbox.ts`) uses to
// partition the signed-in user's notifications into the two inbox views:
//
//   type InboxView = 'default' | 'resolved';
//   type InboxFilterInput = {
//     type: string;               // notification_type value
//     scheduledForIso: string | null;
//     resolvedAtIso: string | null;
//   };
//
//   isDue(input, nowIso)            — no schedule, or scheduled at/before now
//                                     (compare as Date — offset-bearing ISO strings
//                                     do NOT compare correctly as strings).
//   isResolvedAllied(input)         — input.type === 'hmod_urgent'
//                                     && input.resolvedAtIso !== null.
//   belongsInInboxView(in, view, nowIso):
//     !isDue                  → false (future-scheduled hides in BOTH views)
//     view === 'resolved'     → isResolvedAllied(in)
//     view === 'default'      → !isResolvedAllied(in)
//
// TDD-RED: `../../src/inbox/index.js` does not exist yet (the inbox module + its
// barrel export are the implementer's deliverable). This import is the intended
// failure; the file turns GREEN when the implementer lands the module + the
// `export * from './inbox/index.js';` barrel line in packages/core/src/index.ts —
// the same red-first discipline the S2 force-trigger summary spec establishes.

import { describe, expect, it } from 'vitest';

import {
  belongsInInboxView,
  isDue,
  isResolvedAllied,
  type InboxFilterInput,
  type InboxView,
} from '../../src/inbox/index.js';

// ---------------------------------------------------------------------
// Fixtures. A fixed "now" with an explicit offset; the cross-offset cases
// deliberately express the SAME instant (or a strictly earlier/later one) in a
// DIFFERENT zone so a string comparison would get them wrong but a Date one is
// correct (the D6 "compare as Date" requirement).
// ---------------------------------------------------------------------

// 2026-06-07T12:00:00 America/New_York (EDT, -04:00) == 2026-06-07T16:00:00Z.
const NOW_ISO = '2026-06-07T12:00:00-04:00';

function input(over: Partial<InboxFilterInput> = {}): InboxFilterInput {
  return {
    type: over.type ?? 'hmod_urgent',
    scheduledForIso: over.scheduledForIso === undefined ? null : over.scheduledForIso,
    resolvedAtIso: over.resolvedAtIso === undefined ? null : over.resolvedAtIso,
  };
}

const DEFAULT: InboxView = 'default';
const RESOLVED: InboxView = 'resolved';

// =====================================================================
// isDue — the #18b due gate (§4b lines 1–2).
// =====================================================================

describe('isDue — the due gate (#18b)', () => {
  it('should treat a null scheduledFor as due', () => {
    // No future-cadence schedule → immediately due (mirrors phase-12's NULL
    // scheduled_for = immediate-delivery semantics).
    expect(isDue(input({ scheduledForIso: null }), NOW_ISO)).toBe(true);
  });

  it('should treat scheduledFor at or before now as due, and after now as not due', () => {
    // Exactly now (boundary inclusive) — expressed in UTC, the same instant as NOW_ISO.
    expect(isDue(input({ scheduledForIso: '2026-06-07T16:00:00Z' }), NOW_ISO)).toBe(true);
    // Strictly before now (an hour earlier, different offset). String-compare would
    // mis-order "…11:00:00-04:00" vs "…12:00:00-04:00" only by luck; Date is correct.
    expect(isDue(input({ scheduledForIso: '2026-06-07T11:00:00-04:00' }), NOW_ISO)).toBe(true);
    // Strictly after now (an hour later, expressed in a +01:00 zone == 13:00 EDT).
    expect(isDue(input({ scheduledForIso: '2026-06-07T18:00:00+01:00' }), NOW_ISO)).toBe(false);
  });
});

// =====================================================================
// isResolvedAllied — the resolved-Allied predicate (§4b line 3).
// =====================================================================

describe('isResolvedAllied — a resolved Allied alert', () => {
  it('should mark only hmod_urgent with a resolvedAt as a resolved Allied alert', () => {
    // hmod_urgent + a resolvedAt → resolved Allied.
    expect(
      isResolvedAllied(input({ type: 'hmod_urgent', resolvedAtIso: '2026-06-07T11:30:00-04:00' })),
    ).toBe(true);
    // hmod_urgent but unresolved → NOT a resolved Allied alert.
    expect(isResolvedAllied(input({ type: 'hmod_urgent', resolvedAtIso: null }))).toBe(false);
    // A resolvedAt on a NON-urgent type → NOT a resolved Allied alert (the column is
    // meaningful only for hmod_urgent; D1).
    expect(
      isResolvedAllied(
        input({ type: 'hm_leave_notice', resolvedAtIso: '2026-06-07T11:30:00-04:00' }),
      ),
    ).toBe(false);
  });
});

// =====================================================================
// belongsInInboxView — DEFAULT view membership (§4b lines 4–7).
// =====================================================================

describe('belongsInInboxView — default view', () => {
  it('should EXCLUDE resolved Allied alerts from the default view', () => {
    const resolvedAllied = input({
      type: 'hmod_urgent',
      resolvedAtIso: '2026-06-07T11:30:00-04:00',
      scheduledForIso: '2026-06-07T11:00:00-04:00', // due
    });
    expect(belongsInInboxView(resolvedAllied, DEFAULT, NOW_ISO)).toBe(false);
  });

  it('should INCLUDE unresolved Allied alerts in the default view', () => {
    const unresolvedAllied = input({
      type: 'hmod_urgent',
      resolvedAtIso: null,
      scheduledForIso: '2026-06-07T11:00:00-04:00', // due
    });
    expect(belongsInInboxView(unresolvedAllied, DEFAULT, NOW_ISO)).toBe(true);
  });

  it('should INCLUDE due non-urgent notifications in the default view', () => {
    const nonUrgentDue = input({
      type: 'hm_leave_notice',
      resolvedAtIso: null,
      scheduledForIso: null, // null = due
    });
    expect(belongsInInboxView(nonUrgentDue, DEFAULT, NOW_ISO)).toBe(true);
  });

  it('should EXCLUDE future-scheduled notifications from the default view (#18b)', () => {
    const futureNonUrgent = input({
      type: 'ack_reminder',
      resolvedAtIso: null,
      scheduledForIso: '2026-06-09T12:00:00-04:00', // +2d → not due
    });
    expect(belongsInInboxView(futureNonUrgent, DEFAULT, NOW_ISO)).toBe(false);
  });
});

// =====================================================================
// belongsInInboxView — RESOLVED view membership (§4b lines 8–11).
// =====================================================================

describe('belongsInInboxView — resolved view', () => {
  it('should INCLUDE resolved Allied alerts in the resolved view', () => {
    const resolvedAllied = input({
      type: 'hmod_urgent',
      resolvedAtIso: '2026-06-07T11:30:00-04:00',
      scheduledForIso: '2026-06-07T11:00:00-04:00', // due
    });
    expect(belongsInInboxView(resolvedAllied, RESOLVED, NOW_ISO)).toBe(true);
  });

  it('should EXCLUDE unresolved Allied alerts from the resolved view', () => {
    const unresolvedAllied = input({
      type: 'hmod_urgent',
      resolvedAtIso: null,
      scheduledForIso: '2026-06-07T11:00:00-04:00', // due
    });
    expect(belongsInInboxView(unresolvedAllied, RESOLVED, NOW_ISO)).toBe(false);
  });

  it('should EXCLUDE non-urgent notifications from the resolved view', () => {
    // Even a (nonsensical) resolvedAt on a non-urgent type stays out of the resolved
    // view: only hmod_urgent alerts are "Allied alerts".
    const nonUrgent = input({
      type: 'hm_leave_notice',
      resolvedAtIso: '2026-06-07T11:30:00-04:00',
      scheduledForIso: null, // due
    });
    expect(belongsInInboxView(nonUrgent, RESOLVED, NOW_ISO)).toBe(false);
  });

  it('should EXCLUDE a future-scheduled resolved alert from the resolved view (due gate applies in both views)', () => {
    const futureResolvedAllied = input({
      type: 'hmod_urgent',
      resolvedAtIso: '2026-06-07T11:30:00-04:00',
      scheduledForIso: '2026-06-09T12:00:00-04:00', // +2d → not due
    });
    expect(belongsInInboxView(futureResolvedAllied, RESOLVED, NOW_ISO)).toBe(false);
  });
});
