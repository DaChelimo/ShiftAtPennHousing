'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { dropShift, permanentDrop } from '../../lib/actions/worker/shifts';
import type { MyShiftCardView, MyShiftsBoard } from '../../lib/data/worker/myShifts';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { Notification } from '../ui/Notification';
import { PageHead } from '../ui/PageHead';
import { PickupDot, Tag, type TagKind } from '../ui/Tag';

const STATE_TAG: Record<MyShiftCardView['state'], { kind: TagKind; label: string }> = {
  scheduled: { kind: 'gray', label: 'Scheduled' },
  pickup_home: { kind: 'green', label: 'Picked up' },
  pickup_cross: { kind: 'green', label: 'Picked up' },
  float_out: { kind: 'purple', label: 'Floating out' },
  pending_float: { kind: 'amber', label: 'Float pending' },
  break_shift: { kind: 'amber', label: 'Break' },
  dropped: { kind: 'gray', label: 'Dropped, open' },
};

// A held shift can be dropped only when it is the worker's own present shift (scheduled or
// a temporary pickup). A shift already floating out or already dropped is not droppable.
function isDroppable(card: MyShiftCardView): boolean {
  return (
    !card.droppedStillOpen &&
    !card.pending &&
    (card.kind === 'scheduled' || card.kind === 'temp_pickup')
  );
}

function ShiftCard({
  card,
  onManage,
}: {
  card: MyShiftCardView;
  onManage: (card: MyShiftCardView) => void;
}) {
  const tag = STATE_TAG[card.state];
  const cross = card.state === 'pickup_cross' || card.state === 'float_out' || card.state === 'pending_float';
  return (
    <Card pad className="shift-card" data-testid={`myshift-${card.id}`}>
      <div className="shift-card-avatar">
        <Avatar name={card.houseName} size={36} />
      </div>
      <div className="col gap-1 grow">
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <span className="t-h2">{card.timeLabel}</span>
          <Tag kind={tag.kind}>{tag.label}</Tag>
          {cross && <PickupDot title="Cross-house shift" />}
        </div>
        <div className="t-helper">
          {card.dayLabel} · {card.durationLabel} · {cross ? `at ${card.houseName}` : card.houseName}
        </div>
      </div>
      {isDroppable(card) && (
        <Button kind="ghost" size="sm" data-testid={`myshift-manage-${card.id}`} onClick={() => onManage(card)}>
          Manage
        </Button>
      )}
    </Card>
  );
}

function Section({
  title,
  testId,
  cards,
  emptyText,
  onManage,
}: {
  title: string;
  testId: string;
  cards: MyShiftCardView[];
  emptyText: string;
  onManage: (card: MyShiftCardView) => void;
}) {
  return (
    <section className="shift-section" data-testid={testId}>
      <div className="shift-section-head">
        <span className="t-eyebrow">{title}</span>
        <span className="t-meta">{cards.length}</span>
      </div>
      {cards.length === 0 ? (
        <div className="shift-section-empty t-helper" data-testid={`${testId}-empty`}>
          {emptyText}
        </div>
      ) : (
        <div className="col gap-2">
          {cards.map((c) => (
            <ShiftCard key={c.id} card={c} onManage={onManage} />
          ))}
        </div>
      )}
    </section>
  );
}

