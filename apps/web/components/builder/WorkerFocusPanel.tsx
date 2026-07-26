'use client';

// Schedule builder: the side panel shown when the SM CLICKS a drafted shift.
//
// Clicking a shift never edits the grid by itself (that is what dragging, or
// typing new times here, is for). It focuses a worker: the clicked shift and
// every other shift they hold this week light up in the grid, and this panel
// answers "what exactly is this shift, and how does it fit this person's
// week" with editable start/end times instead of a read-only block count.

import { useState } from 'react';

import type { BuilderBlock } from '../../lib/data/scheduleBuilder';
import { Avatar, Button, IconButton, Tag } from '../ui';

import { nyTime, type ShiftRun } from './gridModel';

// "Wed, Jun 3" from a NY YYYY-MM-DD day key. Parsed as UTC midnight and
// formatted in UTC so the label can never drift a day either way.
function dayLabel(dayKey: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${dayKey}T00:00:00Z`));
}

function hoursLabel(hours: number): string {
  return `${String(hours)}h`;
}

// The N+1 time boundaries a day's N blocks admit: every block's own start,
// plus the closing time after the last one. Typing a start/end pair only
// commits when both land on one of these, so a shift can never end up
// straddling a half-block or the house's actual open/close window.
function dayBoundaries(dayBlocks: BuilderBlock[]): string[] {
  if (dayBlocks.length === 0) return [];
  const starts = dayBlocks.map((b) => b.timeLabel);
  const last = dayBlocks[dayBlocks.length - 1]!;
  const closing = nyTime(new Date(new Date(last.startAtIso).getTime() + 30 * 60000));
  return [...starts, closing];
}

export function WorkerFocusPanel({
  name,
  focused,
  shifts,
  dayBlocks,
  targetHours,
  readOnly,
  onResizeShift,
  onRemoveShift,
  onClose,
}: {
  name: string;
  focused: ShiftRun;
  // Every shift this worker holds in the build week, focused one included: only
  // used here for the header's "N hours of M target, N shifts" summary.
  shifts: ShiftRun[];
  // This shift's own day, so a typed start/end can only land on a real block
  // boundary (see dayBoundaries above).
  dayBlocks: BuilderBlock[];
  targetHours: number | null;
  // AI preview or an already-published week: show the same information, but
  // without the controls that would write.
  readOnly: boolean;
  onResizeShift: (
    userId: string,
    dayKey: string,
    oldBlockIds: string[],
    newBlockIds: string[],
  ) => void;
  onRemoveShift: (shift: ShiftRun) => void;
  onClose: () => void;
}) {
  const totalHours = shifts.reduce((sum, s) => sum + s.hours, 0);
  const [start, end] = focused.label.split('-') as [string, string];
  const [startVal, setStartVal] = useState(start);
  const [endVal, setEndVal] = useState(end);
  const [invalid, setInvalid] = useState(false);
  // Re-sync the inputs whenever the underlying shift changes from outside this
  // panel (a grid handle drag, or focus moving to a different shift entirely).
  // Adjusting state during render (not an effect) on a prop-identity change is
  // React's own sanctioned pattern for this, and is the same one ScheduleBuilder
  // itself already uses for `prevData`/`data`.
  const [prevStartAtIso, setPrevStartAtIso] = useState(focused.startAtIso);
  if (focused.startAtIso !== prevStartAtIso) {
    setPrevStartAtIso(focused.startAtIso);
    setStartVal(start);
    setEndVal(end);
    setInvalid(false);
  }

  const boundaries = dayBoundaries(dayBlocks);

  const commit = (nextStart: string, nextEnd: string) => {
    const startIdx = dayBlocks.findIndex((b) => b.timeLabel === nextStart);
    const endIdx = boundaries.indexOf(nextEnd);
    if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const newBlockIds = dayBlocks.slice(startIdx, endIdx).map((b) => b.blockId);
    const unchanged =
      newBlockIds.length === focused.blockIds.length &&
      newBlockIds.every((id, i) => id === focused.blockIds[i]);
    if (unchanged) return;
    onResizeShift(focused.userId, focused.dayKey, focused.blockIds, newBlockIds);
  };

  return (
    <div data-testid="worker-focus-panel" className="side-focus">
      <div className="side-head">
        <div className="row gap-2">
          <Avatar name={name} size={32} />
          <div className="col gap-1">
            <span className="t-eyebrow">Focused worker</span>
            <span className="t-h3">{name}</span>
            <span className="t-meta">
              {hoursLabel(totalHours)} this week
              {targetHours !== null && ` of ${hoursLabel(targetHours)} target`} ·{' '}
              {String(shifts.length)} {shifts.length === 1 ? 'shift' : 'shifts'}
            </span>
          </div>
        </div>
        <IconButton icon="close" label="Clear focus" onClick={onClose} />
      </div>

      <div className="focus-card is-current" data-testid="focus-current-shift">
        <div className="focus-card-head">
          <span className="t-label">This shift</span>
          <Tag kind="blue">Selected</Tag>
        </div>
        <div className="focus-shift-main">
          <b className="t-h3">{dayLabel(focused.dayKey)}</b>
          {readOnly ? (
            <span className="t-mono focus-shift-range">{focused.label}</span>
          ) : (
            <div className={`focus-time-row ${invalid ? 'is-invalid' : ''}`.trim()}>
              <input
                type="time"
                step={1800}
                className="focus-time-input"
                data-testid="focus-start-time"
                aria-label="Start time"
                value={startVal}
                onChange={(e) => {
                  setStartVal(e.target.value);
                  if (e.target.value !== '') commit(e.target.value, endVal);
                }}
              />
              <span className="t-meta">to</span>
              <input
                type="time"
                step={1800}
                className="focus-time-input"
                data-testid="focus-end-time"
                aria-label="End time"
                value={endVal}
                onChange={(e) => {
                  setEndVal(e.target.value);
                  if (e.target.value !== '') commit(startVal, e.target.value);
                }}
              />
            </div>
          )}
          {invalid && !readOnly && (
            <span className="t-meta focus-time-error">
              That range does not line up with this house&apos;s schedule.
            </span>
          )}
          <span className="focus-shift-duration">{hoursLabel(focused.hours)}</span>
        </div>
        {!readOnly && (
          <Button
            kind="danger"
            full
            icon="trash"
            data-testid="focus-remove-shift"
            onClick={() => onRemoveShift(focused)}
          >
            Remove this shift
          </Button>
        )}
      </div>
    </div>
  );
}
