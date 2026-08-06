'use client';

import { useState } from 'react';

import type { AssignableWorker } from '../../lib/data/calendar';
import { Avatar, Icon } from '../ui';

import { fmtH } from './format';

// The "who covers this" picker inside the shift detail sheet's edit section.
// Extracted from ShiftOverrideEditor.tsx on 2026-08-05, when it grew a pinned split
// chip and a search field and pushed that file past the 600-line ceiling.
//
// Three parts, top to bottom:
//   1. A split chip pinning the two STANDING cover options, the house's RSM and the
//      Allied contractor. Both are always-relevant answers that were previously
//      buried in an alphabetical list of every student at the house.
//   2. A name filter, so a manager who already knows who they want ("Mary") types
//      instead of scrolling. The pinned chip is deliberately NOT filtered.
//   3. The roster, minus whoever is pinned, so each identity appears exactly once.

type CapTone = 'muted' | 'warn' | 'danger';

// Per-candidate cap context: their current weekly load and headroom against the
// week's soft cap, flagged when adding the selected range would push them over
// (danger when the week's cap is a hard break cap).
export function capHint(
  weeklyHours: number,
  addHours: number,
  cap: number,
  enforcement: 'soft' | 'hard',
): { text: string; tone: CapTone } {
  if (weeklyHours + addHours > cap) {
    return {
      text: `${fmtH(weeklyHours)}h this week · +${fmtH(addHours)}h over ${cap}h cap`,
      tone: enforcement === 'hard' ? 'danger' : 'warn',
    };
  }
  const headroom = cap - weeklyHours;
  return {
    text: `${fmtH(weeklyHours)}h this week · ${fmtH(headroom)}h to cap`,
    tone: headroom <= 2 ? 'warn' : 'muted',
  };
}

export function WorkerPicker({
  workers,
  selectedId,
  rangeHours,
  softCapHours,
  capEnforcement,
  onSelect,
}: {
  /** Already filtered to eligible candidates (the incumbent removed). */
  workers: AssignableWorker[];
  selectedId: string | null;
  rangeHours: number;
  softCapHours: number;
  capEnforcement: 'soft' | 'hard';
  onSelect: (userId: string) => void;
}) {
  const pinnedRsm = workers.find((w) => w.isRsm) ?? null;
  const pinnedAllied = workers.find((w) => w.isAllied) ?? null;
  const roster = workers.filter((w) => !w.isRsm && !w.isAllied);

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = q === '' ? roster : roster.filter((w) => w.name.toLowerCase().includes(q));

  return (
    <>
      {(pinnedRsm !== null || pinnedAllied !== null) && (
        <div className="wpin" role="group" aria-label="Standing cover options">
          {pinnedRsm && (
            <PinnedHalf
              testId="override-pinned-rsm"
              name={pinnedRsm.name}
              role="RSM"
              sub="Manages this house · no hours cap"
              selected={selectedId === pinnedRsm.userId}
              onSelect={() => onSelect(pinnedRsm.userId)}
            />
          )}
          {pinnedAllied && (
            <PinnedHalf
              testId="override-pinned-allied"
              name={pinnedAllied.name}
              role="Allied"
              sub="External cover · any house"
              selected={selectedId === pinnedAllied.userId}
              onSelect={() => onSelect(pinnedAllied.userId)}
            />
          )}
        </div>
      )}

      {roster.length > 0 && (
        <div className="wsearch">
          <Icon name="search" size={14} className="muted" />
          <input
            type="search"
            className="wsearch-input"
            data-testid="override-worker-search"
            placeholder="Search by name"
            aria-label="Search workers by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {q !== '' && (
            <button
              type="button"
              className="wsearch-clear"
              aria-label="Clear search"
              data-testid="override-worker-search-clear"
              onClick={() => setQuery('')}
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

      {matches.length === 0 ? (
        <div className="edit-empty t-helper" data-testid="override-worker-empty">
          {roster.length === 0
            ? 'No other workers are available for this house.'
            : `No worker matches "${query.trim()}".`}
        </div>
      ) : (
        <div className="wpick-list" data-testid="override-worker-list" role="listbox">
          {matches.map((w) => {
            const hint = capHint(w.weeklyHours, rangeHours, softCapHours, capEnforcement);
            const sel = selectedId === w.userId;
            return (
              <button
                type="button"
                key={w.userId}
                role="option"
                aria-selected={sel}
                data-testid="override-worker-card"
                data-worker-id={w.userId}
                className={`wpick ${sel ? 'is-sel' : ''}`.trim()}
                onClick={() => onSelect(w.userId)}
              >
                <Avatar name={w.name} size={30} />
                <span className="wpick-main">
                  <b className="wpick-name">{w.name}</b>
                  <span className={`wpick-hint tone-${hint.tone}`}>
                    {hint.tone !== 'muted' && <Icon name="warn" size={12} />}
                    {hint.text}
                  </span>
                </span>
                {sel && <Icon name="checkCircle" size={18} className="wpick-check" />}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// One half of the pinned split chip. Deliberately shows NO cap hint: both the RSM
// (20260729000002) and Allied (20260805000002) are exempt from every hours check in
// admin_assign_worker, so an "Xh to cap" line would state a limit that does not
// apply to them. The sub-line carries their standing instead.
function PinnedHalf({
  testId,
  name,
  role,
  sub,
  selected,
  onSelect,
}: {
  testId: string;
  name: string;
  role: string;
  sub: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-testid={testId}
      className={`wpin-half ${selected ? 'is-sel' : ''}`.trim()}
      onClick={onSelect}
    >
      <span className="wpin-role">{role}</span>
      <span className="wpin-main">
        <b className="wpin-name">{name}</b>
        <span className="wpin-sub">{sub}</span>
      </span>
      {selected && <Icon name="checkCircle" size={16} className="wpick-check" />}
    </button>
  );
}
