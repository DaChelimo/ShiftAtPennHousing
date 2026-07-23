'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import '../calendar/calendar.css';

import type { WorkerCalendarModel, WorkerCalShift, HouseOption } from '../../lib/data/worker/house';
import { DayColumn, GutterTicks, SplitDay, StatusLegend, useNowBlock } from '../calendar/Grid';
import { ShiftInfoPopover } from '../calendar/ShiftInfoPopover';
import { WeekPicker } from '../calendar/WeekPicker';
import { addDaysKey, fmtRange, relWeekLabel } from '../calendar/format';
import { EmptyState, Icon, IconButton, Tag } from '../ui';
import { Field, Select } from '../ui/Field';
import { PageHead } from '../ui/PageHead';

export function HouseCalendarView({
  model,
  todayKey,
  thisMondayKey,
  houses,
  viewerUserId,
  deskPhone,
}: {
  model: WorkerCalendarModel;
  todayKey: string;
  thisMondayKey: string;
  houses: HouseOption[];
  viewerUserId: string;
  deskPhone: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<'week' | 'day'>('week');
  const [selected, setSelected] = useState<WorkerCalShift | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const weekScrollRef = useRef<HTMLDivElement>(null);
  const nowBlock = useNowBlock(model.dayStartMin, model.blocksPerDay);

  useEffect(() => {
    if (selected === null || view !== 'week') return;
    const sc = weekScrollRef.current;
    if (sc === null) return;
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

  const go = (params: { houseId?: string; week?: string }) => {
    const houseId = params.houseId ?? model.houseId;
    const week = params.week ?? model.weekStartDate;
    router.push(`/home/house?house=${encodeURIComponent(houseId)}&week=${week}`);
  };
  const colMin = model.lanes >= 3 ? 248 : model.lanes === 2 ? 196 : 168;
  const dayShifts = (idx: number) => model.shifts.filter((s) => s.dayIndex === idx);
  const dayViewDay = model.days.find((d) => d.isToday) ?? model.days[0]!;
  const isMine = (s: WorkerCalShift) => s.userId === viewerUserId;

  const gridStyle = (ncols: number): CSSProperties =>
    ({ '--ncols': ncols, '--colmin': `${colMin}px` }) as unknown as CSSProperties;

  return (
    <div className={`page page-wide cal-page ${selected !== null ? 'is-panel-open' : ''}`.trim()}>
      <PageHead
        eyebrow="House schedule"
        title={model.houseName}
        sub="See who is on the desk at any house. This view is read only."
        actions={
          deskPhone ? (
            <a
              className="btn btn-secondary btn-md"
              href={`tel:${deskPhone}`}
              data-testid="house-call-desk"
            >
              Call the desk
            </a>
          ) : undefined
        }
      />

      <Field label="House">
        <Select
          value={model.houseId}
          data-testid="house-switcher"
          onChange={(e) => go({ houseId: e.target.value })}
        >
          {houses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="cal-toolbar">
        <div className="col gap-1">
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
              onClick={() => go({ week: addDaysKey(model.weekStartDate, -7) })}
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
              onClick={() => go({ week: addDaysKey(model.weekStartDate, 7) })}
            />
            {pickOpen && (
              <WeekPicker
                weekStartDate={model.weekStartDate}
                todayKey={todayKey}
                onPick={(m) => {
                  setPickOpen(false);
                  go({ week: m });
                }}
                onToday={() => {
                  setPickOpen(false);
                  go({ week: thisMondayKey });
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

      {model.restricted && (
        <div className="cal-banner">
          <Tag kind="outline">Harnwell-trained only</Tag>
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
                  ? 'This week has not been published yet.'
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
            />
          </div>
        </div>
      ) : (
        <div className="cal-scroll" ref={weekScrollRef}>
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
              />
            ))}
          </div>
        </div>
      )}

      {selected && (
        <ShiftInfoPopover
          key={selected.id}
          shift={selected}
          houseName={model.houseName}
          dayLabel={`${model.days[selected.dayIndex]!.label} ${model.days[selected.dayIndex]!.date}`}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
