'use client';

import { useSyncExternalStore } from 'react';

import type { CalendarDay, CalShift, CalSwapMark, LaneSegment } from '../../lib/data/calendar';
import { workerColor, workerContrastText } from '../../lib/workerColor';
import { Icon, PickupDot, Tag } from '../ui';

import {
  BLOCK_H,
  blockLabel,
  CAL_STATE_META,
  emptyCardName,
  HEAD_H,
  shiftOriginMinutes,
  spanLabel,
} from './format';

// The admin calendar's CalShift carries `workerPhone`; the worker-safe model
// omits it. Every grid renderer here is presentation-only and never reads that
// field, so they accept either shape.
type GridShift = Omit<CalShift, 'workerPhone'>;

function prettifyHouse(id: string): string {
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// "Now" as a fractional block index in NY (minute resolution → stable within a
// minute), relative to the grid's own origin/span. useSyncExternalStore keeps SSR
// (null, no line) and the client in sync without a setState-in-effect or
// hydration mismatch.
function nyNowBlock(dayStartMin: number, blocksPerDay: number): number | null {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const b = (h * 60 + m - dayStartMin) / 30;
  return b >= 0 && b <= blocksPerDay ? b : null;
}
const SUBSCRIBE_NOW = () => () => {};
const NOW_SERVER = () => null;

// Shared "now line" wiring — both the admin Live Calendar and the worker House
// calendar want the same live position, kept in sync across SSR/client.
export function useNowBlock(dayStartMin: number, blocksPerDay: number): number | null {
  return useSyncExternalStore(
    SUBSCRIBE_NOW,
    () => nyNowBlock(dayStartMin, blocksPerDay),
    NOW_SERVER,
  );
}

export function ShiftCardEl<S extends GridShift>({
  shift,
  onSelect,
  top,
  height,
  clipTop = false,
  clipBot = false,
  mine = false,
  selected = false,
}: {
  shift: S;
  onSelect?: (s: S) => void;
  top?: number;
  height?: number;
  clipTop?: boolean;
  clipBot?: boolean;
  mine?: boolean;
  selected?: boolean;
}) {
  const meta = CAL_STATE_META[shift.state];
  const h = height ?? (shift.endBlock - shift.startBlock) * BLOCK_H - 2;
  const t = top ?? shift.startBlock * BLOCK_H + 1;
  const short = h < 52;
  const name = shift.workerName ?? emptyCardName(shift.state);
  // Derived from the shift's own timestamp, not the grid's shared origin — always
  // shows the block's real start/end even for an early-opening summer shift.
  const origin = shiftOriginMinutes(shift);
  // Per-worker tint applies only to the default "scheduled" look (scheduled +
  // picked-up) with a real worker on it. Float/allied/vacant/permanent keep their
  // state colors, which carry meaning. See docs/design/worker-colors.md.
  const tinted = shift.userId !== null && meta.cls === 'sc-scheduled';
  // A seat tied up in a pending swap (BSpec §11.4). Shown on BOTH shifts in the
  // exchange, because a manager reading coverage needs to know the desk is mid-swap:
  // who proposed it and who still owes an answer. The label is deliberately terse (the
  // card is ~90px wide); the full detail is in the title attribute and the side panel.
  const swap = shift.pendingSwap;
  const wc = tinted ? workerColor(shift.userId!) : undefined;
  const wcFg = tinted ? workerContrastText(shift.userId!) : undefined;
  return (
    <button
      type="button"
      className={`scard ${meta.cls} ${clipTop ? 'clip-top' : ''} ${clipBot ? 'clip-bot' : ''} ${mine ? 'scard-mine' : ''} ${tinted ? 'scard-worker' : ''} ${selected ? 'is-selected' : ''}`.trim()}
      style={
        wc
          ? { top: t, height: h, ['--wc' as string]: wc, ['--wc-fg' as string]: wcFg }
          : { top: t, height: h }
      }
      onClick={() => onSelect?.(shift)}
      title={swap ? `${name} - ${swapTitle(swap)}` : name}
    >
      <span className="scard-time t-mono">
        {spanLabel(shift.startBlock, shift.endBlock, origin)}
      </span>
      <span className="scard-name">
        {meta.dot && <PickupDot />}
        <span className="scard-name-text">{name}</span>
      </span>
      {!short && (
        <span className="scard-foot">
          {meta.tag && (
            <Tag kind={meta.tag.kind} icon={meta.tag.icon}>
              {meta.tag.label}
            </Tag>
          )}
          {shift.homeHouse && (
            <span className="scard-home t-mono">{prettifyHouse(shift.homeHouse)}</span>
          )}
        </span>
      )}
      {short && meta.tag && <span className="scard-tag-mini" />}
      {swap && <span className="scard-swap" aria-label={swapTitle(swap)} />}
    </button>
  );
}

/**
 * The full pending-swap sentence, for the card's tooltip and the detail panel. Names
 * both parties and says who is being waited on, so the reader never has to guess which
 * of the two shifts is "the other one". No em/en dashes (surfaced copy).
 */
export function swapTitle(swap: CalSwapMark): string {
  const kind = swap.swapType === 'handoff' ? 'hand-off' : 'swap';
  const proposer = swap.initiatorName ?? 'A worker';
  const other = swap.counterpartyName ?? 'a housemate';
  const awaiting = swap.awaitingName ?? other;
  // The span on the OTHER side of the exchange from this seat.
  const otherSpan = swap.side === 'initiator' ? swap.counterpartySpan : swap.initiatorSpan;
  const forPart = otherSpan ? ` for ${otherSpan}` : '';
  return `Pending ${kind}: ${proposer} proposed it${forPart}. Waiting on ${awaiting} to respond.`;
}

// §3.4/§11.3 closed-house presentation: a column with no shift grid and no
// open-shifts feed — just a "Closed" marker for the closure date.
export function ClosedCell() {
  return (
    <div className="cal-closed">
      <div className="cal-closed-inner">
        <Icon name="calendar" size={22} />
        <span>Closed</span>
      </div>
    </div>
  );
}

export function GutterTicks({
  startBlock,
  rows,
  originMin,
}: {
  startBlock: number;
  rows: number;
  originMin: number;
}) {
  return (
    <div className="cal-gutter">
      <div className="cal-corner" style={{ height: HEAD_H }} />
      {Array.from({ length: rows }).map((_, i) => {
        const b = startBlock + i;
        // Always label the very first row with the column's real open time (e.g.
        // 05:30 for summer Harnwell), even when that's not on the hour — then only
        // label on-the-hour rows after that. Labeling every 30-min step relative to
        // an odd origin (05:30, 06:30, 07:30…) is unreadable; a fixed 06:00, 07:00…
        // cadence reads naturally while still surfacing the true start time once.
        const onHour = (originMin + b * 30) % 60 === 0;
        const showLabel = i === 0 || onHour;
        const isLast = i === rows - 1;
        return (
          <div className="cal-tick" key={b} style={{ height: BLOCK_H }}>
            {showLabel && (
              <span className={`t-mono cal-tick-label ${i === 0 ? 'is-first' : ''}`.trim()}>
                {blockLabel(b, originMin)}
              </span>
            )}
            {/* The closing boundary (e.g. 24:00) isn't the START of any row, so it
                never gets a label from the loop above — without this, the column's
                end time is never shown at all. Anchored to the LAST row's own box
                (not straddling past the container edge) so it can't get clipped the
                same way the first row's label used to. */}
            {isLast && (
              <span className="t-mono cal-tick-label is-last">{blockLabel(b + 1, originMin)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function RowLines({
  startBlock,
  rows,
  originMin,
}: {
  startBlock: number;
  rows: number;
  originMin: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => {
        const b = startBlock + i;
        // Bold gridline cadence follows the same on-the-hour rule as the tick
        // labels above (06:00, 07:00…), not a fixed every-other-row offset from
        // an odd origin like 05:30 — otherwise the bold lines land on 05:30,
        // 06:30, 07:30… which no longer matches the labels.
        const onHour = (originMin + b * 30) % 60 === 0;
        return (
          <div
            className={`cal-rowline ${onHour ? 'is-hour' : ''}`.trim()}
            key={b}
            style={{ top: i * BLOCK_H }}
          />
        );
      })}
    </>
  );
}

// One lane-count segment within a day's column. A day with uniform staffing all
// day is a single segment spanning the full height (identical to the old
// fixed-lane render); a day like Harnwell's (1 seat 05:30-12:00, 2 seats
// 12:00-24:00) stacks two segments so the grid never reserves a lane that
// doesn't exist yet for that time range.
export function DaySegment<S extends GridShift>({
  seg,
  shifts,
  originMin,
  nowBlock,
  onSelect,
  isMine,
  selectedId,
}: {
  seg: LaneSegment;
  shifts: S[];
  originMin: number;
  nowBlock: number | null;
  onSelect?: (s: S) => void;
  isMine?: (s: S) => boolean;
  selectedId?: string | null;
}) {
  const rows = seg.endBlock - seg.startBlock;
  const segShifts = shifts.filter(
    (s) => s.startBlock < seg.endBlock && s.endBlock > seg.startBlock,
  );
  const nowHere = nowBlock !== null && nowBlock >= seg.startBlock && nowBlock < seg.endBlock;
  return (
    <div className="cal-lanes" style={{ height: rows * BLOCK_H }}>
      <RowLines startBlock={seg.startBlock} rows={rows} originMin={originMin} />
      {Array.from({ length: seg.lanes }).map((_, ln) => (
        <div className={`cal-lane ${ln === seg.lanes - 1 ? 'lane-last' : ''}`.trim()} key={ln}>
          {segShifts
            .filter((s) => s.lane === ln)
            .map((s) => {
              const vs = Math.max(s.startBlock, seg.startBlock);
              const ve = Math.min(s.endBlock, seg.endBlock);
              return (
                <ShiftCardEl
                  key={`${s.id}-${seg.startBlock}`}
                  shift={s}
                  onSelect={onSelect}
                  top={(vs - seg.startBlock) * BLOCK_H + 1}
                  height={(ve - vs) * BLOCK_H - 2}
                  clipTop={s.startBlock < seg.startBlock}
                  clipBot={s.endBlock > seg.endBlock}
                  mine={isMine?.(s) ?? false}
                  selected={s.id === selectedId}
                />
              );
            })}
        </div>
      ))}
      {nowHere && (
        <div className="nowline-inline" style={{ top: (nowBlock! - seg.startBlock) * BLOCK_H }}>
          <span className="nowline-dot" />
        </div>
      )}
    </div>
  );
}

export function DayColumn<S extends GridShift>({
  day,
  shifts,
  blocksPerDay,
  originMin,
  nowBlock,
  onSelect,
  isMine,
  selectedId,
}: {
  day: CalendarDay;
  shifts: S[];
  blocksPerDay: number;
  originMin: number;
  nowBlock: number | null;
  onSelect?: (s: S) => void;
  isMine?: (s: S) => boolean;
  selectedId?: string | null;
}) {
  return (
    <div className={`cal-day ${day.isToday ? 'is-today' : ''}`.trim()} data-col-index={day.index}>
      <div className="cal-dayhead" style={{ height: HEAD_H }}>
        <span className="cal-dow">{day.label}</span>
        <span className="cal-date t-mono">{day.date}</span>
        {day.isToday && <span className="cal-today-pip">Today</span>}
      </div>
      {day.closed ? (
        <div
          className="cal-lanes"
          style={{ height: blocksPerDay * BLOCK_H }}
          data-testid="calendar-closed-day"
        >
          <ClosedCell />
        </div>
      ) : (
        <div className="cal-segments">
          {day.laneSegments.map((seg) => (
            <DaySegment
              key={seg.startBlock}
              seg={seg}
              shifts={shifts}
              originMin={originMin}
              nowBlock={day.isToday ? nowBlock : null}
              onSelect={onSelect}
              isMine={isMine}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Single-staff Day view: the day's hours wrapped into two balanced half columns.
export function SplitDay<S extends GridShift>({
  day,
  shifts,
  dayStartMin,
  blocksPerDay,
  nowBlock,
  onSelect,
  isMine,
  selectedId,
}: {
  day: CalendarDay;
  shifts: S[];
  dayStartMin: number;
  blocksPerDay: number;
  nowBlock: number | null;
  onSelect?: (s: S) => void;
  isMine?: (s: S) => boolean;
  selectedId?: string | null;
}) {
  const half = blocksPerDay / 2;
  const halves = [
    { from: 0, to: half },
    { from: half, to: blocksPerDay },
  ];
  if (day.closed) {
    return (
      <div className="splitday" data-testid="calendar-closed-day">
        <ClosedCell />
      </div>
    );
  }
  return (
    <div className="splitday">
      {halves.map((half) => {
        const rows = half.to - half.from;
        const nowHere =
          day.isToday && nowBlock !== null && nowBlock >= half.from && nowBlock < half.to;
        return (
          <div className="split-half" key={half.from}>
            <div className="cal-grid" style={{ gridTemplateColumns: '52px minmax(190px,1fr)' }}>
              <GutterTicks startBlock={half.from} rows={rows} originMin={dayStartMin} />
              <div className={`cal-day ${day.isToday ? 'is-today' : ''}`.trim()}>
                <div className="cal-dayhead" style={{ height: HEAD_H }}>
                  <span className="cal-dow t-mono">
                    {blockLabel(half.from, dayStartMin)}–{blockLabel(half.to, dayStartMin)}
                  </span>
                </div>
                <div className="cal-lanes" style={{ height: rows * BLOCK_H }}>
                  <RowLines startBlock={half.from} rows={rows} originMin={dayStartMin} />
                  <div className="cal-lane">
                    {shifts
                      .filter((s) => s.lane === 0)
                      .map((s) => {
                        const vs = Math.max(s.startBlock, half.from);
                        const ve = Math.min(s.endBlock, half.to);
                        if (vs >= ve) return null;
                        return (
                          <ShiftCardEl
                            key={`${s.id}-${half.from}`}
                            shift={s}
                            onSelect={onSelect}
                            top={(vs - half.from) * BLOCK_H + 1}
                            height={(ve - vs) * BLOCK_H - 2}
                            clipTop={s.startBlock < half.from}
                            clipBot={s.endBlock > half.to}
                            mine={isMine?.(s) ?? false}
                            selected={s.id === selectedId}
                          />
                        );
                      })}
                  </div>
                  {nowHere && (
                    <div
                      className="nowline-inline"
                      style={{ top: (nowBlock - half.from) * BLOCK_H }}
                    >
                      <span className="nowline-dot" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
