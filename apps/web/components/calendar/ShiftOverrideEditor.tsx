'use client';

import { useEffect, useRef, useState } from 'react';

import {
  assignWorker,
  removeWorker,
  type AssignAdvisory,
  type OverrideScope,
} from '../../lib/actions/override';
import type { AssignableWorker, CalShift } from '../../lib/data/calendar';
import { Avatar, Button, Icon, Modal, Notification } from '../ui';

import { blockLabel, fmtH, shiftOriginMinutes, spanLabel } from './format';

const ADVISORY_LABEL: Record<string, string> = {
  cannot: 'This worker marked “cannot work” for this shift.',
  opted_out: 'This worker opted out of hours this period.',
  soft_cap: 'This assignment exceeds the worker’s soft (20h) weekly cap.',
  over_target: 'This assignment exceeds the worker’s target hours.',
};

type CapTone = 'muted' | 'warn' | 'danger';

// Per-candidate cap context for the swap/assign cards: their current weekly load
// and headroom against the week's soft cap, flagged when adding the selected range
// would push them over (danger when the week's cap is a hard break cap).
function capHint(
  weeklyHours: number,
  addHours: number,
  cap: number,
  enforcement: 'soft' | 'hard',
): { text: string; tone: CapTone } {
  if (weeklyHours + addHours > cap) {
    return {
      text: `${fmtH(weeklyHours)}h this week · +${fmtH(addHours)}h over ${cap}h cap`,
      tone: enforcement === 'hard' ? 'danger' : 'warn',
    };
  }
  const headroom = cap - weeklyHours;
  return {
    text: `${fmtH(weeklyHours)}h this week · ${fmtH(headroom)}h to cap`,
    tone: headroom <= 2 ? 'warn' : 'muted',
  };
}

