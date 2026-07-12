'use client';

import {
  brushOf,
  buildSubmitPayload,
  buildWeekLayout,
  clampTarget,
  dayHasPaint,
  dragBrushForStart,
  effectiveTarget,
  paint,
  PREF_BRUSHES,
  PREF_TARGET_STEP,
  type PrefBrush,
  type PrefGrid,
} from '@shift/core';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { submitPreferencesForWorker } from '../../lib/actions/preferences';
import { submitPreferences } from '../../lib/actions/worker/preferences';
import type { WorkerPreferenceBoard } from '../../lib/data/worker/preferences';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Notification } from '../ui/Notification';
import { PageHead } from '../ui/PageHead';
import { Toggle } from '../ui/Toggle';

const BRUSH_LABEL: Record<PrefBrush, string> = {
  preferred: 'Preferred',
  available: 'Available',
  cannot: 'Cannot work',
};

// When a schedule builder opens a roster member from /admin/preferences, the same
// paint grid is reused to author that worker's preferences on their behalf.
export type AdminPreferenceContext = {
  targetUserId: string;
  targetName: string;
  /** Where the back link returns to (the oversight roster, house-scoped). */
  backHref: string;
};

export function PreferenceBoard({
  board,
  admin,
}: {
  board: WorkerPreferenceBoard;
  admin?: AdminPreferenceContext;
}) {
  const { period } = board;
  const adminMode = admin != null;
  const layout = buildWeekLayout(board.blocks);
  // Managers override the deadline (they may author after the window closes); the
  // worker's own board stays read-only once the deadline passes.
  const readOnly = adminMode ? false : !board.deadlineOpen;
  // The deadline has passed but a manager is still editing (override note).
  const deadlinePassedOverride = adminMode && !board.deadlineOpen;

  const [grid, setGrid] = useState<PrefGrid>(board.initialGrid);
  const [brush, setBrush] = useState<PrefBrush>('preferred');
  const [targetHours, setTargetHours] = useState(board.targetHours);
  const [optedOut, setOptedOut] = useState(board.optedOut);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  const painting = useRef(false);
  const dragBrush = useRef<PrefBrush>('preferred');

  // End any drag when the pointer is released anywhere (incl. outside the grid).
  useEffect(() => {
    const stop = () => {
      painting.current = false;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const onCellDown = useCallback(
    (blockId: string) => {
      if (readOnly) return;
      const next = dragBrushForStart(brushOf(grid, blockId), brush);
      dragBrush.current = next;
      painting.current = true;
      setGrid((g) => paint(g, blockId, next));
      setDirty(true);
      setResult(null);
    },
    [readOnly, grid, brush],
  );

  const onCellEnter = useCallback(
    (blockId: string) => {
      if (readOnly || !painting.current) return;
      setGrid((g) => paint(g, blockId, dragBrush.current));
      setDirty(true);
    },
    [readOnly],
  );

  function stepTarget(delta: number) {
    setTargetHours((h) => clampTarget(h + delta, board.capHours));
    setDirty(true);
    setResult(null);
  }

  function toggleOptOut(next: boolean) {
    setOptedOut(next);
    setDirty(true);
    setResult(null);
  }

  async function onSubmit() {
    if (period === null || submitting) return;
    setSubmitting(true);
    setResult(null);
    const preferences = buildSubmitPayload(board.blocks, grid);
    const res = adminMode
      ? await submitPreferencesForWorker({
          targetUserId: admin.targetUserId,
          periodId: period.periodId,
          preferences,
          targetHours,
          optedOut,
        })
      : await submitPreferences({
          periodId: period.periodId,
          preferences,
          targetHours,
          optedOut,
        });
    setSubmitting(false);
    if (res.ok) {
      setDirty(false);
      setResult({
        kind: 'ok',
        message: adminMode
          ? `Saved ${admin.targetName}'s preferences.`
          : 'Your preferences were submitted.',
      });
    } else {
      setResult({ kind: 'error', message: res.error });
    }
  }

  if (period === null) {
    return (
      <div className="page">
        <PageHead
          eyebrow="Preferences"
          title={adminMode ? admin.targetName : 'Semester preferences'}
          actions={
            adminMode ? (
              <Link className="btn btn-tertiary btn-md" href={admin.backHref} data-testid="pref-back">
                <span>Back to roster</span>
              </Link>
            ) : undefined
          }
        />
        <Notification kind="info" title="No preference window open" testId="pref-no-window">
          {adminMode
            ? 'There is no scheduling period accepting preferences right now. Create a period to author availability.'
            : 'There is no scheduling period accepting preferences right now. Check back when your manager opens submissions.'}
        </Notification>
      </div>
    );
  }

  const effTarget = effectiveTarget(targetHours, optedOut);

  return (
    <div className="page" data-testid="preference-board">
      <PageHead
        eyebrow={adminMode ? `Preferences · ${period.periodName}` : 'Preferences'}
        title={adminMode ? admin.targetName : period.periodName}
        sub={
          adminMode
            ? `Editing on behalf of ${admin.targetName}. These choices repeat every week this season.`
            : period.deadlineLabel
              ? `Submit by ${period.deadlineLabel}. Your choices repeat every week this season.`
              : 'Your choices repeat every week this season.'
        }
        actions={
          adminMode ? (
            <Link className="btn btn-tertiary btn-md" href={admin.backHref} data-testid="pref-back">
              <span>Back to roster</span>
            </Link>
          ) : undefined
        }
      />

      {deadlinePassedOverride && (
        <Notification kind="info" title="Deadline has passed" testId="pref-override">
          The submission window for this period is closed. You are editing as a manager, so your
          changes will still be saved.
        </Notification>
      )}
      {readOnly && (
        <Notification kind="warning" title="Submissions are closed" testId="pref-closed">
          The deadline for this period has passed. Your preferences are shown read-only.
        </Notification>
      )}
      {board.submitted && !dirty && !readOnly && result === null && (
        <Notification
          kind="success"
          title={adminMode ? 'On file' : 'Submitted'}
          testId="pref-submitted"
        >
          {adminMode
            ? `${admin.targetName} has preferences on file for this period. Adjust and save any time.`
            : 'You have already submitted for this period. Adjust and resubmit any time before the deadline.'}
        </Notification>
      )}
      {result && (
        <Notification
          kind={result.kind === 'ok' ? 'success' : 'error'}
          title={result.kind === 'ok' ? 'Submitted' : 'Could not submit'}
          testId="pref-result"
        >
          {result.message}
        </Notification>
      )}

      <div className="pref-toolbar" data-testid="pref-toolbar">
        <div className="pref-brushes" role="group" aria-label="Paint mode">
          {PREF_BRUSHES.map((b) => (
            <button
              key={b}
              type="button"
              data-testid={`pref-brush-${b}`}
              className={`pref-brush pref-swatch-${b} ${brush === b ? 'is-active' : ''}`.trim()}
              aria-pressed={brush === b}
              disabled={readOnly || optedOut}
              onClick={() => setBrush(b)}
            >
              <span className={`pref-swatch pref-fill-${b}`} aria-hidden="true" />
              {BRUSH_LABEL[b]}
            </button>
          ))}
        </div>

        <div className="pref-target" data-testid="pref-target">
          <span className="t-eyebrow">Weekly target</span>
          <div className="pref-stepper">
            <button
              type="button"
              className="icon-btn"
              aria-label="Decrease target hours"
              data-testid="pref-target-dec"
              disabled={readOnly || optedOut || targetHours <= 0}
              onClick={() => stepTarget(-PREF_TARGET_STEP)}
            >
              <Icon name="close" size={14} />
            </button>
            <span className="pref-target-val" data-testid="pref-target-val">
              {effTarget}h
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Increase target hours"
              data-testid="pref-target-inc"
              disabled={readOnly || optedOut || targetHours >= board.capHours}
              onClick={() => stepTarget(PREF_TARGET_STEP)}
            >
              <Icon name="add" size={14} />
            </button>
          </div>
          <label className="pref-optout" data-testid="pref-optout">
            <Toggle checked={optedOut} onChange={toggleOptOut} disabled={readOnly} />
            No hours this season
          </label>
        </div>

        <div className="pref-actions">
          <Button
            kind="primary"
            data-testid="pref-submit"
            disabled={readOnly || submitting || !dirty}
            onClick={onSubmit}
            iconRight={submitting ? undefined : 'send'}
          >
            {adminMode
              ? submitting
                ? 'Saving...'
                : dirty
                  ? 'Save preferences'
                  : 'Saved'
              : submitting
                ? 'Submitting...'
                : dirty
                  ? 'Submit preferences'
                  : 'Submitted'}
          </Button>
        </div>
      </div>

      {optedOut ? (
        <Notification kind="info" title="Marked as no hours" testId="pref-optout-note">
          {adminMode
            ? `${admin.targetName} is marked as no hours this season. Turn off the no-hours toggle to paint availability.`
            : 'You have opted out of hours this season. Turn off the no-hours toggle to paint your availability.'}
        </Notification>
      ) : (
        <div
          className="pref-grid-wrap"
          data-testid="pref-grid"
          style={{ userSelect: 'none', touchAction: 'none' }}
        >
          <div
            className="pref-grid"
            style={{ gridTemplateColumns: `72px repeat(7, minmax(56px, 1fr))` }}
          >
            <div className="pref-corner" />
            {layout.dayLabels.map((label, weekday) => (
              <div key={label} className="pref-dayhead">
                {label}
                {dayHasPaint(board.blocks, grid, weekday) && (
                  <span className="pref-daydot" aria-hidden="true" />
                )}
              </div>
            ))}

            {layout.rows.map((row) => (
              <div key={row.minuteOfDay} className="pref-row" style={{ display: 'contents' }}>
                <div className="pref-time">{row.label}</div>
                {row.cells.map((blockId, weekday) => {
                  if (blockId === null) {
                    return <div key={weekday} className="pref-cell pref-cell-empty" />;
                  }
                  const b = brushOf(grid, blockId);
                  return (
                    <button
                      key={weekday}
                      type="button"
                      className={`pref-cell pref-fill-${b}`}
                      data-testid={`pref-cell-${blockId}`}
                      data-brush={b}
                      aria-label={`${layout.dayLabels[weekday]} ${row.label}: ${BRUSH_LABEL[b]}`}
                      disabled={readOnly}
                      onPointerDown={() => onCellDown(blockId)}
                      onPointerEnter={() => onCellEnter(blockId)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
