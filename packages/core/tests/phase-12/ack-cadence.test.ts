// Phase 12 — Notification system: the acknowledgment-cadence timing math (the
// PURE surface). Cadence-offset computation, the snapshot taken at float-assign
// time, the skip-past-offsets rule for short-lead floats, and the
// already-acknowledged suppression predicate.
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md
//     §7.1 (the acknowledgment cadence — "the worker must acknowledge or decline
//          the float by the acknowledgment deadline, which is 10 minutes before
//          the float start time … All reminder offsets are measured from this
//          T-10m deadline"; reminders fire at "6 hours, 2 hours, 1 hour, 30
//          minutes, and 5 minutes before the deadline"; the 6h and 2h reminders
//          are per-house configurable and may be disabled, the 1h/30m/5m are
//          MANDATORY and not modifiable; "Changes to these offsets take effect for
//          float assignments created after the change; existing float assignments
//          retain the cadence that was in effect when they were assigned"; "If the
//          float was assigned with less than 6 hours of lead time before the
//          deadline, the cadence starts at whichever interval is next reached. For
//          a float assigned exactly at T-2h, only the 1h, 30m, and 5m reminders
//          fire"),
//     §7.2 / §7.3 (a float that is declined/voided/no-acked is no longer pending —
//          an in-flight ack reminder must not be delivered for it);
//   ARCHITECTURE.md
//     §2.8 (ack_cadence_config — the 6h/2h offsets are per-house; null = system
//          default of -6h/-2h before the deadline; "disabled" = suppressed; the
//          1h/30m/5m reminders are mandatory and not stored here),
//     §2.8 "Snapshot at assignment time" ("When a float is assigned, the effective
//          cadence offsets … are snapshotted onto the scheduled notification rows
//          at that moment. The notification scheduler delivers reminders based on
//          the snapshotted values, not by re-querying ack_cadence_config at
//          delivery time. This ensures that a cadence change does not affect float
//          assignments that have already been created"),
//     §3.7 (notifications.scheduled_for is the future-cadence delivery instant;
//          ack reminders are scheduled at float-assign time).
//
// THE MODEL (pinned in tests/PHASE_12/TEST_PLAN.md). The ack cadence is a PURE
// function of (the ack deadline, the assignment instant `now`, and the SNAPSHOT of
// the per-house 6h/2h config taken at assignment time). Each reminder is scheduled
// at `ackDeadline − offset`. The snapshot — not the live config — is what the
// schedule is computed from; this is the load-bearing decoupling that makes a
// later ack_cadence_config change a no-op for in-flight floats. Reminders whose
// scheduled instant is already at-or-before `now` are skipped (a float assigned
// inside the 6h window simply starts from the next future offset). All arithmetic
// is plain duration arithmetic on instants — offsets are measured-before-deadline
// durations, so a DST boundary in the interval is handled by the instant itself
// (no wall-clock enumeration; invariant #6 is about calendar-day anchoring, which
// does not apply to a fixed-duration "N minutes before").
//
// No I/O, no clock, no DB. The float-assignment Edge Function / orchestrator
// snapshots the ack_cadence_config row and calls these to write the scheduled
// notification rows; the delivery scheduler (pgTAP surface) reads scheduled_for.
// The DB-side surface (push_tokens, the delivery-queue query, dispatch targets,
// the HM-leave mailto) is exercised in supabase/tests/phase-12-notifications.sql.
//
// TDD-RED: `packages/core/src/notifications/` is not yet written; this suite (and
// the type imports below) fail at the import line until the phase-12 module lands
// — the same TDD discipline phase-06/07/08/09/10/11 used.

import { describe, expect, it } from 'vitest';

import {
  ACK_DEADLINE_LEAD_MINUTES,
  DEFAULT_ACK_CADENCE_CONFIG,
  DEFAULT_CONFIGURABLE_ACK_OFFSETS_MINUTES,
  MANDATORY_ACK_OFFSETS_MINUTES,
  ackDeadlineFromFloatStart,
  computeAckReminderSchedule,
  shouldSuppressAckReminder,
  snapshotAckCadence,
} from '../../src/notifications/index.js';
import type {
  AckCadenceConfig,
  AckCadenceSnapshot,
  FloatAckState,
} from '../../src/notifications/types.js';

