import type { AppRole } from '../auth';
import { createServiceClient } from '../supabase/server';

// ===========================================================================
// Preferences oversight — READ model (presentation + wiring over EXISTING data).
// Design screen §6.11 (SM). NEW screen → read layer only; invents no backend.
//
// Tracks, for the active scheduling period, which of a house's preference-
// submitting workers have submitted / opted out ("no hours") / not yet, plus the
// 5d/3d/1d reminder status — everything the SM needs to know the roster is
// complete before opening the schedule builder.
//
//   * Period         — scheduling_periods (preference_deadline + published_at).
//   * Submission      — derived exactly like the builder's `submittedUserIds`
//                       (lib/data/scheduleBuilder): a worker SUBMITTED if they
//                       have any `preferences` row OR a non-opted-out
//                       `period_targets` row; "no hours" = period_targets.opted_out;
//                       else "not yet".
//   * Reminder status — `preference_reminder_sends` rows (threshold_days 5/3/1,
//                       sent_at). Authoritative for "sent"; "due / upcoming" for
//                       not-yet workers is derived from the deadline + now
//                       (no clock is read inside the component).
//   * Roster          — active SW/SM home-housed here: exactly the population
//                       `send_preference_reminders` targets (HM/BM don't submit).
//
// The "Set deadline" WRITE the design leads with has NO backing path — the
// `scheduling_periods.preference_deadline` column exists but there is no
// set-deadline RPC and only a service-role RLS policy, so the screen surfaces
// that control disabled + flagged (mirroring People Hire/Fire). The current
// deadline is read and shown live. See DESIGN_TOKENS.md §6.
//
// Service client (the authorized house-scoped snapshot used by builder / people /
// hours / leave / rotor); the page gates on canBuildSchedule (SM/HM/BM) + the
// admin's own house — the same managerial-read pattern.
// ===========================================================================

const NY = 'America/New_York';

// The cadence `send_preference_reminders` fires at (days before the deadline).
const REMINDER_THRESHOLDS = [5, 3, 1] as const;
export type ReminderDay = (typeof REMINDER_THRESHOLDS)[number];

export type SubmissionStatus = 'submitted' | 'no_hours' | 'not_yet';

// 'sent'     — a preference_reminder_sends row exists (authoritative).
// 'overdue'  — not-yet worker, deadline set, that reminder window has passed with
//              no recorded send.
// 'upcoming' — not-yet worker, deadline set, window still in the future.
// 'na'       — worker has responded, or there is no deadline → no reminder due.
export type ReminderState = 'sent' | 'overdue' | 'upcoming' | 'na';

export type ReminderCell = {
  day: ReminderDay;
  state: ReminderState;
  /** Formatted NY send time when state === 'sent'. */
  sentAtLabel: string | null;
};

export type PreferenceRow = {
  userId: string;
  name: string;
  /** Display role for the badge — 'sm' when they manage, else 'sw'. */
  role: Extract<AppRole, 'sw' | 'sm'>;
  status: SubmissionStatus;
  /** Target hours when a non-opted-out period_targets row exists, else null. */
  targetHours: number | null;
  reminders: ReminderCell[]; // always three: 5d, 3d, 1d
};

export type DeadlineStatus = 'open' | 'closed' | 'unset' | 'published';

export type PreferencePeriod = {
  periodId: string;
  name: string;
  startDate: string;
  endDate: string;
  deadlineIso: string | null;
  /** Formatted NY deadline (date + time), or null when unset. */
  deadlineLabel: string | null;
  /** Native date value (YYYY-MM-DD, NY) for the (disabled) date input. */
  deadlineDateValue: string | null;
  status: DeadlineStatus;
  /** Whole days from now to the deadline (negative = past); null when unset. */
  daysToDeadline: number | null;
};

export type PreferencesOversight = {
  houseId: string;
  houseName: string;
  period: PreferencePeriod | null;
  rows: PreferenceRow[];
  summary: { total: number; submitted: number; noHours: number; notYet: number };
  /** Total reminder sends recorded for this period across the roster. */
  remindersSent: number;
};

function nyDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function nyDateTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Outstanding first (the SM chases these), then opted-out, then submitted — each
// alphabetical. Surfaces the roster gaps that block a clean builder open.
const STATUS_ORDER: Record<SubmissionStatus, number> = { not_yet: 0, no_hours: 1, submitted: 2 };

