'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { acknowledgeAlliedPage, markRead, setAlliedResolved } from '../../lib/actions/inbox';
import type { CoverageData } from '../../lib/data/coverage';
import type { InboxData, InboxItem as InboxItemT } from '../../lib/data/inbox';
import { createClient } from '../../lib/supabase/client';
import { CoverageSection } from '../coverage/CoverageSection';
import { Button, EmptyState, Icon, PageHead, Tabs, Tag, type IconName } from '../ui';
import './inbox.css';

// Realtime: open a postgres_changes channel on `notifications` so new/changed
// alerts surface without a manual reload. On any change we just `router.refresh()` —
// that re-runs the inbox server component, which re-fetches and re-partitions through
// the same @shift/core lifecycle predicates, so we never re-implement that logic here.
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
  sw_permanent_removal_alert: 'warn',
  hm_leave_notice: 'power',
  swap_request: 'swap',
  ack_reminder: 'clock',
  broadcast: 'inbox',
  personal_shift: 'calendar',
};

// The status pill on a coverage card. Action-required (red) only while the window is
// still open; resolved (green) once handled; "Window passed" (neutral) for an archived
// alert that was never resolved.
function StatusBadge({ item }: { item: InboxItemT }) {
  if (item.urgent) {
    return (
      <Tag kind="red" icon="warnFill">
        Action required
      </Tag>
    );
  }
  if (item.resolved) {
    return (
      <Tag kind="green" icon="check">
        Resolved
      </Tag>
    );
  }
  // Archived + unresolved: the window elapsed without a logged resolution.
  return <Tag kind="gray">Window passed</Tag>;
}

// One Allied-coverage card (Coverage + Archive grids). Leads with HOUSE · DATE · WINDOW
// — the three things a HM / RSM scans first. Active cards carry the native Resolved
// checkbox; archived cards are read-only history (the window has already elapsed).
function CoverageCard({ item }: { item: InboxItemT }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = item.lifecycle === 'archived';

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

  return (
    <div
      className={`cov-card ${item.urgent ? 'is-urgent' : ''} ${archived ? 'is-archived' : ''}`.trim()}
      data-testid="inbox-coverage-card"
    >
      <div className="cov-card-top">
        <span className="cov-house">
          <span className="cov-house-icon">
            <Icon name="shield" size={15} />
          </span>
          <b className="cov-house-name">{item.houseName ?? 'House'}</b>
        </span>
        <StatusBadge item={item} />
      </div>

      <div className="cov-when">
        <span className="cov-date">{item.dateLabel ?? '-'}</span>
        {item.windowLabel && <span className="cov-window t-mono">{item.windowLabel}</span>}
      </div>

      {item.reason && <div className="cov-reason">{item.reason}</div>}

      <div className="cov-foot">
        {archived ? (
          <span className="cov-ago">{item.agoLabel}</span>
        ) : (
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
        )}
      </div>

      {error !== null && <div className="cov-error">{error}</div>}
    </div>
  );
}

// An off-hours ladder "call the desk" page (staggered-rollout pilot). Unlike a
// coverage card (a status the manager resolves), this is a direct instruction: call the
// desk to secure Allied coverage, then acknowledge so the ladder stops escalating.
function AlliedPageCard({ item }: { item: InboxItemT }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAck() {
    if (item.alliedPageBlockId === null) return;
    setBusy(true);
    setError(null);
    const res = await acknowledgeAlliedPage({ blockId: item.alliedPageBlockId });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="cov-card is-urgent" data-testid="inbox-allied-page-card">
      <div className="cov-card-top">
        <span className="cov-house">
          <span className="cov-house-icon">
            <Icon name="shield" size={15} />
          </span>
          <b className="cov-house-name">{item.houseName ?? 'House'}</b>
        </span>
        <Tag kind="red" icon="warnFill">
          Call the desk
        </Tag>
      </div>

      <div className="cov-when">
        <span className="cov-date">{item.dateLabel ?? '-'}</span>
        {item.windowLabel && <span className="cov-window t-mono">{item.windowLabel}</span>}
      </div>

      {item.reason && <div className="cov-reason">{item.reason}</div>}

      <div className="cov-foot" style={{ gap: 12 }}>
        {item.deskPhone && (
          <a className="t-mono" href={`tel:${item.deskPhone}`}>
            {item.deskPhone}
          </a>
        )}
        <Button
          kind="primary"
          size="sm"
          data-testid="inbox-allied-page-ack"
          disabled={busy}
          onClick={onAck}
        >
          I have called the desk
        </Button>
      </div>

      {error !== null && <div className="cov-error">{error}</div>}
    </div>
  );
}

