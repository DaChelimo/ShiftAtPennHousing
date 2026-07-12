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
  // Day stepper state: dayCount/dayLabels grow in as day-start events arrive
  // (the panel has no upfront list of the house's operating weekdays), doneCount
  // is "how many days are fully settled", activeIndex is the day being worked
  // right now (null once finalizing marks every day done).
  const [dayCount, setDayCount] = useState(0);
  const [dayLabels, setDayLabels] = useState<string[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activeKind, setActiveKind] = useState<'active' | 'repair'>('active');
  const dayCountRef = useRef(0);
  const doneCountRef = useRef(0);
  const [proposal, setProposal] = useState<AiProposalDto | null>(null);
  // Set when the user clicks Stop (not Stop and clear): whatever days had
  // already settled, reconstructed client-side from the same day-fill events
  // that painted the grid. There is no score/breakdown for this (only the
  // server-side loop can compute those, and by the time Stop takes effect the
  // client has already severed the connection to trigger it).
  const [stopped, setStopped] = useState<{
    assignments: { blockId: string; workerId: string }[];
    doneCount: number;
    dayCount: number;
  } | null>(null);
  const [stoppedConfirmOpen, setStoppedConfirmOpen] = useState(false);
  const [stoppedAccepting, setStoppedAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const stopModeRef = useRef<'keep' | 'clear' | null>(null);
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
    setStopped(null);
    setElapsed(0);
    setDayCount(0);
    setDayLabels([]);
    setDoneCount(0);
    setActiveIndex(null);
    setActiveKind('active');
    dayCountRef.current = 0;
    doneCountRef.current = 0;
    setPhaseText('Reading everyone’s preferences');
    setRunning(true);
    onPreview.current({}); // clear the grid so the week builds from scratch

    const controller = new AbortController();
    abortRef.current = controller;
    stopModeRef.current = null;

    const preview: Record<string, string[]> = {};
    try {
      const resp = await fetch('/api/schedule/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ houseId }),
        signal: controller.signal,
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
                doneCountRef.current = dayCountRef.current;
                setDoneCount(dayCountRef.current);
                setActiveIndex(null);
              }
              break;
            case 'day-start':
              dayCountRef.current = ev.dayCount;
              setDayCount(ev.dayCount);
              setDayLabels((prev) => {
                const next = [...prev];
                next[ev.dayIndex] = dayName(ev.weekday);
                return next;
              });
              doneCountRef.current = ev.dayIndex;
              setDoneCount(ev.dayIndex);
              setActiveIndex(ev.dayIndex);
              setActiveKind('active');
              setPhaseText(`Scheduling ${dayName(ev.weekday)}`);
              break;
            case 'day-repair':
              setActiveKind('repair');
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
      // Stop / Stop and clear both work by aborting this fetch, so an abort
      // here is the expected path for both, not a failure. stopModeRef says
      // which button the user pressed; anything else is a genuine network
      // failure.
      if (stopModeRef.current === 'clear') {
        clearPreview();
        setDayCount(0);
        setDayLabels([]);
        setDoneCount(0);
        setActiveIndex(null);
        setActiveKind('active');
        dayCountRef.current = 0;
        doneCountRef.current = 0;
      } else if (stopModeRef.current === 'keep') {
        setStopped({
          assignments: Object.entries(preview).flatMap(([blockId, workerIds]) =>
            workerIds.map((workerId) => ({ blockId, workerId })),
          ),
          doneCount: doneCountRef.current,
          dayCount: dayCountRef.current,
        });
      } else {
        setError('Schedule generation failed. Try again.');
        clearPreview();
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
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

  // Stop: keep whatever days already settled (still visible in the grid)
  // for review; Stop and clear: discard everything and return to idle.
  // Both work the same way underneath: abort the fetch, which the route
  // treats as a client disconnect and stops issuing further model calls.
  const onStop = () => {
    stopModeRef.current = 'keep';
    abortRef.current?.abort();
  };

  const onStopAndClear = () => {
    stopModeRef.current = 'clear';
    abortRef.current?.abort();
  };

  const onAcceptStopped = () => {
    if (stopped === null || periodId === null) return;
    setStoppedAccepting(true);
    setError(null);
    void acceptAiSchedule({ houseId, periodId, assignments: stopped.assignments })
      .then((res) => {
        setStoppedConfirmOpen(false);
        if (res.ok) {
          setStopped(null);
          clearPreview();
          router.refresh();
        } else {
          setError(res.error);
        }
      })
      .catch(() => {
        setStoppedConfirmOpen(false);
        setError('Accepting failed. The shifts are still in the grid; try accepting again.');
      })
      .finally(() => {
        setStoppedAccepting(false);
      });
  };

  const onDiscardStopped = () => {
    setStopped(null);
    setError(null);
    clearPreview();
  };

  return (
    <section
      data-testid="ai-schedule-panel"
      className="col gap-4"
      style={{ border: '1px solid var(--border, #d0d0d0)', padding: 16, marginBottom: 24 }}
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
          {(proposal !== null || stopped !== null) && !running && (
            <Button
              kind="ghost"
              icon="refresh"
              data-testid="ai-regenerate-button"
              onClick={() => void onGenerate()}
            >
              Regenerate
            </Button>
          )}
          {proposal === null && stopped === null && !running && (
            <Button
              icon="layers"
              data-testid="ai-generate-button"
              disabled={blockedHint !== null}
              onClick={() => void onGenerate()}
            >
              Generate with AI
            </Button>
          )}
          {running && (
            <>
              <Button
                kind="secondary"
                icon="power"
                data-testid="ai-stop-button"
                onClick={onStop}
              >
                Stop
              </Button>
              <Button
                kind="ghost"
                icon="trash"
                data-testid="ai-stop-clear-button"
                onClick={onStopAndClear}
              >
                Stop and clear
              </Button>
            </>
          )}
        </div>
      </div>

      {blockedHint !== null && <span className="t-meta">{blockedHint}</span>}

      {running && (
        <div className="ai-processing-card col gap-2" data-testid="ai-progress">
          <div
            className="row gap-2"
            style={{ justifyContent: 'space-between', alignItems: 'baseline' }}
          >
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <span className="ai-spinner" aria-hidden="true" />
              <span className="t-body" style={{ fontWeight: 600 }}>
                {phaseText}
              </span>
            </div>
            <span className="t-meta t-mono">{elapsed}s</span>
          </div>

          {dayCount > 0 && (
            <div
              className="ai-day-row"
              role="progressbar"
              aria-valuenow={Math.round((doneCount / dayCount) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={phaseText}
              data-testid="ai-day-stepper"
            >
              {Array.from({ length: dayCount }, (_, i) => {
                const isDone = i < doneCount;
                const isActive = activeIndex === i;
                const isRepair = isActive && activeKind === 'repair';
                const label = dayLabels[i] ?? '';
                return (
                  <div
                    key={i}
                    className={[
                      'ai-day-chip',
                      isDone ? 'is-done' : '',
                      isActive && !isRepair ? 'is-active' : '',
                      isRepair ? 'is-repair' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="ai-day-dot">
                      {isDone ? (
                        <Icon name="check" size={12} />
                      ) : isRepair ? (
                        <Icon name="warn" size={12} />
                      ) : (
                        label.slice(0, 1) || '·'
                      )}
                    </span>
                    <span className="ai-day-label t-mono">{label}</span>
                  </div>
                );
              })}
            </div>
          )}

          <span className="t-meta">
            The schedule fills in above as each day is built. Keep this tab open.
          </span>
        </div>
      )}

      {stopped !== null && (
        <div data-testid="ai-stopped" className="col gap-2">
          <Notification kind="warning" title="Generation stopped">
            You stopped the generator after {stopped.doneCount} of {stopped.dayCount} days.{' '}
            {stopped.assignments.length} shift{stopped.assignments.length === 1 ? '' : 's'} from
            the completed days are shown in the grid above. Accept them as your draft, or discard
            to clear the grid.
          </Notification>
          <div className="row gap-2">
            <Button
              icon="check"
              data-testid="ai-stopped-accept-button"
              onClick={() => setStoppedConfirmOpen(true)}
            >
              Accept as draft
            </Button>
            <Button kind="secondary" data-testid="ai-stopped-discard-button" onClick={onDiscardStopped}>
              Discard
            </Button>
          </div>
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

      {stoppedConfirmOpen && stopped !== null && (
        <Modal
          testId="ai-stopped-accept-confirm"
          eyebrow="AI schedule"
          title="Save these shifts as your draft?"
          onClose={() => setStoppedConfirmOpen(false)}
          footer={
            <>
              <Button
                kind="secondary"
                onClick={() => setStoppedConfirmOpen(false)}
                disabled={stoppedAccepting}
              >
                Cancel
              </Button>
              <Button
                kind="primary"
                icon="check"
                data-testid="ai-stopped-accept-confirm-button"
                onClick={onAcceptStopped}
                disabled={stoppedAccepting}
              >
                {stoppedAccepting ? 'Saving draft...' : 'Accept as draft'}
              </Button>
            </>
          }
        >
          <p className="t-body">
            This replaces any existing draft for this house with the {stopped.assignments.length}{' '}
            shifts from the {stopped.doneCount} days the generator finished before you stopped it.
            It stays a draft: you can still change any shift in the builder, and nothing is
            published until you press Publish.
          </p>
        </Modal>
      )}
    </section>
  );
}
