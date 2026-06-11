'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { markRead, setAlliedResolved } from '../../lib/actions/inbox';
import type { InboxData, InboxItem as InboxItemT } from '../../lib/data/inbox';
import { createClient } from '../../lib/supabase/client';
import { Button, EmptyState, Icon, PageHead, Tabs, Tag, type IconName } from '../ui';
import './inbox.css';

// Realtime: open a postgres_changes channel on `notifications` so new/changed
// alerts surface without a manual reload (the page copy promises "in real time").
// The browser client carries the signed-in admin's cookie session, so RLS scopes
// the stream to this recipient's rows exactly as the server-side initial load does.
// On any change we just `router.refresh()` — that re-runs the inbox server
// component, which re-fetches and re-partitions through the same @shift/core
// predicates, so we never re-implement the enrich/partition logic client-side.
function useInboxRealtime() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('inbox-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        router.refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);
}

const ICON_FOR: Record<string, IconName> = {
  hmod_urgent: 'shield',
  sm_permanent_drop_alert: 'warn',
  sw_permanent_removal_alert: 'warn',
  hm_leave_notice: 'power',
  swap_request: 'swap',
  ack_reminder: 'clock',
  broadcast: 'inbox',
  personal_shift: 'calendar',
};

// One inbox row. The container keeps `.inbox-item`; an unread row keeps the
// `.unread-dot` element (DOM contract). hmod_urgent rows carry a native Resolved
// checkbox (set/clear the Allied resolved marker); every other row carries a
// mark-read button. After a successful action we refresh so the server re-partitions
// the view (the resolved alert leaves / re-enters the default inbox).
function InboxItem({ item }: { item: InboxItemT }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUrgentType = item.type === 'hmod_urgent';

  async function toggleResolved(next: boolean) {
    setBusy(true);
    setError(null);
    const res = await setAlliedResolved({ notificationId: item.id, resolved: next });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function onMarkRead() {
    setBusy(true);
    setError(null);
    const res = await markRead({ notificationId: item.id });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className={`inbox-item ${item.urgent ? 'is-urgent' : ''}`.trim()}>
      <div className={`inbox-icon ${item.urgent ? 'urgent' : ''}`.trim()}>
        <Icon name={ICON_FOR[item.type] ?? 'inbox'} size={18} />
      </div>
      <div className="inbox-main">
        <div className="row gap-2 between">
          <div className="row gap-2">
            {item.unread && <span className="unread-dot" />}
            <span className="inbox-title">{item.title}</span>
            {item.urgent && (
              <Tag kind="red" icon="warnFill">
                Action required
              </Tag>
            )}
            {item.resolved && (
              <Tag kind="green" icon="check">
                Resolved
              </Tag>
            )}
          </div>
          <span className="t-meta">{item.timeLabel}</span>
        </div>

        {(item.houseName || item.windowLabel) && (
          <div className="inbox-fields">
            {item.houseName && (
              <span className="inbox-field">
                <span className="t-meta">House</span>
                <b>{item.houseName}</b>
              </span>
            )}
            {item.windowLabel && (
              <span className="inbox-field">
                <span className="t-meta">Window</span>
                <b className="t-mono">{item.windowLabel}</b>
              </span>
            )}
          </div>
        )}

        {item.reason && <div className="inbox-reason">{item.reason}</div>}

        <div className="row gap-2" style={{ marginTop: 10 }}>
          {isUrgentType ? (
            <label className="inbox-resolve">
              <input
                type="checkbox"
                data-testid="inbox-resolve-checkbox"
                aria-label="Resolved"
                checked={item.resolved}
                disabled={busy}
                onChange={(e) => toggleResolved(e.target.checked)}
              />
              <span>Resolved</span>
            </label>
          ) : (
            <Button
              kind="tertiary"
              size="sm"
              data-testid="inbox-mark-read"
              disabled={busy}
              onClick={onMarkRead}
            >
              Mark read
            </Button>
          )}
        </div>

        {error !== null && (
          <div className="inbox-reason" style={{ color: 'var(--st-danger)', marginTop: 8 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export function ActionInbox({ data }: { data: InboxData }) {
  const [tab, setTab] = useState<'all' | 'urgent' | 'unread'>('all');
  useInboxRealtime();

  // ---- Resolved view: a plain list of the resolved Allied alerts + hide link. ----
  if (data.view === 'resolved') {
    return (
      <div className="page" style={{ maxWidth: 880 }}>
        <PageHead
          eyebrow="Action inbox"
          title="Resolved Allied requests"
          sub="Allied-coverage alerts that have been marked resolved. Untick one to send it back to the active inbox."
        />

        <div style={{ marginTop: 16 }}>
          <Link href="/inbox" className="btn btn-ghost btn-sm" data-testid="inbox-hide-resolved">
            <Icon name="chevLeft" size={16} />
            <span>Back to action inbox</span>
          </Link>
        </div>

        {data.items.length === 0 ? (
          <div className="card" style={{ marginTop: 16 }}>
            <EmptyState
              title="Nothing resolved yet"
              desc="Resolved Allied requests will appear here."
              tone="neutral"
            />
          </div>
        ) : (
          <div className="inbox-list" style={{ marginTop: 16 }}>
            {data.items.map((n) => (
              <InboxItem key={n.id} item={n} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---- Default view: only unresolved Allied requests + non-urgent notifications. ----
  const urgent = data.items.filter((i) => i.urgent);
  const earlier = data.items.filter((i) => !i.urgent);
  const shown =
    tab === 'urgent' ? urgent : tab === 'unread' ? data.items.filter((i) => i.unread) : data.items;

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <PageHead
        eyebrow="Working hours · Mon–Fri 08:00–17:00"
        title="Action inbox"
        sub="The human-in-the-loop queue. Real-time, action-required alerts. Most healthy weeks, this is empty."
      />

      <div className="row gap-2 between" style={{ marginTop: 16 }}>
        <Tabs
          active={tab}
          onChange={(k) => setTab(k as 'all' | 'urgent' | 'unread')}
          tabs={[
            { key: 'all', label: 'All', count: data.items.length },
            { key: 'urgent', label: 'Action required', count: urgent.length },
            { key: 'unread', label: 'Unread', count: data.unreadCount },
          ]}
        />
        {data.resolvedCount > 0 && (
          <Link
            href="/inbox?show=resolved"
            className="btn btn-ghost btn-sm"
            data-testid="inbox-show-resolved"
          >
            <Icon name="check" size={16} />
            <span>Show resolved ({data.resolvedCount})</span>
          </Link>
        )}
      </div>

      {data.items.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <EmptyState
            title="All clear — no action needed"
            desc="Coverage is healthy. New alerts will appear here in real time."
          />
        </div>
      ) : (
        <div className="inbox-list" style={{ marginTop: 16 }}>
          {tab === 'all' ? (
            <>
              {urgent.length > 0 && (
                <div className="inbox-group-label">
                  <Icon name="warnFill" size={14} />
                  Action required
                </div>
              )}
              {urgent.map((n) => (
                <InboxItem key={n.id} item={n} />
              ))}
              {earlier.length > 0 && (
                <div className="inbox-group-label muted" style={{ marginTop: 20 }}>
                  Earlier
                </div>
              )}
              {earlier.map((n) => (
                <InboxItem key={n.id} item={n} />
              ))}
            </>
          ) : shown.length > 0 ? (
            shown.map((n) => <InboxItem key={n.id} item={n} />)
          ) : (
            <div className="card">
              <EmptyState title="Nothing here" desc="No items match this filter." tone="neutral" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
