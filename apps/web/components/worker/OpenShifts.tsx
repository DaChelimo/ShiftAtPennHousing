'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { claimShift, permanentPickup } from '../../lib/actions/worker/shifts';
import type { OpenShiftCardView, OpenShiftsBoard } from '../../lib/data/worker/openShifts';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Notification } from '../ui/Notification';
import { PageHead } from '../ui/PageHead';
import { Tag } from '../ui/Tag';

function OpenCard({
  card,
  busy,
  onAct,
}: {
  card: OpenShiftCardView;
  busy: boolean;
  onAct: (card: OpenShiftCardView) => void;
}) {
  const locked = card.state === 'unpickable';
  return (
    <Card pad className={`open-card ${locked ? 'is-locked' : ''}`.trim()} data-testid={`open-${card.id}`}>
      <Avatar name={card.houseName} size={36} />
      <div className="open-card-body grow">
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <span className="t-h2">{card.timeLabel}</span>
          {card.state === 'permanent' && <Tag kind="magenta">Permanent</Tag>}
          {card.count > 1 && <Tag kind="blue">{card.count} open</Tag>}
          {!card.homeHouse && <Tag kind="teal">Other house</Tag>}
        </div>
        <div className="t-helper">
          {card.dayLabel} · {card.durationLabel} · {card.houseName}
          {card.meta ? ` · ${card.meta}` : ''}
        </div>
      </div>
      {card.actionLabel && (
        <Button
          kind="primary"
          size="sm"
          data-testid={`open-action-${card.id}`}
          disabled={busy}
          onClick={() => onAct(card)}
        >
          {card.actionLabel}
        </Button>
      )}
    </Card>
  );
}

export function OpenShifts({ board }: { board: OpenShiftsBoard }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  async function onAct(card: OpenShiftCardView) {
    if (busyId !== null) return;
    setBusyId(card.id);
    setToast(null);
    if (card.feed === 'permanent_opening' && card.slot) {
      const res = await permanentPickup(card.slot);
      setBusyId(null);
      if (res.ok) {
        const { weeksPickedUp, totalWeeks, weeksSkipped } = res.data;
        const base =
          totalWeeks > 0
            ? `Picked up ${String(weeksPickedUp)} of ${String(totalWeeks)} week${totalWeeks === 1 ? '' : 's'}`
            : 'Picked up. It is now in My shifts';
        setToast({
          kind: 'ok',
          message: weeksSkipped > 0 ? `${base}. ${String(weeksSkipped)} skipped.` : base,
        });
        router.refresh();
      } else {
        setToast({ kind: 'error', message: res.error });
      }
      return;
    }
    // Weekly claim: one seat by assignment_id.
    const res = await claimShift(card.id);
    setBusyId(null);
    if (res.ok) {
      setToast({ kind: 'ok', message: "Claimed. It is now in My shifts." });
      router.refresh();
    } else {
      setToast({ kind: 'error', message: res.error });
    }
  }

  const meterFraction = Math.min(1, board.currentWeekHours / board.hoursCap);

  return (
    <div className="page" data-testid="open-shifts">
      <PageHead
        eyebrow="Open shifts"
        title="Open shifts"
        sub="Claim a one-time gap or pick up a recurring slot."
      />

      <Card pad data-testid="open-hours-meter">
        <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="t-body">This week</span>
          <span className="t-meta">
            {String(board.currentWeekHours)}h of {String(board.hoursCap)}h soft cap
          </span>
        </div>
        <div className="claim-meter">
          <div
            className={`claim-meter-fill ${board.currentWeekHours > board.hoursCap ? 'is-over' : ''}`.trim()}
            style={{ width: `${String(meterFraction * 100)}%` }}
          />
        </div>
      </Card>

      {toast && (
        <Notification
          kind={toast.kind === 'ok' ? 'success' : 'error'}
          title={toast.kind === 'ok' ? 'Done' : 'Could not complete'}
          onClose={() => setToast(null)}
          testId="open-toast"
        >
          {toast.message}
        </Notification>
      )}

      {board.cards.length === 0 ? (
        <EmptyState
          icon="search"
          title="No open shifts right now"
          desc="When a shift opens up at a house you can staff, it appears here."
        />
      ) : (
        <div className="open-feed" data-testid="open-feed">
          {board.cards.map((c) => (
            <OpenCard key={c.id} card={c} busy={busyId !== null} onAct={onAct} />
          ))}
        </div>
      )}
    </div>
  );
}