// ---------------------------------------------------------------------
// Fixtures. A canonical float starting 2026-02-10 20:00 EST (a regular school day,
// fully inside EST so the instants read cleanly). The ack deadline is T-10m before
// the start = 19:50. Reminder instants for the five default offsets follow.
// ---------------------------------------------------------------------

const FLOAT_START = new Date('2026-02-10T20:00:00-05:00');
const ACK_DEADLINE = new Date('2026-02-10T19:50:00-05:00'); // start − 10m

// ackDeadline − {6h, 2h, 1h, 30m, 5m}
const R_6H = new Date('2026-02-10T13:50:00-05:00');
const R_2H = new Date('2026-02-10T17:50:00-05:00');
const R_1H = new Date('2026-02-10T18:50:00-05:00');
const R_30M = new Date('2026-02-10T19:20:00-05:00');
const R_5M = new Date('2026-02-10T19:45:00-05:00');

const MINUTE = 60_000;

function makeConfig(overrides: Partial<AckCadenceConfig> = {}): AckCadenceConfig {
  return { ...DEFAULT_ACK_CADENCE_CONFIG, ...overrides };
}

function instantsOf(slots: { scheduledFor: Date }[]): number[] {
  return slots.map((s) => s.scheduledFor.getTime());
}

// =====================================================================
// Constants & the deadline derivation.
// =====================================================================

describe('cadence constants & ack-deadline derivation (§7.1, ARCH §2.8)', () => {
  it('the ack deadline is 10 minutes before float start', () => {
    expect(ACK_DEADLINE_LEAD_MINUTES).toBe(10);
    expect(ackDeadlineFromFloatStart(FLOAT_START)).toEqual(ACK_DEADLINE);
  });

  it('the mandatory offsets are exactly 1h / 30m / 5m before the deadline', () => {
    // Order is largest-first (earliest-fired first); these three are not configurable.
    expect(MANDATORY_ACK_OFFSETS_MINUTES).toEqual([60, 30, 5]);
  });

  it('the configurable defaults are 6h / 2h before the deadline', () => {
    expect(DEFAULT_CONFIGURABLE_ACK_OFFSETS_MINUTES).toEqual({
      sixHourMinutes: 360,
      twoHourMinutes: 120,
    });
  });

  it('the default cadence config enables both 6h and 2h at the system default offset (null)', () => {
    expect(DEFAULT_ACK_CADENCE_CONFIG).toEqual({
      reminder6hEnabled: true,
      reminder6hOffsetMinutes: null,
      reminder2hEnabled: true,
      reminder2hOffsetMinutes: null,
    });
  });
});

// =====================================================================
// snapshotAckCadence — resolve the per-house config into the concrete, frozen set
// of offsets the float carries for its lifetime. The mandatory three are ALWAYS
// present; the 6h/2h are present iff enabled, at their configured (or default)
// offset. This is the value snapshotted onto the notification rows (ARCH §2.8).
// =====================================================================

