// S6 — HMOD context (web-remediation #18a/#8/#9-open-half): contract types for the
// PURE decision surface. Zero Supabase imports (core invariant). The web I/O layer
// (apps/web/lib/data/hmod.ts + coverage.ts) snapshots DB rows into these shapes and
// threads the clock in (`now: Date`) — these functions never read a clock or do I/O.

// A single ack-reminder notification row, reduced to the two instants the summary
// needs. `scheduledForIso` = the absolute moment the reminder fires;
// `ackDeadlineIso` = the float's T-10m ack deadline (payload->>'ack_deadline').
export type AckReminderRow = {
  scheduledForIso: string;
  ackDeadlineIso: string;
};

// The deepest cadence step a float's ack reminders have reached by `now`.
//   awaiting        — nothing fired yet (or no rows)
//   reminded_6h     — the long (≈6h-default) reminder fired (lead ≥ 180 min)
//   reminded_2h     — the short (≈2h-default) reminder fired (90 ≤ lead < 180 min)
//   reminded_final  — a mandatory 1h/30m/5m nudge fired (lead < 90 min)
export type AckReminderStage = 'awaiting' | 'reminded_6h' | 'reminded_2h' | 'reminded_final';

export type AckReminderState = {
  stage: AckReminderStage;
  firedCount: number;
};

// `?house=` resolution inputs (shared by the calendar + coverage resolvers).
export type HouseResolutionInput = {
  requested: string | null;
  homeHouse: string;
  canViewOthers: boolean;
  validHouseIds: string[];
};

// Coverage scope: a single house, or the aggregate-all (HMOD default) board.
export type CoverageScope = {
  mode: 'all' | 'single';
  houseId: string | null;
};
