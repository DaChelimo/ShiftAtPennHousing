'use client';

import { useEffect, useState } from 'react';

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

// Shift detail / contact panel (design screen 04). Shows the shift, the staffing
// worker's contact (Call via tel:), escalation context, and the live inline
// override (S1 — assign / reassign / remove, this-week vs permanent). `onApplied`
// re-fetches the calendar after a successful override; `onClose` just dismisses.
export function ShiftDetailPanel({
  shift,
  houseName,
  dayLabel,
  assignableWorkers,
  onClose,
  onApplied,
}: {
  shift: CalShift;
  houseName: string;
  dayLabel: string;
  assignableWorkers: AssignableWorker[];
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

          {/* Inline override (S1) — live assign / reassign / remove on this block,
              this-week vs permanent, with a soft-advisory confirm. Authoritative
              enforcement is the admin_assign_worker / admin_remove_worker RPC. */}
          <OverrideSection
            shift={shift}
            assignableWorkers={assignableWorkers}
            onApplied={onApplied}
          />
        </div>
      </aside>
    </>
  );
}

const ADVISORY_LABEL: Record<string, string> = {
  cannot: 'This worker marked “cannot work” for this shift.',
  opted_out: 'This worker opted out of hours this period.',
  soft_cap: 'This assignment exceeds the worker’s soft (20h) weekly cap.',
  over_target: 'This assignment exceeds the worker’s target hours.',
};

// Live inline-override controls: worker picker + this-week/permanent scope +
// submit, an advisory-confirm modal (soft constraints), and a remove button on an
// occupied seat. Hard blocks / unauthorized are surfaced inline from the RPC.
function OverrideSection({
  shift,
  assignableWorkers,
  onApplied,
}: {
  shift: CalShift;
  assignableWorkers: AssignableWorker[];
  onApplied: () => void;
}) {
  const occupied = shift.userId !== null;
  const [workerId, setWorkerId] = useState<string | null>(shift.userId);
  const [scope, setScope] = useState<OverrideScope>('this_week');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AssignAdvisory[] | null>(null);

  const options = assignableWorkers.map((w) => ({ value: w.userId, label: w.name }));

  async function doAssign(overrideAdvisories: boolean) {
    if (workerId === null) {
      setError('Pick a worker first.');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    const res = await assignWorker({
      blockIds: shift.blockIds,
      userId: workerId,
      scope,
      overrideAdvisories,
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
    setSuccess(occupied ? 'Reassigned' : 'Assigned');
    // Let the success flash render, then re-fetch the calendar grid so the card
    // reflects the write (the server action already revalidated /calendar).
    setTimeout(onApplied, 700);
  }

  async function doRemove() {
    if (shift.userId === null) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    const res = await removeWorker({
      blockIds: shift.blockIds,
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
      <div className="t-label" style={{ marginBottom: 10 }}>
        Inline override
      </div>

      <div className="col gap-3">
        <label className="field">
          <span className="t-label">Worker</span>
          <select
            data-testid="override-worker-select"
            className="input select"
            value={workerId ?? ''}
            onChange={(e) => setWorkerId(e.target.value === '' ? null : e.target.value)}
          >
            <option value="" disabled>
              Select a worker…
            </option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="col gap-1">
          <span className="t-label">Apply to</span>
          <div className="seg" role="radiogroup" aria-label="Override scope">
            <button
              type="button"
              role="radio"
              data-testid="override-scope-week"
              className={`seg-btn ${scope === 'this_week' ? 'is-on' : ''}`.trim()}
              aria-checked={scope === 'this_week'}
              onClick={() => setScope('this_week')}
            >
              This week
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
        </div>

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

        <div className="row gap-2 wrap">
          <Button
            kind="primary"
            icon={occupied ? 'edit' : 'add'}
            data-testid="override-submit"
            disabled={busy || workerId === null}
            onClick={() => doAssign(false)}
          >
            {occupied ? 'Reassign' : 'Assign'}
          </Button>
          {occupied && (
            <Button
              kind="danger"
              icon="trash"
              data-testid="override-remove"
              disabled={busy}
              onClick={doRemove}
            >
              Remove
            </Button>
          )}
        </div>
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
                Assign anyway
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
