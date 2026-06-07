import { createClient } from '../supabase/server';

// ===========================================================================
// Action inbox — READ model (presentation + wiring over EXISTING data).
// Design screen 07. NEW screen → read layer only. Reads the signed-in user's
// `notifications` (RLS policy "users can select own notifications" scopes rows to
// recipient = auth.uid(), so the AUTHED client is correct — no service bypass).
//
// The signature Allied-procurement alert is an `hmod_urgent` notification whose
// payload carries { house_id, block_start_at, reason } — exactly the house, time
// window, and reason the design shows. Action writes (Call Allied / Mark covered,
// mark-read) are surfaced but NOT wired ("mark covered" has no RPC;
// mark_notification_read exists but is left for the wiring phase) — DESIGN_TOKENS §6.
// ===========================================================================

const NY = 'America/New_York';

export type InboxItem = {
  id: string;
  type: string;
  urgent: boolean;
  unread: boolean;
  title: string;
  timeLabel: string;
  houseName: string | null;
  windowLabel: string | null;
  reason: string | null;
};

export type InboxData = {
  items: InboxItem[];
  unreadCount: number;
  urgentCount: number;
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

export async function getInboxData(now: Date = new Date()): Promise<InboxData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const empty: InboxData = { items: [], unreadCount: 0, urgentCount: 0 };
  if (user === null) return empty;

  // RLS scopes this to the signed-in recipient. Delivered (or due) notifications only.
  const { data: rows } = await supabase
    .from('notifications')
    .select('notification_id, type, payload, created_at, acknowledged_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const items: InboxItem[] = (rows ?? []).map((n) => {
    const p = (n.payload ?? {}) as Record<string, unknown>;
    const houseId = typeof p.house_id === 'string' ? p.house_id : null;
    const blockStart = typeof p.block_start_at === 'string' ? p.block_start_at : null;
    const rawReason = typeof p.reason === 'string' ? p.reason : null;
    return {
      id: n.notification_id,
      type: n.type,
      urgent: n.type === 'hmod_urgent',
      unread: n.acknowledged_at === null,
      title: TITLE[n.type] ?? 'Notification',
      timeLabel: timeLabel(n.created_at, now),
      houseName: houseId ? prettifyHouse(houseId) : null,
      windowLabel: blockStart ? windowLabel(blockStart) : null,
      reason: rawReason ? (REASON[rawReason] ?? rawReason.replace(/_/g, ' ')) : null,
    };
  });

  return {
    items,
    unreadCount: items.filter((i) => i.unread).length,
    urgentCount: items.filter((i) => i.urgent).length,
  };
}
