'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';

import './calendar.css';

import type { CalendarDay, CalendarModel, CalShift, LaneSegment } from '../../lib/data/calendar';
import { EmptyState, Icon, IconButton, PickupDot, StatusLegend, Tag } from '../ui';

import { ShiftDetailPanel } from './ShiftDetailPanel';
import { WeekPicker } from './WeekPicker';
import {
  addDaysKey,
  BLOCK_H,
  blockLabel,
  CAL_STATE_META,
  emptyCardName,
  fmtRange,
  HEAD_H,
  relWeekLabel,
  shiftOriginMinutes,
  spanLabel,
} from './format';

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

function ShiftCardEl({
  shift,
  onSelect,
  top,
  height,
  clipTop = false,
  clipBot = false,
}: {
  shift: CalShift;
  onSelect: (s: CalShift) => void;
  top?: number;
  height?: number;
  clipTop?: boolean;
  clipBot?: boolean;
}) {
  const meta = CAL_STATE_META[shift.state];
  const h = height ?? (shift.endBlock - shift.startBlock) * BLOCK_H - 2;
  const t = top ?? shift.startBlock * BLOCK_H + 1;
  const short = h < 52;
  const name = shift.workerName ?? emptyCardName(shift.state);
  // Derived from the shift's own timestamp, not the grid's shared origin — always
  // shows the block's real start/end even for an early-opening summer shift.
  const origin = shiftOriginMinutes(shift);
  return (
    <button
      type="button"
      className={`scard ${meta.cls} ${clipTop ? 'clip-top' : ''} ${clipBot ? 'clip-bot' : ''}`.trim()}
      style={{ top: t, height: h }}
      onClick={() => onSelect(shift)}
      title={name}
    >
      <span className="scard-time t-mono">
        {spanLabel(shift.startBlock, shift.endBlock, origin)}
      </span>
      <span className="scard-name">
        {meta.dot && <PickupDot />}
        {name}
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
    </button>
  );
}

// §3.4/§11.3 closed-house presentation: a column with no shift grid and no
// open-shifts feed — just a "Closed" marker for the closure date.
function ClosedCell() {
  return (
    <div className="cal-closed">
      <div className="cal-closed-inner">
        <Icon name="calendar" size={22} />
        <span>Closed</span>
      </div>
    </div>
  );
}

