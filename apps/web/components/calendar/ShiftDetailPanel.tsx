'use client';

import { useEffect, useState, type Ref } from 'react';

import type { AssignableWorker, CalShift } from '../../lib/data/calendar';
import {
  ESCALATION_STEPS,
  EscalationChip,
  Icon,
  IconButton,
  PickupDot,
  Tag,
  type EscalationStep,
} from '../ui';

import { EditSection } from './ShiftOverrideEditor';
import type { WriteStatusEvent } from './WriteStatusToasts';
import {
  blocksToHours,
  CAL_STATE_META,
  emptyCardName,
  fmtH,
  shiftOriginMinutes,
  spanLabel,
} from './format';

function prettifyHouse(id: string): string {
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// Shift detail / contact panel (design screen 04). A fixed-height drawer: the
// header (name + phone/hours chips) and the edit footer (scope + apply) stay put
// while the Swap/Assign worker list scrolls WITHIN one viewport (see
// ShiftOverrideEditor.tsx). The edit flow is action first (Swap or Remove), then
// a range-slider sub-range pick, revealed together with the worker cards and Apply.
export function ShiftDetailPanel({
  shift,
  houseId,
  houseName,
  dayLabel,
  assignableWorkers,
  softCapHours,
  capEnforcement,
  onClose,
  onApplied,
  onWriteStatus,
  panelRef,
}: {
  shift: CalShift;
  houseId: string;
  houseName: string;
  dayLabel: string;
  assignableWorkers: AssignableWorker[];
  softCapHours: number;
  capEnforcement: 'soft' | 'hard';
  onClose: () => void;
  onApplied: () => void;
  onWriteStatus?: (evt: WriteStatusEvent) => void;
  panelRef?: Ref<HTMLElement>;
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

  // The state tag is dropped when it only repeats the header: an unoccupied card's
  // title IS its state name ("Open shift", "Permanent opening", "Allied"), so the tag
  // spent a whole row saying nothing new. Tags that add information (Float-in,
  // Pending, Picked up, the home house) survive and move inline onto the time row.
  // This whole sheet's job is picking a replacement, so the space above the picker is
  // the scarcest thing on it.
  const stateTag = shift.workerName === null ? null : meta.tag;
  const hasTags = Boolean(stateTag || homeLabel || meta.dot);

  // The incumbent's own weekly load (same-house roster) — shown as a header chip.
  const incumbent = shift.userId
    ? (assignableWorkers.find((w) => w.userId === shift.userId) ?? null)
    : null;

  return (
    <>
      <div className="panel-scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label="Shift detail" ref={panelRef}>
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
          {/* Time + tags on ONE row: the tags used to own a second full-width row of
              their own directly under it. */}
          <div className="detail-row">
            <Icon name="clock" size={16} className="muted" />
            <span className="t-mono detail-time">
              {spanLabel(shift.startBlock, shift.endBlock, shiftOriginMinutes(shift))}
            </span>
            <span className="t-meta">· {blocksToHours(shift.startBlock, shift.endBlock)}h</span>
            {hasTags && (
              <span className="detail-row-tags">
                {stateTag && (
                  <Tag kind={stateTag.kind} icon={stateTag.icon}>
                    {stateTag.label}
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
              </span>
            )}
          </div>

          {/* Pending swap (BSpec §11.4, 2026-07-28). The card only carries a corner flag,
              so this is where the reader actually learns WHAT is being exchanged, who
              proposed it and who still owes an answer. Rendered on both shifts in the
              exchange, each describing the other side. */}
          {shift.pendingSwap && (
            <div className="detail-esc">
              <div className="t-label" style={{ marginBottom: 10 }}>
                {shift.pendingSwap.swapType === 'handoff' ? 'Pending hand-off' : 'Pending swap'}
              </div>
              <div className="t-meta">
                Proposed by <b>{shift.pendingSwap.initiatorName ?? 'a worker'}</b>. Waiting on{' '}
                <b>{shift.pendingSwap.awaitingName ?? 'the other worker'}</b> to respond.
              </div>
              {(shift.pendingSwap.side === 'initiator'
                ? shift.pendingSwap.counterpartySpan
                : shift.pendingSwap.initiatorSpan) && (
                <div className="t-meta" style={{ marginTop: 6 }}>
                  In exchange for{' '}
                  <b>
                    {shift.pendingSwap.side === 'initiator'
                      ? shift.pendingSwap.counterpartySpan
                      : shift.pendingSwap.initiatorSpan}
                  </b>
                  .
                </div>
              )}
              <div className="t-meta" style={{ marginTop: 6 }}>
                Nothing has moved yet. This desk is still staffed as shown until the swap is
                accepted.
              </div>
            </div>
          )}

          {showEscalation && (
            <EscalationDisclosure
              step={escStep}
              pendingFloaterName={
                shift.state === 'pending-in' && shift.workerName ? shift.workerName : null
              }
            />
          )}

          {/* Inline edit (S1) — pick a sub-range, then Remove or Replace; this-week
              vs permanent, with a soft-advisory confirm. Authoritative enforcement
              is the admin_assign_worker / admin_remove_worker RPC. */}
          <EditSection
            shift={shift}
            houseId={houseId}
            assignableWorkers={assignableWorkers}
            softCapHours={softCapHours}
            capEnforcement={capEnforcement}
            onApplied={onApplied}
            onWriteStatus={onWriteStatus}
          />
        </div>
      </aside>
    </>
  );
}

// Escalation, collapsed by default (2026-08-05). The full three-node timeline used to
// sit permanently open above the picker, costing ~110px of the sheet's most valuable
// space to answer one question: where on the ladder is this gap. Collapsed, that
// answer is the summary line itself ("Step 1 of 3 · T-3h broadcast"); the timeline is
// one click away for the reader who wants to see what comes next.
function EscalationDisclosure({
  step,
  pendingFloaterName,
}: {
  step: EscalationStep;
  pendingFloaterName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const idx = ESCALATION_STEPS.findIndex((s) => s.key === step);
  const current = ESCALATION_STEPS[idx];

  return (
    <div className="detail-esc is-collapsible" data-testid="detail-escalation">
      <button
        type="button"
        className="esc-summary"
        aria-expanded={open}
        data-testid="detail-escalation-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="chevDown" size={14} className={`esc-caret ${open ? 'is-open' : ''}`.trim()} />
        <span className="t-label">Escalation</span>
        <span className="esc-summary-step">
          Step {idx + 1} of {ESCALATION_STEPS.length} · <b>{current?.t}</b> {current?.label}
        </span>
      </button>
      {open && (
        <div className="esc-detail">
          <EscalationChip step={step} />
          {pendingFloaterName !== null && (
            <div className="t-meta" style={{ marginTop: 10 }}>
              Floater <b>{pendingFloaterName}</b> · pending acknowledgment
            </div>
          )}
        </div>
      )}
    </div>
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
