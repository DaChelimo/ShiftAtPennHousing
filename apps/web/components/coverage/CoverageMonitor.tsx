'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { CoverageData, CoverageGap, PermOpening } from '../../lib/data/coverage';
import {
  Avatar,
  Button,
  EmptyState,
  EscalationChip,
  Icon,
  Notification,
  PageHead,
  Tabs,
  Tag,
  type TagKind,
} from '../ui';
import './coverage.css';

function prettifyHouse(id: string): string {
  if (!id) return '';
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function GapCard({ gap }: { gap: CoverageGap }) {
  const tMinusKind: TagKind = gap.esc === 'allied' ? 'red' : gap.esc === 'float' ? 'amber' : 'blue';
  return (
    <div className={`gap-card ${gap.esc === 'allied' ? 'is-allied' : ''}`.trim()}>
      <div className="gap-top">
        <div className="col gap-1">
          <div className="row gap-2">
            <b>{gap.houseName}</b>
            {gap.restricted && <Tag kind="outline">Restricted</Tag>}
          </div>
          <span className="t-mono gap-window">
            {gap.dayLabel} {gap.dateLabel} · {gap.spanLabel}
          </span>
        </div>
        <Tag kind={tMinusKind} icon={gap.esc === 'allied' ? 'warnFill' : 'clock'}>
          {gap.tMinus}
        </Tag>
      </div>

      <div className="gap-esc">
        <EscalationChip step={gap.esc} />
      </div>
      <div className="gap-reason">{gap.reason}</div>

      {gap.floater && (
        <div className="gap-floater">
          <Avatar name={gap.floater.name} size={26} />
          <span className="grow">
            <b>{gap.floater.name}</b>{' '}
            <span className="t-meta">from {prettifyHouse(gap.floater.fromHouse)}</span>
          </span>
          <Tag kind="amber" icon="clock">
            Pending ack
          </Tag>
        </div>
      )}

      <div className="gap-actions">
        {gap.esc === 'allied' ? (
          <Button kind="danger" size="sm" icon="phone" disabled title="No backing RPC — flagged">
            Call Allied / Mark covered
          </Button>
        ) : (
          <Button
            kind="tertiary"
            size="sm"
            icon="swap"
            disabled
            title="Force-trigger flow — not wired here"
          >
            Force-trigger float
          </Button>
        )}
        <Link className="btn btn-ghost btn-sm" href={`/calendar?week=${gap.weekKey}`}>
          <span>View on calendar</span>
        </Link>
      </div>
    </div>
  );
}

function PermCard({ p }: { p: PermOpening }) {
  return (
    <div className="gap-card is-perm">
      <div className="gap-top">
        <div className="col gap-1">
          <b>{p.houseName}</b>
          <span className="t-mono gap-window">
            Recurring {p.dayLabel} · {p.spanLabel}
          </span>
        </div>
        <Tag kind="magenta" icon="warn">
          Permanent opening
        </Tag>
      </div>
      <div className="gap-reason">
        Owner permanently dropped this recurring slot · {p.weeksRemaining}{' '}
        {p.weeksRemaining === 1 ? 'week' : 'weeks'} remaining.
      </div>
      <div className="gap-actions">
        <Link className="btn btn-tertiary btn-sm" href="/schedule-builder">
          <Icon name="grid" size={16} />
          <span>Assign owner in builder</span>
        </Link>
      </div>
    </div>
  );
}

export function CoverageMonitor({ data }: { data: CoverageData }) {
  const [tab, setTab] = useState<'weekly' | 'perm'>('weekly');
  const gaps = data.gaps;
  const perm = data.permOpenings;
  const pendingAcks = gaps.filter((g) => g.floater !== null).length;
  const awaitingAllied = gaps.filter((g) => g.esc === 'allied').length;

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <PageHead
        eyebrow={`${data.houseName} · next 30 days`}
        title="Coverage monitor"
        sub="A live board of everything needing coverage — and where each gap sits on the escalation timeline."
      />

      <Notification kind="info" title="Read-only monitor in this build">
        Actions (force-trigger float, Call Allied / Mark covered) are not wired here — force-trigger
        is a separate flow and “mark covered” has no RPC (DESIGN_TOKENS.md §6). “View on calendar”
        works.
      </Notification>

      <div className="statstrip" style={{ margin: '16px 0 20px' }}>
        <div className="statcard">
          <span className="statcard-num">{gaps.length}</span>
          <span className="statcard-label">Open gaps</span>
        </div>
        <div className="statcard">
          <span className="statcard-num" style={{ color: 'var(--st-pending)' }}>
            {pendingAcks}
          </span>
          <span className="statcard-label">Pending acks</span>
        </div>
        <div className="statcard">
          <span className="statcard-num" style={{ color: 'var(--st-danger)' }}>
            {awaitingAllied}
          </span>
          <span className="statcard-label">Awaiting Allied</span>
        </div>
        <div className="statcard">
          <span className="statcard-num" style={{ color: 'var(--st-perm-fg)' }}>
            {perm.length}
          </span>
          <span className="statcard-label">Permanent openings</span>
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={(k) => setTab(k as 'weekly' | 'perm')}
        tabs={[
          { key: 'weekly', label: 'Weekly feed', count: gaps.length },
          { key: 'perm', label: 'Permanent openings', count: perm.length },
        ]}
      />

      <div className="gap-grid" style={{ marginTop: 16 }}>
        {tab === 'weekly' &&
          (gaps.length > 0 ? (
            gaps.map((g) => <GapCard key={g.id} gap={g} />)
          ) : (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <EmptyState title="No open gaps" desc="Every block in range is covered." />
            </div>
          ))}
        {tab === 'perm' &&
          (perm.length > 0 ? (
            perm.map((p) => <PermCard key={p.id} p={p} />)
          ) : (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <EmptyState title="No permanent openings" desc="No recurring slots are unowned." />
            </div>
          ))}
      </div>
    </div>
  );
}
