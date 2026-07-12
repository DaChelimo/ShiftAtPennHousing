'use client';

import { AI_WEEKDAY_LABELS } from '@shift/core';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { acceptAiSchedule } from '../../lib/actions/aiSchedule';
import type { AiProposalDto } from '../../lib/ai/proposal';
import type { AiStreamEvent } from '../../lib/ai/streamTypes';
import { Button, Icon, Modal, Notification, Tag } from '../ui';

// AI schedule generator panel. Generation streams from a route handler so the
// SM watches the week build one day at a time in the real grid (the live
// preview is lifted to the builder via onPreviewChange); this panel carries
// the status, the score summary, and Accept / Discard. Accepting only writes
// a draft the SM can still edit before publishing.

type PanelProps = {
  houseId: string;
  periodId: string | null;
  published: boolean;
  deadlineOpen: boolean;
  // Live proposal painted into the builder grid (blockId -> userIds). {} clears
  // the grid to build from scratch; null removes the preview entirely. Optional
  // so the panel is usable without the grid-fill wiring.
  onPreviewChange?: (preview: Record<string, string[]> | null) => void;
};

const NO_PREVIEW = (): void => {
  /* grid-fill wiring not attached */
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

function durationLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${String(s)}s`;
  return `${String(Math.floor(s / 60))}m ${String(s % 60)}s`;
}

function costLabel(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function dayName(weekday: number): string {
  return AI_WEEKDAY_LABELS[weekday] ?? `Day ${String(weekday + 1)}`;
}

export function AiSchedulePanel({
  houseId,
  periodId,
  published,
  deadlineOpen,
  onPreviewChange,
}: PanelProps) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [phaseText, setPhaseText] = useState('');
  const [progress, setProgress] = useState(0);
  const [proposal, setProposal] = useState<AiProposalDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const onPreview = useRef(onPreviewChange ?? NO_PREVIEW);
  onPreview.current = onPreviewChange ?? NO_PREVIEW;

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

  const clearPreview = () => onPreview.current(null);

  const onGenerate = async () => {
    setError(null);
    setProposal(null);
    setElapsed(0);
    setProgress(0);
    setPhaseText('Reading everyone’s preferences');
    setRunning(true);
    onPreview.current({}); // clear the grid so the week builds from scratch

    const preview: Record<string, string[]> = {};
    try {
      const resp = await fetch('/api/schedule/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ houseId }),
      });
      if (!resp.ok || resp.body === null) {
        throw new Error('The generator could not be reached. Try again.');
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamError: string | null = null;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf('\n');
        while (nl >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          nl = buf.indexOf('\n');
          if (line.length === 0) continue;
          const ev = JSON.parse(line) as AiStreamEvent;
          switch (ev.t) {
            case 'phase':
              if (ev.phase === 'planning') setPhaseText('Planning the week');
              else if (ev.phase === 'planned') setPhaseText('Strategy set. Building the schedule.');
              else {
                setPhaseText('Finishing up');
                setProgress(1);
              }
              break;
            case 'day-start':
              setPhaseText(`Scheduling ${dayName(ev.weekday)}`);
              setProgress(ev.dayCount > 0 ? ev.dayIndex / ev.dayCount : 0);
              break;
            case 'day-repair':
              setPhaseText(`Adjusting ${dayName(ev.weekday)} to fit the rules`);
              break;
            case 'day-fill':
              for (const a of ev.assignments) {
                (preview[a.blockId] ??= []).push(a.workerId);
              }
              onPreview.current({ ...preview });
              break;
            case 'result': {
              setProposal(ev.data);
              const finalPreview: Record<string, string[]> = {};
              for (const a of ev.data.assignments) {
                (finalPreview[a.blockId] ??= []).push(a.workerId);
              }
              onPreview.current(finalPreview);
              setPhaseText('');
              break;
            }
            case 'error':
              streamError = ev.message;
              break;
          }
        }
      }
      if (streamError !== null) {
        setError(streamError);
        clearPreview();
      }
    } catch {
      setError('Schedule generation failed. Try again.');
      clearPreview();
    } finally {
      setRunning(false);
    }
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
        setConfirmOpen(false);
        if (res.ok) {
          setProposal(null);
          clearPreview();
          router.refresh();
        } else {
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

  const onDiscard = () => {
    setProposal(null);
    setError(null);
    clearPreview();
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
            Builds a full draft week from submitted preferences, filling the grid as it goes. Every
            hard rule is checked by code. You review, edit, and publish; nothing is saved until you
            accept.
          </span>
        </div>
        <div className="row gap-2">
          {proposal !== null && !running && (
            <Button
              kind="ghost"
              icon="refresh"
              data-testid="ai-regenerate-button"
              onClick={() => void onGenerate()}
            >
              Regenerate
            </Button>
          )}
          {proposal === null && (
            <Button
              icon="layers"
              data-testid="ai-generate-button"
              disabled={running || blockedHint !== null}
              onClick={() => void onGenerate()}
            >
              {running ? 'Generating...' : 'Generate with AI'}
            </Button>
          )}
        </div>
      </div>

      {blockedHint !== null && <span className="t-meta">{blockedHint}</span>}

      {running && (
        <div className="col gap-1" data-testid="ai-progress">
          <div
            className="row gap-2"
            style={{ justifyContent: 'space-between', alignItems: 'baseline' }}
          >
            <span className="t-body" style={{ fontWeight: 600 }}>
              {phaseText}
              <span className="ai-ellipsis" aria-hidden="true" />
            </span>
            <span className="t-meta t-mono">{elapsed}s</span>
          </div>
          <div
            className="ai-progress-track"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
          >
            <div
              className="ai-progress-fill"
              style={{ width: `${String(Math.round(progress * 100))}%` }}
            />
          </div>
          <span className="t-meta">
            The schedule fills in above as each day is built. Keep this tab open.
          </span>
        </div>
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
          <Notification kind="info" title="Draft ready in the grid above">
            This is a draft only. Move, add, or remove any shift in the builder, then publish when
            you are ready. Nothing goes live until you press Publish.
          </Notification>

          <div className="row gap-2" style={{ flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span className="t-h2 t-mono">Score {proposal.score.toFixed(1)}</span>
            {BREAKDOWN_LABELS.map(({ key, label }) => (
              <Tag key={String(key)} kind="gray">
                {label} {proposal.breakdown[key].toFixed(1)}
              </Tag>
            ))}
          </div>

          <span className="t-meta" data-testid="ai-run-stats">
            {proposal.run.calls} model call{proposal.run.calls === 1 ? '' : 's'} ·{' '}
            {durationLabel(proposal.run.durationMs)} · {costLabel(proposal.run.costUsd)} ·{' '}
            {proposal.run.model}
          </span>

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

          <div className="col gap-1">
            <span className="t-label">Hours vs target</span>
            <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
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

          {proposal.oneHourShiftCount > 0 && (
            <span className="t-meta">
              {proposal.oneHourShiftCount} shift
              {proposal.oneHourShiftCount === 1 ? '' : 's'} shorter than 2 hours remain; adjust them
              in the grid if you like.
            </span>
          )}

          <div className="row gap-2">
            <Button
              icon="check"
              data-testid="ai-accept-button"
              onClick={() => setConfirmOpen(true)}
            >
              Accept as draft
            </Button>
            <Button kind="secondary" data-testid="ai-discard-button" onClick={onDiscard}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {confirmOpen && proposal !== null && (
        <Modal
          testId="ai-accept-confirm"
          eyebrow="AI schedule"
          title="Save this as your draft?"
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
                {accepting ? 'Saving draft...' : 'Accept as draft'}
              </Button>
            </>
          }
        >
          <p className="t-body">
            This replaces {proposal.existingDraftCount} existing draft assignment
            {proposal.existingDraftCount === 1 ? '' : 's'} for this house with the{' '}
            {proposal.assignments.length} proposed shifts. It stays a draft: you can still change
            any shift in the builder, and nothing is published until you press Publish.
          </p>
        </Modal>
      )}
    </section>
  );
}
