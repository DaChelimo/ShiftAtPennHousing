import type { IconName } from '../../components/ui/Icon';
import type { SessionUser } from '../auth';
import { isAdmin, isHouseAdmin, isWorker } from '../auth';
import { createServiceClient } from '../supabase/server';

import { getHouseCalendar, mondayOf, nyToday, type CalShift } from './calendar';
import { getCoverageData, type CoverageItem } from './coverage';
import { getManagerFloaters } from './floaters';
import { getOrchestratorHealth } from './health';
import { getOnDutyHmodId } from './hmod';
import { getHoursReport } from './hours';
import { getInboxData } from './inbox';
import { getMyShifts, type MyShift } from './myShifts';
import { getPreferencesOversight } from './preferences';

// ===========================================================================
// The manager dashboard read model (the console's landing page).
//
// This is a READ-ONLY aggregation over read models that already exist — the live
// calendar, the coverage queue, the action inbox, preferences oversight, the hours
// report, the floaters view. It adds no new query surface and no new authorization:
// every source is the same function the dedicated page for that concern already
// calls, so anything the dashboard can show, the viewer could already open.
//
// Two rules shape it:
//
//   1. The page answers ONE question first — "is there anything I have to do right
//      now?" — and everything else is context underneath it. So the model computes a
//      single ranked `actions` list rather than handing the page N unrelated counts
//      to arrange.
//
//   2. Silence must never read as all-clear when it is really a failed read (the
//      coverage lesson in lib/data/coverage.ts). `degraded` names every source that
//      threw, and the page says so out loud instead of rendering an empty queue.
//
// Everything is fetched in ONE Promise.all wave (apps/web/AGENTS.md — each round trip
// against the hosted project is ~50ms, and this page fans out over seven sources).
// ===========================================================================

const NY = 'America/New_York';
const BLOCK_MINUTES = 30;
const MS_PER_MIN = 60_000;

/** How far ahead "coming up" looks on the desk strip. */
const NEXT_UP_HOURS = 12;
/** A gap inside this horizon is escalation-relevant now, not a planning note. */
const URGENT_GAP_HOURS = 24;
/** An orchestrator that has not ticked in this long is not running. */
const STALE_TICK_MINUTES = 15;

export type ActionSeverity = 'critical' | 'warning' | 'info';

/**
 * One thing the viewer may need to do, already resolved to where it gets done.
 * The page never derives urgency itself — it renders `severity` and the order.
 */
export type DashboardAction = {
  id: string;
  severity: ActionSeverity;
  icon: IconName;
  title: string;
  detail: string;
  /** Time/place context ("Tue, Jun 24 · 22:00 to 23:00"), or null when not time-bound. */
  meta: string | null;
  href: string;
  cta: string;
};

/** A coalesced run of blocks on the desk — staffed or vacant. */
export type DeskShift = {
  id: string;
  workerName: string | null;
  /** 'gap' when nobody is on it. */
  vacant: boolean;
  homeHouse: string | null;
  startIso: string;
  endIso: string;
  /** "14:00 to 17:30" (NY). */
  rangeLabel: string;
  /** "Wed, Jul 23" (NY) — only rendered on the coming-up list. */
  dayLabel: string;
};

export type DashboardDesk = {
  /** Whatever is on the desk at `now`, staffed or not. */
  onNow: DeskShift[];
  /** The next few starts within NEXT_UP_HOURS. */
  nextUp: DeskShift[];
  /**
   * Runs within URGENT_GAP_HOURS where the desk would be EMPTY, capped for display.
   * A vacant seat on a desk that still has a worker is NOT here — see uncoveredRuns.
   * Never count this array; it is truncated. Use `urgentGapCount`.
   */
  urgentGaps: DeskShift[];
  /** How many uncovered runs there really are inside URGENT_GAP_HOURS, untruncated. */
  urgentGapCount: number;
  /** Vacant SEATS anywhere in the viewed week, covered desk or not. */
  weekGapCount: number;
  /** This house is closed today per the operating calendar. */
  closedToday: boolean;
  /** The house has no generated blocks for this week at all. */
  hasBlocks: boolean;
};

export type DashboardPreferences = {
  periodName: string;
  status: 'open' | 'closed' | 'unset' | 'published';
  deadlineLabel: string | null;
  daysToDeadline: number | null;
  total: number;
  submitted: number;
  outstanding: number;
};

