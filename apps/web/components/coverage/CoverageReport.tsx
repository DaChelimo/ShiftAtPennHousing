'use client';

import Link from 'next/link';

import type { CoverageReportRow } from '../../lib/data/coverage';
import { EmptyState, PageHead, Tag } from '../ui';
import './coverage.css';

// The missed-coverage audit trail. Incidents lead, because they are the reason this
// report exists: a desk that went unstaffed, or a request nobody ever closed out.

const RANGES = [7, 30, 90];

function StateTag({ row }: { row: CoverageReportRow }) {
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

export function CoverageReport({ rows, days }: { rows: CoverageReportRow[]; days: number }) {
  const incidents = rows.filter((r) => r.isIncident);
  const sub =
    rows.length === 0
      ? `No Allied coverage was requested in the last ${String(days)} days.`
      : `${String(incidents.length)} incident${incidents.length === 1 ? '' : 's'} across ${String(rows.length)} coverage request${rows.length === 1 ? '' : 's'} in the last ${String(days)} days.`;

  return (
    <div className="page">
      <PageHead eyebrow="Coverage" title="Coverage report" sub={sub} />

      <div className="row gap-2" style={{ margin: '12px 0 16px' }}>
        {RANGES.map((d) => (
          <Link
            key={d}
            href={`/admin/coverage?days=${String(d)}`}
            className={`tag ${d === days ? 'tag-blue' : 'tag-outline'}`}
            data-testid={`coverage-range-${String(d)}`}
          >
            Last {d} days
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nothing to report"
            desc="Every Allied coverage request over the selected range will be listed here, with what happened to it."
            tone="neutral"
          />
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table" data-testid="coverage-report-table">
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
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={row.isIncident ? 'cov-report-incident' : ''}
                  data-testid="coverage-report-row"
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
      )}
    </div>
  );
}