// A draggable dual-thumb range slider over the shift's 30-min blocks. Either thumb
// snaps to a block boundary. This is the ONLY way to size the sub-range, there is
// no typed from/to entry, by design (2026-07-25 redesign).
function RangeSlider({
  startBlock,
  endBlock,
  fromBlock,
  toBlock,
  originMin,
  onChange,
}: {
  startBlock: number;
  endBlock: number;
  fromBlock: number;
  toBlock: number;
  originMin: number;
  onChange: (from: number, to: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<'from' | 'to' | null>(null);
  const span = endBlock - startBlock;

  useEffect(() => {
    if (drag === null) return;
    const blockAt = (clientX: number): number | null => {
      const el = trackRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const frac = (clientX - r.left) / r.width;
      return Math.max(startBlock, Math.min(endBlock, startBlock + Math.round(frac * span)));
    };
    const move = (e: PointerEvent) => {
      const b = blockAt(e.clientX);
      if (b === null) return;
      if (drag === 'from') onChange(Math.min(b, toBlock - 1), toBlock);
      else onChange(fromBlock, Math.max(b, fromBlock + 1));
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, fromBlock, toBlock, startBlock, endBlock, span, onChange]);

  const fromPct = ((fromBlock - startBlock) / span) * 100;
  const toPct = ((toBlock - startBlock) / span) * 100;

  const onKey = (which: 'from' | 'to') => (e: React.KeyboardEvent) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -1
          : 0;
    if (delta === 0) return;
    e.preventDefault();
    if (which === 'from')
      onChange(Math.min(Math.max(fromBlock + delta, startBlock), toBlock - 1), toBlock);
    else onChange(fromBlock, Math.max(Math.min(toBlock + delta, endBlock), fromBlock + 1));
  };

  // One tick per 30-min block boundary (a "marked" slider, mirroring the discrete-
  // step feel of the mobile BlockRangeSlider) so it reads as a stepped control, not
  // a freeform drag — every stop is a real, snappable block.
  const ticks: number[] = [];
  for (let i = 0; i <= span; i++) ticks.push((i / span) * 100);

  return (
    <div className="range-slider">
      <div className="range-slider-bounds" aria-hidden="true">
        <span>{blockLabel(startBlock, originMin)}</span>
        <span>{blockLabel(endBlock, originMin)}</span>
      </div>
      <div className="range-slider-track" ref={trackRef}>
        <div
          className="range-slider-fill"
          style={{ left: `${fromPct}%`, width: `${toPct - fromPct}%` }}
        />
        {ticks.map((pct) => (
          <span key={pct} className="range-slider-tick" style={{ left: `${pct}%` }} />
        ))}
        <button
          type="button"
          className="range-thumb"
          style={{ left: `${fromPct}%` }}
          role="slider"
          aria-label="Start time"
          aria-valuemin={startBlock}
          aria-valuemax={toBlock - 1}
          aria-valuenow={fromBlock}
          aria-valuetext={blockLabel(fromBlock, originMin)}
          data-testid="override-range-from-thumb"
          onPointerDown={(e) => {
            e.preventDefault();
            setDrag('from');
          }}
          onKeyDown={onKey('from')}
        >
          <span className="range-thumb-badge" aria-hidden="true">
            {blockLabel(fromBlock, originMin)}
          </span>
        </button>
        <button
          type="button"
          className="range-thumb"
          style={{ left: `${toPct}%` }}
          role="slider"
          aria-label="End time"
          aria-valuemin={fromBlock + 1}
          aria-valuemax={endBlock}
          aria-valuenow={toBlock}
          aria-valuetext={blockLabel(toBlock, originMin)}
          data-testid="override-range-to-thumb"
          onPointerDown={(e) => {
            e.preventDefault();
            setDrag('to');
          }}
          onKeyDown={onKey('to')}
        >
          <span className="range-thumb-badge" aria-hidden="true">
            {blockLabel(toBlock, originMin)}
          </span>
        </button>
      </div>
    </div>
  );
}

// Unified inline edit for the shift detail panel's edit section. Occupied seats lead
// with an action choice (Swap / Remove, no label), nothing below it renders until
// one is picked. Then: a range slider (the only way to size the sub-range), and for
// swap, worker cards (cap-aware) appear on the SAME screen as the slider, then
// this-week/permanent scope, then a contextual apply, all revealed together. An open
// seat has no action to choose, so it goes straight to the slider + worker cards.
// The whole card's blocks are `shift.blockIds` in block order; the selected
// sub-range is a slice, so Remove/Swap act on exactly those blocks. Laid out as a
// fixed top + scrolling worker list + fixed footer so the flow lives in one viewport.
export function EditSection({
  shift,
  assignableWorkers,
  softCapHours,
  capEnforcement,
  onApplied,
}: {
  shift: CalShift;
  assignableWorkers: AssignableWorker[];
  softCapHours: number;
  capEnforcement: 'soft' | 'hard';
  onApplied: () => void;
}) {
  const occupied = shift.userId !== null;
  const { startBlock, endBlock } = shift;
  const multiBlock = endBlock - startBlock > 1;
  // Derived from the shift's own timestamp, not the grid's shared origin, so the
  // edit-range picker's times stay correct regardless of the grid's start hour.
  const origin = shiftOriginMinutes(shift);

  // Sub-range [fromBlock, toBlock), defaulting to the whole shift. 30-min blocks.
  const [fromBlock, setFromBlock] = useState(startBlock);
  const [toBlock, setToBlock] = useState(endBlock);
  // occupied: choose Swap vs Remove. Nothing past the action row shows until one is
  // picked, an open seat has no action to choose, so it goes straight to assigning.
  const [action, setAction] = useState<'remove' | 'replace' | null>(occupied ? null : 'replace');
  const showBody = !occupied || action !== null;
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [scope, setScope] = useState<OverrideScope>('this_week');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // A completed-but-no-op write (0 seats assigned) is surfaced as a warning snackbar
  // rather than a success, so the operator sees that nothing changed.
  const [warning, setWarning] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AssignAdvisory[] | null>(null);

  // The DB block ids backing the selected sub-range (blockIds are in block order).
  const selectedBlockIds = shift.blockIds.slice(fromBlock - startBlock, toBlock - startBlock);
  const rangeHours = (toBlock - fromBlock) * 0.5;
  const fullHours = (endBlock - startBlock) * 0.5;
  // MUST pass `origin`: without it spanLabel falls back to the grid's default 08:00
  // origin, so a shift on a house/season that opens earlier (e.g. summer Harnwell at
  // 05:30) rendered a range shifted by the difference — the panel header said
  // "05:30-08:00" while this label claimed "08:00-10:30" for the very same blocks.
  const rangeLabel = spanLabel(fromBlock, toBlock, origin);

  // Assigning shows worker cards; swapping shows them minus the incumbent.
  const assigning = !occupied || action === 'replace';
  const candidates = assignableWorkers.filter((w) => w.userId !== shift.userId);
  const selectedName = candidates.find((w) => w.userId === workerId)?.name ?? null;

  function setRange(from: number, to: number) {
    setFromBlock(from);
    setToBlock(to);
    setError(null);
  }

  async function doAssign(overrideAdvisories: boolean) {
    if (workerId === null) {
      setError('Pick a worker first.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    setWarning(null);
    const res = await assignWorker({
      blockIds: selectedBlockIds,
      userId: workerId,
      scope,
      overrideAdvisories,
      // SWAP on a still-occupied seat: overwrite the incumbent's seat (not a
      // sibling vacant one). Omitted when filling an open shift.
      incumbentUserId: occupied ? shift.userId : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setConfirm(null);
      setError(res.error);
      return;
    }
    if (res.data.needsConfirm) {
      setConfirm(res.data.advisories);
      return;
    }
    setConfirm(null);
    // A completed write that touched zero seats is a no-op, not a success, so the
    // operator should know nothing changed (and, where we can infer it, why).
    if (res.data.assignedCount === 0) {
      setWarning(
        res.data.scope === 'permanent'
          ? 'No shifts were assigned. Every future occurrence of this slot is already filled (or none remain this term).'
          : 'No shift was assigned. This seat is already filled.',
      );
      return;
    }
    setSuccess(occupied ? 'Swapped' : 'Assigned');
    setTimeout(onApplied, 700);
  }

  async function doRemove() {
    if (shift.userId === null) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setWarning(null);
    const res = await removeWorker({
      blockIds: selectedBlockIds,
      userId: shift.userId,
      scope,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSuccess('Removed');
    setTimeout(onApplied, 700);
  }

  return (
    <div className="detail-override" data-testid="override-section">
      <div className="edit-top">
        {/* 1 — action (occupied only, no label): pick Swap or Remove first. Nothing
            below this shows until one is chosen. Deliberately its OWN button style
            (not the generic .seg toggle used for Apply-to below) — this is the
            flow's first real decision, so it needs to read as two clickable
            buttons, not a passive filter control. */}
        {occupied && (
          <div className="action-picker" role="radiogroup" aria-label="Action">
            <button
              type="button"
              role="radio"
              data-testid="override-action-replace"
              className={`action-btn action-btn-swap ${action === 'replace' ? 'is-on' : ''}`.trim()}
              aria-checked={action === 'replace'}
              onClick={() => {
                setAction('replace');
                setError(null);
              }}
            >
              <Icon name="swap" size={15} />
              Swap with someone else
            </button>
            <button
              type="button"
              role="radio"
              data-testid="override-action-remove"
              className={`action-btn action-btn-remove ${action === 'remove' ? 'is-on' : ''}`.trim()}
              aria-checked={action === 'remove'}
              onClick={() => {
                setAction('remove');
                setError(null);
              }}
            >
              <Icon name="trash" size={15} />
              Remove
            </button>
          </div>
        )}

        {/* 2 — how much of it: slider only, no typed time inputs. Shows the moment an
            action is chosen (or immediately, for an open seat with no action to pick).
            The "Editing…" line is a loud, action-toned banner (not quiet helper text)
            so exactly which hours are about to change is unmistakable at a glance. */}
        {showBody &&
          (multiBlock ? (
            <div className="col gap-1">
              <RangeSlider
                startBlock={startBlock}
                endBlock={endBlock}
                fromBlock={fromBlock}
                toBlock={toBlock}
                originMin={origin}
                onChange={setRange}
              />
              <div
                className={`range-caption ${occupied && action === 'remove' ? 'is-danger' : ''}`.trim()}
                data-testid="override-range-help"
              >
                <Icon name={occupied && action === 'remove' ? 'trash' : 'swap'} size={14} />
                <span>
                  Editing <b>{rangeLabel}</b> · {fmtH(rangeHours)}h of {fmtH(fullHours)}h
                </span>
              </div>
            </div>
          ) : (
            <div
              className={`range-caption ${occupied && action === 'remove' ? 'is-danger' : ''}`.trim()}
            >
              <Icon name={occupied && action === 'remove' ? 'trash' : 'swap'} size={14} />
              <span>
                Whole shift · <b>{rangeLabel}</b> ({fmtH(fullHours)}h)
              </span>
            </div>
          ))}

        {/* 3 — worker-list label (the list itself scrolls below) */}
        {assigning && (
          <span className="t-label">
            {occupied ? `Swap ${shift.workerName ?? 'this worker'} for` : 'Assign to'}
          </span>
        )}
      </div>

      {/* worker cards — the one scrolling region inside the viewport */}
      {assigning &&
        (candidates.length === 0 ? (
          <div className="edit-empty t-helper">No other workers are available for this house.</div>
        ) : (
          <div className="wpick-list" data-testid="override-worker-list" role="listbox">
            {candidates.map((w) => {
              const hint = capHint(w.weeklyHours, rangeHours, softCapHours, capEnforcement);
              const sel = workerId === w.userId;
              return (
                <button
                  type="button"
                  key={w.userId}
                  role="option"
                  aria-selected={sel}
                  data-testid="override-worker-card"
                  data-worker-id={w.userId}
                  className={`wpick ${sel ? 'is-sel' : ''}`.trim()}
                  onClick={() => {
                    setWorkerId(w.userId);
                    setError(null);
                  }}
                >
                  <Avatar name={w.name} size={30} />
                  <span className="wpick-main">
                    <b className="wpick-name">{w.name}</b>
                    <span className={`wpick-hint tone-${hint.tone}`}>
                      {hint.tone !== 'muted' && <Icon name="warn" size={12} />}
                      {hint.text}
                    </span>
                  </span>
                  {sel && <Icon name="checkCircle" size={18} className="wpick-check" />}
                </button>
              );
            })}
          </div>
        ))}

      {/* fixed footer — scope + apply. Shows together with the slider, once an
          action is chosen (or immediately for an open seat). */}
      {showBody && (
        <div className="edit-foot">
          {error !== null && (
            <Notification kind="error" title="Could not apply" testId="override-error">
              {error}
            </Notification>
          )}
          {success !== null && (
            <Notification kind="success" title={success} testId="override-success">
              The live schedule has been updated.
            </Notification>
          )}
          {warning !== null && (
            <Notification kind="warning" title="Nothing was assigned" testId="override-warning">
              {warning}
            </Notification>
          )}

          <div className="col gap-1">
            <span className="t-label">Apply to</span>
            <div className="seg seg-fill" role="radiogroup" aria-label="Override scope">
              <button
                type="button"
                role="radio"
                data-testid="override-scope-week"
                className={`seg-btn ${scope === 'this_week' ? 'is-on' : ''}`.trim()}
                aria-checked={scope === 'this_week'}
                onClick={() => setScope('this_week')}
              >
                This week only
              </button>
              <button
                type="button"
                role="radio"
                data-testid="override-scope-permanent"
                className={`seg-btn ${scope === 'permanent' ? 'is-on' : ''}`.trim()}
                aria-checked={scope === 'permanent'}
                onClick={() => setScope('permanent')}
              >
                This week onward
              </button>
            </div>
            <span className="t-helper" data-testid="override-scope-help">
              {scope === 'this_week'
                ? 'Changes only the week you’re viewing. Every other week keeps the published pattern.'
                : 'Changes this week and the same slot (weekday + time) in every following week of the term.'}
            </span>
          </div>

          {occupied && action === 'remove' ? (
            <Button
              kind="danger"
              icon="trash"
              full
              data-testid="override-remove"
              disabled={busy}
              onClick={doRemove}
            >
              Remove {rangeLabel}
            </Button>
          ) : (
            <Button
              kind="primary"
              icon={occupied ? 'swap' : 'add'}
              full
              data-testid="override-submit"
              disabled={busy || workerId === null}
              onClick={() => doAssign(false)}
            >
              {occupied ? 'Swap in' : 'Assign'} {rangeLabel}
              {selectedName ? ` → ${selectedName}` : ''}
            </Button>
          )}
        </div>
      )}

      {confirm !== null && (
        <Modal
          testId="override-advisory-confirm"
          eyebrow="Soft constraint"
          title="Confirm override"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button kind="secondary" onClick={() => setConfirm(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                kind="primary"
                data-testid="override-advisory-accept"
                disabled={busy}
                onClick={() => doAssign(true)}
              >
                {occupied ? 'Swap anyway' : 'Assign anyway'}
              </Button>
            </>
          }
        >
          <p style={{ marginBottom: 12 }}>This assignment trips a soft constraint:</p>
          <ul className="col gap-2" style={{ margin: 0, paddingLeft: 18 }}>
            {confirm.map((a) => (
              <li key={a.kind} className="t-body">
                {ADVISORY_LABEL[a.kind] ?? a.kind}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
