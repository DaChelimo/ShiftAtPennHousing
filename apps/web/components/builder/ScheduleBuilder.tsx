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
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  assignDraft,
  publishScheduleAction,
  removeDraftSpan,
  type ActionResult,
  type PublishStats,
} from '../../lib/actions/builder';
import type { BuilderBlock, BuilderData } from '../../lib/data/scheduleBuilder';
import { Avatar, Button, Icon, IconButton, Modal, Notification, Tag, TextInput } from '../ui';

import { AiSchedulePanel } from './AiSchedulePanel';
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
  const router = useRouter();
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
  // Phase-2 worker search (§6.2 / design): a client-side filter over the
  // already-loaded full roster — no new query. Empty = show everyone.
  const [rosterQuery, setRosterQuery] = useState('');

  // ---- save status (A2) --------------------------------------------------
  // Every assign/remove is persisted immediately (no batch "Save" step); these
  // surface that so the HM trusts that refreshing won't lose work, and a guard
  // blocks an unload while a write is genuinely mid-flight.
  const inFlight = useRef(0);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // ---- freshness (B2) ----------------------------------------------------
  // Preferences are server-fetched once at render; new worker submissions only
  // appear on a refresh. `router.refresh()` re-runs the server component so the
  // `data` prop re-flows (preferences read straight from props recompute; local
  // drafts/published re-sync via the effect below). This now runs ONLY on tab
  // focus/visibility (the manual "Refresh preferences" button was removed) — and
  // never while a write is in flight, so a stale read can't clobber an optimistic edit.
  const lastRefreshAt = useRef(0);

  const refreshData = useCallback(() => {
    if (inFlight.current > 0) return;
    lastRefreshAt.current = Date.now();
    router.refresh();
  }, [router]);

  // Re-sync server-owned state after a refresh/navigation re-flows `data`. We
  // adjust state during render (React's "data changed since last render"
  // pattern) keyed on the `data` reference, which only changes on a server
  // re-render — never on a local interaction — so it can't stomp optimistic
  // drafts mid-edit.
  const [prevData, setPrevData] = useState(data);
  if (prevData !== data) {
    setPrevData(data);
    setDrafts(data.drafts);
    setPublished(data.published);
    setPublishStats(null);
  }

  // B2: refetch when the tab regains focus (e.g. HM switched to phone to tell a
  // worker to submit, then came back). Throttled to avoid focus+visibility
  // double-fire and rapid toggling.
  useEffect(() => {
    const maybeRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefreshAt.current < 3000) return;
      refreshData();
    };
    window.addEventListener('focus', maybeRefresh);
    document.addEventListener('visibilitychange', maybeRefresh);
    return () => {
      window.removeEventListener('focus', maybeRefresh);
      document.removeEventListener('visibilitychange', maybeRefresh);
    };
  }, [refreshData]);

  // A2 guard: warn before leaving only while a write is actually in flight
  // (sub-second). Persisted edits are safe, so there's nothing else to protect.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (inFlight.current > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Wrap a persisted write so the Saved/Saving indicator and unload guard track
  // it. Returns the action result for callers that branch on success.
  const runWrite = useCallback(async <T,>(fn: () => Promise<ActionResult<T>>) => {
    inFlight.current += 1;
    setSaving(true);
    try {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else setSavedAt(Date.now());
      return res;
    } finally {
      inFlight.current -= 1;
      if (inFlight.current === 0) setSaving(false);
    }
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

  // Escape deselects: drop the current/dragged blocks so they return to their normal
  // grey (and abort an in-progress drag). Modals own Escape while they're open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pending !== null || publishOpen) return;
      setDragging(false);
      setAnchorIdx(null);
      setHoverIdx(null);
      setSelectedBlockIds([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, publishOpen]);

  const workerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of data.workers) map.set(w.userId, w.name);
    return map;
  }, [data.workers]);

  // Per-block staffing limit (1 regular / 2 Harnwell / 3 Quad) — the builder enforces
  // it at assign time so an over-staffed pattern can't be drafted (the DB trigger is the
  // authoritative backstop).
  const capacityByBlock = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of data.blocks) map.set(b.blockId, b.requiredHeadcount);
    return map;
  }, [data.blocks]);

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
      // Staffing-limit guard: never push a block past its required_headcount. Mirrors
      // the DB trigger so the SM gets immediate feedback instead of a failed write.
      const overCapacity = blockIds.some((blockId) => {
        const req = capacityByBlock.get(blockId) ?? 1;
        const current = drafts[blockId] ?? [];
        const adding = current.includes(userId) ? 0 : 1;
        return current.length + adding > req;
      });
      if (overCapacity) {
        setPending(null);
        setError(
          'Those blocks are already fully staffed for this house. Remove the current worker before assigning another.',
        );
        return;
      }

      // Only the blocks that actually gain this worker (others are idempotent) — so a
      // failed write reverts exactly what it added.
      const added = blockIds.filter((blockId) => !(drafts[blockId] ?? []).includes(userId));
      setDrafts((prev) => {
        const next = { ...prev };
        for (const blockId of added) next[blockId] = [...(next[blockId] ?? []), userId];
        return next;
      });
      setPending(null);
      if (data.periodId !== null) {
        const periodId = data.periodId;
        const res = await runWrite(() => assignDraft({ periodId, blockIds, userId }));
        if (!res.ok) {
          setDrafts((prev) => {
            const next = { ...prev };
            for (const blockId of added) {
              next[blockId] = (next[blockId] ?? []).filter((id) => id !== userId);
            }
            return next;
          });
        }
      }
    },
    [capacityByBlock, drafts, data.periodId, runWrite],
  );

  // Remove a worker from a whole contiguous run at once (the "×" on a continuous block).
  const onRemoveSpan = useCallback(
    async (userId: string, blockIds: string[]) => {
      setDrafts((prev) => {
        const next = { ...prev };
        for (const blockId of blockIds) {
          next[blockId] = (next[blockId] ?? []).filter((id) => id !== userId);
        }
        return next;
      });
      if (data.periodId !== null) {
        const periodId = data.periodId;
        await runWrite(() => removeDraftSpan({ periodId, blockIds, userId }));
      }
    },
    [data.periodId, runWrite],
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
    const periodId = data.periodId;
    const res = await runWrite(() => publishScheduleAction({ periodId }));
    if (!res.ok) return;
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
                <Tag kind="amber">Draft · recurring weekly pattern</Tag>
              )}
              <SaveStatus saving={saving} savedAt={savedAt} />
            </div>
            <div className="t-helper">
              Build the recurring weekly pattern{' '}
              {data.weekStartDate !== null && <>(template week of {data.weekStartDate})</>}. Drag a
              span of consecutive 30-min blocks, then assign from preferences (Phase 1) or the full
              roster (Phase 2). Publishing applies this pattern to every week of the term — edit
              individual weeks later in the live calendar.
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

        <AiSchedulePanel
          houseId={data.houseId}
          periodId={data.periodId}
          published={published}
          deadlineOpen={data.deadlineOpen}
        />

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
            onRemoveSpan={onRemoveSpan}
          />

          <aside className="builder-side">
            {selectedBlockIds.length === 0 ? (
              <div className="side-empty">
                <Icon name="drag" size={24} />
                <div className="t-h3">Select blocks to assign</div>
                <div className="t-helper">
                  Drag across one or more consecutive cells to pick a span. Press Esc to clear it.
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
                      Pick one or more consecutive 30-min blocks.
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
                        <Phase2RosterView
                          roster={phase2Roster}
                          query={rosterQuery}
                          onQueryChange={setRosterQuery}
                          onClick={onPhase2Click}
                        />
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

// A2: surfaces that every assignment is saved the instant it's made (the
// builder has no batch "Save" — drafts persist per-action), so the HM can
// refresh for new preferences without fear of losing work.
function SaveStatus({ saving, savedAt }: { saving: boolean; savedAt: number | null }) {
  if (saving) {
    return (
      <span data-testid="builder-save-status" className="bld-savestate is-saving">
        <Icon name="refresh" size={14} className="bld-spin" />
        Saving…
      </span>
    );
  }
  if (savedAt !== null) {
    return (
      <span data-testid="builder-save-status" className="bld-savestate is-saved">
        <Icon name="check" size={14} />
        All changes saved
      </span>
    );
  }
  return null;
}

function advisoryText(a: Phase2Advisory): string {
  if (a.kind === 'opted_out') return 'Opted out — no hours';
  return `Marked cannot for this block (${nyTime(a.blockStartAt)})`;
}

// Fixed pixel height of one 30-min block row. The continuous assignment blocks and the
// selection band are absolutely positioned at `localIndex * CELL_H`, so this MUST match
// the `.bld-cell` height in builder.css.
const CELL_H = 34;

type BlockRun = { userId: string; startLocal: number; len: number; blockIds: string[] };
type LanedRun = BlockRun & { lane: number };

// Coalesce a day's drafts into per-worker contiguous runs (the mobile `Coalesce` pattern):
// a worker drafted across consecutive 30-min blocks becomes ONE run with a single label,
// instead of one card per block.
function computeRuns(dayBlocks: BuilderBlock[], drafts: Record<string, string[]>): BlockRun[] {
  const has = (idx: number, userId: string) =>
    (drafts[dayBlocks[idx]!.blockId] ?? []).includes(userId);
  const workers = new Set<string>();
  for (const b of dayBlocks) for (const u of drafts[b.blockId] ?? []) workers.add(u);

  const runs: BlockRun[] = [];
  for (const userId of workers) {
    let i = 0;
    while (i < dayBlocks.length) {
      if (!has(i, userId)) {
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < dayBlocks.length && has(j + 1, userId)) j += 1;
      runs.push({
        userId,
        startLocal: i,
        len: j - i + 1,
        blockIds: dayBlocks.slice(i, j + 1).map((b) => b.blockId),
      });
      i = j + 1;
    }
  }
  return runs;
}

// Greedy lane assignment so overlapping runs (multi-headcount houses: Harnwell 2, Quad 3)
// sit side by side instead of stacking on top of each other.
function assignLanes(runs: BlockRun[]): { laned: LanedRun[]; laneCount: number } {
  const sorted = [...runs].sort(
    (a, b) => a.startLocal - b.startLocal || a.userId.localeCompare(b.userId),
  );
  const laneEnd: number[] = []; // exclusive end (local idx) of the last run placed in each lane
  const laned: LanedRun[] = sorted.map((r) => {
    let lane = laneEnd.findIndex((end) => end <= r.startLocal);
    if (lane === -1) {
      lane = laneEnd.length;
      laneEnd.push(0);
    }
    laneEnd[lane] = r.startLocal + r.len;
    return { ...r, lane };
  });
  return { laned, laneCount: Math.max(1, laneEnd.length) };
}

// "08:00–12:00" for a run — the END is the last block's start + 30 min, so the span reads
// as one continuous block and the 11:30-vs-12:00 "is that the end?" ambiguity disappears.
function runRangeLabel(dayBlocks: BuilderBlock[], run: BlockRun): string {
  const first = dayBlocks[run.startLocal]!;
  const last = dayBlocks[run.startLocal + run.len - 1]!;
  const end = nyTime(new Date(new Date(last.startAtIso).getTime() + 30 * 60000));
  return `${first.timeLabel}–${end}`;
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
  onRemoveSpan,
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
  onRemoveSpan: (userId: string, blockIds: string[]) => void;
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
      {days.map((day) => {
        // This day's blocks, paired with their index in the flat `blocks` array (the drag
        // model keys on the flat index). The local index drives vertical positioning.
        const dayCells: Array<{ b: BuilderBlock; flatIdx: number }> = [];
        blocks.forEach((b, flatIdx) => {
          if (b.dayKey === day) dayCells.push({ b, flatIdx });
        });
        const dayBlocks = dayCells.map((c) => c.b);
        const { laned, laneCount } = assignLanes(computeRuns(dayBlocks, drafts));

        // The active drag / finalized selection, as one contiguous local range in this day.
        let selStart = -1;
        let selEnd = -1;
        dayCells.forEach(({ b, flatIdx }, localIdx) => {
          const on = (dragging && flatIdx >= lo && flatIdx <= hi) || selected.has(b.blockId);
          if (on) {
            if (selStart === -1) selStart = localIdx;
            selEnd = localIdx;
          }
        });

        return (
          <div className="bld-day" key={day}>
            <div className="bld-dayhead">
              <span className="cal-dow">{dowLabel(day)}</span>
              <span className="cal-date t-mono">{day}</span>
            </div>
            <div className="bld-col">
              {/* Drag layer: one target per 30-min block (preserves the e2e drag contract).
                  The assignee name stays in the cell (visually hidden) so each block's
                  testid still reports who's on it; the visible block is the overlay. */}
              {dayCells.map(({ b, flatIdx }) => {
                const isHour = b.timeKey.endsWith('00');
                const assignees = drafts[b.blockId] ?? [];
                // Each empty cell reads as its full 30-min range ("08:00–08:30"), not
                // just the start — so the end boundary is unambiguous (08:30 means this
                // block ENDS at 08:30, not that an 08:30 block begins). Assigned cells
                // are covered by the .bld-run overlay, which carries the run's range.
                const endLabel = nyTime(new Date(new Date(b.startAtIso).getTime() + 30 * 60000));
                return (
                  <div
                    key={b.blockId}
                    data-testid={`block-${b.cellKey}`}
                    onMouseDown={() => onCellDown(flatIdx)}
                    onMouseEnter={() => onCellEnter(flatIdx)}
                    className={`bld-cell ${isHour ? 'is-hour' : ''}`.trim()}
                    style={{ height: CELL_H }}
                  >
                    <span className="bld-time">
                      {b.timeLabel}–{endLabel}
                    </span>
                    {assignees.length > 0 && (
                      <span className="bld-cell-assignee" aria-hidden="true">
                        {assignees.map((u) => workerName.get(u) ?? u).join(', ')}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Selection band — one continuous highlight, not per-cell. */}
              {selStart !== -1 && (
                <div
                  className="bld-selection"
                  style={{ top: selStart * CELL_H, height: (selEnd - selStart + 1) * CELL_H }}
                  aria-hidden="true"
                />
              )}

              {/* Assignment layer — each contiguous run is ONE continuous block. */}
              {laned.map((run) => {
                const name = workerName.get(run.userId) ?? run.userId;
                return (
                  <div
                    key={`${run.userId}-${run.startLocal}`}
                    className="bld-run"
                    style={{
                      top: run.startLocal * CELL_H,
                      height: run.len * CELL_H,
                      left: `${(run.lane / laneCount) * 100}%`,
                      width: `${100 / laneCount}%`,
                    }}
                  >
                    <span className="bld-run-name">{name}</span>
                    <span className="bld-run-time t-mono">{runRangeLabel(dayBlocks, run)}</span>
                    <button
                      type="button"
                      className="bld-run-x"
                      aria-label={`Remove ${name}`}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => onRemoveSpan(run.userId, run.blockIds)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
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
