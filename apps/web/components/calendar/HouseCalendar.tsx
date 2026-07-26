'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import './calendar.css';

import type { CalendarModel, CalShift } from '../../lib/data/calendar';
import { EmptyState, Icon, IconButton, StatusLegend, Tag } from '../ui';

import { DayColumn, GutterTicks, SplitDay, useNowBlock } from './Grid';
import { ShiftDetailPanel } from './ShiftDetailPanel';
import { WeekPicker } from './WeekPicker';
import { addDaysKey, fmtRange, relWeekLabel } from './format';

export function HouseCalendar({
  model,
  todayKey,
  thisMondayKey,
  viewerUserId,
}: {
  model: CalendarModel;
  todayKey: string;
  thisMondayKey: string;
  viewerUserId: string;
}) {
  const isMine = (s: CalShift) => s.userId === viewerUserId;
  const router = useRouter();
  const [view, setView] = useState<'week' | 'day'>('week');
  const [selected, setSelected] = useState<CalShift | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const weekScrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const nowBlock = useNowBlock(model.dayStartMin, model.blocksPerDay);

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

  // A shift stays "in focus" (highlighted card + open detail panel) until the user
  // clicks something outside both the calendar grid and the panel itself. Clicking
  // another shift card re-targets onSelect directly, so it is excluded here only via
  // the panel ref — anything outside the panel, including empty calendar space or
  // page chrome, drops focus.
  useEffect(() => {
    if (selected === null) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setSelected(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [selected]);

  const go = (monday: string) => router.push(`/calendar?week=${monday}&house=${model.houseId}`);
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
            {model.minLanes === model.lanes ? model.lanes : `${model.minLanes}-${model.lanes}`}{' '}
            staff per block
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
            isMine={isMine}
            selectedId={selected?.id ?? null}
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
              isMine={isMine}
              selectedId={selected?.id ?? null}
            />
          </div>
        </div>
      ) : (
        <div
          className={`cal-scroll ${model.isPast ? 'is-history' : ''}`.trim()}
          ref={weekScrollRef}
        >
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
                isMine={isMine}
                selectedId={selected?.id ?? null}
              />
            ))}
          </div>
        </div>
      )}

      {selected && (
        <ShiftDetailPanel
          key={selected.id}
          panelRef={panelRef}
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
