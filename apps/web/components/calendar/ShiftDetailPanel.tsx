'use client';

import { useEffect } from 'react';

import type { CalShift } from '../../lib/data/calendar';
import {
  Avatar,
  Button,
  EscalationChip,
  Icon,
  IconButton,
  Notification,
  PickupDot,
  Tag,
  type EscalationStep,
} from '../ui';

import { blocksToHours, CAL_STATE_META, emptyCardName, spanLabel } from './format';

const ROLE_LABEL: Record<string, string> = {
  bm: 'Building Manager',
  hm: 'Housing Manager',
  sm: 'Student Manager',
  sw: 'Student Worker',
};

function prettifyHouse(id: string): string {
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// Read-only shift detail / contact panel (design screen 04). Shows the shift,
// the staffing worker's contact (Call via tel:), and escalation context. The
// inline-OVERRIDE write the design shows is surfaced as a flagged, disabled
// section — it needs an override RPC that does not exist (DESIGN_TOKENS.md §6).
export function ShiftDetailPanel({
  shift,
  houseName,
  dayLabel,
  onClose,
}: {
  shift: CalShift;
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

  return (
    <>
      <div className="panel-scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label="Shift detail">
        <div className="panel-head">
          <div className="col gap-1">
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
              {spanLabel(shift.startBlock, shift.endBlock)}
            </span>
            <span className="t-meta">· {blocksToHours(shift.startBlock, shift.endBlock)}h</span>
          </div>

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

          {shift.workerName && (
            <div className="contact-card">
              <Avatar name={shift.workerName} size={34} />
              <div className="col grow" style={{ gap: 3, minWidth: 0 }}>
                <b className="scard-name">{shift.workerName}</b>
                <span className="t-meta scard-name">
                  {shift.workerRole ? (ROLE_LABEL[shift.workerRole] ?? shift.workerRole) : 'Worker'}{' '}
                  · {homeLabel ?? houseName}
                </span>
              </div>
              {shift.workerPhone ? (
                <a className="btn btn-secondary btn-sm" href={`tel:${shift.workerPhone}`}>
                  <Icon name="phone" size={16} />
                  <span>Call</span>
                </a>
              ) : (
                <Button kind="secondary" size="sm" icon="phone" disabled>
                  Call
                </Button>
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

          {/* Inline override — design shows reassign / remove / force-trigger here,
              but there is no override RPC (DESIGN_TOKENS.md §6). Flagged + disabled. */}
          <div className="detail-override">
            <div className="t-label" style={{ marginBottom: 8 }}>
              Inline override
            </div>
            <Notification kind="info" title="Read-only in this build">
              Changing the live schedule (reassign / remove / force-trigger, this-week vs permanent)
              needs an override RPC that does not exist yet — flagged in DESIGN_TOKENS.md §6, not
              fabricated here.
            </Notification>
            <div className="col gap-2" style={{ marginTop: 12 }}>
              <Button kind="secondary" icon="edit" disabled>
                {shift.workerName ? 'Reassign / add coverage' : 'Assign a worker'}
              </Button>
              {isGap && (
                <Button kind="tertiary" icon="swap" disabled>
                  Force-trigger float lookup
                </Button>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
