'use client';

import { useEffect } from 'react';

import type { CalShift } from '../../lib/data/calendar';
import { EscalationChip, Icon, IconButton, PickupDot, Tag, type EscalationStep } from '../ui';

import {
  blocksToHours,
  CAL_STATE_META,
  emptyCardName,
  shiftOriginMinutes,
  spanLabel,
} from './format';

function prettifyHouse(id: string): string {
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// Read-only counterpart to ShiftDetailPanel, for surfaces (the worker House
// calendar) that show the same shift information without any reassignment
// capability — no worker roster, no phone numbers, no edit/apply controls.
// Takes a shift without `workerPhone` (the worker-safe model omits it) — this
// component never reads that field anyway.
export function ShiftInfoPopover({
  shift,
  houseName,
  dayLabel,
  onClose,
}: {
  shift: Omit<CalShift, 'workerPhone'>;
  houseName: string;
  dayLabel: string;
  onClose: () => void;
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
        </div>
      </aside>
    </>
  );
}
