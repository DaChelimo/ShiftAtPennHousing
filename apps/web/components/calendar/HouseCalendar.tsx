'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';

import './calendar.css';

import type { CalendarDay, CalendarModel, CalShift } from '../../lib/data/calendar';
import { EmptyState, Icon, IconButton, PickupDot, StatusLegend, Tag } from '../ui';

import { ShiftDetailPanel } from './ShiftDetailPanel';
import { WeekPicker } from './WeekPicker';
import {
  addDaysKey,
  BLOCK_H,
  BLOCKS,
  blockLabel,
  CAL_STATE_META,
  emptyCardName,
  fmtRange,
  HALF,
  HEAD_H,
  relWeekLabel,
  spanLabel,
} from './format';

function prettifyHouse(id: string): string {
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// "Now" as a fractional block index in NY (minute resolution → stable within a
// minute). useSyncExternalStore keeps SSR (null, no line) and the client in sync
// without a setState-in-effect or hydration mismatch.
function nyNowBlock(): number | null {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const b = (h * 60 + m - 480) / 30;
  return b >= 0 && b <= BLOCKS ? b : null;
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
  return (
    <button
      type="button"
      className={`scard ${meta.cls} ${clipTop ? 'clip-top' : ''} ${clipBot ? 'clip-bot' : ''}`.trim()}
      style={{ top: t, height: h }}
      onClick={() => onSelect(shift)}
      title={name}
    >
      <span className="scard-time t-mono">{spanLabel(shift.startBlock, shift.endBlock)}</span>
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

function GutterTicks({ startBlock, rows }: { startBlock: number; rows: number }) {
  return (
    <div className="cal-gutter">
      <div className="cal-corner" style={{ height: HEAD_H }} />
      {Array.from({ length: rows }).map((_, i) => {
        const b = startBlock + i;
        return (
          <div className="cal-tick" key={b} style={{ height: BLOCK_H }}>
            {b % 2 === 0 && <span className="t-mono cal-tick-label">{blockLabel(b)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function RowLines({ startBlock, rows }: { startBlock: number; rows: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => {
        const b = startBlock + i;
        return (
          <div
            className={`cal-rowline ${b % 2 === 0 ? 'is-hour' : ''}`.trim()}
            key={b}
            style={{ top: i * BLOCK_H }}
          />
        );
      })}
    </>
  );
}

function DayColumn({
  day,
  shifts,
  lanes,
  nowBlock,
  onSelect,
}: {
  day: CalendarDay;
  shifts: CalShift[];
  lanes: number;
  nowBlock: number | null;
  onSelect: (s: CalShift) => void;
}) {
  return (
    <div className={`cal-day ${day.isToday ? 'is-today' : ''}`.trim()}>
      <div className="cal-dayhead" style={{ height: HEAD_H }}>
        <span className="cal-dow">{day.label}</span>
        <span className="cal-date t-mono">{day.date}</span>
        {day.isToday && <span className="cal-today-pip">Today</span>}
      </div>
      <div className="cal-lanes" style={{ height: BLOCKS * BLOCK_H }}>
        <RowLines startBlock={0} rows={BLOCKS} />
        {Array.from({ length: lanes }).map((_, ln) => (
          <div className={`cal-lane ${ln === lanes - 1 ? 'lane-last' : ''}`.trim()} key={ln}>
            {shifts
              .filter((s) => s.lane === ln)
              .map((s) => (
                <ShiftCardEl key={s.id} shift={s} onSelect={onSelect} />
              ))}
          </div>
        ))}
        {day.isToday && nowBlock !== null && (
          <div className="nowline-inline" style={{ top: nowBlock * BLOCK_H }}>
            <span className="nowline-dot" />
          </div>
        )}
      </div>
    </div>
  );
}

// Single-staff Day view: the day's hours wrapped into two balanced half columns.
function SplitDay({
  day,
  shifts,
  nowBlock,
  onSelect,
}: {
  day: CalendarDay;
  shifts: CalShift[];
  nowBlock: number | null;
  onSelect: (s: CalShift) => void;
}) {
  const halves = [
    { from: 0, to: HALF },
    { from: HALF, to: BLOCKS },
  ];
  return (
    <div className="splitday">
      {halves.map((half) => {
        const rows = half.to - half.from;
        const nowHere =
          day.isToday && nowBlock !== null && nowBlock >= half.from && nowBlock < half.to;
        return (
          <div className="split-half" key={half.from}>
            <div className="cal-grid" style={{ gridTemplateColumns: '52px minmax(190px,1fr)' }}>
              <GutterTicks startBlock={half.from} rows={rows} />
              <div className={`cal-day ${day.isToday ? 'is-today' : ''}`.trim()}>
                <div className="cal-dayhead" style={{ height: HEAD_H }}>
                  <span className="cal-dow t-mono">
                    {blockLabel(half.from)}–{blockLabel(half.to)}
                  </span>
                </div>
                <div className="cal-lanes" style={{ height: rows * BLOCK_H }}>
                  <RowLines startBlock={half.from} rows={rows} />
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
  const nowBlock = useSyncExternalStore(SUBSCRIBE_NOW, nyNowBlock, NOW_SERVER);

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

  const go = (monday: string) => router.push(`/calendar?week=${monday}`);
  const colMin = model.lanes >= 3 ? 248 : model.lanes === 2 ? 196 : 168;
  const dayShifts = (idx: number) => model.shifts.filter((s) => s.dayIndex === idx);
  const dayViewDay = model.days.find((d) => d.isToday) ?? model.days[0]!;

  const gridStyle = (ncols: number): CSSProperties =>
    ({ '--ncols': ncols, '--colmin': `${colMin}px` }) as unknown as CSSProperties;

  return (
    <div className="page page-wide cal-page">
      <div className="cal-toolbar">
        <div className="col gap-1">
          <div className="row gap-2">
            <h1 className="t-h1">{model.houseName}</h1>
            {model.restricted && <Tag kind="outline">Harnwell-trained only</Tag>}
          </div>
          <div className="t-helper">
            {model.lanes} staff per block
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
            nowBlock={nowBlock}
            onSelect={setSelected}
          />
        </div>
      ) : view === 'day' ? (
        <div className="cal-scroll">
          <div className="cal-grid" style={gridStyle(1)}>
            <GutterTicks startBlock={0} rows={BLOCKS} />
            <DayColumn
              day={dayViewDay}
              shifts={dayShifts(dayViewDay.index)}
              lanes={model.lanes}
              nowBlock={nowBlock}
              onSelect={setSelected}
            />
          </div>
        </div>
      ) : (
        <div className={`cal-scroll ${model.isPast ? 'is-history' : ''}`.trim()}>
          <div className="cal-grid" style={gridStyle(model.days.length)}>
            <GutterTicks startBlock={0} rows={BLOCKS} />
            {model.days.map((d) => (
              <DayColumn
                key={d.dateKey}
                day={d}
                shifts={dayShifts(d.index)}
                lanes={model.lanes}
                nowBlock={nowBlock}
                onSelect={setSelected}
              />
            ))}
          </div>
        </div>
      )}

      {selected && (
        <ShiftDetailPanel
          shift={selected}
          houseName={model.houseName}
          dayLabel={`${model.days[selected.dayIndex]!.label} ${model.days[selected.dayIndex]!.date}`}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