export type DashboardHours = {
  cap: number;
  enforcement: 'soft' | 'hard';
  /** Roster members at or above the cap this week. */
  atCap: number;
  /** Roster members with any scheduled hours this week. */
  scheduled: number;
  totalHours: number;
};

export type DashboardModel = {
  houseId: string;
  houseName: string;
  /** "Wednesday, July 23" (NY). */
  todayLabel: string;
  /** "14:07" (NY) — the clock this page was rendered against (honors the sim clock). */
  nowLabel: string;
  weekStartDate: string;
  actions: DashboardAction[];
  desk: DashboardDesk;
  preferences: DashboardPreferences | null;
  hours: DashboardHours | null;
  hmodName: string | null;
  hmodIsYou: boolean;
  floatersOut: number;
  /** The viewer's own upcoming shifts — only populated when they hold the sw role. */
  myShifts: MyShift[];
  /** Human names of the sources whose read FAILED. Never rendered as "all clear". */
  degraded: string[];
};

// --- NY formatting helpers (Intl only — never wall-clock arithmetic) ---------

function nyTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function nyDay(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

function nyLongDay(now: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);
}

/**
 * A calendar card's end instant. The card knows its start as a real timestamptz and
 * its length in 30-minute blocks, so the end is DURATION arithmetic off the start —
 * never wall-clock addition, which is wrong across a DST boundary (invariant #6).
 */
function endIsoOf(shift: CalShift): string {
  const blocks = shift.endBlock - shift.startBlock;
  return new Date(
    new Date(shift.startAtIso).getTime() + blocks * BLOCK_MINUTES * MS_PER_MIN,
  ).toISOString();
}

function toDeskShift(shift: CalShift): DeskShift {
  const endIso = endIsoOf(shift);
  return {
    id: shift.id,
    workerName: shift.workerName,
    vacant: shift.state === 'gap' || shift.state === 'perm-gap',
    homeHouse: shift.homeHouse,
    startIso: shift.startAtIso,
    endIso,
    rangeLabel: `${nyTime(shift.startAtIso)} to ${nyTime(endIso)}`,
    dayLabel: nyDay(shift.startAtIso),
  };
}

/**
 * The vacant runs where the desk would genuinely be EMPTY.
 *
 * The coverage floor is ONE worker, not required headcount (BSpec §5.4): the
 * escalation ladder fires for a block only when nobody at all is on the desk. A
 * second seat sitting vacant while a real worker is present is a staffing shortfall,
 * not a coverage gap, and the orchestrator will never escalate it (`loadCoveredBlockIds`
 * in orchestrator-tick). Raising it in the action queue was a false alarm: on a
 * 2-staff Harnwell or a 3-staff Quad it fires on essentially every temporary drop and
 * buries the one run that IS a real empty desk.
 *
 * A `CalShift` is per-seat and knows nothing about its neighbours, so recover the
 * floor here by subtracting the union of present runs from each vacant run. Every
 * non-vacant atom on the house calendar is presence at THIS desk — toAtom already
 * drops floated_out/pending_float_out — which matches the orchestrator's present-set
 * (scheduled/claimed/floated_in/pending_float_in/allied) plus cross-house pickups.
 *
 * Subtracting can leave zero, one, or two pieces of a run (a gap straddling a lone
 * covered block splits in half), so this returns runs, not a filtered subset.
 *
 * The surviving pieces are then MERGED into distinct windows. Once the unit is the
 * desk rather than the seat, an empty 2-staff Harnwell would otherwise report the same
 * 05:30 to 08:00 twice (once per vacant seat) and read as two separate problems when a
 * manager has exactly one hole to fill.
 */
