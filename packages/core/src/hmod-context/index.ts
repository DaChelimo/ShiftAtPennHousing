// S6 — HMOD context: PURE helpers (web-remediation #18a Friday-anchor, #8 ack
// indicator, the cross-house gating + ?house= resolvers). Zero Supabase imports;
// the clock is always injected. The web I/O wrappers (apps/web/lib/data/hmod.ts +
// coverage.ts) build the inputs from DB rows and the pages call the resolvers.
//
// Pinned decisions (docs/web-remediation/sessions/S6/TEST_PLAN.md §2):
//   D1  fridayAnchor — UTC date-only, DST-immune; agrees with resolve_hmod_on_duty.
//   D5  canViewOtherHouses — on-duty-HMOD OR project-administrator.
//   D6  resolveCalendarHouse / resolveCoverageScope — gated ?house= resolution.
//   D8  summarizeAckReminders — deepest fired cadence step, ISO-instant compare.

import {
  type AckReminderRow,
  type AckReminderStage,
  type AckReminderState,
  type CoverageScope,
  type HouseResolutionInput,
} from './types.js';

export * from './types.js';

// D1 — most-recent Friday on or before `dateKey` (YYYY-MM-DD).
//
// Mirrors the Monday helper in apps/web/lib/data/rotor.ts but snaps to Friday:
// UTC date-only math (no local time, no wall-clock-of-day) so it is DST-immune by
// construction. `(getUTCDay() + 2) % 7` is the days-since-Friday delta
// (Sun=0…Sat=6 → Fri=0, Sat=1, Sun=2, Mon=3, Tue=4, Wed=5, Thu=6). This equals
// resolve_hmod_on_duty's SQL `(isodow + 2) % 7` day-snap (they differ only on
// Sunday, 7 vs 0, and (7+2)%7 == (0+2)%7 == 2), so every key this produces is a
// Friday (isodow 5) and clears the hmod_rotor isodow=5 CHECK.
export function fridayAnchor(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 2) % 7));
  return at.toISOString().slice(0, 10);
}

// T2-7 (§2.5 "Academic-year scope of the rotor") — the truncated week list for a
// scheduling period. The rotor exists ONLY for operating (academic-year) dates:
//   - the FIRST week is the Friday-08:00 opening the week that contains the first
//     operating date in the period (fridayAnchor of that date);
//   - the LAST week is the Friday-anchored week CONTAINING the last operating day —
//     truncated so no interval extends into summer (a week is emitted iff its Friday
//     anchor is on-or-before the last operating day). There is no summer rotor.
// The upper bound is the last OPERATING date (operating_calendar), NOT period.end_date,
// which may sit mid-summer or span a break and would otherwise over-generate weeks.
// operatingDates is the unfiltered operating_calendar date list; this clamps it to the
// period bounds itself. Pure: zero Supabase imports, no clock.
export type RotorWeek = { weekStartDate: string; label: string };
export function rotorWeeks(opts: {
  periodStart: string;
  periodEnd: string;
  operatingDates: readonly string[];
}): RotorWeek[] {
  const inPeriod = opts.operatingDates
    .filter((d) => d >= opts.periodStart && d <= opts.periodEnd)
    .sort();
  if (inPeriod.length === 0) return [];
  const firstOperating = inPeriod[0]!;
  const lastOperating = inPeriod[inPeriod.length - 1]!;

  const weeks: RotorWeek[] = [];
  let cursor = fridayAnchor(firstOperating);
  // Bounded against malformed input (a semester is ~17–18 weeks; 60 is generous).
  for (let i = 0; i < 60 && cursor <= lastOperating; i += 1) {
    weeks.push({ weekStartDate: cursor, label: `Week of ${cursor}` });
    cursor = addDaysUtc(cursor, 7);
  }
  return weeks;
}

