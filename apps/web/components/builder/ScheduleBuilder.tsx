'use client';

import {
  buildPhase1Card,
  buildPhase2Roster,
  validateDragSpan,
  type Phase1Card,
  type Phase1Entry,
  type Phase2Advisory,
  type Phase2Entry,
  type PreferenceRecord,
  type SpanBlock,
  type WorkerScheduleInfo,
} from '@shift/core';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  assignDraft,
  publishScheduleAction,
  removeDraft,
  type PublishStats,
} from '../../lib/actions/builder';
import type { BuilderBlock, BuilderData } from '../../lib/data/scheduleBuilder';
import { Avatar, Button, Icon, IconButton, Modal, Notification, Tag } from '../ui';
import './builder.css';

const HOURS_PER_BLOCK = 0.5;
const NY = 'America/New_York';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function nyTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function prettifyHouse(id: string): string {
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function dowLabel(dayKey: string): string {
  return DOW[new Date(`${dayKey}T00:00:00Z`).getUTCDay()] ?? '';
}

type PendingAssign = {
  userId: string;
  name: string;
  blockIds: string[];
  kind: 'over_target' | 'advisory';
  advisories?: Phase2Advisory[];
};

export function ScheduleBuilder({ data }: { data: BuilderData }) {
  const [phase, setPhase] = useState<1 | 2>(1);
  const [drafts, setDrafts] = useState<Record<string, string[]>>(data.drafts);
  const [anchorIdx, setAnchorIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingAssign | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [published, setPublished] = useState(data.published);
  const [publishStats, setPublishStats] = useState<PublishStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Finalize a drag on mouse-up anywhere.
  useEffect(() => {
    if (!dragging) return;
    const onUp = () => {
      setDragging(false);
      if (anchorIdx !== null && hoverIdx !== null) {
        const lo = Math.min(anchorIdx, hoverIdx);
        const hi = Math.max(anchorIdx, hoverIdx);
        setSelectedBlockIds(data.blocks.slice(lo, hi + 1).map((b) => b.blockId));
      }
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [dragging, anchorIdx, hoverIdx, data.blocks]);

  const workerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of data.workers) map.set(w.userId, w.name);
    return map;
  }, [data.workers]);

  // assignedHours this week is derived from current local drafts.
  const scheduleInfos = useMemo<WorkerScheduleInfo[]>(() => {
    const assignedCount = new Map<string, number>();
    for (const userIds of Object.values(drafts)) {
      for (const userId of userIds) {
        assignedCount.set(userId, (assignedCount.get(userId) ?? 0) + 1);
      }
    }
    return data.workers.map((w) => ({
      worker: { userId: w.userId, name: w.name },
      assignedHours: (assignedCount.get(w.userId) ?? 0) * HOURS_PER_BLOCK,
      targetHours: data.targets[w.userId]?.targetHours ?? 0,
      optedOut: data.targets[w.userId]?.optedOut ?? false,
    }));
  }, [data.workers, data.targets, drafts]);

  const selectedBlocks = useMemo<BuilderBlock[]>(() => {
    const set = new Set(selectedBlockIds);
    return data.blocks.filter((b) => set.has(b.blockId));
  }, [selectedBlockIds, data.blocks]);

  const span = useMemo<SpanBlock[]>(
    () => selectedBlocks.map((b) => ({ blockId: b.blockId, blockStartAt: new Date(b.startAtIso) })),
    [selectedBlocks],
  );

  const spanValidation = span.length > 0 ? validateDragSpan(span) : null;
  const spanValid = spanValidation?.valid === true;

  const spanLabel = useMemo(() => {
    if (selectedBlocks.length === 0) return '';
    const first = selectedBlocks[0]!;
    const last = selectedBlocks[selectedBlocks.length - 1]!;
    const end = nyTime(new Date(new Date(last.startAtIso).getTime() + 30 * 60000));
    return `${first.timeLabel}–${end}`;
  }, [selectedBlocks]);

  const phase1Card: Phase1Card | null = useMemo(() => {
    if (!spanValid || phase !== 1) return null;
    const submitted = new Set(data.submittedUserIds);
    const pool = scheduleInfos.filter((i) => submitted.has(i.worker.userId));
    return buildPhase1Card(pool, span, data.preferences as PreferenceRecord[]);
  }, [spanValid, phase, scheduleInfos, span, data.submittedUserIds, data.preferences]);

  const phase2Roster: Phase2Entry[] | null = useMemo(() => {
    if (!spanValid || phase !== 2) return null;
    return buildPhase2Roster(scheduleInfos, span, data.preferences as PreferenceRecord[]);
  }, [spanValid, phase, scheduleInfos, span, data.preferences]);

  const assignedBlockCount = useMemo(
    () => Object.values(drafts).filter((a) => a.length > 0).length,
    [drafts],
  );

  const commitAssign = useCallback(
    async (userId: string, blockIds: string[]) => {
      setDrafts((prev) => {
        const next = { ...prev };
        for (const blockId of blockIds) {
          const existing = next[blockId] ?? [];
          if (!existing.includes(userId)) next[blockId] = [...existing, userId];
        }
        return next;
      });
      setPending(null);
      if (data.periodId !== null) {
        const res = await assignDraft({ periodId: data.periodId, blockIds, userId });
        if (!res.ok) setError(res.error);
      }
    },
    [data.periodId],
  );

  const onRemove = useCallback(
    async (userId: string, blockId: string) => {
      setDrafts((prev) => {
        const next = { ...prev };
        next[blockId] = (next[blockId] ?? []).filter((id) => id !== userId);
        return next;
      });
      if (data.periodId !== null) {
        const res = await removeDraft({ periodId: data.periodId, blockId, userId });
        if (!res.ok) setError(res.error);
      }
    },
    [data.periodId],
  );

  const onPhase1Click = (entry: Phase1Entry) => {
    if (!entry.selectable) return;
    if (entry.wouldExceedTarget) {
      setPending({
        userId: entry.worker.userId,
        name: entry.worker.name,
        blockIds: selectedBlockIds,
        kind: 'over_target',
      });
      return;
    }
    void commitAssign(entry.worker.userId, selectedBlockIds);
  };

  const onPhase2Click = (entry: Phase2Entry) => {
    if (entry.advisories.length > 0) {
      setPending({
        userId: entry.worker.userId,
        name: entry.worker.name,
        blockIds: selectedBlockIds,
        kind: 'advisory',
        advisories: entry.advisories,
      });
      return;
    }
    if (entry.wouldExceedTarget) {
      setPending({
        userId: entry.worker.userId,
        name: entry.worker.name,
        blockIds: selectedBlockIds,
        kind: 'over_target',
      });
      return;
    }
    void commitAssign(entry.worker.userId, selectedBlockIds);
  };

  const onPublish = async () => {
    setPublishOpen(false);
    if (data.periodId === null) return;
    const res = await publishScheduleAction({ periodId: data.periodId });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPublished(true);
    setPublishStats(res.data);
  };

  const clearSelection = () => {
    setSelectedBlockIds([]);
    setAnchorIdx(null);
    setHoverIdx(null);
  };

  // ---- render ------------------------------------------------------------

  return (
    <div data-testid="schedule-builder" className="builder-page">
      {/* desktop-only gate — shown ≤680px via CSS (§4.3) */}
      <div data-testid="builder-desktop-only-notice" className="builder-narrow">
        <Icon name="grid" size={32} />
        <div className="t-h2">Schedule builder is desktop-only</div>
        <div className="t-helper">
          Building a week needs a wide canvas — open this on a larger screen.
        </div>
      </div>

      <div className="builder-main">
        <div className="bld-toolbar">
          <div className="col gap-1">
            <div className="row gap-2">
              <h1 className="t-h1">Schedule builder — {prettifyHouse(data.houseId)}</h1>
              {published ? (
                <span data-testid="schedule-published-badge">
                  <Tag kind="green" icon="check">
                    Published{publishStats !== null && ` · ${publishStats.scheduled} scheduled`}
                  </Tag>
                </span>
              ) : (
                <Tag kind="amber">
                  Draft{data.weekStartDate !== null && ` · week of ${data.weekStartDate}`}
                </Tag>
              )}
            </div>
            <div className="t-helper">
              Build the recurring weekly pattern. Drag a span of consecutive 30-min blocks, then
              assign from preferences (Phase 1) or the full roster (Phase 2).
            </div>
          </div>
          <div className="row gap-2 wrap">
            <div className="seg">
              <button
                type="button"
                data-testid="builder-phase-1"
                className={`seg-btn ${phase === 1 ? 'is-on' : ''}`.trim()}
                onClick={() => setPhase(1)}
              >
                Phase 1 · Preferences
              </button>
              <button
                type="button"
                data-testid="builder-phase-2"
                className={`seg-btn ${phase === 2 ? 'is-on' : ''}`.trim()}
                onClick={() => setPhase(2)}
              >
                Phase 2 · Manual
              </button>
            </div>
            {!published && (
              <Button
                data-testid="publish-button"
                icon="check"
                onClick={() => setPublishOpen(true)}
              >
                Publish
              </Button>
            )}
          </div>
        </div>

        {error !== null && (
          <div data-testid="builder-error" className="side-note">
            <Notification kind="error" title="Something went wrong">
              {error}
            </Notification>
          </div>
        )}

        <div className="bld-body">
          <Grid
            blocks={data.blocks}
            drafts={drafts}
            workerName={workerName}
            anchorIdx={anchorIdx}
            hoverIdx={hoverIdx}
            dragging={dragging}
            selectedBlockIds={selectedBlockIds}
            onCellDown={(idx) => {
              setDragging(true);
              setAnchorIdx(idx);
              setHoverIdx(idx);
              setSelectedBlockIds([]);
            }}
            onCellEnter={(idx) => dragging && setHoverIdx(idx)}
            onRemove={onRemove}
          />

          <aside className="builder-side">
            {selectedBlockIds.length === 0 ? (
              <div className="side-empty">
                <Icon name="drag" size={24} />
                <div className="t-h3">Select blocks to assign</div>
                <div className="t-helper">
                  Drag across {phase === 1 ? '2–12' : 'one or more'} consecutive cells to pick a
                  span.
                </div>
                <div className="side-stat">
                  <span className="t-meta">Assigned so far</span>
                  <b className="t-mono">{assignedBlockCount} blocks</b>
                </div>
              </div>
            ) : (
              <>
                <div className="side-head">
                  <div className="col gap-1">
                    <span className="t-eyebrow">New selection</span>
                    <span className="t-h2 t-mono">{spanLabel}</span>
                    <span className="t-meta">
                      {selectedBlockIds.length * HOURS_PER_BLOCK}h · {selectedBlockIds.length}{' '}
                      blocks
                    </span>
                  </div>
                  <IconButton icon="close" label="Clear selection" onClick={clearSelection} />
                </div>
                {!spanValid ? (
                  <div className="side-note">
                    <Notification kind="warning" title="Adjust your selection">
                      Pick a span of 2–12 consecutive 30-min blocks.
                    </Notification>
                  </div>
                ) : (
                  <>
                    <span className="side-list-label t-label">Assign</span>
                    <div className="side-list">
                      {phase1Card !== null && (
                        <Phase1CardView card={phase1Card} onClick={onPhase1Click} />
                      )}
                      {phase2Roster !== null && (
                        <Phase2RosterView roster={phase2Roster} onClick={onPhase2Click} />
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </aside>
        </div>
      </div>

      {pending?.kind === 'over_target' && (
        <Modal
          testId="over-target-warning"
          eyebrow="Soft cap"
          title="Over target hours"
          width={440}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button kind="secondary" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                kind="primary"
                data-testid="over-target-confirm"
                onClick={() => void commitAssign(pending.userId, pending.blockIds)}
              >
                Assign anyway
              </Button>
            </>
          }
        >
          <Notification kind="warning" title="Exceeds target">
            {pending.name} would be pushed over their weekly target hours. The 20h soft cap is
            overridable.
          </Notification>
        </Modal>
      )}

      {pending?.kind === 'advisory' && (
        <Modal
          testId="advisory-confirm"
          eyebrow="Advisory"
          title="Override availability?"
          width={440}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button kind="secondary" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                kind="danger"
                data-testid="advisory-confirm-accept"
                onClick={() => void commitAssign(pending.userId, pending.blockIds)}
              >
                Assign anyway
              </Button>
            </>
          }
        >
          <Notification kind="warning" title={`Assign ${pending.name} anyway?`}>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {(pending.advisories ?? []).map((a, i) => (
                <li key={i}>{advisoryText(a)}</li>
              ))}
            </ul>
          </Notification>
        </Modal>
      )}

      {publishOpen && (
        <Modal
          testId="publish-confirm-dialog"
          eyebrow="Confirm publish"
          title="Publish schedule?"
          width={480}
          onClose={() => setPublishOpen(false)}
          footer={
            <>
              <Button kind="secondary" onClick={() => setPublishOpen(false)}>
                Keep editing
              </Button>
              <Button kind="primary" icon="check" data-testid="publish-confirm" onClick={onPublish}>
                Publish
              </Button>
            </>
          }
        >
          <p className="t-body">
            Publishing converts your drafts into worker assignments and fills the remaining
            headcount with open shifts. This cannot be undone for the period.
          </p>
        </Modal>
      )}
    </div>
  );
}

// ---- subcomponents -------------------------------------------------------

function advisoryText(a: Phase2Advisory): string {
  if (a.kind === 'opted_out') return 'Opted out — no hours';
  return `Marked cannot for this block (${nyTime(a.blockStartAt)})`;
}

function Grid({
  blocks,
  drafts,
  workerName,
  anchorIdx,
  hoverIdx,
  dragging,
  selectedBlockIds,
  onCellDown,
  onCellEnter,
  onRemove,
}: {
  blocks: BuilderBlock[];
  drafts: Record<string, string[]>;
  workerName: Map<string, string>;
  anchorIdx: number | null;
  hoverIdx: number | null;
  dragging: boolean;
  selectedBlockIds: string[];
  onCellDown: (idx: number) => void;
  onCellEnter: (idx: number) => void;
  onRemove: (userId: string, blockId: string) => void;
}) {
  const lo = anchorIdx !== null && hoverIdx !== null ? Math.min(anchorIdx, hoverIdx) : -1;
  const hi = anchorIdx !== null && hoverIdx !== null ? Math.max(anchorIdx, hoverIdx) : -1;
  const selected = new Set(selectedBlockIds);
  const days = [...new Set(blocks.map((b) => b.dayKey))];

  if (blocks.length === 0) {
    return (
      <div data-testid="schedule-builder-grid" className="bld-grid">
        <div className="bld-grid-empty">
          <div className="empty empty-neutral">
            <div className="empty-icon">
              <Icon name="grid" size={28} />
            </div>
            <div className="t-h2">Nothing to build yet</div>
            <div className="t-helper" style={{ maxWidth: 320, textAlign: 'center' }}>
              This week’s period has no generated blocks.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="schedule-builder-grid" className="bld-grid">
      {days.map((day) => (
        <div className="bld-day" key={day}>
          <div className="bld-dayhead">
            <span className="cal-dow">{dowLabel(day)}</span>
            <span className="cal-date t-mono">{day}</span>
          </div>
          <div className="bld-col">
            {blocks.map((b, idx) => {
              if (b.dayKey !== day) return null;
              const inSpan = (dragging && idx >= lo && idx <= hi) || selected.has(b.blockId);
              const assignees = drafts[b.blockId] ?? [];
              const isHour = b.timeKey.endsWith('00');
              return (
                <div
                  key={b.blockId}
                  data-testid={`block-${b.cellKey}`}
                  onMouseDown={() => onCellDown(idx)}
                  onMouseEnter={() => onCellEnter(idx)}
                  className={`bld-cell ${isHour ? 'is-hour' : ''} ${inSpan ? 'is-span' : ''}`.trim()}
                >
                  <span className="bld-time">{b.timeLabel}</span>
                  <div className="bld-assignees">
                    {assignees.map((userId) => (
                      <span key={userId} className="bld-chip">
                        <span>{workerName.get(userId) ?? userId}</span>
                        <button
                          type="button"
                          className="bld-chip-x"
                          aria-label={`Remove ${workerName.get(userId) ?? userId}`}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => onRemove(userId, b.blockId)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function HoursRemaining({ hours }: { hours: number }) {
  return (
    <span data-testid="worker-hours-remaining" className="t-meta">
      {hours}h left to target
    </span>
  );
}

function Phase1CardView({
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
                    {entry.wouldExceedTarget && <Tag kind="amber">Over target</Tag>}
                  </span>
                  {blocked && entry.blockedReason !== undefined ? (
                    <span className="t-meta" style={{ color: 'var(--st-danger)' }}>
                      {entry.blockedReason.kind === 'cannot'
                        ? `Cannot — ${nyTime(entry.blockedReason.blockStartAt)}`
                        : 'No preference'}
                    </span>
                  ) : (
                    <HoursRemaining hours={entry.hoursRemaining} />
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

function Phase2RosterView({
  roster,
  onClick,
}: {
  roster: Phase2Entry[];
  onClick: (entry: Phase2Entry) => void;
}) {
  return (
    <div data-testid="phase2-roster" className="prefgroup">
      <div className="prefgroup-label">Full roster · {roster.length}</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {roster.map((entry) => {
          const cannot = entry.advisories.some((a) => a.kind === 'cannot');
          const optedOut = entry.advisories.some((a) => a.kind === 'opted_out');
          return (
            <li key={entry.worker.userId} className="roster-li">
              <button type="button" onClick={() => onClick(entry)} className="roster-row">
                <Avatar name={entry.worker.name} size={28} />
                <span className="roster-meta">
                  <span className="row gap-2">
                    <b>{entry.worker.name}</b>
                    {cannot && <Tag kind="red">Cannot</Tag>}
                    {optedOut && <Tag kind="amber">Opted out</Tag>}
                    {entry.wouldExceedTarget && <Tag kind="amber">Over target</Tag>}
                  </span>
                  <span className="t-meta">
                    {entry.advisories.length > 0
                      ? entry.advisories.map(advisoryText).join(' · ')
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
