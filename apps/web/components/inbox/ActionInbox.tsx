'use client';

import { useState } from 'react';

import type { InboxData, InboxItem as InboxItemT } from '../../lib/data/inbox';
import { Button, EmptyState, Icon, Notification, PageHead, Tabs, Tag, type IconName } from '../ui';
import './inbox.css';

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

function InboxItem({ item }: { item: InboxItemT }) {
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
          <Button
            kind={item.urgent ? 'danger' : 'tertiary'}
            size="sm"
            icon={item.urgent ? 'phone' : undefined}
            disabled
            title="Not wired in this build — flagged"
          >
            {item.urgent ? 'Call Allied / Mark covered' : 'Open'}
          </Button>
          <button type="button" className="inbox-dismiss" disabled>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export function ActionInbox({ data }: { data: InboxData }) {
  const [tab, setTab] = useState<'all' | 'urgent' | 'unread'>('all');
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

      <Notification kind="info" title="Read-only in this build">
        Item actions (Call Allied / Mark covered, mark-read, dismiss) are surfaced but not wired —
        “mark covered” has no RPC; mark_notification_read exists and is left for the wiring phase
        (DESIGN_TOKENS.md §6).
      </Notification>

      <div style={{ marginTop: 16 }}>
        <Tabs
          active={tab}
          onChange={(k) => setTab(k as 'all' | 'urgent' | 'unread')}
          tabs={[
            { key: 'all', label: 'All', count: data.items.length },
            { key: 'urgent', label: 'Action required', count: urgent.length },
            { key: 'unread', label: 'Unread', count: data.unreadCount },
          ]}
        />
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
