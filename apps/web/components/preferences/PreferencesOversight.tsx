import Link from 'next/link';

import type {
  PreferenceRow,
  PreferencesOversight as PreferencesOversightData,
  ReminderCell,
} from '../../lib/data/preferences';
import {
  Avatar,
  type Column,
  DataTable,
  EmptyState,
  type IconName,
  PageHead,
  Tag,
  type TagKind,
} from '../ui';

import { DeadlineEditor } from './DeadlineEditor';

const ROLE_META: Record<PreferenceRow['role'], { short: string; full: string; kind: TagKind }> = {
  sm: { short: 'SM', full: 'Student Manager', kind: 'blue' },
  sw: { short: 'SW', full: 'Student Worker', kind: 'gray' },
};

const STATUS_META: Record<
  PreferenceRow['status'],
  { label: string; kind: TagKind; icon?: IconName; dot?: boolean }
> = {
  submitted: { label: 'Submitted', kind: 'green', icon: 'check' },
  no_hours: { label: 'No hours', kind: 'gray', dot: true },
  not_yet: { label: 'Not yet', kind: 'amber', icon: 'clock' },
};

// Reminder cadence chips (5d / 3d / 1d). Color is never the only cue: a sent
// reminder carries a check, upcoming is a hollow outline, overdue a filled dot —
// three distinct shapes, plus a per-chip title and the explanatory legend below.
const REMINDER_CHIP: Record<
  ReminderCell['state'],
  { kind: TagKind; icon?: 'check'; dot?: boolean }
> = {
  sent: { kind: 'green', icon: 'check' },
  overdue: { kind: 'amber', dot: true },
  upcoming: { kind: 'outline' },
  na: { kind: 'gray' },
};

function reminderTitle(cell: ReminderCell): string {
  switch (cell.state) {
    case 'sent':
      return `${cell.day}-day reminder sent${cell.sentAtLabel ? ` · ${cell.sentAtLabel}` : ''}`;
    case 'overdue':
      return `${cell.day}-day reminder window has passed — no send recorded`;
    case 'upcoming':
      return `${cell.day}-day reminder is scheduled`;
    default:
      return `${cell.day}-day reminder not applicable`;
  }
}

function Reminders({ cells }: { cells: ReminderCell[] }) {
  // Responded workers (or no deadline) have no live reminder window.
  if (cells.every((c) => c.state === 'na')) {
    return (
      <span className="t-meta" title="No reminder due — worker has responded">
        —
      </span>
    );
  }
  return (
    <span className="row gap-1">
      {cells.map((c) => {
        const meta = REMINDER_CHIP[c.state];
        return (
          <Tag key={c.day} kind={meta.kind} icon={meta.icon} dot={meta.dot}>
            <span title={reminderTitle(c)} aria-label={reminderTitle(c)}>
              {c.day}d
            </span>
          </Tag>
        );
      })}
    </span>
  );
}

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

function columns(): Column<PreferenceRow>[] {
  return [
    {
      key: 'worker',
      header: 'Worker',
      render: (r) => (
        <span className="cell-name row gap-3 center">
          <Avatar name={r.name} size={28} />
          <span className="col">
            <b>{r.name}</b>
            <span className="cell-sub">
              <span title={ROLE_META[r.role].full}>{ROLE_META[r.role].full}</span>
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (r) => (
        <Tag kind={ROLE_META[r.role].kind}>
          <span title={ROLE_META[r.role].full}>{ROLE_META[r.role].short}</span>
        </Tag>
      ),
    },
    {
      key: 'status',
      header: 'Submission',
      render: (r) => {
        const m = STATUS_META[r.status];
        return (
          <Tag kind={m.kind} icon={m.icon} dot={m.dot}>
            {m.label}
          </Tag>
        );
      },
    },
    {
      key: 'target',
      header: 'Target',
      numeric: true,
      render: (r) =>
        r.targetHours !== null ? (
          <span className="t-mono">{r.targetHours}h</span>
        ) : r.status === 'no_hours' ? (
          <span className="t-meta">opted out</span>
        ) : (
          <span className="t-meta">—</span>
        ),
    },
    {
      key: 'reminders',
      header: 'Reminders',
      render: (r) => <Reminders cells={r.reminders} />,
    },
  ];
}

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

      <DataTable
        columns={columns()}
        rows={data.rows}
        getRowKey={(r) => r.userId}
        emptyText="No student workers are home-housed here yet."
      />
    </div>
  );
}
