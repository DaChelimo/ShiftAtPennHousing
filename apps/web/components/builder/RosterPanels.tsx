'use client';

import type { Phase1Card, Phase1Entry, Phase2Advisory, Phase2Entry } from '@shift/core';

import { Avatar, Icon, Tag, TextInput } from '../ui';

import { nyTime } from './gridModel';

// Extracted from ScheduleBuilder.tsx (quarantined at the 600-line ceiling, AGENTS §5.2):
// the Phase-1/Phase-2 roster side-panel views, pulled out on the 2026-07-29 pass that
// added the RSM desk-assignment display (an RSM is exempt from every hours check, so
// these views show "No hour cap (RSM)" instead of the usual "Xh left to target" copy).

export function advisoryText(a: Phase2Advisory): string {
  if (a.kind === 'opted_out') return 'Opted out, no hours';
  return `Marked cannot for this block (${nyTime(a.blockStartAt)})`;
}

function HoursRemaining({ hours, isRsm }: { hours: number; isRsm?: boolean }) {
  if (isRsm === true) {
    return (
      <span data-testid="worker-hours-remaining" className="t-meta">
        No hour cap (RSM)
      </span>
    );
  }
  return (
    <span data-testid="worker-hours-remaining" className="t-meta">
      {hours}h left to target
    </span>
  );
}

export function Phase1CardView({
  card,
  onClick,
}: {
  card: Phase1Card;
  onClick: (entry: Phase1Entry) => void;
}) {
  const groups: Array<{
    key: 'preferred' | 'available' | 'blocked';
    label: string;
    tone: string;
    entries: Phase1Entry[];
  }> = [
    { key: 'preferred', label: 'Preferred', tone: 'green', entries: card.preferred },
    { key: 'available', label: 'Available', tone: '', entries: card.available },
    { key: 'blocked', label: 'Blocked', tone: 'red', entries: card.blocked },
  ];

  return (
    <div data-testid="phase1-card">
      {groups.map((group) => (
        <div key={group.key} data-testid={`card-group-${group.key}`} className="prefgroup">
          <div className={`prefgroup-label ${group.tone ? `tone-${group.tone}` : ''}`.trim()}>
            <span className="prefgroup-dot" />
            {group.label} · {group.entries.length}
          </div>
          {group.entries.length === 0 && <div className="prefgroup-empty t-meta">None</div>}
          {group.entries.map((entry) => {
            const blocked = entry.status === 'blocked';
            return (
              <button
                key={entry.worker.userId}
                type="button"
                disabled={!entry.selectable}
                onClick={() => onClick(entry)}
                className={`roster-row ${blocked ? 'is-blocked' : ''}`.trim()}
              >
                <Avatar name={entry.worker.name} size={28} />
                <span className="roster-meta">
                  <span className="row gap-2">
                    <b>{entry.worker.name}</b>
                    {entry.isRsm === true && <Tag kind="green">RSM</Tag>}
                    {entry.wouldExceedTarget && <Tag kind="amber">Over target</Tag>}
                  </span>
                  {blocked && entry.blockedReason !== undefined ? (
                    <span className="t-meta" style={{ color: 'var(--st-danger)' }}>
                      {entry.blockedReason.kind === 'cannot'
                        ? `Cannot at ${nyTime(entry.blockedReason.blockStartAt)}`
                        : 'No preference'}
                    </span>
                  ) : (
                    <HoursRemaining hours={entry.hoursRemaining} isRsm={entry.isRsm} />
                  )}
                </span>
                {!blocked && <Icon name="add" size={16} className="roster-add" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function Phase2RosterView({
  roster,
  query,
  onQueryChange,
  onClick,
}: {
  roster: Phase2Entry[];
  query: string;
  onQueryChange: (value: string) => void;
  onClick: (entry: Phase2Entry) => void;
}) {
  const q = query.trim().toLowerCase();
  const filtered =
    q === '' ? roster : roster.filter((e) => e.worker.name.toLowerCase().includes(q));

  return (
    <div data-testid="phase2-roster" className="prefgroup">
      <div className="side-search">
        <TextInput
          icon="search"
          type="search"
          data-testid="builder-roster-search"
          placeholder="Search workers"
          aria-label="Search workers"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>
      <div className="prefgroup-label">
        Full roster · {filtered.length}
        {q !== '' && filtered.length !== roster.length && ` of ${roster.length}`}
      </div>
      {filtered.length === 0 && (
        <div className="prefgroup-empty t-meta" data-testid="builder-roster-empty">
          No workers match “{query.trim()}”
        </div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {filtered.map((entry) => {
          const cannot = entry.advisories.some((a) => a.kind === 'cannot');
          const optedOut = entry.advisories.some((a) => a.kind === 'opted_out');
          return (
            <li key={entry.worker.userId} className="roster-li">
              <button type="button" onClick={() => onClick(entry)} className="roster-row">
                <Avatar name={entry.worker.name} size={28} />
                <span className="roster-meta">
                  <span className="row gap-2">
                    <b>{entry.worker.name}</b>
                    {entry.isRsm === true && <Tag kind="green">RSM</Tag>}
                    {cannot && <Tag kind="red">Cannot</Tag>}
                    {optedOut && <Tag kind="amber">Opted out</Tag>}
                    {entry.wouldExceedTarget && <Tag kind="amber">Over target</Tag>}
                  </span>
                  <span className="t-meta">
                    {entry.advisories.length > 0
                      ? entry.advisories.map(advisoryText).join(' · ')
                      : entry.isRsm === true
                        ? 'No hour cap (RSM)'
                        : `${entry.hoursRemaining}h left to target`}
                  </span>
                </span>
                <Icon name="add" size={16} className="roster-add" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
