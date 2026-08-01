import {
  coverageRequestState,
  coverageSortKey,
  isActionRequired,
  isMissedCoverageIncident,
  outcomeLabel,
  rungDeadlineIso,
  rungLabel,
  type CoverageOutcome,
  type CoverageRequestInput,
  type CoverageRequestState,
  type CoverageRung,
} from '@shift/core';
import { cache } from 'react';

import { getSessionUser } from '../auth';
import { cachedGlobal } from '../cache/ttl';
import { createClient, createServiceClient } from '../supabase/server';

// ===========================================================================
// Allied coverage requests — READ model.
//
// RLS on allied_coverage_requests scopes rows to user_can_build_schedule(house) plus
// an admin clause, so the AUTHED client is correct here (no service bypass), matching
// the Action Inbox read path.
//
// All lifecycle derivation lives in @shift/core (`coverageRequestState`). This module
// only does I/O and formatting. The central rule it surfaces: an OPEN request never
// auto-clears. Once its window passes it is `overdue` and stays on screen until a
// human records an outcome.
// ===========================================================================

const NY = 'America/New_York';

export type CoverageItem = {
  id: string;
  houseId: string;
  houseName: string;
  state: CoverageRequestState;
  actionRequired: boolean;
  isIncident: boolean;
  dateLabel: string; // "Tue, Jun 24"
  windowLabel: string; // "22:00 to 23:00"
  windowStartIso: string;
  windowEndIso: string;
  reason: string;
  rung: CoverageRung;
  rungLabel: string;
  rungDeadlineIso: string | null;
  recipientName: string | null;
  acknowledgedByName: string | null;
  outcome: CoverageOutcome | null;
  outcomeLabel: string | null;
  closeNote: string | null;
  closedByName: string | null;
  closedAtIso: string | null;
};

export type CoverageData = {
  overdue: CoverageItem[];
  awaitingAck: CoverageItem[];
  acknowledged: CoverageItem[];
  actionRequiredCount: number; // drives the banner and the red bell badge
  openCount: number;
};

const REASON: Record<string, string> = {
  float_no_acknowledgment: 'No floater found or the floater did not acknowledge in time.',
  no_floater_found: 'No floater found in the eligible source houses.',
  floater_declined: 'The assigned floater declined.',
  escalation_chain: 'The desk will be empty and no one picked up the shift.',
};

