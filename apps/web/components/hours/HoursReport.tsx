'use client';

import { useState } from 'react';

import type { HoursReport as HoursReportData, HoursRow } from '../../lib/data/hours';
import { Avatar, Icon, PageHead } from '../ui';

const FLOAT_COLOR = 'var(--st-out-fg)';

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

// The floated-out chip is the one stat a manager wants to drill into: not just
// "how many hours" but "covering what, when" (the composition bar and its cap
// comparison told them neither, so both got cut). Collapsed it reads like any
// other stat; expanded it lists each coalesced shift with day, time and duration.
function FloatChip({ row }: { row: HoursRow }) {
  const [open, setOpen] = useState(false);
  const hasShifts = row.floatShifts.length > 0;

  return (
    <div className="hchip-wrap">
      <button
        type="button"
        className={`hchip ${hasShifts ? '' : 'hchip-empty'}`.trim()}
        onClick={() => hasShifts && setOpen((v) => !v)}
        disabled={!hasShifts}
        aria-expanded={hasShifts ? open : undefined}
      >
        <span className="t-mono">{row.floatedOutHours > 0 ? `${row.floatedOutHours}h` : '-'}</span>
        <span>Floated out</span>
        {hasShifts && (
          <>
            <span className="hchip-count">{row.floatShifts.length}</span>
            <Icon name={open ? 'chevUp' : 'chevDown'} size={14} />
          </>
        )}
      </button>
      {open && hasShifts && (
        <div className="hcard-detail">
          {row.floatShifts.map((s, i) => (
            <div className="hcard-shift-row" key={i}>
              <span className="hcard-shift-day">
                {s.dayLabel} · {s.dateLabel}
              </span>
              <span className="hcard-shift-time t-mono">
                {s.startLabel}&ndash;{s.endLabel}
              </span>
              <span className="hcard-shift-dur t-mono">{s.hours}h</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkerCard({ row }: { row: HoursRow }) {
  return (
    <div className="hcard">
      <div className="hcard-top">
        <span className="hcard-worker">
          <Avatar name={row.name} size={32} />
          <b>{row.name}</b>
        </span>
        <div className="hcard-stats">
          <Stat value={row.totalHours} label="Total" />
          <Stat value={row.homeHours} label="At home" />
          <FloatChip row={row} />
        </div>
      </div>
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
        <LegendItem color="var(--st-allied-fg)" label="Cross-house pickup" />
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
          <span className="statcard-num" style={{ color: 'var(--st-allied-fg)' }}>
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
            <WorkerCard row={row} key={row.userId} />
          ))}
        </div>
      )}
    </div>
  );
}