function CoverageGrid({ items, testId }: { items: InboxItemT[]; testId: string }) {
  return (
    <div className="cov-grid" data-testid={testId}>
      {items.map((n) => (
        <CoverageCard key={n.id} item={n} />
      ))}
    </div>
  );
}

// A non-Allied notification (swap / leave / reminder). Plain row + mark-read.
function NotificationRow({ item }: { item: InboxItemT }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="inbox-item">
      <div className="inbox-icon">
        <Icon name={ICON_FOR[item.type] ?? 'inbox'} size={18} />
      </div>
      <div className="inbox-main">
        <div className="row gap-2 between">
          <div className="row gap-2">
            {item.unread && <span className="unread-dot" />}
            <span className="inbox-title">{item.title}</span>
          </div>
          <span className="t-meta">{item.timeLabel}</span>
        </div>
        {item.reason && <div className="inbox-reason">{item.reason}</div>}
        <div className="row gap-2" style={{ marginTop: 10 }}>
          <Button
            kind="tertiary"
            size="sm"
            data-testid="inbox-mark-read"
            disabled={busy}
            onClick={onMarkRead}
          >
            Mark read
          </Button>
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

type Tab = 'coverage' | 'archive' | 'other';

export function ActionInbox({ data, coverage }: { data: InboxData; coverage: CoverageData }) {
  const [tab, setTab] = useState<Tab>('coverage');
  useInboxRealtime();

  const actionCount = coverage.actionRequiredCount + data.alliedPages.length;
  const sub =
    actionCount > 0
      ? `${String(actionCount)} Allied request${actionCount === 1 ? '' : 's'} need attention.`
      : 'No open Allied requests. New alerts appear here in real time.';

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <PageHead eyebrow="Coverage escalation · real-time" title="Action inbox" sub={sub} />

      <div style={{ marginTop: 16 }}>
        <Tabs
          active={tab}
          onChange={(k) => setTab(k as Tab)}
          tabs={[
            {
              key: 'coverage',
              label: 'Coverage',
              count: coverage.openCount + data.alliedPages.length,
            },
            { key: 'archive', label: 'Archive', count: data.archivedCount },
            { key: 'other', label: 'Notifications', count: data.otherUnreadCount },
          ]}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        {tab === 'coverage' && (
          <>
            {/* Off-hours ladder "call the desk" pages (pilot, default off). These are a
                direct instruction rather than a tracked request, so they keep their own
                card and their own acknowledge path. */}
            {data.alliedPages.length > 0 && (
              <div className="cov-grid" data-testid="inbox-allied-page-grid">
                {data.alliedPages.map((n) => (
                  <AlliedPageCard key={n.id} item={n} />
                ))}
              </div>
            )}
            {/* Legacy hmod_urgent alerts opened BEFORE the ladder migration. They have no
                request row, so they keep the old resolve control until they age out. */}
            {data.alliedActive.length > 0 && (
              <>
                <div className="inbox-group-label muted">Earlier alerts</div>
                <CoverageGrid items={data.alliedActive} testId="inbox-active-grid" />
              </>
            )}
            <CoverageSection data={coverage} />
          </>
        )}

        {tab === 'archive' &&
          (data.alliedArchived.length === 0 ? (
            <div className="card">
              <EmptyState
                title="Nothing archived"
                desc="Requests whose coverage window has passed stay here for a day, then clear."
                tone="neutral"
              />
            </div>
          ) : (
            <CoverageGrid items={data.alliedArchived} testId="inbox-archive-grid" />
          ))}

        {tab === 'other' &&
          (data.other.length === 0 ? (
            <div className="card">
              <EmptyState
                title="No notifications"
                desc="Swaps, leave and reminders show up here."
                tone="neutral"
              />
            </div>
          ) : (
            <div className="inbox-list">
              {data.other.map((n) => (
                <NotificationRow key={n.id} item={n} />
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
