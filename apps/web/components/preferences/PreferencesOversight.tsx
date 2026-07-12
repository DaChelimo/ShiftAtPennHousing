import Link from 'next/link';

import type { PreferencesOversight as PreferencesOversightData } from '../../lib/data/preferences';
import { EmptyState, PageHead, Tag } from '../ui';

import { DeadlineEditor } from './DeadlineEditor';
import { PreferenceRoster } from './PreferenceRoster';

const REMINDER_LEGEND = (
  <span className="row gap-3 wrap center">
    <span className="row gap-1 center">
      <Tag kind="green" icon="check">
        Nd
      </Tag>
      <span className="t-meta">sent</span>
    </span>
    <span className="row gap-1 center">
      <Tag kind="amber" dot>
        Nd
      </Tag>
      <span className="t-meta">window passed, none recorded</span>
    </span>
    <span className="row gap-1 center">
      <Tag kind="outline">Nd</Tag>
      <span className="t-meta">upcoming</span>
    </span>
  </span>
);

function StatCard({ num, label, color }: { num: number; label: string; color?: string }) {
  return (
    <div className="statcard">
      <span className="statcard-num" style={color ? { color } : undefined}>
        {num}
      </span>
      <span className="statcard-label">{label}</span>
    </div>
  );
}

export function PreferencesOversight({ data }: { data: PreferencesOversightData }) {
  const { period, summary } = data;

  if (period === null) {
    return (
      <div className="page page-wide">
        <PageHead
          eyebrow={`${data.houseName} · preferences`}
          title="Preferences oversight"
          sub="Track who has submitted availability before you build the schedule."
        />
        <EmptyState
          tone="neutral"
          icon="calendar"
          title="No scheduling period yet"
          desc="A scheduling period must be created before preference submission opens. Once it exists, this view tracks every worker's submission and reminder status."
        />
      </div>
    );
  }

  const responded = summary.submitted + summary.noHours;
  const pct = summary.total > 0 ? Math.round((responded / summary.total) * 100) : 0;
  const complete = summary.notYet === 0 && summary.total > 0;

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow={`${data.houseName} · ${period.name}`}
        title="Preferences oversight"
        sub="Set the submission deadline and track who has submitted availability before you build the schedule."
        actions={
          <Link className="btn btn-primary btn-md" href="/schedule-builder">
            <span>Open schedule builder</span>
          </Link>
        }
      />

      {/* Deadline — live read + write (set_preference_deadline RPC, §4.2). */}
      <DeadlineEditor period={period} />

      {/* Roster completion — sets up the builder. */}
      <div
        className="statstrip"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}
      >
        <StatCard num={summary.total} label="Workers" />
        <StatCard num={summary.submitted} label="Submitted" color="var(--success)" />
        <StatCard num={summary.noHours} label="No hours" />
        <StatCard
          num={summary.notYet}
          label="Not yet"
          color={summary.notYet > 0 ? 'var(--warn)' : undefined}
        />
      </div>

      <div className="row between wrap gap-4" style={{ marginBottom: 8 }}>
        <span className="meter-wrap" style={{ maxWidth: 360, flex: 1, minWidth: 220 }}>
          <span
            className="meter"
            role="img"
            aria-label={`${responded} of ${summary.total} workers responded`}
          >
            <span
              className={`meter-fill ${complete ? 'ok' : 'high'}`}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="meter-val">
            <b>{responded}</b>/{summary.total} responded
          </span>
        </span>
        {complete ? (
          <Tag kind="green" icon="check">
            Roster complete
          </Tag>
        ) : (
          <span className="t-meta">
            {summary.notYet} {summary.notYet === 1 ? 'worker' : 'workers'} still to submit
          </span>
        )}
      </div>

      <div className="row between wrap gap-3" style={{ margin: '12px 0 8px' }}>
        <span className="t-helper">
          Reminders auto-send 5 / 3 / 1 days before the deadline to workers who haven’t responded.
          {data.remindersSent === 0 ? ' None recorded for this period yet.' : ''}
        </span>
        {REMINDER_LEGEND}
      </div>

      <span className="t-helper" style={{ display: 'block', marginBottom: 8 }}>
        Select a worker to view or edit their availability.
      </span>
      <PreferenceRoster rows={data.rows} houseId={data.houseId} />
    </div>
  );
}
