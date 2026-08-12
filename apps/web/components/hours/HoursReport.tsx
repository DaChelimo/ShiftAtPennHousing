'use client';

import { useEffect, useMemo, useState } from 'react';

import type { HoursReport as HoursReportData, HoursRow, ShiftEntry } from '../../lib/data/hours';
import { Avatar, PageHead, Select, TextInput } from '../ui';

const FLOAT_COLOR = 'var(--st-out-fg)';
const PICKUP_COLOR = 'var(--st-pickup)';
const SEARCH_DEBOUNCE_MS = 250;

type SortOption = 'nameAsc' | 'nameDesc' | 'hoursDesc' | 'hoursAsc';

const SORT_LABELS: Record<SortOption, string> = {
  nameAsc: 'Name (A-Z)',
  nameDesc: 'Name (Z-A)',
  hoursDesc: 'Total hours (high to low)',
  hoursAsc: 'Total hours (low to high)',
};

// "Britney Njiri" -> first "Britney", last "Njiri". A name with no space (or
// extra middle names) still gets a usable first/last split for sort + search.
function splitName(name: string): { first: string; last: string } {
  const trimmed = name.trim();
  const spaceAt = trimmed.indexOf(' ');
  if (spaceAt === -1) return { first: trimmed, last: '' };
  return { first: trimmed.slice(0, spaceAt), last: trimmed.slice(spaceAt + 1) };
}

function sortRows(rows: HoursRow[], sort: SortOption): HoursRow[] {
  const byFirstName = (a: HoursRow, b: HoursRow) =>
    splitName(a.name).first.localeCompare(splitName(b.name).first) || a.name.localeCompare(b.name);
  const sorted = [...rows];
  switch (sort) {
    case 'nameAsc':
      return sorted.sort(byFirstName);
    case 'nameDesc':
      return sorted.sort((a, b) => byFirstName(b, a));
    case 'hoursDesc':
      return sorted.sort((a, b) => b.totalHours - a.totalHours || byFirstName(a, b));
    case 'hoursAsc':
      return sorted.sort((a, b) => a.totalHours - b.totalHours || byFirstName(a, b));
  }
}

function matchesQuery(row: HoursRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const { first, last } = splitName(row.name);
  return (
    first.toLowerCase().includes(q) ||
    last.toLowerCase().includes(q) ||
    row.email.toLowerCase().includes(q)
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="row gap-1 center">
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: color,
          display: 'inline-block',
        }}
      />
      <span className="t-meta">{label}</span>
    </span>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="hcard-stat">
      <span className="hcard-stat-num t-mono">{value > 0 ? `${value}h` : '-'}</span>
      <span className="hcard-stat-label">{label}</span>
    </span>
  );
}

function ShiftTile({ entry, kind }: { entry: ShiftEntry; kind: 'float' | 'pickup' }) {
  return (
    <div className={`shift-tile shift-tile-${kind}`}>
      <span className="shift-tile-day">
        {entry.dayLabel} · {entry.dateLabel}
      </span>
      <span className="shift-tile-house">{entry.houseName}</span>
      <div className="shift-tile-meta">
        <span className="shift-tile-time t-mono">
          {entry.startLabel}&ndash;{entry.endLabel}
        </span>
        <span className="shift-tile-dur t-mono">{entry.hours}h</span>
      </div>
    </div>
  );
}

// Each category gets the full card width and its shifts wrap into a grid, so a
// busy worker (multiple houses in a week) never crowds a fixed-width column —
// the card just grows taller. A category with zero hours renders nothing, so a
// worker who only floats (the common case) doesn't carry an empty pickup section.
function ShiftSection({
  hours,
  count,
  label,
  color,
  kind,
  entries,
}: {
  hours: number;
  count: number;
  label: string;
  color: string;
  kind: 'float' | 'pickup';
  entries: ShiftEntry[];
}) {
  if (count === 0) return null;
  return (
    <div className="hcard-section">
      <div className="hcard-section-head">
        <span className="row gap-2 center">
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: color,
              display: 'inline-block',
            }}
          />
          <span className="hcard-section-label">{label}</span>
          <span className="hcard-section-count">{count}</span>
        </span>
        <span className="t-mono hcard-section-hours" style={{ color }}>
          {hours}h
        </span>
      </div>
      <div className="hcard-tiles">
        {entries.map((entry, i) => (
          <ShiftTile entry={entry} kind={kind} key={i} />
        ))}
      </div>
    </div>
  );
}

