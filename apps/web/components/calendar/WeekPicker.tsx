'use client';

import { useState } from 'react';

import { Icon } from '../ui';

import { addDaysKey } from './format';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function parse(key: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}
function mondayOf(key: string): string {
  const at = parse(key);
  return addDaysKey(key, -((at.getUTCDay() + 6) % 7));
}

// Mon–Sun week picker popover (design screen 03). Whole-row selection; the ends
// are fixed weeks. Reports the chosen week's Monday key.
export function WeekPicker({
  weekStartDate,
  todayKey,
  onPick,
  onToday,
}: {
  weekStartDate: string;
  todayKey: string;
  onPick: (mondayKey: string) => void;
  onToday: () => void;
}) {
  const sel = parse(weekStartDate);
  const [viewMonth, setViewMonth] = useState(
    `${sel.getUTCFullYear()}-${String(sel.getUTCMonth() + 1).padStart(2, '0')}-01`,
  );
  const vm = parse(viewMonth);
  const monthLabel = `${MONTHS[vm.getUTCMonth()]} ${vm.getUTCFullYear()}`;
  const gridStart = mondayOf(viewMonth); // first Monday on/before the 1st

  const weeks = Array.from({ length: 6 }, (_, w) => {
    const monday = addDaysKey(gridStart, w * 7);
    return {
      monday,
      days: Array.from({ length: 7 }, (_, i) => addDaysKey(monday, i)),
    };
  });

  const stepMonth = (n: number) => {
    const next = new Date(Date.UTC(vm.getUTCFullYear(), vm.getUTCMonth() + n, 1));
    setViewMonth(next.toISOString().slice(0, 10));
  };

  return (
    <div className="wkpick" role="dialog" aria-label="Pick a week">
      <div className="wkpick-head">
        <button
          type="button"
          className="wkpick-nav"
          onClick={() => stepMonth(-1)}
          aria-label="Previous month"
        >
          <Icon name="chevLeft" size={15} />
        </button>
        <span className="wkpick-month">{monthLabel}</span>
        <button
          type="button"
          className="wkpick-nav"
          onClick={() => stepMonth(1)}
          aria-label="Next month"
        >
          <Icon name="chevRight" size={15} />
        </button>
      </div>
      <div className="wkpick-dow">
        {DOW.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="wkpick-grid">
        {weeks.map((w) => (
          <button
            key={w.monday}
            type="button"
            className={`wkpick-week ${w.monday === weekStartDate ? 'is-sel' : ''}`.trim()}
            onClick={() => onPick(w.monday)}
            title={`Week of ${w.monday}`}
          >
            {w.days.map((d) => {
              const out = parse(d).getUTCMonth() !== vm.getUTCMonth();
              const isToday = d === todayKey;
              return (
                <span
                  key={d}
                  className={`wkpick-day ${out ? 'is-out' : ''} ${isToday ? 'is-today' : ''}`.trim()}
                >
                  {parse(d).getUTCDate()}
                </span>
              );
            })}
          </button>
        ))}
      </div>
      <div className="wkpick-foot">
        <span className="t-meta">Whole Mon–Sun weeks</span>
        <button type="button" className="wkpick-today" onClick={onToday}>
          This week
        </button>
      </div>
    </div>
  );
}