function uncoveredRuns(all: DeskShift[]): DeskShift[] {
  const present = all
    .filter((s) => !s.vacant)
    .map((s) => [new Date(s.startIso).getTime(), new Date(s.endIso).getTime()] as const);

  const holes: { piece: [number, number]; gap: DeskShift }[] = [];

  for (const gap of all.filter((s) => s.vacant)) {
    let pieces: [number, number][] = [
      [new Date(gap.startIso).getTime(), new Date(gap.endIso).getTime()],
    ];

    for (const [presentStart, presentEnd] of present) {
      const next: [number, number][] = [];
      for (const [gapStart, gapEnd] of pieces) {
        if (presentEnd <= gapStart || presentStart >= gapEnd) {
          next.push([gapStart, gapEnd]); // disjoint — the whole piece survives
          continue;
        }
        if (presentStart > gapStart) next.push([gapStart, presentStart]);
        if (presentEnd < gapEnd) next.push([presentEnd, gapEnd]);
      }
      pieces = next;
      if (pieces.length === 0) break; // fully covered
    }

    for (const piece of pieces) holes.push({ piece, gap });
  }

  // Merge into distinct windows. Touching intervals (08:00 end, 08:00 start) are one
  // continuous hole, so merge on >= rather than >.
  holes.sort((a, b) => a.piece[0] - b.piece[0] || a.piece[1] - b.piece[1]);

  const merged: DeskShift[] = [];
  let open: { start: number; end: number; gap: DeskShift } | null = null;

  const flush = () => {
    if (open === null) return;
    const startIso = new Date(open.start).toISOString();
    const endIso = new Date(open.end).toISOString();
    merged.push({
      ...open.gap,
      // Reuse the calendar id only when the window IS that one gap, untouched.
      id:
        new Date(open.gap.startIso).getTime() === open.start &&
        new Date(open.gap.endIso).getTime() === open.end
          ? open.gap.id
          : `uncovered-${open.start}`,
      startIso,
      endIso,
      rangeLabel: `${nyTime(startIso)} to ${nyTime(endIso)}`,
      dayLabel: nyDay(startIso),
    });
    open = null;
  };

  for (const { piece, gap } of holes) {
    const [start, end] = piece;
    if (open !== null && start <= open.end) {
      open.end = Math.max(open.end, end);
      continue;
    }
    flush();
    open = { start, end, gap };
  }
  flush();

  return merged;
}

/** `settled` if it resolved, otherwise null plus the source's display name. */
async function settle<T>(
  label: string,
  promise: Promise<T>,
): Promise<{ value: T | null; failed: string | null }> {
  try {
    return { value: await promise, failed: null };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'dashboard_source_failed',
        source: label,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { value: null, failed: label };
  }
}

const SEVERITY_RANK: Record<ActionSeverity, number> = { critical: 0, warning: 1, info: 2 };

function coverageAction(item: CoverageItem, overdue: boolean): DashboardAction {
  return {
    id: `coverage-${item.id}`,
    severity: overdue ? 'critical' : 'warning',
    icon: 'warn',
    title: overdue ? 'Allied coverage is overdue' : 'Allied coverage needs an answer',
    detail: overdue
      ? `${item.houseName} went past its coverage window with no outcome recorded. Record what happened.`
      : `${item.houseName} is waiting on ${item.recipientName ?? 'the on-duty manager'} to acknowledge.`,
    meta: `${item.dateLabel} · ${item.windowLabel}`,
    href: '/inbox',
    cta: 'Open the inbox',
  };
}

