'use client';

import type { SwapRow, SwapSide } from '@shift/core';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { acceptSwap, createHandoff, rejectSwap, voidSwap } from '../../lib/actions/worker/swaps';
import type { MyShiftOption, SwapsBoard } from '../../lib/data/worker/swaps';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Field, Select } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Notification } from '../ui/Notification';
import { PageHead } from '../ui/PageHead';
import { Tabs } from '../ui/Tabs';
import { Tag } from '../ui/Tag';

function SidePanel({ label, side }: { label: string; side: SwapSide }) {
  return (
    <div className="swap-side">
      <span className="swap-side-label">{label}</span>
      <span className="t-body">{side.timeRange ?? side.hours}</span>
      {side.dayLabel && <span className="t-meta">{side.dayLabel}</span>}
      {side.houseName && <span className="t-meta">at {side.houseName}</span>}
    </div>
  );
}

function SwapCard({
  row,
  busy,
  onAct,
}: {
  row: SwapRow;
  busy: boolean;
  onAct: (id: string, kind: 'accept' | 'reject' | 'void') => void;
}) {
  return (
    <Card pad className="swap-card" data-testid={`swap-${row.swapId}`}>
      <div className="row gap-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <Tag kind="purple">{row.typeLabel}</Tag>
          <span className="t-body">{row.counterpartyName}</span>
        </div>
        <span className={`t-meta ${row.deadlineUrgent ? 'is-urgent' : ''}`.trim()}>{row.deadline}</span>
      </div>

      {row.isOneWayTransfer && row.transferSide ? (
        <div className="swap-transfer" data-testid={`swap-transfer-${row.swapId}`}>
          <div className="swap-side-label">{row.transferHeadline}</div>
          <div className="t-body">{row.transferSide.timeRange ?? row.transferSide.hours}</div>
          <div className="t-meta">
            {row.transferSide.dayLabel}
            {row.transferSide.houseName ? ` · at ${row.transferSide.houseName}` : ''}
          </div>
        </div>
      ) : (
        <div className="swap-sides">
          {row.give ? <SidePanel label="You give" side={row.give} /> : <div />}
          <span className="swap-arrow" aria-hidden="true">
            &harr;
          </span>
          {row.get ? <SidePanel label="You get" side={row.get} /> : <div />}
        </div>
      )}

      <div className="row gap-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="t-meta">{row.directionLabel}</span>
        <div className="row gap-2">
          {row.acceptable ? (
            <>
              <Button
                kind="primary"
                size="sm"
                data-testid={`swap-accept-${row.swapId}`}
                disabled={busy}
                onClick={() => onAct(row.swapId, 'accept')}
              >
                Accept
              </Button>
              <Button
                kind="secondary"
                size="sm"
                data-testid={`swap-reject-${row.swapId}`}
                disabled={busy}
                onClick={() => onAct(row.swapId, 'reject')}
              >
                Decline
              </Button>
            </>
          ) : (
            <Button
              kind="ghost"
              size="sm"
              data-testid={`swap-void-${row.swapId}`}
              disabled={busy}
              onClick={() => onAct(row.swapId, 'void')}
            >
              Cancel request
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function HandoffSheet({
  board,
  onClose,
  onDone,
}: {
  board: SwapsBoard;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [shiftIdx, setShiftIdx] = useState<string>('');
  const [counterparty, setCounterparty] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shift: MyShiftOption | undefined =
    shiftIdx === '' ? undefined : board.handoffable[Number(shiftIdx)];

  async function onSubmit() {
    if (shift === undefined || counterparty === '' || busy) return;
    setBusy(true);
    setError(null);
    const res = await createHandoff(counterparty, shift.assignmentIds);
    setBusy(false);
    if (res.ok) {
      onDone('Hand-off proposed. It is waiting on the other worker.');
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <Modal
      testId="handoff-sheet"
      eyebrow="Hand off a shift"
      title="Give a shift to someone"
      onClose={onClose}
      footer={
        <>
          <Button kind="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            kind="primary"
            data-testid="handoff-submit"
            disabled={busy || shift === undefined || counterparty === ''}
            onClick={onSubmit}
          >
            {busy ? 'Sending...' : 'Send hand-off'}
          </Button>
        </>
      }
    >
      <div className="col gap-2">
        {error && (
          <Notification kind="error" title="Could not propose">
            {error}
          </Notification>
        )}
        {board.handoffable.length === 0 ? (
          <p className="t-body">You have no upcoming shifts to hand off right now.</p>
        ) : (
          <>
            <Field label="Your shift">
              <Select
                value={shiftIdx}
                data-testid="handoff-shift"
                onChange={(e) => setShiftIdx(e.target.value)}
              >
                <option value="">Choose a shift</option>
                {board.handoffable.map((s, i) => (
                  <option key={`${s.assignmentIds[0]}`} value={String(i)}>
                    {s.label} · {s.houseName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Give it to">
              <Select
                value={counterparty}
                data-testid="handoff-counterparty"
                onChange={(e) => setCounterparty(e.target.value)}
              >
                <option value="">Choose a worker</option>
                {board.directory.map((d) => (
                  <option key={d.userId} value={d.userId}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="t-helper">
              They receive your hours and nothing comes back to you. They must accept before it
              takes effect.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

export function Swaps({ board }: { board: SwapsBoard }) {
  const router = useRouter();
  const [tab, setTab] = useState<'incoming' | 'outgoing'>(
    board.feed.incoming.length > 0 ? 'incoming' : 'outgoing',
  );
  const [busy, setBusy] = useState(false);
  const [compose, setCompose] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  async function onAct(swapId: string, kind: 'accept' | 'reject' | 'void') {
    if (busy) return;
    setBusy(true);
    setToast(null);
    const res = await (kind === 'accept'
      ? acceptSwap(swapId)
      : kind === 'reject'
        ? rejectSwap(swapId)
        : voidSwap(swapId));
    setBusy(false);
    if (res.ok) {
      const message =
        kind === 'accept' ? 'Swap accepted.' : kind === 'reject' ? 'Swap declined.' : 'Request cancelled.';
      setToast({ kind: 'ok', message });
      router.refresh();
    } else {
      setToast({ kind: 'error', message: res.error });
    }
  }

  const rows = tab === 'incoming' ? board.feed.incoming : board.feed.outgoing;

  return (
    <div className="page" data-testid="swaps">
      <PageHead
        eyebrow="Swaps"
        title="Swaps"
        sub="Respond to requests, or hand a shift to someone else."
        actions={
          <Button kind="primary" icon="add" data-testid="swaps-compose" onClick={() => setCompose(true)}>
            Hand off a shift
          </Button>
        }
      />

      {toast && (
        <Notification
          kind={toast.kind === 'ok' ? 'success' : 'error'}
          title={toast.kind === 'ok' ? 'Done' : 'Could not complete'}
          onClose={() => setToast(null)}
          testId="swaps-toast"
        >
          {toast.message}
        </Notification>
      )}

      <Tabs
        tabs={[
          { key: 'incoming', label: 'Incoming', count: board.feed.incoming.length },
          { key: 'outgoing', label: 'Outgoing', count: board.feed.outgoing.length },
        ]}
        active={tab}
        onChange={(k) => setTab(k as 'incoming' | 'outgoing')}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="swap"
          title={tab === 'incoming' ? 'No incoming requests' : 'No outgoing requests'}
          desc={
            tab === 'incoming'
              ? 'Swap and hand-off requests from others show up here.'
              : 'Requests you send show up here until the other worker responds.'
          }
        />
      ) : (
        <div className="col gap-2" data-testid={`swaps-${tab}`}>
          {rows.map((r) => (
            <SwapCard key={r.swapId} row={r} busy={busy} onAct={onAct} />
          ))}
        </div>
      )}

      {compose && (
        <HandoffSheet
          board={board}
          onClose={() => setCompose(false)}
          onDone={(message) => {
            setCompose(false);
            setToast({ kind: 'ok', message });
          }}
        />
      )}
    </div>
  );
}
