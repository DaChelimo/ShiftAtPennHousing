'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';

import { claimShift, permanentPickup } from '../../lib/actions/worker/shifts';
import type { OpenShiftCardView, OpenShiftsBoard } from '../../lib/data/worker/openShifts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Notification } from '../ui/Notification';
import { PageHead } from '../ui/PageHead';
import { Tabs } from '../ui/Tabs';
import { Tag } from '../ui/Tag';

type OpenFilter = 'all' | 'home' | 'away';

// Soonest first, then by house so a shared time slot reads in a stable order.
// This is not a user-toggleable sort — the feed is always ordered this way.
function bySoonest(a: OpenShiftCardView, b: OpenShiftCardView): number {
  return a.startIso.localeCompare(b.startIso) || a.houseName.localeCompare(b.houseName);
}

// Cards arrive pre-sorted by start time; cluster contiguous same-day runs so a
// divider can be rendered once per day instead of once per card.
function groupByDay(cards: OpenShiftCardView[]): { day: string; cards: OpenShiftCardView[] }[] {
  const groups: { day: string; cards: OpenShiftCardView[] }[] = [];
  for (const c of cards) {
    const last = groups[groups.length - 1];
    if (last && last.day === c.dayLabel) {
      last.cards.push(c);
    } else {
      groups.push({ day: c.dayLabel, cards: [c] });
    }
  }
  return groups;
}

function OpenCard({
  card,
  busy,
  showHomeTag,
  onAct,
}: {
  card: OpenShiftCardView;
  busy: boolean;
  showHomeTag: boolean;
  onAct: (card: OpenShiftCardView) => void;
}) {
  const locked = card.state === 'unpickable';
  const highlightHome = showHomeTag && card.homeHouse;
  return (
    <Card
      className={`open-card ${locked ? 'is-locked' : ''} ${highlightHome ? 'is-home' : ''}`.trim()}
      data-testid={`open-${card.id}`}
    >
      <div className="open-card-strip">
        <span>{card.dayLabel}</span>
        <span>{card.durationLabel}</span>
      </div>
      <div className="open-card-body">
        <div className="open-card-time">{card.timeLabel}</div>
        <div className="open-card-house">
          {card.houseName}
          {card.meta ? ` · ${card.meta}` : ''}
        </div>
        <div className="open-card-tags">
          {highlightHome && <Tag kind="blue">Home</Tag>}
          {card.state === 'permanent' && <Tag kind="magenta">Permanent</Tag>}
          {card.count > 1 && <Tag kind="blue">{card.count} open</Tag>}
        </div>
        {card.actionLabel && (
          <Button
            kind="primary"
            size="sm"
            full
            className="open-card-action"
            data-testid={`open-action-${card.id}`}
            disabled={busy}
            onClick={() => onAct(card)}
          >
            {card.actionLabel}
          </Button>
        )}
      </div>
    </Card>
  );
}

// The card grid for one filter. Fluid and column-count agnostic: as many
// ~300px cards as the container allows (1 on a phone, up to 3 on a laptop or
// iPad), grouped under a day divider that spans every column.
function OpenGrid({
  cards,
  emptyText,
  busy,
  showHomeTag,
  onAct,
}: {
  cards: OpenShiftCardView[];
  emptyText: string;
  busy: boolean;
  showHomeTag: boolean;
  onAct: (card: OpenShiftCardView) => void;
}) {
  if (cards.length === 0) {
    return <EmptyState icon="search" title="Nothing open right now" desc={emptyText} />;
  }
  return (
    <div className="open-feed" data-testid="open-feed">
      {groupByDay(cards).map((group) => (
        <Fragment key={group.day}>
          <div className="open-day-divider">{group.day}</div>
          {group.cards.map((c) => (
            // Feed-scoped key: a permanently dropped occurrence can surface as both a
            // weekly card and a permanent card sharing one assignment_id.
            <OpenCard
              key={`${c.feed}-${c.id}`}
              card={c}
              busy={busy}
              showHomeTag={showHomeTag}
              onAct={onAct}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

export function OpenShifts({ board }: { board: OpenShiftsBoard }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);
  const [filter, setFilter] = useState<OpenFilter>('all');

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
      setToast({ kind: 'ok', message: 'Claimed. It is now in My shifts.' });
      router.refresh();
    } else {
      setToast({ kind: 'error', message: res.error });
    }
  }

  const meterFraction = Math.min(1, board.currentWeekHours / board.hoursCap);

  const allCards = [...board.cards].sort(bySoonest);
  const homeCards = board.cards.filter((c) => c.homeHouse).sort(bySoonest);
  const awayCards = board.cards.filter((c) => !c.homeHouse).sort(bySoonest);
  const filteredCards = filter === 'home' ? homeCards : filter === 'away' ? awayCards : allCards;

  return (
    <div className="page" data-testid="open-shifts">
      <PageHead
        eyebrow="Open shifts"
        title="Open shifts"
        sub="Claim a one-time gap or pick up a recurring slot."
      />

      <Card pad data-testid="open-hours-meter">
        <div
          className="row gap-2"
          style={{ justifyContent: 'space-between', alignItems: 'baseline' }}
        >
          <span className="t-body">This week</span>
          <span className="t-meta">
            {String(board.currentWeekHours)}h of {String(board.hoursCap)}h{' '}
            {board.capEnforcement === 'hard' ? 'hard cap' : 'soft cap'}
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
        <>
          <div className="open-toprow">
            <Tabs
              tabs={[
                { key: 'all', label: 'All', count: allCards.length },
                { key: 'home', label: 'My house', count: homeCards.length },
                { key: 'away', label: 'Other houses', count: awayCards.length },
              ]}
              active={filter}
              onChange={(k) => setFilter(k as OpenFilter)}
            />
            <span className="t-meta open-sort-note">Soonest first</span>
          </div>
          <OpenGrid
            cards={filteredCards}
            emptyText={
              filter === 'home'
                ? 'Nothing open at your house right now.'
                : filter === 'away'
                  ? 'Nothing open at other houses right now.'
                  : 'When a shift opens up at a house you can staff, it appears here.'
            }
            busy={busyId !== null}
            showHomeTag={filter === 'all'}
            onAct={onAct}
          />
        </>
      )}
    </div>
  );
}
