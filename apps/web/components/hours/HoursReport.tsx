import type { HoursReport as HoursReportData, HoursRow } from '../../lib/data/hours';
import { Avatar, type Column, DataTable, PageHead, Tag } from '../ui';

const BUCKETS = {
  home: { color: 'var(--brand)', label: 'At home' },
  float: { color: 'var(--st-out-fg)', label: 'Floated out' },
  pickup: { color: 'var(--st-allied-fg)', label: 'Cross-house pickup' },
};

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="row gap-1 center">
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: color,
          display: 'inline-block',
        }}
      />
      <span className="t-meta">{label}</span>
    </span>
  );
}

function hoursCell(value: number, color?: string) {
  if (value <= 0) return <span className="t-meta">-</span>;
  return (
    <span className="t-mono" style={{ color }}>
      {value}h
    </span>
  );
}

function CompositionBar({ row, cap }: { row: HoursRow; cap: number }) {
  const { homeHours: h, floatedOutHours: f, pickupHours: p, totalHours: total } = row;
  const denom = Math.max(cap, total, 0.0001);
  const pct = (x: number) => `${(x / denom) * 100}%`;
  const over = cap > 0 && total > cap;
  return (
    <div className="meter-wrap">
      <div
        role="img"
        aria-label={`${h}h at home, ${f}h floated out, ${p}h cross-house pickup of a ${cap}h cap`}
        style={{
          display: 'flex',
          height: 8,
          flex: 1,
          minWidth: 120,
          borderRadius: 99,
          overflow: 'hidden',
          background: 'var(--surface-3)',
        }}
      >
        <span style={{ width: pct(h), background: BUCKETS.home.color }} />
        <span style={{ width: pct(f), background: BUCKETS.float.color }} />
        <span style={{ width: pct(p), background: BUCKETS.pickup.color }} />
      </div>
      <span className="meter-val">
        <b style={over ? { color: 'var(--st-danger)' } : undefined}>{total}</b>/{cap}h
      </span>
    </div>
  );
}

function columns(cap: number): Column<HoursRow>[] {
  return [
    {
      key: 'worker',
      header: 'Worker',
      render: (r) => (
        <span className="cell-name row gap-3 center">
          <Avatar name={r.name} size={28} />
          <b>{r.name}</b>
        </span>
      ),
    },
    { key: 'home', header: 'At home', numeric: true, render: (r) => hoursCell(r.homeHours) },
    {
      key: 'float',
      header: 'Floated out',
      numeric: true,
      render: (r) => hoursCell(r.floatedOutHours, BUCKETS.float.color),
    },
    {
      key: 'pickup',
      header: 'Cross-house pickup',
      numeric: true,
      render: (r) => hoursCell(r.pickupHours, BUCKETS.pickup.color),
    },
    {
      key: 'composition',
      header: 'Total vs cap',
      render: (r) => <CompositionBar row={r} cap={cap} />,
    },
  ];
}

export function HoursReport({ data }: { data: HoursReportData }) {
  const sum = (pick: (r: HoursRow) => number) => data.rows.reduce((acc, r) => acc + pick(r), 0);
  const totalHome = sum((r) => r.homeHours);
  const totalFloat = sum((r) => r.floatedOutHours);
  const totalPickup = sum((r) => r.pickupHours);
  const grand = totalHome + totalFloat + totalPickup;
  const overCount = data.rows.filter((r) => data.cap > 0 && r.totalHours > data.cap).length;

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow={`${data.houseName} · week of ${data.weekStartDate}`}
        title="Hours report"
        sub="Each worker's weekly hours, decomposed by where the shift was worked, against the week's cap."
      />

      <div className="row gap-4 wrap" style={{ margin: '4px 0 16px' }}>
        <LegendItem color={BUCKETS.home.color} label={BUCKETS.home.label} />
        <LegendItem color={BUCKETS.float.color} label={BUCKETS.float.label} />
        <LegendItem color={BUCKETS.pickup.color} label={BUCKETS.pickup.label} />
        <span className="t-meta">
          · cap {data.cap}h ({data.capEnforcement})
        </span>
      </div>

      <div
        className="statstrip"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}
      >
        <div className="statcard">
          <span className="statcard-num">{grand}</span>
          <span className="statcard-label">Total hours</span>
        </div>
        <div className="statcard">
          <span className="statcard-num" style={{ color: BUCKETS.home.color }}>
            {totalHome}
          </span>
          <span className="statcard-label">At home</span>
        </div>
        <div className="statcard">
          <span className="statcard-num" style={{ color: BUCKETS.float.color }}>
            {totalFloat}
          </span>
          <span className="statcard-label">Floated out</span>
        </div>
        <div className="statcard">
          <span className="statcard-num" style={{ color: BUCKETS.pickup.color }}>
            {totalPickup}
          </span>
          <span className="statcard-label">Cross-house pickup</span>
        </div>
      </div>

      {overCount > 0 && (
        <p className="row gap-2 center" style={{ marginBottom: 12 }}>
          <Tag kind="red" icon="warn">
            {overCount} over cap
          </Tag>
          <span className="t-meta">Workers whose total exceeds the {data.cap}h cap this week.</span>
        </p>
      )}

      <DataTable
        columns={columns(data.cap)}
        rows={data.rows}
        getRowKey={(r) => r.userId}
        emptyText="No workers are home-housed here yet."
      />
    </div>
  );
}
