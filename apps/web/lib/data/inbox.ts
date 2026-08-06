import {
  alliedLifecycle,
  alliedWindowEndIso,
  isDue,
  isResolvedAllied,
  type AlliedLifecycle,
  type InboxFilterInput,
} from '@shift/core';

import { getSessionUser } from '../auth';
import { createClient } from '../supabase/server';

// ===========================================================================
// Action inbox — READ model (presentation over the EXISTING `notifications` data).
// RLS policy "users can select own notifications" scopes rows to recipient =
// auth.uid(), so the AUTHED client is correct (no service bypass).
//
// The signature Allied-procurement alert is an `hmod_urgent` notification whose
// payload carries { house_id, block_start_at, block_end_at, reason } — exactly the
// house, coverage window, and reason the redesign leads with. Allied alerts move
// through a coverage-window LIFECYCLE (pure @shift/core `alliedLifecycle`):
//
//   active   → still needs / can get coverage (the window has not ended) — the
//              actionable card grid, soonest window first.
//   archived → the window has ended (resolved or not); kept for one day for reference.
//   discarded→ older than that → hidden here (the DB row is retained).
//
// Manager-facing scope only (decided 2026-08-05): this read model surfaces
// hmod_urgent and allied_page rows, the only types an SM/RSM/HM/BM is ever expected
// to act on here (a desk about to go empty). Every other notification type
// (shift_opened, shift_reminder, personal_shift, swap_request, hm_leave_notice,
// ack_reminder, sw_permanent_removal_alert) is personal to the recipient as a
// shift-holder, not to their manager role, and is delivered to them via mobile push
// instead — this read model does not fetch or render them.
// ===========================================================================

const NY = 'America/New_York';

export type { AlliedLifecycle } from '@shift/core';

export type InboxItem = {
  id: string;
  type: string;
  urgent: boolean; // an unresolved Allied alert whose window is still active
  resolved: boolean; // a resolved Allied alert (hmod_urgent + resolved_at set)
  lifecycle: AlliedLifecycle | null; // Allied alerts only; null for allied_page rows
  houseName: string | null;
  dateLabel: string | null; // "Tue, Jun 24" (the coverage day)
  windowLabel: string | null; // "22:00 to 23:00" (the coverage window)
  windowStartIso: string | null;
  agoLabel: string | null; // "Ended 2h ago" — archived cards only
  reason: string | null;
  timeLabel: string; // fallback label when a ladder page carries no block window
  alliedPageBlockId: string | null; // off-hours ladder alert: block to acknowledge
  deskPhone: string | null; // off-hours ladder alert: the desk to call
};

export type InboxData = {
  alliedPages: InboxItem[]; // off-hours ladder "call the desk" alerts — ack, not resolve
  alliedActive: InboxItem[]; // window not yet ended — sorted soonest first
  alliedArchived: InboxItem[]; // window ended < 24h ago — sorted most-recent first
  actionRequiredCount: number; // active Allied alerts / ladder pages still open
  activeCount: number; // Coverage tab badge (ladder pages + active Allied)
  archivedCount: number; // alliedArchived.length (the Archive tab badge)
};

const REASON: Record<string, string> = {
  float_no_acknowledgment: 'No floater found or the floater did not acknowledge in time.',
  no_floater_found: 'No floater found in the eligible source houses.',
  floater_declined: 'The assigned floater declined.',
  escalation_chain: 'The desk will be empty and no one picked up the shift.',
  ladder_no_acknowledgment: 'The prior contact did not confirm. Please call the desk now.',
};

function prettifyHouse(id: string): string {
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function timeLabel(iso: string, now: Date): string {
  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: NY,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  const created = new Date(iso);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(created);
  if (fmtDate(created) === fmtDate(now)) return time;
  return new Intl.DateTimeFormat('en-US', { timeZone: NY, month: 'short', day: 'numeric' }).format(
    created,
  );
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

function agoLabel(endIso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(endIso).getTime()) / 60000));
  if (mins < 60) return `Ended ${String(mins)}m ago`;
  return `Ended ${String(Math.round(mins / 60))}h ago`;
}

type NotificationRow = {
  notification_id: string;
  type: string;
  payload: unknown;
  created_at: string;
  scheduled_for: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
};

function payloadOf(row: NotificationRow): {
  houseId: string | null;
  blockStart: string | null;
  blockEnd: string | null;
  reason: string | null;
  blockId: string | null;
  deskPhone: string | null;
} {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  return {
    houseId: typeof p.house_id === 'string' ? p.house_id : null,
    blockStart: typeof p.block_start_at === 'string' ? p.block_start_at : null,
    blockEnd: typeof p.block_end_at === 'string' ? p.block_end_at : null,
    reason: typeof p.reason === 'string' ? p.reason : null,
    blockId: typeof p.block_id === 'string' ? p.block_id : null,
    deskPhone: typeof p.desk_phone === 'string' ? p.desk_phone : null,
  };
}

