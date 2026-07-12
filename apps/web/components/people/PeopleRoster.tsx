import type { AppRole } from '../../lib/auth';
import type { PeopleData, PersonRow } from '../../lib/data/people';
import { Avatar, type Column, DataTable, PageHead, Tag, type TagKind } from '../ui';

import { FireWorkerControl } from './FireWorkerControl';
import { HireWorkerControl } from './HireWorkerControl';

const ROLE_META: Record<AppRole, { short: string; full: string; kind: TagKind }> = {
  sw: { short: 'SW', full: 'Student Worker', kind: 'gray' },
  sm: { short: 'SM', full: 'Student Manager', kind: 'blue' },
  hm: { short: 'HM', full: 'Housing Manager', kind: 'purple' },
  rsm: { short: 'RSM', full: 'Residential Services Manager', kind: 'magenta' },
  bm: { short: 'BM', full: 'Building Manager', kind: 'teal' },
  admin: { short: 'ADM', full: 'Administrator', kind: 'red' },
};

const ROLE_ORDER: AppRole[] = ['admin', 'bm', 'hm', 'rsm', 'sm', 'sw'];

function prettifyHouse(id: string): string {
  if (!id) return '';
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function HoursMeter({ hours, cap, hasShifts }: { hours: number; cap: number; hasShifts: boolean }) {
  if (!hasShifts) {
    return <span className="t-meta">No shifts (admin)</span>;
  }
  const pct = cap > 0 ? Math.min(100, (hours / cap) * 100) : 0;
  const tone = hours <= 0 ? 'low' : hours > cap ? 'over' : hours / cap >= 0.85 ? 'high' : 'ok';
  return (
    <div className="meter-wrap">
      <div className="meter" role="img" aria-label={`${hours} of ${cap} hours`}>
        <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="meter-val">
        <b>{hours}</b>/{cap}h
      </span>
    </div>
  );
}

function rosterColumns(cap: number): Column<PersonRow>[] {
  return [
    {
      key: 'person',
      header: 'Person',
      render: (p) => (
        <span className="cell-name row gap-3 center">
          <Avatar name={p.name} size={32} />
          <span className="col">
            <b>{p.name}</b>
            <span className="cell-sub">{p.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'roles',
      header: 'Role(s)',
      render: (p) => (
        <span className="row gap-1 wrap">
          {[...p.roles]
            .sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b))
            .map((r) => (
              <Tag key={r} kind={ROLE_META[r].kind}>
                <span title={ROLE_META[r].full}>{ROLE_META[r].short}</span>
              </Tag>
            ))}
          {p.roles.length === 0 && <span className="t-meta">-</span>}
        </span>
      ),
    },
    {
      key: 'home',
      header: 'Home house',
      render: (p) => prettifyHouse(p.homeHouseId),
    },
    {
      key: 'hours',
      header: 'Weekly hours vs cap',
      render: (p) => <HoursMeter hours={p.weeklyHours} cap={cap} hasShifts={p.hasShifts} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) =>
        p.isActive ? (
          <Tag kind="green" icon="check">
            Active
          </Tag>
        ) : (
          <Tag kind="gray" dot>
            Inactive
          </Tag>
        ),
    },
    {
      key: 'actions',
      header: '',
      // S4: Fire is enabled per-row, but ONLY on active workers. An already-fired
      // (inactive) row shows nothing here — the Status cell carries the Inactive tag.
      render: (p) => (p.isActive ? <FireWorkerControl userId={p.userId} name={p.name} /> : null),
    },
  ];
}

export function PeopleRoster({ data }: { data: PeopleData }) {
  const rows = data.people;
  const active = rows.filter((p) => p.isActive).length;
  const workers = rows.filter((p) => p.roles.includes('sw')).length;

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow={`${data.houseName} · roster`}
        title="People"
        sub="Workers and managers at this house, with their roles, weekly hours against the cap, and status."
        actions={<HireWorkerControl houseName={data.houseName} />}
      />

      <div
        className="statstrip"
        style={{ gridTemplateColumns: 'repeat(3, 1fr)', margin: '16px 0 20px' }}
      >
        <div className="statcard">
          <span className="statcard-num">{rows.length}</span>
          <span className="statcard-label">People</span>
        </div>
        <div className="statcard">
          <span className="statcard-num" style={{ color: 'var(--success)' }}>
            {active}
          </span>
          <span className="statcard-label">Active</span>
        </div>
        <div className="statcard">
          <span className="statcard-num">{workers}</span>
          <span className="statcard-label">Student workers</span>
        </div>
      </div>

      <p className="t-helper" style={{ marginBottom: 8 }}>
        Weekly hours shown for the week of <span className="t-mono">{data.weekStartDate}</span> ·
        cap {data.cap}h ({data.capEnforcement}).
      </p>

      <DataTable
        columns={rosterColumns(data.cap)}
        rows={rows}
        getRowKey={(p) => p.userId}
        emptyText="No people are home-housed here yet."
      />
    </div>
  );
}