function addDaysUtc(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

// D5 — cross-house authority unlocks the house switcher. As of the 2026-06-27
// decision the elevated schedule-admin tier (hm/bm/rsm, anywhere) may EDIT any
// house's schedule, so the switcher unlocks for them too — not just the on-duty
// HMOD (campus-wide duty power), the project administrator, or the RSM. The
// `isScheduleAdmin` flag supersedes the narrower `isRsm` for the elevated tier;
// `isRsm` is retained for callers that only know the RSM bit. People admin /
// leave / cap remain scope-matched at the action/RPC layer regardless.
//
// 2026-07-13 ruling: a plain Student Manager (`isStudentManager`) also unlocks the
// switcher for READ-ONLY cross-house VIEW of the live schedule/calendar, just like
// a worker can. This flag ONLY widens view/switcher gating — every SM write path
// (override, schedule build/publish, force-trigger) stays pinned to the SM's home
// house via the separate `isScheduleAdmin`/`adminHouseId` gates and the DB's
// `user_can_build_schedule` backstop, so it cannot leak cross-house write access.
export function canViewOtherHouses(opts: {
  isOnDutyHmod: boolean;
  isProjectAdmin: boolean;
  isRsm?: boolean;
  isScheduleAdmin?: boolean;
  isStudentManager?: boolean;
}): boolean {
  return (
    opts.isOnDutyHmod ||
    opts.isProjectAdmin ||
    opts.isRsm === true ||
    opts.isScheduleAdmin === true ||
    opts.isStudentManager === true
  );
}

// D6 — calendar is always single-house. Honor `requested` only when authorized and
// the id is a real house; otherwise pin to the home house (a non-authorized user
// passing ?house=<other> is silently pinned, no error page).
export function resolveCalendarHouse(opts: HouseResolutionInput): string {
  const { requested, homeHouse, canViewOthers, validHouseIds } = opts;
  if (canViewOthers && requested !== null && validHouseIds.includes(requested)) {
    return requested;
  }
  return homeHouse;
}

// D6 — coverage scope:
//   not authorized                                  → single / homeHouse (ignores ?house=)
//   authorized + valid non-'all' requested house    → single / requested
//   authorized + (absent | 'all' | invalid)         → all / null (HMOD default aggregate)
export function resolveCoverageScope(opts: HouseResolutionInput): CoverageScope {
  const { requested, homeHouse, canViewOthers, validHouseIds } = opts;
  if (!canViewOthers) {
    return { mode: 'single', houseId: homeHouse };
  }
  if (requested !== null && requested !== 'all' && validHouseIds.includes(requested)) {
    return { mode: 'single', houseId: requested };
  }
  return { mode: 'all', houseId: null };
}

// D8 — the deepest ack-reminder cadence step reached by `now`.
//
// "Fired" = `new Date(scheduledForIso) <= now` (ISO instant compare, DST-immune).
// If none fired → awaiting/0. Else take the LATEST fired reminder (max scheduledFor
// ≤ now = the deepest cadence step reached) and bucket by its lead before the
// deadline `lead = (ackDeadline − scheduledFor)` in minutes:
//   lead ≥ 180        → reminded_6h
//   90 ≤ lead < 180   → reminded_2h
//   lead < 90         → reminded_final
export function summarizeAckReminders(input: {
  reminders: AckReminderRow[];
  now: Date;
}): AckReminderState {
  const nowMs = input.now.getTime();
  const fired = input.reminders.filter((r) => new Date(r.scheduledForIso).getTime() <= nowMs);
  const firedCount = fired.length;
  if (firedCount === 0) {
    return { stage: 'awaiting', firedCount: 0 };
  }

  // The latest fired = the deepest cadence step reached.
  let latest = fired[0]!;
  let latestMs = new Date(latest.scheduledForIso).getTime();
  for (const r of fired) {
    const ms = new Date(r.scheduledForIso).getTime();
    if (ms > latestMs) {
      latest = r;
      latestMs = ms;
    }
  }

  const leadMinutes =
    (new Date(latest.ackDeadlineIso).getTime() - new Date(latest.scheduledForIso).getTime()) /
    60000;

  let stage: AckReminderStage;
  if (leadMinutes >= 180) stage = 'reminded_6h';
  else if (leadMinutes >= 90) stage = 'reminded_2h';
  else stage = 'reminded_final';

  return { stage, firedCount };
}
