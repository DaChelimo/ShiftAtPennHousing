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

// D5 — cross-house authority is the on-duty HMOD's duty-week power (campus-wide)
// plus the system-wide project administrator. An off-duty HM/BM is house-scoped.
export function canViewOtherHouses(opts: {
  isOnDutyHmod: boolean;
  isProjectAdmin: boolean;
}): boolean {
  return opts.isOnDutyHmod || opts.isProjectAdmin;
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
