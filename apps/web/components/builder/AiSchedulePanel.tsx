'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  acceptAiSchedule,
  generateAiSchedule,
  type AiProposalDto,
} from '../../lib/actions/aiSchedule';
import { Button, Icon, Modal, Notification, Tag } from '../ui';

// AI schedule generator panel (BUILD SPEC deliverable): trigger the agentic
// loop for this house, preview the proposal (score breakdown, per-day runs,
// hours vs targets, unfilled seats), then Accept (replace-all draft write)
// or Discard. Proposals are never persisted; accept round-trips the
// assignments and the server re-validates them.

type PanelProps = {
  houseId: string;
  periodId: string | null;
  published: boolean;
  deadlineOpen: boolean;
};

const BREAKDOWN_LABELS: { key: keyof AiProposalDto['breakdown']; label: string }[] = [
  { key: 'preferenceSatisfaction', label: 'Preferences' },
  { key: 'targetFit', label: 'Target fit' },
  { key: 'shiftQuality', label: 'Shift quality' },
  { key: 'contiguity', label: 'Contiguity' },
  { key: 'fairness', label: 'Fairness' },
  { key: 'coverage', label: 'Coverage' },
];

function hoursLabel(hours: number): string {
  return `${String(hours)}h`;
}

export function AiSchedulePanel({ houseId, periodId, published, deadlineOpen }: PanelProps) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [proposal, setProposal] = useState<AiProposalDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  if (published) return null;

  const blockedHint =
    periodId === null
      ? 'No scheduling period covers this week yet.'
      : deadlineOpen
        ? 'The preference deadline is still open. Generate after it closes.'
        : null;

  const onGenerate = () => {
    setError(null);
    setProposal(null);
    setElapsed(0);
    setRunning(true);
    void generateAiSchedule({ houseId })
      .then((res) => {
        if (res.ok) setProposal(res.data);
        else setError(res.error);
      })
      .catch(() => {
        setError('Schedule generation failed. Try again.');
      })
      .finally(() => {
        setRunning(false);
      });
  };

  const onAccept = () => {
    if (proposal === null) return;
    setAccepting(true);
    setError(null);
    void acceptAiSchedule({
      houseId,
      periodId: proposal.periodId,
      assignments: proposal.assignments,
    })
      .then((res) => {
        if (res.ok) {
          setConfirmOpen(false);
          setProposal(null);
          router.refresh();
        } else {
          setConfirmOpen(false);
          setError(res.error);
        }
      })
      .catch(() => {
        setConfirmOpen(false);
        setError('Accepting failed. The proposal is still here; try accepting again.');
      })
      .finally(() => {
        setAccepting(false);
      });
  };

  return (
    <section
      data-testid="ai-schedule-panel"
      className="col gap-2"
      style={{ border: '1px solid var(--border, #d0d0d0)', padding: 16 }}
    >
      <div className="row gap-2" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="col gap-1">
          <div className="row gap-2">
            <Icon name="layers" size={18} />
            <span className="t-h3">AI schedule generator</span>
            <Tag kind="blue">Draft assistant</Tag>
          </div>
          <span className="t-helper">
            Builds a full draft week from submitted preferences. Every hard rule is checked by code;
            you review and accept before anything is saved.
          </span>
        </div>
        <div className="row gap-2">
          {proposal !== null && !running && (
            <Button
              kind="ghost"
              icon="refresh"
              data-testid="ai-regenerate-button"
              onClick={onGenerate}
            >
              Regenerate
            </Button>
          )}
          {proposal === null && (
            <Button
              icon="layers"
              data-testid="ai-generate-button"
              disabled={running || blockedHint !== null}
              onClick={onGenerate}
            >
              {running ? 'Generating...' : 'Generate with AI'}
            </Button>
          )}
        </div>
      </div>

      {blockedHint !== null && <span className="t-meta">{blockedHint}</span>}

      {running && (
        <Notification kind="info" title="Working on the schedule">
          The model drafts one day at a time and a validator checks every rule. This can take a few
          minutes. Keep this tab open. Elapsed: {elapsed}s
        </Notification>
      )}

      {error !== null && (
        <div data-testid="ai-error">
          <Notification kind="error" title="Generation problem">
            {error}
          </Notification>
        </div>
      )}

      {proposal !== null && (
        <div data-testid="ai-proposal" className="col gap-2">
          <div className="row gap-2" style={{ flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span className="t-h2 t-mono">Score {proposal.score.toFixed(1)}</span>
            {BREAKDOWN_LABELS.map(({ key, label }) => (
              <Tag key={key} kind="gray">
                {label} {proposal.breakdown[key].toFixed(1)}
              </Tag>
            ))}
            <span className="t-meta">
              {proposal.diagnostics.llmCallCount} model calls ·{' '}
              {proposal.diagnostics.candidateScores.length} candidate
              {proposal.diagnostics.candidateScores.length === 1 ? '' : 's'}
            </span>
          </div>

          {proposal.unfilledSeats.length > 0 && (
            <Notification
              kind={proposal.unfilledSeats.some((s) => s.fillable) ? 'warning' : 'info'}
              title={`${String(proposal.unfilledSeats.length)} open seat${proposal.unfilledSeats.length === 1 ? '' : 's'} remain`}
            >
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {proposal.unfilledSeats.slice(0, 8).map((seat, i) => (
                  <li key={i}>
                    {seat.dayLabel} {seat.timeLabel} · {seat.open} seat
                    {seat.open === 1 ? '' : 's'}
                    {seat.fillable ? '' : ' · no eligible submitter'}
                  </li>
                ))}
                {proposal.unfilledSeats.length > 8 && (
                  <li>and {proposal.unfilledSeats.length - 8} more</li>
                )}
              </ul>
            </Notification>
          )}

          {proposal.oneHourShiftCount > 0 && (
            <span className="t-meta">
              {proposal.oneHourShiftCount} short shift
              {proposal.oneHourShiftCount === 1 ? '' : 's'} of an hour or less survived; you can
              adjust them in the grid after accepting.
            </span>
          )}

          <div className="row gap-2" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="col gap-1" style={{ flex: '2 1 320px' }}>
              <span className="t-label">Proposed week</span>
              {proposal.days.map((day) => (
                <div key={day.dayLabel} className="col gap-1">
                  <span className="t-eyebrow">{day.dayLabel}</span>
                  {day.runs.length === 0 ? (
                    <span className="t-meta">No assignments</span>
                  ) : (
                    day.runs.map((run, i) => (
                      <span key={i} className="t-body">
                        {run.startLabel} to {run.endLabel} · {run.workerName} ·{' '}
                        {hoursLabel(run.hours)}
                        {run.preferredBlocks > 0 ? ' · preferred time' : ''}
                      </span>
                    ))
                  )}
                </div>
              ))}
            </div>
            <div className="col gap-1" style={{ flex: '1 1 220px' }}>
              <span className="t-label">Hours vs target</span>
              {proposal.workers.map((worker) => (
                <span key={worker.workerId} className="t-body row gap-1">
                  {worker.name}: {hoursLabel(worker.hours)}
                  {worker.targetHours !== null && <> of {hoursLabel(worker.targetHours)}</>}
                  {worker.targetHours !== null &&
                    Math.abs(worker.hours - worker.targetHours) > 2 && (
                      <Tag kind="amber">{worker.hours > worker.targetHours ? 'over' : 'under'}</Tag>
                    )}
                </span>
              ))}
            </div>
          </div>

          <div className="row gap-2">
            <Button
              icon="check"
              data-testid="ai-accept-button"
              onClick={() => setConfirmOpen(true)}
            >
              Accept and write drafts
            </Button>
            <Button
              kind="secondary"
              data-testid="ai-discard-button"
              onClick={() => {
                setProposal(null);
                setError(null);
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      {confirmOpen && proposal !== null && (
        <Modal
          testId="ai-accept-confirm"
          eyebrow="AI schedule"
          title="Replace drafts with this schedule?"
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <Button kind="secondary" onClick={() => setConfirmOpen(false)} disabled={accepting}>
                Cancel
              </Button>
              <Button
                kind="primary"
                icon="check"
                data-testid="ai-accept-confirm-button"
                onClick={onAccept}
                disabled={accepting}
              >
                {accepting ? 'Writing drafts...' : 'Accept'}
              </Button>
            </>
          }
        >
          <p className="t-body">
            Accepting replaces {proposal.existingDraftCount} existing draft assignment
            {proposal.existingDraftCount === 1 ? '' : 's'} for this house with the proposed week (
            {proposal.assignments.length} assignments). Nothing is published; you can still adjust
            blocks in the builder and publish when ready.
          </p>
        </Modal>
      )}
    </section>
  );
}
