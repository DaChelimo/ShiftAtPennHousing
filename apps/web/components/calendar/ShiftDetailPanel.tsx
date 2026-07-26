'use client';

import { useEffect, useState, type Ref } from 'react';

import type { AssignableWorker, CalShift } from '../../lib/data/calendar';
import { EscalationChip, Icon, IconButton, PickupDot, Tag, type EscalationStep } from '../ui';

import { EditSection } from './ShiftOverrideEditor';
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
  houseName,
  dayLabel,
  assignableWorkers,
  softCapHours,
  capEnforcement,
  onClose,
  onApplied,
  panelRef,
}: {
  shift: CalShift;
  houseName: string;
  dayLabel: string;
  assignableWorkers: AssignableWorker[];
  softCapHours: number;
  capEnforcement: 'soft' | 'hard';
  onClose: () => void;
  onApplied: () => void;
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
  const hasTags = Boolean(meta.tag || homeLabel || meta.dot);

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
          <div className="detail-row">
            <Icon name="clock" size={16} className="muted" />
            <span className="t-mono detail-time">
              {spanLabel(shift.startBlock, shift.endBlock, shiftOriginMinutes(shift))}
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
