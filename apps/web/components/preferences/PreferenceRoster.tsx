'use client';

import { useRouter } from 'next/navigation';

import type { PreferenceRow, ReminderCell } from '../../lib/data/preferences';
import { Avatar, type Column, DataTable, type IconName, Tag, type TagKind } from '../ui';

// Client wrapper over the oversight DataTable: clicking a worker opens the same
// paint grid the worker uses, scoped to that worker (/admin/preferences/[userId]).
// `houseId` is carried through so the detail page and its back link stay in the
// viewed house (cross-house schedule admins). Row data (incl. reminder cells) is
// fully serializable, so the whole table lives client-side for the row-click.
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

const REMINDER_CHIP: Record<ReminderCell['state'], { kind: TagKind; icon?: 'check'; dot?: boolean }> =
  {
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
      return `${cell.day}-day reminder window has passed. No send recorded`;
    case 'upcoming':
      return `${cell.day}-day reminder is scheduled`;
    default:
      return `${cell.day}-day reminder not applicable`;
  }
}

function Reminders({ cells }: { cells: ReminderCell[] }) {
  if (cells.every((c) => c.state === 'na')) {
    return (
      <span className="t-meta" title="No reminder due, worker has responded">
        -
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

function columns(): Column<PreferenceRow>[] {
  return [
    {
      key: 'worker',
      // Indent the label to sit above the NAME, not the avatar (avatar 28 + gap 10),
      // so the column header reads as connected to the worker names.
      header: <span style={{ paddingLeft: 38 }}>Worker</span>,
      render: (r) => (
        // `cell-name` alone is a left-aligned flex row (avatar + name); do NOT add
        // `center`, which justifies the group to the middle of the wide column and
        // pulls the names away from the left-aligned "Worker" header.
        <span className="cell-name">
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
          <span className="t-meta">-</span>
        ),
    },
    {
      key: 'reminders',
      header: 'Reminders',
      render: (r) => <Reminders cells={r.reminders} />,
    },
  ];
}

export function PreferenceRoster({ rows, houseId }: { rows: PreferenceRow[]; houseId: string }) {
  const router = useRouter();
  const query = houseId ? `?house=${encodeURIComponent(houseId)}` : '';
  return (
    <DataTable
      columns={columns()}
      rows={rows}
      getRowKey={(r) => r.userId}
      onRowClick={(r) => router.push(`/admin/preferences/${r.userId}${query}`)}
      rowChevron
      emptyText="No student workers are home-housed here yet."
    />
  );
}