export async function getDashboard(
  user: SessionUser,
  houseId: string,
  now: Date,
): Promise<DashboardModel> {
  const today = nyToday(now);
  const weekStartDate = mondayOf(today);
  const wantsHours = isHouseAdmin(user);
  const wantsHealth = isAdmin(user);

  // ONE wave. Each of these is an independent read against a remote Postgres, so
  // sequencing them would cost their sum in latency on the app's landing page.
  // Each is settled individually: one dead source degrades its own card, it does not
  // blank the dashboard.
  const [calendar, coverage, inbox, preferences, floaters, hours, health, mine, hmod] =
    await Promise.all([
      settle('Live calendar', getHouseCalendar(houseId, weekStartDate, now)),
      settle('Coverage queue', getCoverageData(now)),
      settle('Notifications', getInboxData(now)),
      settle('Preferences', getPreferencesOversight(houseId, now)),
      settle('Floaters', getManagerFloaters(now)),
      wantsHours
        ? settle('Hours report', getHoursReport(houseId, now))
        : Promise.resolve({ value: null, failed: null }),
      wantsHealth
        ? settle('Orchestrator health', getOrchestratorHealth())
        : Promise.resolve({ value: null, failed: null }),
      isWorker(user)
        ? settle('Your shifts', getMyShifts(user.userId))
        : Promise.resolve({ value: [] as MyShift[], failed: null }),
      settle('HMOD rotor', resolveHmod(now)),
    ]);

  const degraded = [
    calendar.failed,
    coverage.failed,
    inbox.failed,
    preferences.failed,
    floaters.failed,
    hours.failed,
    health.failed,
    mine.failed,
    hmod.failed,
  ].filter((x): x is string => x !== null);

  // --- Desk strip -----------------------------------------------------------
  const cal = calendar.value;
  const nowMs = now.getTime();
  const horizonMs = nowMs + NEXT_UP_HOURS * 60 * MS_PER_MIN;
  const urgentMs = nowMs + URGENT_GAP_HOURS * 60 * MS_PER_MIN;

  const all = (cal?.shifts ?? []).map(toDeskShift);
  const onNow = all
    .filter((s) => new Date(s.startIso).getTime() <= nowMs && new Date(s.endIso).getTime() > nowMs)
    .sort((a, b) => a.startIso.localeCompare(b.startIso));
  const nextUp = all
    .filter((s) => {
      const start = new Date(s.startIso).getTime();
      return start > nowMs && start <= horizonMs;
    })
    .sort((a, b) => a.startIso.localeCompare(b.startIso))
    .slice(0, 4);
  const weekGaps = all.filter((s) => s.vacant);
  const urgentGaps = uncoveredRuns(all)
    .filter((s) => new Date(s.endIso).getTime() > nowMs)
    .filter((s) => new Date(s.startIso).getTime() <= urgentMs)
    .sort((a, b) => a.startIso.localeCompare(b.startIso));

  const desk: DashboardDesk = {
    onNow,
    nextUp,
    urgentGaps: urgentGaps.slice(0, 4),
    urgentGapCount: urgentGaps.length,
    weekGapCount: weekGaps.length,
    closedToday: cal?.days.find((d) => d.dateKey === today)?.closed ?? false,
    hasBlocks: cal?.hasBlocks ?? false,
  };

  // --- Action queue ---------------------------------------------------------
  const actions: DashboardAction[] = [];

  for (const item of coverage.value?.overdue ?? []) actions.push(coverageAction(item, true));
  for (const item of coverage.value?.awaitingAck ?? []) actions.push(coverageAction(item, false));

  for (const page of inbox.value?.alliedPages ?? []) {
    actions.push({
      id: `page-${page.id}`,
      severity: 'critical',
      icon: 'phone',
      title: 'Call the desk for Allied coverage',
      detail: page.deskPhone
        ? `The off-hours ladder reached you. Call ${page.deskPhone} and acknowledge.`
        : 'The off-hours ladder reached you. Acknowledge so it stops escalating.',
      meta:
        page.dateLabel && page.windowLabel
          ? `${page.dateLabel} · ${page.windowLabel}`
          : page.timeLabel,
      href: '/inbox',
      cta: 'Acknowledge',
    });
  }

  if (urgentGaps.length > 0) {
    const first = urgentGaps[0]!;
    actions.push({
      id: 'gaps-urgent',
      severity: 'warning',
      icon: 'calendar',
      title:
        urgentGaps.length === 1
          ? 'The desk is empty for a window in the next 24 hours'
          : `The desk is empty for ${urgentGaps.length} windows in the next 24 hours`,
      detail:
        'Nobody is on the desk for this. Fill it from the calendar before the escalation ladder starts broadcasting and floating.',
      meta: `Next: ${first.dayLabel} · ${first.rangeLabel}`,
      href: `/calendar?house=${encodeURIComponent(houseId)}`,
      cta: 'Open the calendar',
    });
  }

  const prefs = preferences.value;
  if (prefs?.period != null) {
    const outstanding = prefs.summary.notYet;
    const past = (prefs.period.daysToDeadline ?? 0) < 0;
    if (outstanding > 0 && prefs.period.status === 'open') {
      actions.push({
        id: 'preferences-outstanding',
        severity: past ? 'warning' : 'info',
        icon: 'check',
        title: past
          ? `${outstanding} preference submissions are past the deadline`
          : `${outstanding} workers have not submitted preferences`,
        detail: past
          ? 'The builder opens against an incomplete roster until these land. Chase them or record them as no hours.'
          : `${prefs.summary.submitted} of ${prefs.summary.total} are in for ${prefs.period.name}.`,
        meta: prefs.period.deadlineLabel ? `Due ${prefs.period.deadlineLabel}` : null,
        href: `/admin/preferences?house=${encodeURIComponent(houseId)}`,
        cta: 'Chase submissions',
      });
    }
  }

  const hoursValue = hours.value;
  const atCap =
    hoursValue === null ? 0 : hoursValue.rows.filter((r) => r.totalHours >= hoursValue.cap).length;
  if (hoursValue !== null && atCap > 0) {
    actions.push({
      id: 'hours-at-cap',
      severity: hoursValue.capEnforcement === 'hard' ? 'warning' : 'info',
      title:
        atCap === 1 ? 'One worker is at the weekly cap' : `${atCap} workers are at the weekly cap`,
      icon: 'hours',
      detail:
        hoursValue.capEnforcement === 'hard'
          ? `The cap is hard this week at ${hoursValue.cap}h, so they cannot claim or pick up more.`
          : `The cap is soft this week at ${hoursValue.cap}h. They can still be scheduled, but check it is deliberate.`,
      meta: null,
      href: `/admin/hours?house=${encodeURIComponent(houseId)}`,
      cta: 'Open the hours report',
    });
  }

  const awaitingFloat = (floaters.value ?? []).filter(
    (f) => f.state === 'awaiting_confirmation',
  ).length;
  if (awaitingFloat > 0) {
    actions.push({
      id: 'floats-awaiting',
      severity: 'info',
      icon: 'swap',
      title:
        awaitingFloat === 1
          ? 'A float is awaiting confirmation'
          : `${awaitingFloat} floats are awaiting confirmation`,
      detail:
        'The worker has been notified but has not acknowledged yet. Automated systems cannot take a float back once it is out.',
      meta: null,
      href: '/floaters',
      cta: 'View floaters',
    });
  }

  const tick = health.value;
  if (tick !== null) {
    const ageMin = Math.round((nowMs - new Date(tick.lastTickAt).getTime()) / MS_PER_MIN);
    if (ageMin > STALE_TICK_MINUTES) {
      actions.push({
        id: 'orchestrator-stale',
        severity: 'critical',
        icon: 'shield',
        title: 'The orchestrator has stopped ticking',
        detail:
          'Nothing is broadcasting, floating, or escalating right now. Every gap is silently going uncovered until this is fixed.',
        meta: `Last tick ${ageMin} minutes ago`,
        href: '/admin/health',
        cta: 'Open health',
      });
    }
  }

  actions.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return {
    houseId,
    houseName: cal?.houseName ?? prefs?.houseName ?? houseId,
    todayLabel: nyLongDay(now),
    nowLabel: nyTime(now.toISOString()),
    weekStartDate,
    actions,
    desk,
    preferences:
      prefs?.period == null
        ? null
        : {
            periodName: prefs.period.name,
            status: prefs.period.status,
            deadlineLabel: prefs.period.deadlineLabel,
            daysToDeadline: prefs.period.daysToDeadline,
            total: prefs.summary.total,
            submitted: prefs.summary.submitted,
            outstanding: prefs.summary.notYet,
          },
    hours:
      hoursValue === null
        ? null
        : {
            cap: hoursValue.cap,
            enforcement: hoursValue.capEnforcement,
            atCap,
            scheduled: hoursValue.rows.filter((r) => r.totalHours > 0).length,
            totalHours: hoursValue.rows.reduce((sum, r) => sum + r.totalHours, 0),
          },
    hmodName: hmod.value?.name ?? null,
    hmodIsYou: hmod.value?.userId === user.userId,
    floatersOut: (floaters.value ?? []).length,
    myShifts: (mine.value ?? [])
      .filter((s) => new Date(s.startAtIso).getTime() >= nowMs)
      .slice(0, 4),
    degraded,
  };
}

/**
 * Who is HMOD right now, resolved to a display name. `resolve_hmod_on_duty` returns a
 * user_id only, so the name needs one more lookup. getOnDutyHmodId is memoized per
 * request (React cache()) and the shell layout has already resolved it for this
 * render, so only the name lookup is a new round trip.
 */
async function resolveHmod(now: Date): Promise<{ userId: string | null; name: string | null }> {
  const userId = await getOnDutyHmodId(now);
  if (userId === null) return { userId: null, name: null };
  const { data } = await createServiceClient()
    .from('users')
    .select('name')
    .eq('user_id', userId)
    .maybeSingle();
  return { userId, name: data?.name ?? null };
}