// The "Manage shift" sheet. Drop today (Phase 3); the swap + permanent-drop entry points
// land in Phase 4 alongside their actions. Supports a partial (sub-range) drop by toggling
// the constituent 30-minute blocks.
function ManageSheet({
  card,
  onClose,
  onDone,
}: {
  card: MyShiftCardView;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const [scope, setScope] = useState<'this_week' | 'permanent'>('this_week');
  const [selected, setSelected] = useState<Set<string>>(new Set(card.blockIds));

  // Reconstruct each 30-minute sub-block's label from the card start (block atomicity).
  const subBlocks = useMemo(() => {
    const start = new Date(card.startIso);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return card.blockIds.map((id, i) => {
      const s = new Date(start.getTime() + i * 30 * 60 * 1000);
      const e = new Date(s.getTime() + 30 * 60 * 1000);
      return { id, label: `${fmt.format(s)} - ${fmt.format(e)}` };
    });
  }, [card]);

  const toDrop = partial ? [...selected] : card.blockIds;
  const canPermanent = card.slot !== null;

  async function onDrop() {
    if (busy) return;
    setBusy(true);
    setError(null);

    if (scope === 'permanent' && card.slot !== null) {
      const res = await permanentDrop(card.slot);
      setBusy(false);
      if (res.ok) {
        onDone('Slot given up for every future week. Each week is now in the open feed.');
        router.refresh();
      } else {
        setError(res.error);
      }
      return;
    }

    if (toDrop.length === 0) {
      setBusy(false);
      return;
    }
    const res = await dropShift(toDrop);
    setBusy(false);
    if (res.ok) {
      onDone(
        toDrop.length === card.blockIds.length
          ? 'Shift dropped. It is now in the open feed.'
          : `Dropped ${String(toDrop.length)} block${toDrop.length === 1 ? '' : 's'}. They are now open.`,
      );
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <Modal
      testId="manage-shift-sheet"
      eyebrow="Manage shift"
      title={card.timeLabel}
      onClose={onClose}
      footer={
        <>
          <Button kind="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            kind="danger"
            data-testid="manage-drop-submit"
            onClick={onDrop}
            disabled={busy || (scope === 'this_week' && toDrop.length === 0)}
          >
            {busy
              ? 'Working...'
              : scope === 'permanent'
                ? 'Give up every week'
                : partial
                  ? `Drop ${String(toDrop.length)} selected`
                  : 'Drop shift'}
          </Button>
        </>
      }
    >
      <div className="col gap-2">
        <div className="t-helper">
          {card.dayLabel} · {card.durationLabel} · {card.houseName}
        </div>
        {error && (
          <Notification kind="error" title="Could not drop">
            {error}
          </Notification>
        )}
        {canPermanent && (
          <div className="col gap-1" data-testid="manage-scope">
            <label className="row gap-2" style={{ alignItems: 'center' }}>
              <input
                type="radio"
                name="drop-scope"
                checked={scope === 'this_week'}
                data-testid="manage-scope-this-week"
                onChange={() => setScope('this_week')}
              />
              <span className="t-body">This week only</span>
            </label>
            <label className="row gap-2" style={{ alignItems: 'center' }}>
              <input
                type="radio"
                name="drop-scope"
                checked={scope === 'permanent'}
                data-testid="manage-scope-permanent"
                onChange={() => setScope('permanent')}
              />
              <span className="t-body">Every future week (give up the slot)</span>
            </label>
          </div>
        )}
        <p className="t-body">
          {scope === 'permanent'
            ? 'This gives up the recurring slot for the rest of the semester. Every future week returns to the open feed.'
            : 'Dropping returns the shift to the open feed for someone else to pick up. You cannot reclaim it yourself.'}
        </p>
        {scope === 'this_week' && card.blockIds.length > 1 && (
          <label className="row gap-2" style={{ alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={partial}
              data-testid="manage-drop-partial"
              onChange={(e) => setPartial(e.target.checked)}
            />
            <span className="t-body">Drop only part of this shift</span>
          </label>
        )}
        {scope === 'this_week' && partial && (
          <div className="manage-blocklist">
            {subBlocks.map((b) => {
              const on = selected.has(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`manage-block ${on ? 'is-on' : ''}`.trim()}
                  aria-pressed={on}
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(b.id)) next.delete(b.id);
                      else next.add(b.id);
                      return next;
                    })
                  }
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function MyShifts({ board }: { board: MyShiftsBoard }) {
  const pathname = usePathname();
  const [manage, setManage] = useState<MyShiftCardView | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const weekHref = (offset: number): string => `${pathname}?w=${String(offset)}`;

  return (
    <div className="page" data-testid="my-shifts">
      <PageHead
        eyebrow="My shifts"
        title="My shifts"
        sub="Everything you are holding this week."
      />

      <div className="week-header" data-testid="myshifts-week">
        <Link
          href={weekHref(board.weekOffset - 1)}
          className="icon-btn"
          aria-label="Previous week"
          data-testid="myshifts-prev-week"
        >
          <IconButtonGlyph dir="left" />
        </Link>
        <div className="col" style={{ alignItems: 'center' }}>
          <span className="t-body" data-testid="myshifts-week-label">
            {board.weekRangeLabel}
          </span>
          <span className="t-meta" data-testid="myshifts-week-hours">
            This week - {formatHours(board.weekHours)}
          </span>
        </div>
        <Link
          href={weekHref(board.weekOffset + 1)}
          className="icon-btn"
          aria-label="Next week"
          data-testid="myshifts-next-week"
        >
          <IconButtonGlyph dir="right" />
        </Link>
      </div>

      {toast && (
        <Notification kind="success" title="Done" onClose={() => setToast(null)} testId="myshifts-toast">
          {toast}
        </Notification>
      )}

      <Section
        title="Scheduled"
        testId="section_scheduled"
        cards={board.scheduled}
        emptyText="No scheduled shifts this week."
        onManage={setManage}
      />
      <Section
        title="Picked up"
        testId="section_picked_up"
        cards={board.pickedUp}
        emptyText="You have not picked up any open shifts this week."
        onManage={setManage}
      />
      <Section
        title="Dropped, still open"
        testId="section_dropped"
        cards={board.dropped}
        emptyText="Nothing you dropped is waiting to be picked up."
        onManage={setManage}
      />

      {board.scheduled.length === 0 &&
        board.pickedUp.length === 0 &&
        board.dropped.length === 0 && (
          <EmptyState
            icon="calendar"
            title="Nothing this week"
            desc="Use the arrows to look at another week, or head to Open shifts to pick something up."
          />
        )}

      {manage && (
        <ManageSheet
          card={manage}
          onClose={() => setManage(null)}
          onDone={(message) => {
            setManage(null);
            setToast(message);
          }}
        />
      )}
    </div>
  );
}

function formatHours(hours: number): string {
  return `${String(hours)}h`;
}

// Small inline chevron so the week nav does not depend on a specific Icon glyph name.
function IconButtonGlyph({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M10 3 L5 8 L10 13' : 'M6 3 L11 8 L6 13'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
