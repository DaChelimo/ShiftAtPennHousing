'use client';

import { useEffect, useRef, useState } from 'react';

import {
  assignWorker,
  removeWorker,
  type AssignAdvisory,
  type OverrideScope,
} from '../../lib/actions/override';
import type { AssignableWorker, CalShift } from '../../lib/data/calendar';
import {
  Avatar,
  Button,
  EscalationChip,
  Icon,
  IconButton,
  Modal,
  Notification,
  PickupDot,
  Tag,
  type EscalationStep,
} from '../ui';

import { blockLabel, blocksToHours, CAL_STATE_META, emptyCardName, spanLabel } from './format';

function prettifyHouse(id: string): string {
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function fmtH(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// Shift detail / contact panel (design screen 04). A fixed-height drawer: the
// header (name + phone/hours chips) and the edit footer (scope + apply) stay put
// while the Replace/Assign worker list scrolls WITHIN one viewport. The edit flow
// is a sub-range pick (drag the slider or type the times) → Remove or Replace.
export function ShiftDetailPanel({
  shift,
  houseName,
  dayLabel,
  assignableWorkers,
  softCapHours,
  capEnforcement,
  onClose,
  onApplied,
}: {
  shift: CalShift;
  houseName: string;
  dayLabel: string;
  assignableWorkers: AssignableWorker[];
  softCapHours: number;
  capEnforcement: 'soft' | 'hard';
  onClose: () => void;
  onApplied: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta = CAL_STATE_META[shift.state];
  const isGap = shift.state === 'gap' || shift.state === 'perm-gap';
  const title = shift.workerName ?? emptyCardName(shift.state);
  const escStep: EscalationStep =
    shift.escalationStep ??
    (shift.state === 'allied' ? 'allied' : shift.state === 'pending-in' ? 'float' : 'broadcast');
  const showEscalation = isGap || shift.state === 'pending-in' || shift.state === 'allied';
  const homeLabel = shift.homeHouse ? prettifyHouse(shift.homeHouse) : null;
  const hasTags = Boolean(meta.tag || homeLabel || meta.dot);

  // The incumbent's own weekly load (same-house roster) — shown as a header chip.
  const incumbent = shift.userId
    ? (assignableWorkers.find((w) => w.userId === shift.userId) ?? null)
    : null;

  return (
    <>
      <div className="panel-scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label="Shift detail">
        <div className="panel-head">
          <div className="col gap-1" style={{ minWidth: 0 }}>
            <span className="t-eyebrow">
              {houseName} · {dayLabel}
            </span>
            <h2 className="t-h1">{title}</h2>
            {shift.workerName && (
              <PersonChips phone={shift.workerPhone} weeklyHours={incumbent?.weeklyHours ?? null} />
            )}
          </div>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>

        <div className="panel-body">
          <div className="detail-row">
            <Icon name="clock" size={16} className="muted" />
            <span className="t-mono detail-time">
              {spanLabel(shift.startBlock, shift.endBlock)}
            </span>
            <span className="t-meta">· {blocksToHours(shift.startBlock, shift.endBlock)}h</span>
          </div>

          {hasTags && (
            <div className="detail-tags">
              {meta.tag && (
                <Tag kind={meta.tag.kind} icon={meta.tag.icon}>
                  {meta.tag.label}
                </Tag>
              )}
              {homeLabel && (
                <Tag kind="outline" icon="swap">
                  Home: {homeLabel}
                </Tag>
              )}
              {meta.dot && (
                <span className="row gap-1 t-meta">
                  <PickupDot />
                  Cross-house pickup
                </span>
              )}
            </div>
          )}

          {showEscalation && (
            <div className="detail-esc">
              <div className="t-label" style={{ marginBottom: 10 }}>
                Escalation
              </div>
              <EscalationChip step={escStep} />
              {shift.state === 'pending-in' && shift.workerName && (
                <div className="t-meta" style={{ marginTop: 10 }}>
                  Floater <b>{shift.workerName}</b> · pending acknowledgment
                </div>
              )}
            </div>
          )}

          {/* Inline edit (S1) — pick a sub-range, then Remove or Replace; this-week
              vs permanent, with a soft-advisory confirm. Authoritative enforcement
              is the admin_assign_worker / admin_remove_worker RPC. */}
          <EditSection
            shift={shift}
            assignableWorkers={assignableWorkers}
            softCapHours={softCapHours}
            capEnforcement={capEnforcement}
            onApplied={onApplied}
          />
        </div>
      </aside>
    </>
  );
}

// Compact identity chips under the name: phone (copyable — this is a desktop tool,
// so the number is text rather than a tel: Call button) + the worker's weekly load.
function PersonChips({ phone, weeklyHours }: { phone: string | null; weeklyHours: number | null }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — nothing to surface.
    }
  }

  return (
    <div className="person-chips">
      {phone ? (
        <button
          type="button"
          className="pchip"
          onClick={copy}
          title="Copy phone number"
          data-testid="profile-phone"
        >
          <Icon name="phone" size={13} className="muted" />
          <span className="t-mono">{phone}</span>
          <Icon name={copied ? 'check' : 'copy'} size={12} className="muted" />
        </button>
      ) : (
        <span className="pchip is-empty">
          <Icon name="phone" size={13} className="muted" />
          No phone on file
        </span>
      )}
      {weeklyHours !== null && (
        <span className="pchip">
          <Icon name="clock" size={13} className="muted" />
          {fmtH(weeklyHours)}h this week
        </span>
      )}
    </div>
  );
}

const ADVISORY_LABEL: Record<string, string> = {
  cannot: 'This worker marked “cannot work” for this shift.',
  opted_out: 'This worker opted out of hours this period.',
  soft_cap: 'This assignment exceeds the worker’s soft (20h) weekly cap.',
  over_target: 'This assignment exceeds the worker’s target hours.',
};

type CapTone = 'muted' | 'warn' | 'danger';

// Per-candidate cap context for the Replace/Assign cards: their current weekly load
// and headroom against the week's soft cap — flagged when adding the selected range
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
// snaps to a block boundary; the two select inputs stay in sync (type to set the
// exact time, or drag if you'd rather). Thumbs keep a 1-block (30-min) minimum gap.
function RangeSlider({
  startBlock,
  endBlock,
  fromBlock,
  toBlock,
  onChange,
}: {
  startBlock: number;
  endBlock: number;
  fromBlock: number;
  toBlock: number;
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

  return (
    <div className="range-slider">
      <div className="range-slider-track" ref={trackRef}>
        <div
          className="range-slider-fill"
          style={{ left: `${fromPct}%`, width: `${toPct - fromPct}%` }}
        />
        <button
          type="button"
          className="range-thumb"
          style={{ left: `${fromPct}%` }}
          role="slider"
          aria-label="Start time"
          aria-valuemin={startBlock}
          aria-valuemax={toBlock - 1}
          aria-valuenow={fromBlock}
          aria-valuetext={blockLabel(fromBlock)}
          data-testid="override-range-from-thumb"
          onPointerDown={(e) => {
            e.preventDefault();
            setDrag('from');
          }}
          onKeyDown={onKey('from')}
        />
        <button
          type="button"
          className="range-thumb"
          style={{ left: `${toPct}%` }}
          role="slider"
          aria-label="End time"
          aria-valuemin={fromBlock + 1}
          aria-valuemax={endBlock}
          aria-valuenow={toBlock}
          aria-valuetext={blockLabel(toBlock)}
          data-testid="override-range-to-thumb"
          onPointerDown={(e) => {
            e.preventDefault();
            setDrag('to');
          }}
          onKeyDown={onKey('to')}
        />
      </div>
    </div>
  );
}

// Unified inline edit: time-range picker (slider + typed times) → Remove / Replace
// (occupied) or Assign (open seat) → worker-card picker (cap-aware) →
// this-week/permanent scope → contextual apply. The whole card's blocks are
// `shift.blockIds` in block order; the selected sub-range is a slice, so
// Remove/Replace act on exactly those blocks. Laid out as a fixed top + scrolling
// worker list + fixed footer so the whole flow lives in one viewport.
function EditSection({
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

  // Sub-range [fromBlock, toBlock), defaulting to the whole shift. 30-min blocks.
  const [fromBlock, setFromBlock] = useState(startBlock);
  const [toBlock, setToBlock] = useState(endBlock);
  // occupied: choose Remove vs Replace (defaults to Replace — the richer flow).
  const [action, setAction] = useState<'remove' | 'replace'>('replace');
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [scope, setScope] = useState<OverrideScope>('this_week');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AssignAdvisory[] | null>(null);

  // The DB block ids backing the selected sub-range (blockIds are in block order).
  const selectedBlockIds = shift.blockIds.slice(fromBlock - startBlock, toBlock - startBlock);
  const rangeHours = (toBlock - fromBlock) * 0.5;
  const fullHours = (endBlock - startBlock) * 0.5;
  const rangeLabel = spanLabel(fromBlock, toBlock);

  // Assigning shows worker cards; replacing shows them minus the incumbent.
  const assigning = !occupied || action === 'replace';
  const candidates = assignableWorkers.filter((w) => w.userId !== shift.userId);
  const selectedName = candidates.find((w) => w.userId === workerId)?.name ?? null;

  function setRange(from: number, to: number) {
    setFromBlock(from);
    setToBlock(to);
    setError(null);
  }
  function pickFrom(v: number) {
    setFromBlock(v);
    if (toBlock <= v) setToBlock(v + 1);
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
    const res = await assignWorker({
      blockIds: selectedBlockIds,
      userId: workerId,
      scope,
      overrideAdvisories,
      // REPLACE on a still-occupied seat: overwrite the incumbent's seat (not a
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
    setSuccess(occupied ? 'Replaced' : 'Assigned');
    setTimeout(onApplied, 700);
  }

  async function doRemove() {
    if (shift.userId === null) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
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

  const fromOptions: number[] = [];
  for (let b = startBlock; b < endBlock; b++) fromOptions.push(b);
  const toOptions: number[] = [];
  for (let b = fromBlock + 1; b <= endBlock; b++) toOptions.push(b);

  return (
    <div className="detail-override" data-testid="override-section">
      <div className="edit-top">
        <div className="t-label">Edit this shift</div>

        {/* 1 — time range: type the exact times OR drag the slider */}
        {multiBlock ? (
          <div className="col gap-1">
            <span className="t-label">Time range</span>
            <div className="range-row">
              <select
                data-testid="override-range-from"
                className="input select"
                aria-label="From"
                value={fromBlock}
                onChange={(e) => pickFrom(Number(e.target.value))}
              >
                {fromOptions.map((b) => (
                  <option key={b} value={b}>
                    {blockLabel(b)}
                  </option>
                ))}
              </select>
              <span className="range-dash">–</span>
              <select
                data-testid="override-range-to"
                className="input select"
                aria-label="To"
                value={toBlock}
                onChange={(e) => {
                  setToBlock(Number(e.target.value));
                  setError(null);
                }}
              >
                {toOptions.map((b) => (
                  <option key={b} value={b}>
                    {blockLabel(b)}
                  </option>
                ))}
              </select>
            </div>
            <RangeSlider
              startBlock={startBlock}
              endBlock={endBlock}
              fromBlock={fromBlock}
              toBlock={toBlock}
              onChange={setRange}
            />
            <span className="t-helper" data-testid="override-range-help">
              Editing {rangeLabel} · {fmtH(rangeHours)}h of {fmtH(fullHours)}h
            </span>
          </div>
        ) : (
          <div className="col gap-1">
            <span className="t-label">Time range</span>
            <span className="t-helper">
              Whole shift · {rangeLabel} ({fmtH(fullHours)}h)
            </span>
          </div>
        )}

        {/* 2 — action (occupied only) */}
        {occupied && (
          <div className="col gap-1">
            <span className="t-label">Action</span>
            <div className="seg seg-fill" role="radiogroup" aria-label="Action">
              <button
                type="button"
                role="radio"
                data-testid="override-action-replace"
                className={`seg-btn ${action === 'replace' ? 'is-on' : ''}`.trim()}
                aria-checked={action === 'replace'}
                onClick={() => {
                  setAction('replace');
                  setError(null);
                }}
              >
                Replace with…
              </button>
              <button
                type="button"
                role="radio"
                data-testid="override-action-remove"
                className={`seg-btn ${action === 'remove' ? 'is-on' : ''}`.trim()}
                aria-checked={action === 'remove'}
                onClick={() => {
                  setAction('remove');
                  setError(null);
                }}
              >
                Remove
              </button>
            </div>
          </div>
        )}

        {/* 3 — worker-list label (the list itself scrolls below) */}
        {assigning && (
          <span className="t-label">
            {occupied ? `Replace ${shift.workerName ?? 'worker'} with` : 'Assign to'}
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

      {/* fixed footer — scope + apply, always in view below the list */}
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
            {occupied ? 'Replace' : 'Assign'} {rangeLabel}
            {selectedName ? ` → ${selectedName}` : ''}
          </Button>
        )}
      </div>

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
                {occupied ? 'Replace anyway' : 'Assign anyway'}
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
