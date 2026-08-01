'use client';

import type { CoverageData } from '../../lib/data/coverage';
import { EmptyState } from '../ui';

import { CoverageCard } from './CoverageCard';
import './coverage.css';

// The Coverage tab body. Three groups, in the order a manager needs them:
//
//   1. Overdue                    — a coverage window has already passed unrecorded.
//   2. Needs a manager            — nobody has taken it yet; the ladder is running.
//   3. Being handled              — acknowledged, but the outcome is still unrecorded.
//
// Group 3 is the one the predecessor lost entirely: it archived on window end whether
// or not anyone had acted, so "somebody said they had it and then nothing happened"
// left no trace at all.
export function CoverageSection({ data }: { data: CoverageData }) {
  if (data.openCount === 0) {
    return (
      <div className="card">
        <EmptyState
          title="All clear. No coverage needed"
          desc="Allied coverage requests appear here the moment escalation runs out of options."
        />
      </div>
    );
  }

  return (
    <>
      {data.overdue.length > 0 && (
        <>
          <div className="inbox-group-label">Overdue</div>
          <div className="cov-grid" data-testid="coverage-overdue-grid">
            {data.overdue.map((item) => (
              <CoverageCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}

      {data.awaitingAck.length > 0 && (
        <>
          <div className="inbox-group-label">Needs a manager</div>
          <div className="cov-grid" data-testid="coverage-awaiting-grid">
            {data.awaitingAck.map((item) => (
              <CoverageCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}

      {data.acknowledged.length > 0 && (
        <>
          <div className="inbox-group-label muted">Being handled, not yet closed out</div>
          <div className="cov-grid" data-testid="coverage-acknowledged-grid">
            {data.acknowledged.map((item) => (
              <CoverageCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