function filterInput(row: NotificationRow): InboxFilterInput {
  const p = payloadOf(row);
  return {
    type: row.type,
    scheduledForIso: row.scheduled_for,
    resolvedAtIso: row.resolved_at,
    blockStartIso: p.blockStart,
    blockEndIso: p.blockEnd,
  };
}

function enrich(row: NotificationRow, lifecycle: AlliedLifecycle | null, now: Date): InboxItem {
  const p = payloadOf(row);
  const resolved = isResolvedAllied(filterInput(row));
  const endIso = alliedWindowEndIso(filterInput(row));
  const isAlliedPage = row.type === 'allied_page';
  return {
    id: row.notification_id,
    type: row.type,
    urgent: row.type === 'hmod_urgent' && !resolved && lifecycle === 'active',
    resolved,
    lifecycle,
    houseName: p.houseId ? prettifyHouse(p.houseId) : null,
    dateLabel: p.blockStart ? dayDateLabel(p.blockStart) : null,
    // Allied-page alerts carry only a block START (a 30-min block), so the label is the
    // start time alone; hmod_urgent alerts carry a full coverage window.
    windowLabel: isAlliedPage
      ? p.blockStart
        ? hm(p.blockStart)
        : null
      : p.blockStart && endIso
        ? `${hm(p.blockStart)}-${hm(endIso)}`
        : null,
    windowStartIso: p.blockStart,
    agoLabel: lifecycle === 'archived' && endIso ? agoLabel(endIso, now) : null,
    reason: p.reason ? (REASON[p.reason] ?? p.reason.replace(/_/g, ' ')) : null,
    timeLabel: timeLabel(row.created_at, now),
    alliedPageBlockId: isAlliedPage ? p.blockId : null,
    deskPhone: isAlliedPage ? p.deskPhone : null,
  };
}

function startMs(row: NotificationRow): number {
  const s = payloadOf(row).blockStart;
  return s ? new Date(s).getTime() : 0;
}

function endMs(row: NotificationRow): number {
  const e = alliedWindowEndIso(filterInput(row));
  return e ? new Date(e).getTime() : 0;
}

export async function getInboxData(now: Date = new Date()): Promise<InboxData> {
  const supabase = await createClient();
  // getSessionUser() rather than supabase.auth.getUser(): the latter is a GoTrue HTTP
  // round trip on every call, and all this needs is whether someone is signed in. The
  // layout has already resolved (and cached) the session for this request.
  const user = await getSessionUser();
  const empty: InboxData = {
    alliedPages: [],
    alliedActive: [],
    alliedArchived: [],
    actionRequiredCount: 0,
    activeCount: 0,
    archivedCount: 0,
  };
  if (user === null) return empty;

  const nowIso = now.toISOString();

  // RLS scopes this to the signed-in recipient. Only hmod_urgent and allied_page are
  // fetched: the only two types a manager acts on here (see the module comment above).
  const { data: rows } = await supabase
    .from('notifications')
    .select(
      'notification_id, type, payload, created_at, scheduled_for, acknowledged_at, resolved_at, resolved_by',
    )
    .in('type', ['hmod_urgent', 'allied_page'])
    .order('created_at', { ascending: false })
    .limit(200);

  const allRows = (rows ?? []) as NotificationRow[];

  // Off-hours ladder "call the desk" pages: surfaced immediately while unacknowledged,
  // independent of the Allied-window lifecycle (they carry no coverage-window end).
  const alliedPageRows = allRows.filter(
    (r) => r.type === 'allied_page' && r.acknowledged_at === null,
  );
  alliedPageRows.sort((a, b) => startMs(a) - startMs(b));
  const alliedPages = alliedPageRows.map((r) => enrich(r, null, now));

  const due = allRows
    .filter((r) => r.type === 'hmod_urgent')
    .filter((r) => isDue(filterInput(r), nowIso));

  const activeRows: NotificationRow[] = [];
  const archivedRows: NotificationRow[] = [];

  for (const r of due) {
    const phase = alliedLifecycle(filterInput(r), nowIso);
    if (phase === 'active') activeRows.push(r);
    else if (phase === 'archived') archivedRows.push(r);
    // 'discarded' → drop (older than a day; the DB row is retained).
  }

  // Active: soonest coverage window first (the one about to arrive); unresolved before
  // resolved on a tie so the still-open ones lead.
  activeRows.sort((a, b) => {
    const d = startMs(a) - startMs(b);
    if (d !== 0) return d;
    return Number(isResolvedAllied(filterInput(a))) - Number(isResolvedAllied(filterInput(b)));
  });
  // Archived: most-recently elapsed first.
  archivedRows.sort((a, b) => endMs(b) - endMs(a));

  const alliedActive = activeRows.map((r) => enrich(r, 'active', now));
  const alliedArchived = archivedRows.map((r) => enrich(r, 'archived', now));

  return {
    alliedPages,
    alliedActive,
    alliedArchived,
    // Ladder pages always need attention (an unacknowledged call-the-desk request).
    actionRequiredCount: alliedPages.length + alliedActive.filter((i) => i.urgent).length,
    activeCount: alliedPages.length + alliedActive.length,
    archivedCount: alliedArchived.length,
  };
}
