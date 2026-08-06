import type { HoursReport as HoursReportData, HoursRow, ShiftEntry } from '../../lib/data/hours';
import { Avatar, PageHead } from '../ui';

const FLOAT_COLOR = 'var(--st-out-fg)';
const PICKUP_COLOR = 'var(--st-pickup)';

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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="hcard-stat">
      <span className="hcard-stat-num t-mono">{value > 0 ? `${value}h` : '-'}</span>
      <span className="hcard-stat-label">{label}</span>
    </span>
  );
}

function ShiftTile({ entry, kind }: { entry: ShiftEntry; kind: 'float' | 'pickup' }) {
  return (
    <div className={`shift-tile shift-tile-${kind}`}>
      <span className="shift-tile-day">
        {entry.dayLabel} · {entry.dateLabel}
      </span>
      <span className="shift-tile-house">{entry.houseName}</span>
      <div className="shift-tile-meta">
        <span className="shift-tile-time t-mono">
          {entry.startLabel}&ndash;{entry.endLabel}
        </span>
        <span className="shift-tile-dur t-mono">{entry.hours}h</span>
      </div>
    </div>
  );
}

// Each category gets the full card width and its shifts wrap into a grid, so a
// busy worker (multiple houses in a week) never crowds a fixed-width column —
// the card just grows taller. A category with zero hours renders nothing, so a
// worker who only floats (the common case) doesn't carry an empty pickup section.
function ShiftSection({
  hours,
  count,
  label,
  color,
  kind,
  entries,
}: {
  hours: number;
  count: number;
  label: string;
  color: string;
  kind: 'float' | 'pickup';
  entries: ShiftEntry[];
}) {
  if (count === 0) return null;
  return (
    <div className="hcard-section">
      <div className="hcard-section-head">
        <span className="row gap-2 center">
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: color,
              display: 'inline-block',
            }}
          />
          <span className="hcard-section-label">{label}</span>
          <span className="hcard-section-count">{count}</span>
        </span>
        <span className="t-mono hcard-section-hours" style={{ color }}>
          {hours}h
        </span>
      </div>
      <div className="hcard-tiles">
        {entries.map((entry, i) => (
          <ShiftTile entry={entry} kind={kind} key={i} />
        ))}
      </div>
    </div>
  );
}

function WorkerCard({ row, houseName }: { row: HoursRow; houseName: string }) {
  return (
    <div className="hcard">
      <div className="hcard-top">
        <span className="hcard-worker">
          <Avatar name={row.name} size={32} />
          <b>{row.name}</b>
        </span>
        <div className="hcard-stats">
          <Stat value={row.totalHours} label="Total" />
          <Stat value={row.homeHours} label={`At ${houseName}`} />
        </div>
      </div>
      <ShiftSection
        hours={row.floatedOutHours}
        count={row.floatShifts.length}
        label="Floated out"
        color={FLOAT_COLOR}
        kind="float"
        entries={row.floatShifts}
      />
      <ShiftSection
        hours={row.pickupHours}
        count={row.pickupShifts.length}
        label="Cross-house pickup"
        color={PICKUP_COLOR}
        kind="pickup"
        entries={row.pickupShifts}
      />
    </div>
  );
}

export function HoursReport({ data }: { data: HoursReportData }) {
  const sum = (pick: (r: HoursRow) => number) => data.rows.reduce((acc, r) => acc + pick(r), 0);
  const totalHome = sum((r) => r.homeHours);
  const totalFloat = sum((r) => r.floatedOutHours);
  const totalPickup = sum((r) => r.pickupHours);
  const grand = totalHome + totalFloat + totalPickup;

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow={`${data.houseName} · week of ${data.weekStartDate}`}
        title="Hours report"
        sub="Each worker's weekly hours, decomposed by where the shift was worked."
      />

      <div className="row gap-4 wrap" style={{ margin: '4px 0 16px' }}>
        <LegendItem color="var(--brand)" label="At home" />
        <LegendItem color={FLOAT_COLOR} label="Floated out" />
        <LegendItem color={PICKUP_COLOR} label="Cross-house pickup" />
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
          <span className="statcard-num" style={{ color: 'var(--brand)' }}>
            {totalHome}
          </span>
          <span className="statcard-label">At home</span>
        </div>
        <div className="statcard">
          <span className="statcard-num" style={{ color: FLOAT_COLOR }}>
            {totalFloat}
          </span>
          <span className="statcard-label">Floated out</span>
        </div>
        <div className="statcard">
          <span className="statcard-num" style={{ color: PICKUP_COLOR }}>
            {totalPickup}
          </span>
          <span className="statcard-label">Cross-house pickup</span>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <p className="t-helper">No workers are home-housed here yet.</p>
      ) : (
        <div className="hcards">
          {data.rows.map((row) => (
            <WorkerCard row={row} houseName={data.houseName} key={row.userId} />
          ))}
        </div>
      )}
    </div>
  );
}