function WorkerCard({ row, houseName }: { row: HoursRow; houseName: string }) {
  return (
    <div className="hcard">
      <div className="hcard-top">
        <span className="hcard-worker">
          <Avatar name={row.name} size={32} />
          <b>{row.name}</b>
        </span>
        <div className="hcard-stats">
          <Stat value={row.totalHours} label="Total" />
          <Stat value={row.homeHours} label={`At ${houseName}`} />
        </div>
      </div>
      <ShiftSection
        hours={row.floatedOutHours}
        count={row.floatShifts.length}
        label="Floated out"
        color={FLOAT_COLOR}
        kind="float"
        entries={row.floatShifts}
      />
      <ShiftSection
        hours={row.pickupHours}
        count={row.pickupShifts.length}
        label="Cross-house pickup"
        color={PICKUP_COLOR}
        kind="pickup"
        entries={row.pickupShifts}
      />
    </div>
  );
}

export function HoursReport({ data }: { data: HoursReportData }) {
  const sum = (pick: (r: HoursRow) => number) => data.rows.reduce((acc, r) => acc + pick(r), 0);
  const totalHome = sum((r) => r.homeHours);
  const totalFloat = sum((r) => r.floatedOutHours);
  const totalPickup = sum((r) => r.pickupHours);
  const grand = totalHome + totalFloat + totalPickup;

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sort, setSort] = useState<SortOption>('nameAsc');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const visibleRows = useMemo(() => {
    const filtered = data.rows.filter((r) => matchesQuery(r, debouncedQuery));
    return sortRows(filtered, sort);
  }, [data.rows, debouncedQuery, sort]);

  return (
    <div className="page page-wide">
      <PageHead
        eyebrow={`${data.houseName} · week of ${data.weekStartDate}`}
        title="Hours report"
        sub="Each worker's weekly hours, decomposed by where the shift was worked."
      />

      <div className="row gap-4 wrap" style={{ margin: '4px 0 16px' }}>
        <LegendItem color="var(--brand)" label="At home" />
        <LegendItem color={FLOAT_COLOR} label="Floated out" />
        <LegendItem color={PICKUP_COLOR} label="Cross-house pickup" />
      </div>

      <div
        className="statstrip"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}
      >
        <div className="statcard">
          <span className="statcard-num">{grand}</span>
          <span className="statcard-label">Total hours</span>
        </div>
        <div className="statcard">
          <span className="statcard-num" style={{ color: 'var(--brand)' }}>
            {totalHome}
          </span>
          <span className="statcard-label">At home</span>
        </div>
        <div className="statcard">
          <span className="statcard-num" style={{ color: FLOAT_COLOR }}>
            {totalFloat}
          </span>
          <span className="statcard-label">Floated out</span>
        </div>
        <div className="statcard">
          <span className="statcard-num" style={{ color: PICKUP_COLOR }}>
            {totalPickup}
          </span>
          <span className="statcard-label">Cross-house pickup</span>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <p className="t-helper">No workers are home-housed here yet.</p>
      ) : (
        <>
          <div className="row gap-3 wrap" style={{ marginBottom: 16 }}>
            <div style={{ minWidth: 240, flex: '1 1 240px' }}>
              <TextInput
                icon="search"
                placeholder="Search by name or email"
                aria-label="Search workers"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div style={{ minWidth: 200 }}>
              <Select
                aria-label="Sort workers"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
              >
                {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
                  <option key={opt} value={opt}>
                    {SORT_LABELS[opt]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {visibleRows.length === 0 ? (
            <p className="t-helper">No workers match &ldquo;{query}&rdquo;.</p>
          ) : (
            <div className="hcards">
              {visibleRows.map((row) => (
                <WorkerCard row={row} houseName={data.houseName} key={row.userId} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
