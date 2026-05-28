// Phase 07 — Notification routing: HM vs HMOD recipient resolver.
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §10.1 (HM working hours rule —
//                                       Monday-Friday [08:00, 17:00)),
//                               §10.2 (specific routing cases — four
//                                       worked examples);
//   ARCHITECTURE.md §4.6 (notification routing logic — explicit
//                          inclusivity at 08:00, exclusivity at 17:00).
//
// Pinned decisions exercised (see tests/PHASE_07/TEST_PLAN.md):
//   #9  — HM hours [08:00, 17:00) — boundary semantics
//   #10 — All three conjuncts (now in HM hours, block in HM hours,
//          block date is weekday) must hold for HM. Both `now` and
//          `blockStartAt` are evaluated against the NY-local clock.
//
// The function under test (TDD — not yet implemented):
//
//   packages/core/src/orchestrator/routing.ts
//     export function resolveNotificationRecipient(
//       input: { now: Date; blockStartAt: Date }
//     ): 'hm' | 'hmod'
//
// All time arithmetic is in America/New_York per AGENTS hard invariant #6.

import { describe, expect, it } from 'vitest';

import { resolveNotificationRecipient } from '../../src/orchestrator/routing.js';

import {
  fridayAt,
  makeRoutingInput,
  mondayAt,
  plusMinutes,
  plusMilliseconds,
  saturdayAt,
  sundayAt,
  thursdayAt,
  tuesdayAt,
  wednesdayAt,
} from './fixtures.js';

// ---------------------------------------------------------------------
// 1. Both `now` and `blockStartAt` within HM hours on a weekday → HM
// ---------------------------------------------------------------------

describe('both now and blockStartAt within HM hours on a weekday → HM (pinned #9, #10)', () => {
  it('Thursday now=10:00, block=14:00 → HM (both Thu, both in HM hours)', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(thursdayAt(10, 0), thursdayAt(14, 0)),
    );

    expect(recipient).toBe('hm');
  });

  it('Monday now=09:00, block=12:00 → HM', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(mondayAt(9, 0), mondayAt(12, 0)),
    );

    expect(recipient).toBe('hm');
  });

  it('Friday now=15:30, block=16:30 (last HM half-hour) → HM', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(fridayAt(15, 30), fridayAt(16, 30)),
    );

    expect(recipient).toBe('hm');
  });

  it('Wednesday now=13:00, block=Thursday 12:00 (same HM hours, different dates) → HM', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(wednesdayAt(13, 0), thursdayAt(12, 0)),
    );

    expect(recipient).toBe('hm');
  });
});

// ---------------------------------------------------------------------
// 2. Boundary at exactly 08:00 — inclusive (pinned #9)
// ---------------------------------------------------------------------

describe('boundary at exactly 08:00 — inclusive (pinned #9)', () => {
  it('Thursday now=08:00:00.000 EDT, block=12:00 → HM (08:00 is inclusive)', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(thursdayAt(8, 0), thursdayAt(12, 0)),
    );

    expect(recipient).toBe('hm');
  });

  it('Thursday now=10:00, block=08:00 (block start at HM lower bound) → HM', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(thursdayAt(10, 0), thursdayAt(8, 0)),
    );

    expect(recipient).toBe('hm');
  });

  it('Thursday now=07:59:59.999 EDT, block=12:00 → HMOD (1ms before 08:00)', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(plusMilliseconds(thursdayAt(8, 0), -1), thursdayAt(12, 0)),
    );

    expect(recipient).toBe('hmod');
  });
});

// ---------------------------------------------------------------------
// 3. Boundary at exactly 17:00 — exclusive (pinned #9)
// ---------------------------------------------------------------------

describe('boundary at exactly 17:00 — exclusive (pinned #9)', () => {
  it('Thursday now=17:00:00.000 EDT, block=12:00 → HMOD (17:00 is exclusive of HM)', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(thursdayAt(17, 0), thursdayAt(12, 0)),
    );

    expect(recipient).toBe('hmod');
  });

  it('Thursday now=10:00, block=17:00 (block start at HM upper bound) → HMOD', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(thursdayAt(10, 0), thursdayAt(17, 0)),
    );

    expect(recipient).toBe('hmod');
  });

  it('Thursday now=16:59:59.999 EDT, block=12:00 → HM (1ms before 17:00)', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(plusMilliseconds(thursdayAt(17, 0), -1), thursdayAt(12, 0)),
    );

    expect(recipient).toBe('hm');
  });

  it('Thursday now=10:00, block=16:30 (last HM-eligible block start) → HM', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(thursdayAt(10, 0), thursdayAt(16, 30)),
    );

    expect(recipient).toBe('hm');
  });
});

// ---------------------------------------------------------------------
// 4. Weekend → HMOD regardless of hour (pinned #10)
// ---------------------------------------------------------------------

describe('weekend → HMOD regardless (pinned #10)', () => {
  it('Saturday now=12:00, block=Saturday 14:00 → HMOD', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(saturdayAt(12, 0), saturdayAt(14, 0)),
    );

    expect(recipient).toBe('hmod');
  });

  it('Sunday now=12:00, block=Sunday 14:00 → HMOD', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(sundayAt(12, 0), sundayAt(14, 0)),
    );

    expect(recipient).toBe('hmod');
  });

  it('Saturday now=12:00, block=Monday 12:00 → HMOD (now is weekend)', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(saturdayAt(12, 0), mondayAt(12, 0)),
    );

    expect(recipient).toBe('hmod');
  });

  it('Friday now=17:30 (after HM hours), block=Monday 09:00 (HM hours weekday) → HMOD', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(fridayAt(17, 30), mondayAt(9, 0)),
    );

    expect(recipient).toBe('hmod');
  });
});