export async function getPreferencesOversight(
  houseId: string,
  now: Date,
): Promise<PreferencesOversight> {
  const svc = createServiceClient();
  const base: PreferencesOversight = {
    houseId,
    houseName: houseId,
    period: null,
    rows: [],
    summary: { total: 0, submitted: 0, noHours: 0, notYet: 0 },
    remindersSent: 0,
  };

  const { data: house } = await svc
    .from('houses')
    .select('id, name')
    .eq('id', houseId)
    .maybeSingle();
  if (house) base.houseName = house.name;

  // Active SW/SM home-housed here — the preference-submitting population
  // (`send_preference_reminders` targets sw/sm; HM/BM don't submit).
  const { data: userRows } = await svc
    .from('users')
    .select('user_id, name')
    .eq('home_house_id', houseId)
    .eq('is_active', true)
    .order('name');
  const users = userRows ?? [];
  const allIds = users.map((u) => u.user_id);
  if (allIds.length === 0) return base;

  const { data: roleRows } = await svc
    .from('user_roles')
    .select('user_id, role')
    .in('user_id', allIds);
  const rolesByUser = new Map<string, AppRole[]>();
  for (const r of roleRows ?? []) {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role as AppRole);
    rolesByUser.set(r.user_id, arr);
  }
  const roster = users
    .map((u) => ({ ...u, roles: rolesByUser.get(u.user_id) ?? [] }))
    .filter((u) => u.roles.includes('sw') || u.roles.includes('sm'));
  const rosterIds = roster.map((u) => u.user_id);
  if (rosterIds.length === 0) return base;

  // Period: the active submission window = the most recent UNPUBLISHED period
  // (preferences are only collected before publish); fall back to the most recent
  // period overall (shown published/closed) so the screen is never blank when one exists.
  const { data: periodRows } = await svc
    .from('scheduling_periods')
    .select('period_id, period_name, start_date, end_date, preference_deadline, published_at')
    .order('start_date', { ascending: false });
  const periods = periodRows ?? [];
  const chosen = periods.find((p) => p.published_at === null) ?? periods[0] ?? null;
  if (chosen === null) return base;

  const deadlineIso = chosen.preference_deadline;
  const status: DeadlineStatus =
    chosen.published_at !== null
      ? 'published'
      : deadlineIso === null
        ? 'unset'
        : new Date(deadlineIso).getTime() >= now.getTime()
          ? 'open'
          : 'closed';
  base.period = {
    periodId: chosen.period_id,
    name: chosen.period_name,
    startDate: chosen.start_date,
    endDate: chosen.end_date,
    deadlineIso,
    deadlineLabel: deadlineIso ? nyDateTimeLabel(deadlineIso) : null,
    deadlineDateValue: deadlineIso ? nyDate(deadlineIso) : null,
    status,
    daysToDeadline:
      deadlineIso === null
        ? null
        : Math.floor((new Date(deadlineIso).getTime() - now.getTime()) / DAY_MS),
  };

  const periodId = chosen.period_id;

  // Submission signals for the roster, scoped to this period.
  const { data: prefRows } = await svc
    .from('preferences')
    .select('user_id')
    .eq('period_id', periodId)
    .in('user_id', rosterIds);
  const hasPreference = new Set((prefRows ?? []).map((r) => r.user_id));

  const { data: targetRows } = await svc
    .from('period_targets')
    .select('user_id, target_hours, opted_out')
    .eq('period_id', periodId)
    .in('user_id', rosterIds);
  const targetByUser = new Map<string, { targetHours: number; optedOut: boolean }>();
  for (const t of targetRows ?? []) {
    targetByUser.set(t.user_id, { targetHours: t.target_hours, optedOut: t.opted_out });
  }

  const { data: reminderRows } = await svc
    .from('preference_reminder_sends')
    .select('user_id, threshold_days, sent_at')
    .eq('period_id', periodId)
    .in('user_id', rosterIds);
  const sendsByUser = new Map<string, Map<number, string>>();
  for (const s of reminderRows ?? []) {
    const m = sendsByUser.get(s.user_id) ?? new Map<number, string>();
    m.set(s.threshold_days, s.sent_at);
    sendsByUser.set(s.user_id, m);
  }
  base.remindersSent = (reminderRows ?? []).length;

  const summary = { total: 0, submitted: 0, noHours: 0, notYet: 0 };
  base.rows = roster.map((u) => {
    const target = targetByUser.get(u.user_id);
    const submissionStatus: SubmissionStatus = target?.optedOut
      ? 'no_hours'
      : hasPreference.has(u.user_id) || target !== undefined
        ? 'submitted'
        : 'not_yet';

    summary.total += 1;
    if (submissionStatus === 'submitted') summary.submitted += 1;
    else if (submissionStatus === 'no_hours') summary.noHours += 1;
    else summary.notYet += 1;

    const sends = sendsByUser.get(u.user_id);
    const reminders: ReminderCell[] = REMINDER_THRESHOLDS.map((day) => {
      const sentAt = sends?.get(day);
      if (sentAt !== undefined) {
        return { day, state: 'sent', sentAtLabel: nyDateTimeLabel(sentAt) };
      }
      // No send recorded. Only outstanding workers with a deadline have a window.
      if (submissionStatus !== 'not_yet' || deadlineIso === null) {
        return { day, state: 'na', sentAtLabel: null };
      }
      const windowAt = new Date(deadlineIso).getTime() - day * DAY_MS;
      return {
        day,
        state: now.getTime() >= windowAt ? 'overdue' : 'upcoming',
        sentAtLabel: null,
      };
    });

    return {
      userId: u.user_id,
      name: u.name,
      role: u.roles.includes('sm') ? 'sm' : 'sw',
      status: submissionStatus,
      targetHours: target && !target.optedOut ? target.targetHours : null,
      reminders,
    };
  });
  base.summary = summary;

  base.rows.sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
  );

  return base;
}
