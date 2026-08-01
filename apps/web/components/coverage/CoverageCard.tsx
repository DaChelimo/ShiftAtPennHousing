'use client';

import { outcomeLabel, requiresCloseNote, type CoverageOutcome } from '@shift/core';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { acknowledgeCoverageRequest, closeCoverageRequest } from '../../lib/actions/coverage';
import type { CoverageItem } from '../../lib/data/coverage';
import { Button, Icon, Tag } from '../ui';
import './coverage.css';

// One Allied coverage request. Leads with HOUSE, DATE, WINDOW: the three things a
// manager scans first.
//
// Two distinct controls, never one:
//   "I am handling this" -> acknowledge. Stops the escalation ladder.
//   "Close out"          -> record what actually happened. Requires an outcome.
// The predecessor was a single "Resolved" checkbox, which conflated the two and wrote
// no outcome at all, so a desk that went empty left no trace.

const OUTCOMES: CoverageOutcome[] = [
  'allied_secured',
  'covered_internally',
  'desk_unstaffed',
  'no_longer_needed',
];

// Live countdown to the next rung. A manager needs to know whether this is about to
// become someone else's problem, or already is.
function Countdown({ deadlineIso }: { deadlineIso: string }) {
  const [remaining, setRemaining] = useState(() => Date.parse(deadlineIso) - Date.now());

  useEffect(() => {
    const id = setInterval(() => setRemaining(Date.parse(deadlineIso) - Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineIso]);

  if (remaining <= 0) return <span className="cov-countdown">escalating now</span>;
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return (
    <span className="cov-countdown t-mono">
      {mins}m {String(secs).padStart(2, '0')}s
    </span>
  );
}

function StatusBadge({ item }: { item: CoverageItem }) {
  if (item.state === 'overdue') {
    return (
      <Tag kind="red" icon="warnFill">
        Overdue
      </Tag>
    );
  }
  if (item.state === 'acknowledged') {
    return (
      <Tag kind="blue" icon="check">
        Being handled
      </Tag>
    );
  }
  return (
    <Tag kind="red" icon="warnFill">
      Action required
    </Tag>
  );
}

function CloseOutForm({
  item,
  onDone,
  onCancel,
}: {
  item: CoverageItem;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [outcome, setOutcome] = useState<CoverageOutcome>('allied_secured');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRequired = requiresCloseNote(outcome);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await closeCoverageRequest({
      requestId: item.id,
      outcome,
      note: note.trim() === '' ? null : note,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone();
  }

  return (
    <div className="cov-closeout" data-testid="coverage-closeout">
      <div className="cov-closeout-title">What happened?</div>
      <div className="cov-outcomes">
        {OUTCOMES.map((o) => (
          <label key={o} className="cov-outcome">
            <input
              type="radio"
              name={`outcome-${item.id}`}
              value={o}
              checked={outcome === o}
              onChange={() => setOutcome(o)}
              data-testid={`coverage-outcome-${o}`}
            />
            <span>{outcomeLabel(o)}</span>
          </label>
        ))}
      </div>

      <label className="cov-note-label">
        <span>Note{noteRequired ? ' (required)' : ' (optional)'}</span>
        <textarea
          className="cov-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          data-testid="coverage-close-note"
          placeholder={
            noteRequired
              ? 'A desk went unstaffed. Record what happened so this can be reviewed.'
              : 'Anything worth recording.'
          }
        />
      </label>

      <div className="row gap-2">
        <Button
          kind="primary"
          size="sm"
          disabled={busy || (noteRequired && note.trim() === '')}
          onClick={submit}
          data-testid="coverage-close-submit"
        >
          Close out
        </Button>
        <Button kind="tertiary" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {error !== null && <div className="cov-error">{error}</div>}
    </div>
  );
}

export function CoverageCard({ item }: { item: CoverageItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  async function onAcknowledge() {
    setBusy(true);
    setError(null);
    const res = await acknowledgeCoverageRequest({ requestId: item.id });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div
      className={`cov-card ${item.actionRequired ? 'is-urgent' : ''} ${
        item.state === 'overdue' ? 'is-overdue' : ''
      }`.trim()}
      data-testid="coverage-card"
      data-state={item.state}
    >
      <div className="cov-card-top">
        <span className="cov-house">
          <span className="cov-house-icon">
            <Icon name="shield" size={15} />
          </span>
          <b className="cov-house-name">{item.houseName}</b>
        </span>
        <StatusBadge item={item} />
      </div>

      <div className="cov-when">
        <span className="cov-date">{item.dateLabel}</span>
        <span className="cov-window t-mono">{item.windowLabel}</span>
      </div>

      <div className="cov-reason">{item.reason}</div>

      {/* Who holds it right now, and when it moves. A manager must never have to guess
          whether somebody else already has this. */}
      <div className="cov-ladder">
        {item.state === 'acknowledged' ? (
          <span>Being handled by {item.acknowledgedByName ?? 'a manager'}.</span>
        ) : (
          <>
            <span>
              With {item.recipientName ?? item.rungLabel} ({item.rungLabel})
            </span>
            {item.rungDeadlineIso !== null && (
              <span className="cov-escalates">
                {' '}
                escalates in <Countdown deadlineIso={item.rungDeadlineIso} />
              </span>
            )}
            {item.rungDeadlineIso === null && item.rung === 'hmod' && (
              <span className="cov-escalates"> last contact on the ladder</span>
            )}
          </>
        )}
      </div>

      {closing ? (
        <CloseOutForm
          item={item}
          onDone={() => {
            setClosing(false);
            router.refresh();
          }}
          onCancel={() => setClosing(false)}
        />
      ) : (
        <div className="cov-foot">
          {item.state !== 'acknowledged' && (
            <Button
              kind="primary"
              size="sm"
              disabled={busy}
              onClick={onAcknowledge}
              data-testid="coverage-acknowledge"
            >
              I am handling this
            </Button>
          )}
          <Button
            kind="secondary"
            size="sm"
            onClick={() => setClosing(true)}
            data-testid="coverage-close-open"
          >
            Close out
          </Button>
        </div>
      )}

      {error !== null && <div className="cov-error">{error}</div>}
    </div>
  );
}