describe('snapshotAckCadence — resolve config to frozen offsets (ARCH §2.8)', () => {
  it('the default config snapshots all five offsets, largest-first', () => {
    const snap = snapshotAckCadence(DEFAULT_ACK_CADENCE_CONFIG);
    expect(snap.offsets.map((o) => o.minutesBeforeDeadline)).toEqual([360, 120, 60, 30, 5]);
  });

  it('flags the 6h and 2h as configurable and the 1h/30m/5m as mandatory', () => {
    const snap = snapshotAckCadence(DEFAULT_ACK_CADENCE_CONFIG);
    const byMin = new Map(snap.offsets.map((o) => [o.minutesBeforeDeadline, o.mandatory]));
    expect(byMin.get(360)).toBe(false);
    expect(byMin.get(120)).toBe(false);
    expect(byMin.get(60)).toBe(true);
    expect(byMin.get(30)).toBe(true);
    expect(byMin.get(5)).toBe(true);
  });

  it('disabling the 6h reminder drops only the 6h offset', () => {
    const snap = snapshotAckCadence(makeConfig({ reminder6hEnabled: false }));
    expect(snap.offsets.map((o) => o.minutesBeforeDeadline)).toEqual([120, 60, 30, 5]);
  });

  it('disabling the 2h reminder drops only the 2h offset', () => {
    const snap = snapshotAckCadence(makeConfig({ reminder2hEnabled: false }));
    expect(snap.offsets.map((o) => o.minutesBeforeDeadline)).toEqual([360, 60, 30, 5]);
  });

  it('disabling both configurable reminders leaves only the mandatory 1h/30m/5m', () => {
    const snap = snapshotAckCadence(
      makeConfig({ reminder6hEnabled: false, reminder2hEnabled: false }),
    );
    expect(snap.offsets.map((o) => o.minutesBeforeDeadline)).toEqual([60, 30, 5]);
    expect(snap.offsets.every((o) => o.mandatory)).toBe(true);
  });

  it('a custom 6h/2h offset overrides the system default (still largest-first)', () => {
    const snap = snapshotAckCadence(
      makeConfig({ reminder6hOffsetMinutes: 300, reminder2hOffsetMinutes: 90 }),
    );
    expect(snap.offsets.map((o) => o.minutesBeforeDeadline)).toEqual([300, 90, 60, 30, 5]);
  });

  it('a null configurable offset means the system default, not "absent" (enabled governs presence)', () => {
    const snap = snapshotAckCadence(
      makeConfig({ reminder6hOffsetMinutes: null, reminder2hOffsetMinutes: null }),
    );
    expect(snap.offsets.map((o) => o.minutesBeforeDeadline)).toEqual([360, 120, 60, 30, 5]);
  });
});

// =====================================================================
// computeAckReminderSchedule — turn the snapshot into scheduled_for instants
// relative to the ack deadline, dropping any already at-or-before `now`.
// =====================================================================

describe('computeAckReminderSchedule — long-lead float, all offsets future (§7.1)', () => {
  // Assigned the day before — every offset is still in the future.
  const assignedAt = new Date('2026-02-09T20:00:00-05:00');

  it('schedules all five reminders at ackDeadline − offset', () => {
    const slots = computeAckReminderSchedule({
      ackDeadline: ACK_DEADLINE,
      assignedAt,
      snapshot: snapshotAckCadence(DEFAULT_ACK_CADENCE_CONFIG),
    });
    // Delivered chronologically (earliest scheduled_for first).
    expect(instantsOf(slots)).toEqual([R_6H, R_2H, R_1H, R_30M, R_5M].map((d) => d.getTime()));
  });

  it('carries the label and mandatory flag through to each slot', () => {
    const slots = computeAckReminderSchedule({
      ackDeadline: ACK_DEADLINE,
      assignedAt,
      snapshot: snapshotAckCadence(DEFAULT_ACK_CADENCE_CONFIG),
    });
    const last = slots[slots.length - 1];
    expect(last?.minutesBeforeDeadline).toBe(5);
    expect(last?.mandatory).toBe(true);
    expect(slots[0]?.minutesBeforeDeadline).toBe(360);
    expect(slots[0]?.mandatory).toBe(false);
  });
});

// =====================================================================
// Skip-past-offsets — a float assigned with < lead-time skips reminders already
// reached; the half-open `now <` boundary drops an offset landing EXACTLY on now.
// =====================================================================

