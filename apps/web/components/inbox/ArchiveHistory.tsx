'use client';

import { useState } from 'react';

import type { CoverageArchiveRow } from '../../lib/data/coverage';
import { EmptyState, Tag } from '../ui';
import '../coverage/coverage.css';

// The Archive tab body. Replaces the old standalone /admin/coverage report (removed
// 2026-08-05): same source table (allied_coverage_requests, closed rows included), same
// audit purpose, now one tab inside the inbox instead of a second manager surface.
//
// The server always sends ARCHIVE_MAX_DAYS (30d) of rows; these chips filter that one
// payload client-side rather than re-fetching per range, so widening the range costs no
// round trip. Default is the tightest range: this is normally glanced at, not read —
// the wider ranges exist for the once-in-a-while "approving hours" lookback.
const RANGES: { label: string; hours: number }[] = [
  { label: '24 hours', hours: 24 },
  { label: '1 week', hours: 7 * 24 },
  { label: '1 month', hours: 30 * 24 },
];

function StateTag({ row }: { row: CoverageArchiveRow }) {
  if (row.outcome === 'desk_unstaffed') {
    return (
      <Tag kind="red" icon="warnFill">
        Desk unstaffed
      </Tag>
    );
  }
  if (row.state === 'overdue') {
    return (
      <Tag kind="red" icon="warnFill">
        Never closed out
      </Tag>
    );
  }
  if (row.outcomeLabel !== null) {
    return (
      <Tag kind="green" icon="check">
        {row.outcomeLabel}
      </Tag>
    );
  }
  return <Tag kind="gray">Open</Tag>;
}

export function ArchiveHistory({ rows }: { rows: CoverageArchiveRow[] }) {
  const [rangeHours, setRangeHours] = useState(RANGES[0].hours);

  const cutoffMs = Date.now() - rangeHours * 60 * 60 * 1000;
  const visible = rows.filter((r) => new Date(r.windowStartIso).getTime() >= cutoffMs);
  const incidents = visible.filter((r) => r.isIncident);

  return (
    <div data-testid="inbox-archive-history">
      <div className="row gap-2" style={{ margin: '0 0 16px' }}>
        {RANGES.map((r) => (
          <button
            key={r.hours}
            type="button"
            onClick={() => setRangeHours(r.hours)}
            className={`tag ${r.hours === rangeHours ? 'tag-blue' : 'tag-outline'}`}
            data-testid={`archive-range-${String(r.hours)}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nothing archived"
            desc="Every Allied coverage request in the selected range will be listed here, with what happened to it."
            tone="neutral"
          />
        </div>
      ) : (
        <>
          {incidents.length > 0 && (
            <div className="inbox-group-label muted" style={{ marginBottom: 8 }}>
              {incidents.length} incident{incidents.length === 1 ? '' : 's'} in this range
            </div>
          )}
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="table" data-testid="inbox-archive-table">
              <thead>
                <tr>
                  <th>House</th>
                  <th>Coverage window</th>
                  <th>Reason</th>
                  <th>Reached</th>
                  <th>Outcome</th>
                  <th>Closed by</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.id}
                    className={row.isIncident ? 'cov-report-incident' : ''}
                    data-testid="inbox-archive-row"
                    data-incident={row.isIncident ? 'true' : 'false'}
                  >
                    <td>{row.houseName}</td>
                    <td>
                      {row.dateLabel}
                      <br />
                      <span className="t-mono">{row.windowLabel}</span>
                    </td>
                    <td>{row.reason}</td>
                    <td>{row.rungLabel}</td>
                    <td>
                      <StateTag row={row} />
                      {row.closeNote !== null && (
                        <div className="cov-report-note">{row.closeNote}</div>
                      )}
                      {row.incidentReason !== null && row.closeNote === null && (
                        <div className="cov-report-note">{row.incidentReason}</div>
                      )}
                    </td>
                    <td>{row.closedByName ?? row.acknowledgedByName ?? 'Nobody'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