// ---------------------------------------------------------------------
// 5. §10.2 worked examples — verbatim from the spec
// ---------------------------------------------------------------------

describe('§10.2 worked examples', () => {
  it('Tuesday 23:00 drop, Wednesday 08:00 block — T-2h = 06:00 Wed (HMOD time)', () => {
    // Spec: "A drop happens at 23:00 on a Tuesday for a shift starting
    // Wednesday at 08:00. The shift starts at the boundary of the HM's
    // working day. T-2 (escalation point) is 06:00 Wednesday, which is
    // HMOD time. The HMOD is notified for Allied procurement in real-time."
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(wednesdayAt(6, 0), wednesdayAt(8, 0)),
    );

    expect(recipient).toBe('hmod');
  });

  it('Tuesday 23:00 drop, Wednesday 15:00 block — T-2h = 13:00 Wed (HM time)', () => {
    // Spec: "A drop happens at 23:00 on a Tuesday for a shift starting
    // Wednesday at 15:00. T-2 is 13:00 Wednesday, which is HM working
    // hours. If float lookup fails, the HM receives a real-time
    // notification at 13:00 Wednesday for Allied procurement."
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(wednesdayAt(13, 0), wednesdayAt(15, 0)),
    );

    expect(recipient).toBe('hm');
  });

  it('Wednesday 14:00 drop, Wednesday 22:00 block — T-2h = 20:00 Wed (HMOD time)', () => {
    // Spec: "A drop happens at 14:00 on a Wednesday for a shift starting
    // that evening at 22:00. T-2 is 20:00 Wednesday, which is outside
    // HM working hours. The HMOD receives the escalation notification
    // in real-time."
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(wednesdayAt(20, 0), wednesdayAt(22, 0)),
    );

    expect(recipient).toBe('hmod');
  });

  it('Saturday 15:00 drop, Sunday 14:00 block — HMOD handles in real-time', () => {
    // Spec: "A drop happens at 15:00 on a Saturday for a shift starting
    // Sunday at 14:00. HMs do not work weekends. The HMOD handles this
    // event from the moment of the drop through the entire escalation,
    // in real-time."
    // Routing at the moment of T-2h evaluation (12:00 Sunday): both
    // current time and block date are on the weekend → HMOD.
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(sundayAt(12, 0), sundayAt(14, 0)),
    );

    expect(recipient).toBe('hmod');
  });
});

// ---------------------------------------------------------------------
// 6. Mixed-conjunct cases (any single conjunct failing → HMOD)
// ---------------------------------------------------------------------

describe('mixed-conjunct cases — any single conjunct failing → HMOD (pinned #10)', () => {
  it('now in HM hours weekday, block outside HM hours (18:00) → HMOD', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(thursdayAt(12, 0), thursdayAt(18, 0)),
    );

    expect(recipient).toBe('hmod');
  });

  it('now in HM hours weekday, block exactly at 12:00 weekday → HM (both inside)', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(thursdayAt(12, 0), thursdayAt(12, 0)),
    );

    expect(recipient).toBe('hm');
  });

  it('now = 00:00 weekday (midnight), block = 09:00 weekday → HMOD (now outside HM)', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(thursdayAt(0, 0), thursdayAt(9, 0)),
    );

    expect(recipient).toBe('hmod');
  });

  it('now = 12:00 Saturday, block = 12:00 Saturday → HMOD', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(saturdayAt(12, 0), saturdayAt(12, 0)),
    );

    expect(recipient).toBe('hmod');
  });

  it('now = 12:00 weekday, block = 12:00 Saturday → HMOD (block date weekend)', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(fridayAt(12, 0), saturdayAt(12, 0)),
    );

    expect(recipient).toBe('hmod');
  });

  it('now = 12:00 Monday, block = 23:00 Monday (block outside HM hours) → HMOD', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(mondayAt(12, 0), mondayAt(23, 0)),
    );

    expect(recipient).toBe('hmod');
  });
});

// ---------------------------------------------------------------------
// 7. Tuesday-specific (mid-week, fully inside HM hours)
// ---------------------------------------------------------------------

describe('Tuesday — fully inside HM hours', () => {
  it('Tuesday now=09:00, block=14:00 → HM', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(tuesdayAt(9, 0), tuesdayAt(14, 0)),
    );

    expect(recipient).toBe('hm');
  });
});

// ---------------------------------------------------------------------
// 8. Per-minute granularity — within HM window
// ---------------------------------------------------------------------

describe('per-minute granularity', () => {
  it('Thursday now=08:01, block=08:30 → HM', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(thursdayAt(8, 1), thursdayAt(8, 30)),
    );

    expect(recipient).toBe('hm');
  });

  it('Thursday now=16:59, block=17:30 → HMOD (block at 17:30 outside HM)', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(thursdayAt(16, 59), thursdayAt(17, 30)),
    );

    expect(recipient).toBe('hmod');
  });

  it('Thursday now=08:00, block=plusMinutes(08:00, 30) = 08:30 → HM', () => {
    const recipient = resolveNotificationRecipient(
      makeRoutingInput(thursdayAt(8, 0), plusMinutes(thursdayAt(8, 0), 30)),
    );

    expect(recipient).toBe('hm');
  });
});
