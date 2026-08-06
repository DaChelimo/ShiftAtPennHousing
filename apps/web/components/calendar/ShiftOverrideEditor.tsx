'use client';

import { useState } from 'react';

import {
  assignWorker,
  floatWorker,
  removeWorker,
  type OverrideScope,
} from '../../lib/actions/override';
import type { AssignableWorker, CalShift } from '../../lib/data/calendar';
import { Button, Icon, Notification } from '../ui';

import { RangeSlider } from './RangeSlider';
import { WorkerPicker } from './WorkerPicker';
import type { WriteStatusEvent } from './WriteStatusToasts';
import { fmtH, shiftOriginMinutes, spanLabel } from './format';

// Harnwell pilot workstream G. Harnwell excluded (never a float destination, hard
// invariant); the other 12 houses are the fixed, load-bearing id set from AGENTS.md.
const FLOAT_DESTINATION_HOUSES: { id: string; name: string }[] = [
  { id: 'quad', name: 'Upper Quad' },
  { id: 'lower-quad', name: 'Lower Quad' },
  { id: 'gregory', name: 'Van Pelt / Gregory' },
  { id: 'harrison', name: 'Harrison' },
  { id: 'hill', name: 'Hill' },
  { id: 'kings-court', name: 'Kings Court English' },
  { id: 'lauder', name: 'Lauder' },
  { id: 'mayer', name: 'Mayer' },
  { id: 'du-bois', name: 'Du Bois' },
  { id: 'gutmann', name: 'Gutmann' },
  { id: 'radian', name: 'Radian' },
  { id: 'rodin', name: 'Rodin' },
];

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
  houseId,
  assignableWorkers,
  softCapHours,
  capEnforcement,
  onApplied,
  onWriteStatus,
}: {
  shift: CalShift;
  houseId: string;
  assignableWorkers: AssignableWorker[];
  softCapHours: number;
  capEnforcement: 'soft' | 'hard';
  onApplied: () => void;
  onWriteStatus?: (evt: WriteStatusEvent) => void;
}) {
  const occupied = shift.userId !== null;
  const { startBlock, endBlock } = shift;
  const multiBlock = endBlock - startBlock > 1;
  // Derived from the shift's own timestamp, not the grid's shared origin, so the
  // edit-range picker's times stay correct regardless of the grid's start hour.
  const origin = shiftOriginMinutes(shift);
  // Harnwell pilot (workstream G): Float only makes sense as an outbound action from
  // Harnwell (the only house with workers on the app in the pilot), and only on an
  // occupied seat -- there is nobody to float from an open one.
  const canFloat = occupied && houseId === 'harnwell';

  // Sub-range [fromBlock, toBlock), defaulting to the whole shift. 30-min blocks.
  const [fromBlock, setFromBlock] = useState(startBlock);
  const [toBlock, setToBlock] = useState(endBlock);
  // occupied: choose Swap, Float, or Remove. Nothing past the action row shows until
  // one is picked, an open seat has no action to choose, so it goes straight to
  // assigning.
  const [action, setAction] = useState<'remove' | 'replace' | 'float' | null>(
    occupied ? null : 'replace',
  );
  const showBody = !occupied || action !== null;
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [destinationHouseId, setDestinationHouseId] = useState<string>(
    FLOAT_DESTINATION_HOUSES[0]!.id,
  );
  const [scope, setScope] = useState<OverrideScope>('this_week');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // A completed-but-no-op write (0 seats assigned) is surfaced as a warning snackbar
  // rather than a success, so the operator sees that nothing changed.
  const [warning, setWarning] = useState<string | null>(null);

  // The DB block ids backing the selected sub-range (blockIds are in block order).
  const selectedBlockIds = shift.blockIds.slice(fromBlock - startBlock, toBlock - startBlock);
  const rangeHours = (toBlock - fromBlock) * 0.5;
  const fullHours = (endBlock - startBlock) * 0.5;
  // MUST pass `origin`: without it spanLabel falls back to the grid's default 08:00
  // origin, so a shift on a house/season that opens earlier (e.g. summer Harnwell at
  // 05:30) rendered a range shifted by the difference — the panel header said
  // "05:30-08:00" while this label claimed "08:00-10:30" for the very same blocks.
  const rangeLabel = spanLabel(fromBlock, toBlock, origin);

  // Assigning shows the worker picker; swapping shows it minus the incumbent.
  // WorkerPicker owns the pinned RSM/Allied chip, the name filter, and the roster.
  const assigning = !occupied || action === 'replace';
  const eligible = assignableWorkers.filter((w) => w.userId !== shift.userId);
  const selectedName = eligible.find((w) => w.userId === workerId)?.name ?? null;

  function setRange(from: number, to: number) {
    setFromBlock(from);
    setToBlock(to);
    setError(null);
  }

  async function doAssign() {
    if (workerId === null) {
      setError('Pick a worker first.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    setWarning(null);
    onWriteStatus?.({
      key: shift.id,
      phase: 'pending',
      message: occupied
        ? `Swapping ${shift.workerName ?? 'this worker'}'s ${rangeLabel} shift…`
        : `Assigning ${rangeLabel}…`,
    });
    const res = await assignWorker({
      blockIds: selectedBlockIds,
      userId: workerId,
      scope,
      // A manager editing the LIVE calendar directly is assumed to already know
      // the worker's hours/availability picture (unlike the schedule builder,
      // where the roster panel is the only place that context is surfaced) — so
      // soft advisories (over target, opted out, marked cannot, over soft cap)
      // never gate a live-calendar write with a confirm popup. Hard blocks (hard
      // cap, Harnwell training) are NOT affected by this flag and still return a
      // real error below.
      overrideAdvisories: true,
      // SWAP on a still-occupied seat: overwrite the incumbent's seat (not a
      // sibling vacant one). Omitted when filling an open shift.
      incumbentUserId: occupied ? shift.userId : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      onWriteStatus?.({
        key: shift.id,
        phase: 'error',
        message: `Couldn't ${occupied ? 'swap' : 'assign'}: ${res.error}`,
      });
      return;
    }
    if (res.data.needsConfirm) {
      // Unreachable in practice: overrideAdvisories is always true above, so the
      // RPC never returns needs_confirm. Guarded only to satisfy the union type.
      setError('Could not complete the assignment.');
      onWriteStatus?.({ key: shift.id, phase: 'cancel' });
      return;
    }
    // A completed write that touched zero seats is a no-op, not a success, so the
    // operator should know nothing changed (and, where we can infer it, why).
    // The inline warning below covers this case, so the toast just clears rather
    // than claiming a success that didn't happen.
    if (res.data.assignedCount === 0) {
      setWarning(
        res.data.scope === 'permanent'
          ? 'No shifts were assigned. Every future occurrence of this slot is already filled (or none remain this term).'
          : 'No shift was assigned. This seat is already filled.',
      );
      onWriteStatus?.({ key: shift.id, phase: 'cancel' });
      return;
    }
    setSuccess(occupied ? 'Swapped' : 'Assigned');
    onWriteStatus?.({
      key: shift.id,
      phase: 'success',
      message: occupied
        ? `Swapped: ${selectedName ?? 'the worker'} now covers ${rangeLabel}`
        : `Assigned: ${selectedName ?? 'the worker'} now covers ${rangeLabel}`,
    });
    setTimeout(onApplied, 700);
  }

  async function doFloat() {
    if (shift.userId === null) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setWarning(null);
    const destName =
      FLOAT_DESTINATION_HOUSES.find((h) => h.id === destinationHouseId)?.name ?? destinationHouseId;
    onWriteStatus?.({
      key: shift.id,
      phase: 'pending',
      message: `Floating ${shift.workerName ?? 'this worker'} to ${destName} for ${rangeLabel}…`,
    });
    const res = await floatWorker({
      blockIds: selectedBlockIds,
      userId: shift.userId,
      destinationHouseId,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      onWriteStatus?.({ key: shift.id, phase: 'error', message: `Couldn't float: ${res.error}` });
      return;
    }
    setSuccess('Floated');
    onWriteStatus?.({
      key: shift.id,
      phase: 'success',
      message: `Floated: ${shift.workerName ?? 'the worker'} now covers ${destName} for ${rangeLabel}`,
    });
    setTimeout(onApplied, 700);
  }

  async function doRemove() {
    if (shift.userId === null) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setWarning(null);
    onWriteStatus?.({
      key: shift.id,
      phase: 'pending',
      message: `Removing ${shift.workerName ?? 'this worker'}'s ${rangeLabel} shift…`,
    });
    const res = await removeWorker({
      blockIds: selectedBlockIds,
      userId: shift.userId,
      scope,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      onWriteStatus?.({ key: shift.id, phase: 'error', message: `Couldn't remove: ${res.error}` });
      return;
    }
    setSuccess('Removed');
    onWriteStatus?.({
      key: shift.id,
      phase: 'success',
      message: `Removed: ${rangeLabel} is open again`,
    });
    setTimeout(onApplied, 700);
  }

  return (
    <div className="detail-override" data-testid="override-section">
      <div className="edit-top">
        {/* 1 — action (occupied only, no label): pick Swap or Remove first. Nothing
            below this shows until one is chosen. A full-width segmented pill (not
            two separate buttons) so it reads as one control with two states —
            switching it is what reveals the rest of the flow — rather than as a
            command fired on click. The banner beneath names the chosen action in
            full ("Now swapping <name>" / "Now removing <name>") and carries the
            tint down into the revealed content below it. */}
        {occupied && (
          <div className="col gap-2">
            <div className="action-seg" role="radiogroup" aria-label="Action">
              <button
                type="button"
                role="radio"
                data-testid="override-action-replace"
                className={`action-seg-btn action-seg-swap ${action === 'replace' ? 'is-on' : ''}`.trim()}
                aria-checked={action === 'replace'}
                onClick={() => {
                  setAction('replace');
                  setError(null);
                }}
              >
                <Icon name="swap" size={15} />
                Swap
              </button>
              {canFloat && (
                <button
                  type="button"
                  role="radio"
                  data-testid="override-action-float"
                  className={`action-seg-btn action-seg-float ${action === 'float' ? 'is-on' : ''}`.trim()}
                  aria-checked={action === 'float'}
                  onClick={() => {
                    setAction('float');
                    setError(null);
                  }}
                >
                  <Icon name="swap" size={15} />
                  Float
                </button>
              )}
              <button
                type="button"
                role="radio"
                data-testid="override-action-remove"
                className={`action-seg-btn action-seg-remove ${action === 'remove' ? 'is-on' : ''}`.trim()}
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
            {action !== null && (
              <div
                className={`action-banner ${action === 'remove' ? 'is-danger' : ''}`.trim()}
                data-testid="override-action-banner"
              >
                <Icon name={action === 'remove' ? 'trash' : 'swap'} size={14} />
                {action === 'remove'
                  ? `Now removing ${shift.workerName ?? 'this worker'}`
                  : action === 'float'
                    ? `Now floating ${shift.workerName ?? 'this worker'} out`
                    : `Now swapping ${shift.workerName ?? 'this worker'}`}
              </div>
            )}
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

      {/* Float destination picker — Harnwell excluded server-side too (hard
          invariant), but never even offered here. */}
      {action === 'float' && (
        <div className="col gap-1" style={{ padding: '0 2px' }}>
          <span className="t-label">Float to</span>
          <select
            data-testid="override-float-destination"
            value={destinationHouseId}
            onChange={(e) => setDestinationHouseId(e.target.value)}
            className="select"
          >
            {FLOAT_DESTINATION_HOUSES.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Pinned split chip (RSM | Allied), search, then the scrolling roster —
          the one scrolling region inside the viewport. See WorkerPicker.tsx. */}
      {assigning && (
        <WorkerPicker
          workers={eligible}
          selectedId={workerId}
          rangeHours={rangeHours}
          softCapHours={softCapHours}
          capEnforcement={capEnforcement}
          onSelect={(id) => {
            setWorkerId(id);
            setError(null);
          }}
        />
      )}

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

          {/* Float has no this-week-vs-permanent scope: it always acts on exactly the
              selected range, once. */}
          {action !== 'float' && (
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
                  Permanent
                </button>
              </div>
              <span className="t-helper" data-testid="override-scope-help">
                {scope === 'this_week'
                  ? 'Changes only the week you’re viewing. Every other week keeps the published pattern.'
                  : 'Changes this week and the same slot (weekday + time) in every following week of the term.'}
              </span>
            </div>
          )}

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
          ) : occupied && action === 'float' ? (
            <Button
              kind="primary"
              icon="swap"
              full
              data-testid="override-float-submit"
              disabled={busy}
              onClick={() => doFloat()}
            >
              Float {rangeLabel} →{' '}
              {FLOAT_DESTINATION_HOUSES.find((h) => h.id === destinationHouseId)?.name}
            </Button>
          ) : (
            <Button
              kind="primary"
              icon={occupied ? 'swap' : 'add'}
              full
              data-testid="override-submit"
              disabled={busy || workerId === null}
              onClick={() => doAssign()}
            >
              {occupied ? 'Swap in' : 'Assign'} {rangeLabel}
              {selectedName ? ` → ${selectedName}` : ''}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