describe('computeAckReminderSchedule — skip-past-offsets for short-lead floats (§7.1)', () => {
  it('a float assigned exactly at T-2h (1h50m before the deadline) fires only 1h/30m/5m', () => {
    // T-2h before float start = 18:00; deadline is 19:50, so 1h50m of lead. The 6h
    // (13:50) and 2h (17:50) offsets are already past → skipped (§7.1 worked example).
    const assignedAt = new Date('2026-02-10T18:00:00-05:00');
    const slots = computeAckReminderSchedule({
      ackDeadline: ACK_DEADLINE,
      assignedAt,
      snapshot: snapshotAckCadence(DEFAULT_ACK_CADENCE_CONFIG),
    });
    expect(instantsOf(slots)).toEqual([R_1H, R_30M, R_5M].map((d) => d.getTime()));
    expect(slots.every((s) => s.mandatory)).toBe(true);
  });

  it('an offset landing EXACTLY on the assignment instant is skipped (strictly-future)', () => {
    // assignedAt == the 2h instant (17:50). 2h is NOT scheduled; 1h/30m/5m are.
    const slots = computeAckReminderSchedule({
      ackDeadline: ACK_DEADLINE,
      assignedAt: R_2H,
      snapshot: snapshotAckCadence(DEFAULT_ACK_CADENCE_CONFIG),
    });
    expect(instantsOf(slots)).toEqual([R_1H, R_30M, R_5M].map((d) => d.getTime()));
  });

  it('one minute before the 6h instant keeps all five', () => {
    const slots = computeAckReminderSchedule({
      ackDeadline: ACK_DEADLINE,
      assignedAt: new Date(R_6H.getTime() - MINUTE),
      snapshot: snapshotAckCadence(DEFAULT_ACK_CADENCE_CONFIG),
    });
    expect(slots).toHaveLength(5);
  });

  it('a float assigned inside the final 5 minutes schedules NO reminders (all past)', () => {
    // Assigned at 19:48, after the 5m instant (19:45). No reminder is in the future;
    // the immediate float-assigned notification is a separate row, not a reminder.
    const slots = computeAckReminderSchedule({
      ackDeadline: ACK_DEADLINE,
      assignedAt: new Date('2026-02-10T19:48:00-05:00'),
      snapshot: snapshotAckCadence(DEFAULT_ACK_CADENCE_CONFIG),
    });
    expect(slots).toEqual([]);
  });

  it('skip-past composes with a disabled configurable reminder (6h off, assigned at T-2h)', () => {
    const assignedAt = new Date('2026-02-10T18:00:00-05:00');
    const slots = computeAckReminderSchedule({
      ackDeadline: ACK_DEADLINE,
      assignedAt,
      snapshot: snapshotAckCadence(makeConfig({ reminder6hEnabled: false })),
    });
    // 6h disabled (never present), 2h past (skipped) → still just the mandatory three.
    expect(instantsOf(slots)).toEqual([R_1H, R_30M, R_5M].map((d) => d.getTime()));
  });
});

// =====================================================================
// Snapshot semantics — the schedule is derived from the SNAPSHOT, never from live
// config. A later ack_cadence_config change cannot reach an in-flight float
// (ARCH §2.8 "a cadence change does not affect float assignments already created").
// =====================================================================

describe('snapshot semantics — config changes do not reach in-flight floats (ARCH §2.8)', () => {
  const assignedAt = new Date('2026-02-09T20:00:00-05:00');

  it('the schedule is computed from the snapshot value, so a later config change is a no-op', () => {
    // Snapshot taken at assignment time, with the 6h reminder enabled.
    const snapAtAssign: AckCadenceSnapshot = snapshotAckCadence(DEFAULT_ACK_CADENCE_CONFIG);
    const scheduleAtAssign = computeAckReminderSchedule({
      ackDeadline: ACK_DEADLINE,
      assignedAt,
      snapshot: snapAtAssign,
    });

    // The house later DISABLES the 6h reminder and shortens the 2h. The in-flight
    // float still holds its original snapshot; recomputing from it is unchanged.
    const _laterConfig = makeConfig({ reminder6hEnabled: false, reminder2hOffsetMinutes: 90 });
    void _laterConfig;
    const recomputed = computeAckReminderSchedule({
      ackDeadline: ACK_DEADLINE,
      assignedAt,
      snapshot: snapAtAssign,
    });

    expect(instantsOf(recomputed)).toEqual(instantsOf(scheduleAtAssign));
    expect(recomputed).toHaveLength(5); // still includes the original 6h reminder
  });

  it('a float assigned AFTER the change snapshots the NEW config (different schedule)', () => {
    const before = computeAckReminderSchedule({
      ackDeadline: ACK_DEADLINE,
      assignedAt,
      snapshot: snapshotAckCadence(DEFAULT_ACK_CADENCE_CONFIG),
    });
    const after = computeAckReminderSchedule({
      ackDeadline: ACK_DEADLINE,
      assignedAt,
      snapshot: snapshotAckCadence(makeConfig({ reminder6hEnabled: false })),
    });

    expect(before).toHaveLength(5);
    expect(after).toHaveLength(4); // the new (post-change) snapshot dropped the 6h
    expect(instantsOf(after)).not.toContain(R_6H.getTime());
  });
});