function prettifyHouse(id: string): string {
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function dayDateLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

function hm(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

type CoverageRow = {
  request_id: string;
  house_id: string;
  window_start_at: string;
  window_end_at: string;
  reason: string;
  current_rung: string;
  rung_fired_at: string;
  current_recipient: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  outcome: CoverageOutcome | null;
  close_note: string | null;
};

function toInput(row: CoverageRow): CoverageRequestInput {
  return {
    windowStartIso: row.window_start_at,
    windowEndIso: row.window_end_at,
    acknowledgedAtIso: row.acknowledged_at,
    closedAtIso: row.closed_at,
    outcome: row.outcome,
    currentRung: row.current_rung as CoverageRung,
    rungFiredAtIso: row.rung_fired_at,
  };
}

const SELECT =
  'request_id, house_id, window_start_at, window_end_at, reason, current_rung, ' +
  'rung_fired_at, current_recipient, acknowledged_at, acknowledged_by, closed_at, ' +
  'closed_by, outcome, close_note';

// The rung timeout is a system_config row, so the countdown must read it rather than
// assume the 60-minute default.
//
// Memoized process-wide (same rationale as the other global config reads in
// lib/cache/ttl): it is one operator-set row, identical for every caller and not
// derived from the signed-in user, but it sat on the critical path of every coverage
// render as its own remote round trip (~150ms against the hosted project).
const RUNG_TIMEOUT_KEY = 'system_config:allied_ladder_rung_timeout_minutes';
const RUNG_TIMEOUT_TTL_MS = 60_000;

async function rungTimeoutMinutes(): Promise<number> {
  return cachedGlobal(RUNG_TIMEOUT_KEY, RUNG_TIMEOUT_TTL_MS, async () => {
    const svc = createServiceClient();
    const { data } = await svc
      .from('system_config')
      .select('config_value')
      .eq('config_key', 'allied_ladder_rung_timeout_minutes')
      .maybeSingle();
    const parsed = Number(data?.config_value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 60;
  });
}

// Names for the people on the ladder. A separate lookup because
// allied_coverage_requests has no FK-embeddable relationship the authed client may
// traverse under RLS on `users`.
async function nameMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const svc = createServiceClient();
  const { data } = await svc.from('users').select('user_id, name').in('user_id', unique);
  return new Map((data ?? []).map((u) => [u.user_id, u.name]));
}

function enrich(
  row: CoverageRow,
  nowIso: string,
  timeoutMinutes: number,
  names: Map<string, string>,
): CoverageItem {
  const input = toInput(row);
  return {
    id: row.request_id,
    houseId: row.house_id,
    houseName: prettifyHouse(row.house_id),
    state: coverageRequestState(input, nowIso),
    actionRequired: isActionRequired(input, nowIso),
    isIncident: isMissedCoverageIncident(input, nowIso),
    dateLabel: dayDateLabel(row.window_start_at),
    // "to", not a dash: no em dash or en dash in user-facing copy.
    windowLabel: `${hm(row.window_start_at)} to ${hm(row.window_end_at)}`,
    windowStartIso: row.window_start_at,
    windowEndIso: row.window_end_at,
    reason: REASON[row.reason] ?? row.reason.replace(/_/g, ' '),
    rung: row.current_rung as CoverageRung,
    rungLabel: rungLabel(row.current_rung as CoverageRung),
    rungDeadlineIso: rungDeadlineIso(input, timeoutMinutes),
    recipientName: row.current_recipient ? (names.get(row.current_recipient) ?? null) : null,
    acknowledgedByName: row.acknowledged_by ? (names.get(row.acknowledged_by) ?? null) : null,
    outcome: row.outcome,
    outcomeLabel: row.outcome ? outcomeLabel(row.outcome) : null,
    closeNote: row.close_note,
    closedByName: row.closed_by ? (names.get(row.closed_by) ?? null) : null,
    closedAtIso: row.closed_at,
  };
}

// Every OPEN request the signed-in manager may see, grouped by urgency.
//
// Wrapped in React's cache() (per-request), because the shell layout AND the /inbox
// page both need this on the same render: the layout for the app-wide banner and the
// bell badge, the page for the Coverage tab. Unmemoized, /inbox paid this whole read
// TWICE — the requests select, the rung-timeout config row, and the name lookup — for
// one navigation. The cache key is the `now` argument, and simNow() is itself cache()d
// so the layout and the page pass the SAME Date instance and share the entry.
//
// Per-request, not process-wide: the rows are RLS-scoped to the signed-in manager, so a
// cross-request cache here would leak one house's coverage to another's.
export const getCoverageData = cache(async (now: Date = new Date()): Promise<CoverageData> => {
  const empty: CoverageData = {
    overdue: [],
    awaitingAck: [],
    acknowledged: [],
    actionRequiredCount: 0,
    openCount: 0,
  };

  const supabase = await createClient();
  // getSessionUser() rather than supabase.auth.getUser(): the latter is an HTTP call to
  // GoTrue on every invocation, and this function only needs to know whether anyone is
  // signed in. getSessionUser() verifies the token locally and is already resolved for
  // this request by the layout, so this costs nothing (see the note on it in lib/auth).
  const user = await getSessionUser();
  if (user === null) return empty;

  const { data: rows, error } = await supabase
    .from('allied_coverage_requests')
    .select(SELECT)
    .is('closed_at', null)
    .order('window_start_at', { ascending: true })
    .limit(200);

  // NEVER swallow this. A failed read here renders as "All clear. No coverage needed",
  // which is the single most dangerous lie this app can tell: it is indistinguishable
  // from a genuinely quiet night while a desk is about to go unstaffed. A missing table
  // GRANT produced exactly that during development on 2026-07-29.
  if (error !== null) {
    console.error(
      JSON.stringify({ event: 'coverage_read_failed', message: error.message, code: error.code }),
    );
    throw new Error(`Coverage requests could not be loaded: ${error.message}`);
  }

  // `as unknown as` because the select string is built from a const, which PostgREST's
  // generic cannot narrow to the row shape on its own.
  const all = (rows ?? []) as unknown as CoverageRow[];
  if (all.length === 0) return empty;

  const nowIso = now.toISOString();
  const [timeoutMinutes, names] = await Promise.all([
    rungTimeoutMinutes(),
    nameMap(all.flatMap((r) => [r.current_recipient, r.acknowledged_by])),
  ]);

  // Overdue first (most overdue at the top), then soonest window. The key is computed
  // once per row alongside the enrich, not looked back up during the comparator.
  const items = all
    .map((r) => ({
      item: enrich(r, nowIso, timeoutMinutes, names),
      key: coverageSortKey(toInput(r), nowIso),
    }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item);

  return {
    overdue: items.filter((i) => i.state === 'overdue'),
    awaitingAck: items.filter((i) => i.state === 'awaiting_ack'),
    acknowledged: items.filter((i) => i.state === 'acknowledged'),
    actionRequiredCount: items.filter((i) => i.actionRequired).length,
    openCount: items.length,
  };
});

// The shell's read of the same data. The throw above is correct for /inbox, which has an
// error.tsx to catch it, but NOT for (app)/layout.tsx: a layout renders ABOVE every
// error boundary in its own subtree, so an uncaught throw there escapes to Next's
// built-in global error. In production that is a blank error screen for the WHOLE admin
// console on every route; in dev the error overlay reloads the document, the layout
// throws again on the reload, and the app reload-loops about twice a second with no way
// to navigate out. That is exactly what a stale PostgREST schema cache for
// allied_coverage_requests produced on 2026-07-29.
//
// So the shell degrades instead of crashing, and it still refuses to lie: `unavailable`
// makes the banner say the coverage status could not be read, never "all clear".
export async function getShellCoverage(
  now: Date,
): Promise<{ data: CoverageData | null; unavailable: boolean }> {
  try {
    return { data: await getCoverageData(now), unavailable: false };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'shell_coverage_read_failed',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { data: null, unavailable: true };
  }
}

// The single number the app-wide banner and the red bell badge need. Kept separate and
// deliberately cheap: the shell layout renders it on EVERY page.
export async function getCoverageActionCount(now: Date = new Date()): Promise<number> {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (user === null) return 0;

  const { data: rows } = await supabase
    .from('allied_coverage_requests')
    .select('window_end_at, acknowledged_at, closed_at')
    .is('closed_at', null)
    .limit(200);

  const nowIso = now.toISOString();
  return (rows ?? []).filter((r) =>
    isActionRequired(
      {
        windowStartIso: nowIso,
        windowEndIso: r.window_end_at as string,
        acknowledgedAtIso: r.acknowledged_at as string | null,
        closedAtIso: r.closed_at as string | null,
        outcome: null,
        currentRung: 'rsm',
        rungFiredAtIso: nowIso,
      },
      nowIso,
    ),
  ).length;
}

export type CoverageReportRow = CoverageItem & { incidentReason: string | null };

// The missed-coverage report (/admin/coverage). Includes CLOSED requests, which the
// live list deliberately excludes: this is the audit trail that the old
// archive-then-discard model destroyed.
export async function getCoverageReport(
  fromIso: string,
  toIso: string,
  now: Date = new Date(),
): Promise<CoverageReportRow[]> {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (user === null) return [];

  const { data: rows } = await supabase
    .from('allied_coverage_requests')
    .select(SELECT)
    .gte('window_start_at', fromIso)
    .lte('window_start_at', toIso)
    .order('window_start_at', { ascending: false })
    .limit(500);

  const all = (rows ?? []) as unknown as CoverageRow[];
  if (all.length === 0) return [];

  const nowIso = now.toISOString();
  const [timeoutMinutes, names] = await Promise.all([
    rungTimeoutMinutes(),
    nameMap(all.flatMap((r) => [r.current_recipient, r.acknowledged_by, r.closed_by])),
  ]);

  return all.map((r) => {
    const item = enrich(r, nowIso, timeoutMinutes, names);
    return {
      ...item,
      incidentReason: item.isIncident
        ? r.outcome === 'desk_unstaffed'
          ? 'The desk went unstaffed.'
          : 'The coverage window passed with no close-out.'
        : null,
    };
  });
}