function GutterTicks({
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
              <span className="t-mono cal-tick-label is-last">
                {blockLabel(b + 1, originMin)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RowLines({
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
function DaySegment({
  seg,
  shifts,
  originMin,
  nowBlock,
  onSelect,
}: {
  seg: LaneSegment;
  shifts: CalShift[];
  originMin: number;
  nowBlock: number | null;
  onSelect: (s: CalShift) => void;
}) {
  const rows = seg.endBlock - seg.startBlock;
  const segShifts = shifts.filter((s) => s.startBlock < seg.endBlock && s.endBlock > seg.startBlock);
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

function DayColumn({
  day,
  shifts,
  blocksPerDay,
  originMin,
  nowBlock,
  onSelect,
}: {
  day: CalendarDay;
  shifts: CalShift[];
  blocksPerDay: number;
  originMin: number;
  nowBlock: number | null;
  onSelect: (s: CalShift) => void;
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Single-staff Day view: the day's hours wrapped into two balanced half columns.
function SplitDay({
  day,
  shifts,
  dayStartMin,
  blocksPerDay,
  nowBlock,
  onSelect,
}: {
  day: CalendarDay;
  shifts: CalShift[];
  dayStartMin: number;
  blocksPerDay: number;
  nowBlock: number | null;
  onSelect: (s: CalShift) => void;
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

export function HouseCalendar({
  model,
  todayKey,
  thisMondayKey,
}: {
  model: CalendarModel;
  todayKey: string;
  thisMondayKey: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<'week' | 'day'>('week');
  const [selected, setSelected] = useState<CalShift | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const weekScrollRef = useRef<HTMLDivElement>(null);
  const nowBlock = useSyncExternalStore(
    SUBSCRIBE_NOW,
    () => nyNowBlock(model.dayStartMin, model.blocksPerDay),
    NOW_SERVER,
  );

  // When a shift is opened in week view, scroll its day column up to just right
  // of the sticky time gutter so it sits in the area beside the inset panel
  // (never hidden behind it).
  useEffect(() => {
    if (selected === null || view !== 'week') return;
    const sc = weekScrollRef.current;
    if (sc === null) return;
    // Wait for the inset-drawer padding transition to settle before measuring —
    // scrolling mid-transition reads a transient layout and lands short. Centering
    // the day column in the (now narrower) scroll area keeps it clear of both the
    // sticky time rail and the panel.
    const id = window.setTimeout(() => {
      const col = sc.querySelector<HTMLElement>(`[data-col-index="${selected.dayIndex}"]`);
      col?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }, 200);
    return () => window.clearTimeout(id);
  }, [selected, view]);

  useEffect(() => {
    if (!pickOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setPickOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setPickOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [pickOpen]);

  const go = (monday: string) =>
    router.push(`/calendar?week=${monday}&house=${model.houseId}`);
  const colMin = model.lanes >= 3 ? 248 : model.lanes === 2 ? 196 : 168;
  const dayShifts = (idx: number) => model.shifts.filter((s) => s.dayIndex === idx);
  const dayViewDay = model.days.find((d) => d.isToday) ?? model.days[0]!;

  const gridStyle = (ncols: number): CSSProperties =>
    ({ '--ncols': ncols, '--colmin': `${colMin}px` }) as unknown as CSSProperties;

  return (
    <div className={`page page-wide cal-page ${selected !== null ? 'is-panel-open' : ''}`.trim()}>
      <div className="cal-toolbar">
        <div className="col gap-1">
          <div className="row gap-2">
            <h1 className="t-h1" data-testid="calendar-house-name">
              {model.houseName}
            </h1>
            {model.restricted && <Tag kind="outline">Harnwell-trained only</Tag>}
          </div>
          <div className="t-helper">
            {model.minLanes === model.lanes ? model.lanes : `${model.minLanes}-${model.lanes}`} staff
            per block
            {view === 'week' ? ' · scroll sideways for later days' : ''}
          </div>
        </div>
        <div className="row gap-2 wrap">
          <div className="weeknav" ref={navRef}>
            <IconButton
              icon="chevLeft"
              label="Previous week"
              onClick={() => go(addDaysKey(model.weekStartDate, -7))}
            />
            <button
              type="button"
              className={`weeknav-label ${pickOpen ? 'is-open' : ''}`.trim()}
              onClick={() => setPickOpen((o) => !o)}
              aria-haspopup="dialog"
              aria-expanded={pickOpen}
            >
              <span>
                {fmtRange(model.weekStartDate)} ·{' '}
                <b>{relWeekLabel(model.weekStartDate, thisMondayKey)}</b>
              </span>
              <Icon name="chevDown" size={13} style={{ marginLeft: 7, opacity: 0.55 }} />
            </button>
            <IconButton
              icon="chevRight"
              label="Next week"
              onClick={() => go(addDaysKey(model.weekStartDate, 7))}
            />
            {pickOpen && (
              <WeekPicker
                weekStartDate={model.weekStartDate}
                todayKey={todayKey}
                onPick={(m) => {
                  setPickOpen(false);
                  go(m);
                }}
                onToday={() => {
                  setPickOpen(false);
                  go(thisMondayKey);
                }}
              />
            )}
          </div>
          <div className="seg">
            <button
              type="button"
              className={`seg-btn ${view === 'week' ? 'is-on' : ''}`.trim()}
              onClick={() => setView('week')}
            >
              Week
            </button>
            <button
              type="button"
              className={`seg-btn ${view === 'day' ? 'is-on' : ''}`.trim()}
              onClick={() => setView('day')}
            >
              Day
            </button>
          </div>
        </div>
      </div>

      <div style={{ margin: '0 24px 10px' }}>
        <StatusLegend />
      </div>

      {model.isPast && model.hasBlocks && (
        <div className="cal-banner">
          <Icon name="clock" size={16} />
          Viewing a past week — history is read-only.
        </div>
      )}

      {!model.hasBlocks ? (
        <div className="cal-empty">
          <div className="card">
            <EmptyState
              icon="calendar"
              tone="neutral"
              title={model.isFuture ? 'Not published yet' : 'No schedule this week'}
              desc={
                model.isFuture
                  ? 'This week has not been published. Build it in the Schedule builder, then publish to make it the source of truth.'
                  : 'No shifts are scheduled for this house this week.'
              }
            />
          </div>
        </div>
      ) : view === 'day' && model.lanes === 1 ? (
        <div className="cal-scroll">
          <SplitDay
            day={dayViewDay}
            shifts={dayShifts(dayViewDay.index)}
            dayStartMin={model.dayStartMin}
            blocksPerDay={model.blocksPerDay}
            nowBlock={nowBlock}
            onSelect={setSelected}
          />
        </div>
      ) : view === 'day' ? (
        <div className="cal-scroll">
          <div className="cal-grid" style={gridStyle(1)}>
            <GutterTicks startBlock={0} rows={model.blocksPerDay} originMin={model.dayStartMin} />
            <DayColumn
              day={dayViewDay}
              shifts={dayShifts(dayViewDay.index)}
              blocksPerDay={model.blocksPerDay}
              originMin={model.dayStartMin}
              nowBlock={nowBlock}
              onSelect={setSelected}
            />
          </div>
        </div>
      ) : (
        <div className={`cal-scroll ${model.isPast ? 'is-history' : ''}`.trim()} ref={weekScrollRef}>
          <div className="cal-grid" style={gridStyle(model.days.length)}>
            <GutterTicks startBlock={0} rows={model.blocksPerDay} originMin={model.dayStartMin} />
            {model.days.map((d) => (
              <DayColumn
                key={d.dateKey}
                day={d}
                shifts={dayShifts(d.index)}
                blocksPerDay={model.blocksPerDay}
                originMin={model.dayStartMin}
                nowBlock={nowBlock}
                onSelect={setSelected}
              />
            ))}
          </div>
        </div>
      )}

      {selected && (
        <ShiftDetailPanel
          key={selected.id}
          shift={selected}
          houseName={model.houseName}
          dayLabel={`${model.days[selected.dayIndex]!.label} ${model.days[selected.dayIndex]!.date}`}
          assignableWorkers={model.assignableWorkers}
          softCapHours={model.softCapHours}
          capEnforcement={model.capEnforcement}
          onClose={() => setSelected(null)}
          onApplied={() => {
            setSelected(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