// =====================================================================
// shouldSuppressAckReminder — a reminder that fires for a float that is no longer
// pending (acknowledged, declined, voided, completed) is silently suppressed; only
// a still-pending, un-acked float delivers its reminder (§7.2 / §7.3).
// =====================================================================

describe('shouldSuppressAckReminder — suppress once the float leaves pending (§7.2/§7.3)', () => {
  function state(overrides: Partial<FloatAckState> = {}): FloatAckState {
    return { status: 'pending', acknowledgedAt: null, declinedAt: null, ...overrides };
  }

  it('a still-pending, un-acked float DELIVERS its reminder (not suppressed)', () => {
    expect(shouldSuppressAckReminder(state())).toBe(false);
  });

  it('an acknowledged float suppresses the reminder', () => {
    expect(
      shouldSuppressAckReminder(
        state({ status: 'acknowledged', acknowledgedAt: new Date('2026-02-10T18:30:00-05:00') }),
      ),
    ).toBe(true);
  });

  it('a declined float suppresses the reminder', () => {
    expect(
      shouldSuppressAckReminder(
        state({ status: 'declined', declinedAt: new Date('2026-02-10T18:30:00-05:00') }),
      ),
    ).toBe(true);
  });

  it('a voided float suppresses the reminder', () => {
    expect(shouldSuppressAckReminder(state({ status: 'voided' }))).toBe(true);
  });

  it('a completed float suppresses the reminder', () => {
    expect(shouldSuppressAckReminder(state({ status: 'completed' }))).toBe(true);
  });

  it('an acknowledged_at timestamp suppresses even if status still reads pending (race-safe)', () => {
    // Defensive: the acknowledgment write may land a tick before the status flip.
    expect(
      shouldSuppressAckReminder(state({ acknowledgedAt: new Date('2026-02-10T18:30:00-05:00') })),
    ).toBe(true);
  });
});

// =====================================================================
// Purity — deterministic and non-mutating (the phase-06+ discipline).
// =====================================================================

describe('purity', () => {
  it('computeAckReminderSchedule does not mutate the snapshot or the input dates', () => {
    const snapshot = snapshotAckCadence(DEFAULT_ACK_CADENCE_CONFIG);
    const snapshotCopy = JSON.parse(JSON.stringify(snapshot));
    const deadlineMs = ACK_DEADLINE.getTime();
    const assignedAt = new Date('2026-02-09T20:00:00-05:00');
    const assignedMs = assignedAt.getTime();

    computeAckReminderSchedule({ ackDeadline: ACK_DEADLINE, assignedAt, snapshot });

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshotCopy);
    expect(ACK_DEADLINE.getTime()).toBe(deadlineMs);
    expect(assignedAt.getTime()).toBe(assignedMs);
  });

  it('is deterministic — two identical calls produce equal schedules', () => {
    const args = {
      ackDeadline: ACK_DEADLINE,
      assignedAt: new Date('2026-02-10T18:00:00-05:00'),
      snapshot: snapshotAckCadence(DEFAULT_ACK_CADENCE_CONFIG),
    };
    expect(instantsOf(computeAckReminderSchedule(args))).toEqual(
      instantsOf(computeAckReminderSchedule(args)),
    );
  });
});
