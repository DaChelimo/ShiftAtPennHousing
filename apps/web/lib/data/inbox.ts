import {
  belongsInInboxView,
  isDue,
  isResolvedAllied,
  type InboxFilterInput,
  type InboxView,
} from '@shift/core';

import { createClient } from '../supabase/server';

// ===========================================================================
// Action inbox — READ model (presentation + wiring over EXISTING data).
// Design screen 07. Reads the signed-in user's `notifications` (RLS policy
// "users can select own notifications" scopes rows to recipient = auth.uid(), so
// the AUTHED client is correct — no service bypass).
//
// The signature Allied-procurement alert is an `hmod_urgent` notification whose
// payload carries { house_id, block_start_at, reason } — exactly the house, time
// window, and reason the design shows. As of S3 (web-remediation #3) it carries a
// resolved marker (notifications.resolved_at/resolved_by): the DEFAULT view shows
// only UNRESOLVED Allied requests (plus all non-urgent notifications); the RESOLVED
// view shows the resolved Allied alerts behind "Show resolved". Partitioning uses
// the pure @shift/core inbox predicates so the rule is shared + unit-tested.
// ===========================================================================

export type { InboxView } from '@shift/core';

const NY = 'America/New_York';

export type InboxItem = {
  id: string;
  type: string;
  urgent: boolean; // hmod_urgent AND not resolved — an unresolved Allied alert
  resolved: boolean; // a resolved Allied alert (hmod_urgent + resolved_at set)
  unread: boolean; // not yet acknowledged
  title: string;
  timeLabel: string;
  houseName: string | null;
  windowLabel: string | null;
  reason: string | null;
};

export type InboxData = {
  items: InboxItem[]; // rows that belong in the requested view
  view: InboxView;
  unreadCount: number; // default-view items that are unread
  urgentCount: number; // default-view items that are unresolved Allied alerts
  resolvedCount: number; // due resolved Allied alerts (size of the resolved view)
};

const TITLE: Record<string, string> = {
  hmod_urgent: 'Allied coverage needed',
  sm_permanent_drop_alert: 'A worker permanently dropped a slot',
  sw_permanent_removal_alert: 'You were removed from a recurring slot',
  hm_leave_notice: 'Leave / coverage change',
  swap_request: 'Swap request',
  ack_reminder: 'Acknowledgment reminder',
  broadcast: 'Open shift broadcast',
  personal_shift: 'Shift update',
};

const REASON: Record<string, string> = {
  float_no_acknowledgment: 'No floater found or the floater did not acknowledge in time.',
  no_floater_found: 'No floater found in the eligible source houses.',
  floater_declined: 'The assigned floater declined.',
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

function windowLabel(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d);
  const start = new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  const end = new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(d.getTime() + 30 * 60000));
  return `${day} · ${start}–${end}`;
}

// The shape we both partition and enrich from. `scheduled_for` is NOT NULL with a
// now() default in the table, but typed nullable by the generator — treat a missing
// value as "due".
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

function filterInput(row: NotificationRow): InboxFilterInput {
  return {
    type: row.type,
    scheduledForIso: row.scheduled_for,
    resolvedAtIso: row.resolved_at,
  };
}

function enrich(row: NotificationRow, now: Date): InboxItem {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const houseId = typeof p.house_id === 'string' ? p.house_id : null;
  const blockStart = typeof p.block_start_at === 'string' ? p.block_start_at : null;
  const rawReason = typeof p.reason === 'string' ? p.reason : null;
  const resolved = isResolvedAllied(filterInput(row));
  return {
    id: row.notification_id,
    type: row.type,
    // "urgent" is the actionable state: an hmod_urgent alert that is NOT yet
    // resolved. A resolved Allied alert is no longer urgent.
    urgent: row.type === 'hmod_urgent' && !resolved,
    resolved,
    unread: row.acknowledged_at === null,
    title: TITLE[row.type] ?? 'Notification',
    timeLabel: timeLabel(row.created_at, now),
    houseName: houseId ? prettifyHouse(houseId) : null,
    windowLabel: blockStart ? windowLabel(blockStart) : null,
    reason: rawReason ? (REASON[rawReason] ?? rawReason.replace(/_/g, ' ')) : null,
  };
}

export async function getInboxData(
  view: InboxView = 'default',
  now: Date = new Date(),
): Promise<InboxData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const empty: InboxData = {
    items: [],
    view,
    unreadCount: 0,
    urgentCount: 0,
    resolvedCount: 0,
  };
  if (user === null) return empty;

  const nowIso = now.toISOString();

  // RLS scopes this to the signed-in recipient.
  const { data: rows } = await supabase
    .from('notifications')
    .select(
      'notification_id, type, payload, created_at, scheduled_for, acknowledged_at, resolved_at, resolved_by',
    )
    .order('created_at', { ascending: false })
    .limit(100);

  const all = (rows ?? []) as NotificationRow[];

  // Counts come from the FULL fetched set, independent of `view`.
  const resolvedCount = all.filter(
    (r) => isDue(filterInput(r), nowIso) && isResolvedAllied(filterInput(r)),
  ).length;
  const unreadCount = all.filter(
    (r) => belongsInInboxView(filterInput(r), 'default', nowIso) && r.acknowledged_at === null,
  ).length;
  const urgentCount = all.filter(
    (r) => belongsInInboxView(filterInput(r), 'default', nowIso) && r.type === 'hmod_urgent',
  ).length;

  const items = all
    .filter((r) => belongsInInboxView(filterInput(r), view, nowIso))
    .map((r) => enrich(r, now));

  return { items, view, unreadCount, urgentCount, resolvedCount };
}
