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

const HOURS_PER_BLOCK = 0.5;
const NY = 'America/New_York';

function nyTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

type PendingAssign = {
  userId: string;
  name: string;
  blockIds: string[];
  kind: 'over_target' | 'advisory';
  advisories?: Phase2Advisory[];
};

export function ScheduleBuilder({ data }: { data: BuilderData }) {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
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

  // §4.3: desktop-only. Detect after mount (avoids SSR/hydration viewport guesses).
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

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

  const span = useMemo<SpanBlock[]>(() => {
    const byId = new Map(data.blocks.map((b) => [b.blockId, b]));
    return selectedBlockIds
      .map((id) => byId.get(id))
      .filter((b): b is BuilderBlock => b !== undefined)
      .map((b) => ({ blockId: b.blockId, blockStartAt: new Date(b.startAtIso) }));
  }, [selectedBlockIds, data.blocks]);

  const spanValidation = span.length > 0 ? validateDragSpan(span) : null;
  const spanValid = spanValidation?.valid === true;

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

  // ---- render ------------------------------------------------------------

  return (
    <main data-testid="schedule-builder" className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Schedule builder</h1>
          <p className="text-sm text-zinc-500">
            House {data.houseId}
            {data.weekStartDate !== null && ` · week of ${data.weekStartDate}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-black/10 p-0.5 dark:border-white/10">
            <button
              type="button"
              data-testid="builder-phase-1"
              onClick={() => setPhase(1)}
              className={`rounded px-3 py-1 text-sm font-medium ${phase === 1 ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-300'}`}
            >
              Phase 1
            </button>
            <button
              type="button"
              data-testid="builder-phase-2"
              onClick={() => setPhase(2)}
              className={`rounded px-3 py-1 text-sm font-medium ${phase === 2 ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-300'}`}
            >
              Phase 2
            </button>
          </div>
          {published ? (
            <span
              data-testid="schedule-published-badge"
              className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              Published{publishStats !== null && ` · ${publishStats.scheduled} scheduled`}
            </span>
          ) : (
            <button
              type="button"
              data-testid="publish-button"
              onClick={() => setPublishOpen(true)}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
            >
              Publish
            </button>
          )}
        </div>
      </div>

      {error !== null && (
        <p data-testid="builder-error" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {isDesktop === false ? (
        <div
          data-testid="builder-desktop-only-notice"
          className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"
        >
          The schedule builder is desktop-only. Please use a desktop browser (a wider screen) to
          drag-pick shifts.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Grid
            blocks={data.blocks}
            drafts={drafts}
            workerName={workerName}
            anchorIdx={anchorIdx}
            hoverIdx={hoverIdx}
            dragging={dragging}
            onCellDown={(idx) => {
              setDragging(true);
              setAnchorIdx(idx);
              setHoverIdx(idx);
              setSelectedBlockIds([]);
            }}
            onCellEnter={(idx) => dragging && setHoverIdx(idx)}
            onRemove={onRemove}
          />

          <aside className="space-y-4">
            {phase1Card !== null && <Phase1CardView card={phase1Card} onClick={onPhase1Click} />}
            {phase2Roster !== null && (
              <Phase2RosterView roster={phase2Roster} onClick={onPhase2Click} />
            )}
            {selectedBlockIds.length > 0 && spanValid && (
              <ManualOverridePanel
                blocks={data.blocks.filter((b) => selectedBlockIds.includes(b.blockId))}
                drafts={drafts}
                workerName={workerName}
                onRemove={onRemove}
              />
            )}
            {selectedBlockIds.length === 0 && (
              <p className="text-sm text-zinc-500">
                Drag across {phase === 1 ? '2–12' : 'one or more'} consecutive cells to pick a span.
              </p>
            )}
          </aside>
        </div>
      )}

      {pending?.kind === 'over_target' && (
        <Modal testId="over-target-warning">
          <h2 className="text-base font-semibold">Over target hours</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {pending.name} would be pushed over their weekly target hours. Assign anyway?
          </p>
          <ModalActions>
            <button type="button" onClick={() => setPending(null)} className={btnGhost}>
              Cancel
            </button>
            <button
              type="button"
              data-testid="over-target-confirm"
              onClick={() => void commitAssign(pending.userId, pending.blockIds)}
              className={btnPrimary}
            >
              Assign anyway
            </button>
          </ModalActions>
        </Modal>
      )}

      {pending?.kind === 'advisory' && (
        <Modal testId="advisory-confirm">
          <h2 className="text-base font-semibold">Advisory</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
            {(pending.advisories ?? []).map((a, i) => (
              <li key={i}>{advisoryText(a)}</li>
            ))}
          </ul>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Assign {pending.name} anyway?</p>
          <ModalActions>
            <button type="button" onClick={() => setPending(null)} className={btnGhost}>
              Cancel
            </button>
            <button
              type="button"
              data-testid="advisory-confirm-accept"
              onClick={() => void commitAssign(pending.userId, pending.blockIds)}
              className={btnPrimary}
            >
              Assign anyway
            </button>
          </ModalActions>
        </Modal>
      )}

      {publishOpen && (
        <Modal testId="publish-confirm-dialog">
          <h2 className="text-base font-semibold">Publish schedule?</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Publishing converts your drafts into worker assignments and fills the remaining
            headcount with open shifts. This cannot be undone for the period.
          </p>
          <ModalActions>
            <button type="button" onClick={() => setPublishOpen(false)} className={btnGhost}>
              Cancel
            </button>
            <button
              type="button"
              data-testid="publish-confirm"
              onClick={onPublish}
              className={btnPrimary}
            >
              Publish
            </button>
          </ModalActions>
        </Modal>
      )}
    </main>
  );
}

// ---- subcomponents -------------------------------------------------------

const btnPrimary =
  'rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900';
const btnGhost =
  'rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium dark:border-white/15';

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
  onCellDown: (idx: number) => void;
  onCellEnter: (idx: number) => void;
  onRemove: (userId: string, blockId: string) => void;
}) {
  const lo = anchorIdx !== null && hoverIdx !== null ? Math.min(anchorIdx, hoverIdx) : -1;
  const hi = anchorIdx !== null && hoverIdx !== null ? Math.max(anchorIdx, hoverIdx) : -1;

  // Group cells by NY day for column layout.
  const days = [...new Set(blocks.map((b) => b.dayKey))];

  return (
    <div data-testid="schedule-builder-grid" className="select-none">
      <div className="flex gap-4">
        {days.map((day) => (
          <div key={day} className="flex-1">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {day}
            </div>
            <div className="space-y-1">
              {blocks.map((b, idx) => {
                if (b.dayKey !== day) return null;
                const inSpan = dragging && idx >= lo && idx <= hi;
                const assignees = drafts[b.blockId] ?? [];
                return (
                  <div
                    key={b.blockId}
                    data-testid={`block-${b.cellKey}`}
                    onMouseDown={() => onCellDown(idx)}
                    onMouseEnter={() => onCellEnter(idx)}
                    className={`cursor-pointer rounded-md border px-2 py-1.5 text-sm ${
                      inSpan
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                        : 'border-black/10 dark:border-white/10'
                    }`}
                  >
                    <div className="font-medium text-zinc-700 dark:text-zinc-200">
                      {b.timeLabel}
                    </div>
                    {assignees.map((userId) => (
                      <div
                        key={userId}
                        className="mt-1 flex items-center justify-between rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800"
                      >
                        <span>{workerName.get(userId) ?? userId}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${workerName.get(userId) ?? userId}`}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => onRemove(userId, b.blockId)}
                          className="ml-1 text-zinc-400 hover:text-red-600"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HoursRemaining({ hours }: { hours: number }) {
  return (
    <span data-testid="worker-hours-remaining" className="text-xs text-zinc-500">
      {hours}h left
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
    entries: Phase1Entry[];
  }> = [
    { key: 'preferred', label: 'Preferred', entries: card.preferred },
    { key: 'available', label: 'Available', entries: card.available },
    { key: 'blocked', label: 'Blocked', entries: card.blocked },
  ];

  return (
    <div
      data-testid="phase1-card"
      className="rounded-lg border border-black/10 p-3 dark:border-white/10"
    >
      <h2 className="mb-2 text-sm font-semibold">Workers for this span</h2>
      <div className="space-y-3">
        {groups.map((group) => (
          <section key={group.key} data-testid={`card-group-${group.key}`}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {group.label}
            </h3>
            <ul className="space-y-1">
              {group.entries.map((entry) => (
                <li
                  key={entry.worker.userId}
                  className="flex items-center justify-between gap-2 rounded-md border border-black/5 px-2 py-1 dark:border-white/5"
                >
                  <button
                    type="button"
                    disabled={!entry.selectable}
                    onClick={() => onClick(entry)}
                    className="text-sm font-medium disabled:cursor-not-allowed disabled:text-zinc-400"
                  >
                    {entry.worker.name}
                  </button>
                  <span className="flex items-center gap-2">
                    {entry.wouldExceedTarget && (
                      <span className="text-xs text-amber-600">over target</span>
                    )}
                    {entry.status === 'blocked' && entry.blockedReason !== undefined && (
                      <span className="text-xs text-red-600">
                        {entry.blockedReason.kind === 'cannot'
                          ? `Cannot — ${nyTime(entry.blockedReason.blockStartAt)}`
                          : 'No preference'}
                      </span>
                    )}
                    <HoursRemaining hours={entry.hoursRemaining} />
                  </span>
                </li>
              ))}
              {group.entries.length === 0 && <li className="text-xs text-zinc-400">None</li>}
            </ul>
          </section>
        ))}
      </div>
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
    <div
      data-testid="phase2-roster"
      className="rounded-lg border border-black/10 p-3 dark:border-white/10"
    >
      <h2 className="mb-2 text-sm font-semibold">Full roster (manual override)</h2>
      <ul className="space-y-1">
        {roster.map((entry) => (
          <li
            key={entry.worker.userId}
            className="flex items-center justify-between gap-2 rounded-md border border-black/5 px-2 py-1 dark:border-white/5"
          >
            <button type="button" onClick={() => onClick(entry)} className="text-sm font-medium">
              {entry.worker.name}
            </button>
            <span className="flex items-center gap-2">
              {entry.advisories.map((a, i) => (
                <span key={i} className="text-xs text-amber-600">
                  {advisoryText(a)}
                </span>
              ))}
              {entry.wouldExceedTarget && (
                <span className="text-xs text-amber-600">over target</span>
              )}
              <HoursRemaining hours={entry.hoursRemaining} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ManualOverridePanel({
  blocks,
  drafts,
  workerName,
  onRemove,
}: {
  blocks: BuilderBlock[];
  drafts: Record<string, string[]>;
  workerName: Map<string, string>;
  onRemove: (userId: string, blockId: string) => void;
}) {
  return (
    <div
      data-testid="manual-override-panel"
      className="rounded-lg border border-black/10 p-3 dark:border-white/10"
    >
      <h2 className="mb-2 text-sm font-semibold">Manual override — selected blocks</h2>
      <ul className="space-y-2">
        {blocks.map((b) => (
          <li key={b.blockId} className="text-sm">
            <div className="font-medium">{b.timeLabel}</div>
            <ul className="mt-1 space-y-1">
              {(drafts[b.blockId] ?? []).length === 0 ? (
                <li className="text-xs text-zinc-400">Unassigned</li>
              ) : (
                (drafts[b.blockId] ?? []).map((userId) => (
                  <li key={userId} className="flex items-center justify-between text-xs">
                    <span>{workerName.get(userId) ?? userId}</span>
                    <button
                      type="button"
                      onClick={() => onRemove(userId, b.blockId)}
                      className="text-zinc-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </li>
                ))
              )}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Modal({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900"
      >
        {children}
      </div>
    </div>
  );
}

function ModalActions({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 pt-2">{children}</div>;
}
