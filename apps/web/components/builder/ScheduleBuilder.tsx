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
  clearDraftBlocks,
  publishScheduleAction,
  removeDraftSpan,
  type ActionResult,
  type PublishStats,
} from '../../lib/actions/builder';
import type { BuilderBlock, BuilderData } from '../../lib/data/scheduleBuilder';
import { buildScheduleExportHtml } from '../../lib/export/scheduleHtml';
import { Button, Icon, IconButton, Modal, Notification } from '../ui';

import { AiSchedulePanel } from './AiSchedulePanel';
import { BuilderSideDock, useSideDock } from './BuilderSideDock';
import { BuilderToolbar } from './BuilderToolbar';
import { Grid } from './Grid';
import { OverrideConfirmModal } from './OverrideConfirmModal';
import { Phase1CardView, Phase2RosterView } from './RosterPanels';
import { SideEmptyPanel } from './SideEmptyPanel';
import { WorkerFocusPanel } from './WorkerFocusPanel';
import {
  blocksOfDay,
  findShiftAt,
  HOURS_PER_BLOCK,
  nyTime,
  workerWeekShifts,
  type ShiftRun,
} from './gridModel';
import { useResizeShift } from './useResizeShift';
import './builder.css';

function prettifyHouse(id: string): string {
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
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
  // Live pointer x-position during a drag, as a 0..1 fraction of the day column's
  // width — drives which single lane is highlighted per row (see Grid).
  const [dragColFrac, setDragColFrac] = useState<number | null>(null);
  // Live AI proposal painted into the grid while the generator streams (and the
  // finished proposal until the SM accepts or discards it). blockId -> userIds,
  // client-only; never persisted here. Non-null puts the grid in read-only
  // preview mode.
  const [aiPreview, setAiPreview] = useState<Record<string, string[]> | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  // The shift the SM last CLICKED (as opposed to dragged). Non-null lights up
  // that shift plus every other shift its worker holds this week, and swaps the
  // side panel over to the worker-focus cards. Purely a view state: focusing
  // never writes.
  const [focus, setFocus] = useState<ShiftRun | null>(null);
  // Full-screen grid: the week fills the whole page, with the app nav, the
  // toolbar and the AI panel out of the way, for when the SM just wants to read
  // the schedule. In full screen the side panel collapses into a drawer too, so
  // "everything" really is everything — see BuilderSideDock.
  const [expanded, setExpanded] = useState(false);
  const sideDock = useSideDock(expanded);
  const [pending, setPending] = useState<PendingAssign | null>(null);
  // Confirm dialogs for the two destructive draft actions (§4.3): removing one worker
  // from the whole week, and wiping the whole week to start over.
  const [removeWorker, setRemoveWorker] = useState<{ userId: string; name: string } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
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

  // Finalize a gesture on mouse-up anywhere. Two outcomes, decided by whether
  // the pointer moved between cells:
  //   DRAG  -> selects the span, exactly as before (assign / drop by range).
  //   CLICK on a drafted shift -> focuses that worker instead of touching the
  //     draft. Clicking is now a read gesture: it answers "who is this and what
  //     else are they working", and only a drag ever changes the schedule.
  //   CLICK on an empty cell -> selects that single block, as before.
  //
  // The gesture is tracked in a ref as well as in state: the listener is
  // registered once on mount and reads the ref, so a mouse-up that lands in the
  // same task as the mouse-down (a fast click, or an automated one) is still
  // seen. Keying the listener on the `dragging` STATE instead loses those,
  // because the effect that would attach it has not run yet.
  const gesture = useRef<{ anchor: number; hover: number; frac: number } | null>(null);

  const { reveal, handleEscape } = sideDock;

  useEffect(() => {
    const onUp = () => {
      const g = gesture.current;
      gesture.current = null;
      setDragging(false);
      if (g === null) return;
      const block = data.blocks[g.anchor];
      if (g.anchor === g.hover && block !== undefined) {
        const shift = findShiftAt(data.blocks, aiPreview ?? drafts, block.blockId, g.frac);
        if (shift !== null) {
          setFocus(shift);
          // In full screen the panel is collapsed by default; a click that asks
          // "who is this" has to bring it back or the answer has nowhere to land.
          reveal();
          setSelectedBlockIds([]);
          setAnchorIdx(null);
          setHoverIdx(null);
          return;
        }
      }
      setFocus(null);
      const lo = Math.min(g.anchor, g.hover);
      const hi = Math.max(g.anchor, g.hover);
      setSelectedBlockIds(data.blocks.slice(lo, hi + 1).map((b) => b.blockId));
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [data.blocks, drafts, aiPreview, reveal]);

  // Escape backs out one layer at a time: first any selection or focused worker
  // (so the grid returns to its normal grey and an in-progress drag aborts),
  // then the collapsed side drawer, then full screen. Modals own Escape while
  // they're open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pending !== null || publishOpen || clearOpen || removeWorker !== null) return;
      const hadHighlight = selectedBlockIds.length > 0 || focus !== null || dragging;
      gesture.current = null;
      setDragging(false);
      setAnchorIdx(null);
      setHoverIdx(null);
      setDragColFrac(null);
      setSelectedBlockIds([]);
      setFocus(null);
      if (hadHighlight) return;
      if (handleEscape()) return;
      setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    pending,
    publishOpen,
    clearOpen,
    removeWorker,
    selectedBlockIds,
    focus,
    dragging,
    handleEscape,
  ]);

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
      isRsm: w.isRsm,
    }));
  }, [data.workers, data.targets, drafts]);

  const selectedBlocks = useMemo<BuilderBlock[]>(() => {
    const set = new Set(selectedBlockIds);
    return data.blocks.filter((b) => set.has(b.blockId));
  }, [selectedBlockIds, data.blocks]);

  // What the grid renders: the live AI proposal while one is on screen, the
  // persisted drafts otherwise. Focus reads from the same source, so clicking a
  // proposed shift explains it exactly like a drafted one.
  const activeDrafts = aiPreview ?? drafts;

  // The focused worker's whole week, recomputed from the current drafts so a
  // removal (from this panel or the grid) is reflected immediately. The focused
  // shift falls back to their next remaining one when the clicked shift is the
  // one that just went away; when nothing is left the panel closes itself.
  const focusShifts = useMemo<ShiftRun[]>(
    () => (focus === null ? [] : workerWeekShifts(data.blocks, activeDrafts, focus.userId)),
    [focus, data.blocks, activeDrafts],
  );
  const focusCurrent = useMemo<ShiftRun | null>(() => {
    if (focus === null) return null;
    return focusShifts.find((s) => s.startAtIso === focus.startAtIso) ?? focusShifts[0] ?? null;
  }, [focus, focusShifts]);
  // The focused shift's own day, for the panel's time inputs to snap against
  // (the house's real open/close boundaries, not an arbitrary free-typed time).
  const focusDayBlocks = useMemo(
    () => (focusCurrent === null ? [] : blocksOfDay(data.blocks, focusCurrent.dayKey)),
    [focusCurrent, data.blocks],
  );

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
    return `${first.timeLabel}-${end}`;
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

  // ---- export (download / print) -----------------------------------------
  // Exports the CURRENT drafts as a standalone, presentation-ready snapshot —
  // not a screenshot of this interactive page, but a dedicated read-only render
  // (lib/export/scheduleHtml) so the artifact looks right dropped straight into
  // slides. "Download HTML" is a single-click Blob download; "Print / Save as
  // PDF" hands the same markup to the browser's native print dialog via a
  // hidden iframe (no server-side PDF renderer needed).
  const buildExportHtml = useCallback(() => {
    return buildScheduleExportHtml({
      houseLabel: prettifyHouse(data.houseId),
      weekStartDate: data.weekStartDate,
      blocks: data.blocks,
      drafts: aiPreview ?? drafts,
      workerName: (userId) => workerName.get(userId) ?? 'Unknown',
      generatedAtLabel: `Generated ${new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date())}`,
    });
  }, [data.houseId, data.weekStartDate, data.blocks, aiPreview, drafts, workerName]);

  const onDownloadHtml = useCallback(() => {
    const html = buildExportHtml();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.houseId}-schedule-${data.weekStartDate ?? 'week'}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [buildExportHtml, data.houseId, data.weekStartDate]);

  const onPrintPdf = useCallback(() => {
    const html = buildExportHtml();
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    doc?.open();
    doc?.write(html);
    doc?.close();
    const cleanup = () => {
      document.body.removeChild(iframe);
    };
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      // Give the print dialog a moment to open before tearing the iframe down;
      // most browsers block on print() but this is a safe fallback either way.
      window.setTimeout(cleanup, 1000);
    };
  }, [buildExportHtml]);

  const commitAssign = useCallback(
    async (userId: string, blockIds: string[]) => {
      // Fill only the OPEN seats in the span: a block gains this worker when it still has a
      // free seat (drafted count < required_headcount) and the worker isn't already on it.
      // Blocks whose seats are all taken are silently skipped — the drag "flows" past them into
      // the next open seat instead of erroring. New workers append, so the seat renderer packs
      // them leftmost-first.
      const added = blockIds.filter((blockId) => {
        const current = drafts[blockId] ?? [];
        const req = capacityByBlock.get(blockId) ?? 1;
        return current.length < req && !current.includes(userId);
      });
      if (added.length === 0) {
        setPending(null);
        return;
      }
      setDrafts((prev) => {
        const next = { ...prev };
        for (const blockId of added) next[blockId] = [...(next[blockId] ?? []), userId];
        return next;
      });
      setPending(null);
      if (data.periodId !== null) {
        const periodId = data.periodId;
        const res = await runWrite(() => assignDraft({ periodId, blockIds: added, userId }));
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

  // Dragging the focused shift's grid handle or editing its times in the side
  // panel both end here (see useResizeShift.ts).
  const onResizeShift = useResizeShift({
    blocks: data.blocks,
    commitAssign,
    onRemoveSpan,
    setFocus,
  });

  // The distinct workers currently drafted anywhere this week, with their hours vs. target —
  // powers the "On this schedule" list + its per-worker "remove from the whole week" control.
  // Sorted furthest-over-target first: that's the SM's actual triage order when scanning this list.
  const workersOnSchedule = useMemo(() => {
    const count = new Map<string, number>();
    for (const users of Object.values(drafts)) {
      for (const userId of users) count.set(userId, (count.get(userId) ?? 0) + 1);
    }
    return [...count.entries()]
      .map(([userId, blocks]) => {
        const assignedHours = blocks * HOURS_PER_BLOCK;
        const target = data.targets[userId] ?? null;
        return {
          userId,
          name: workerName.get(userId) ?? userId,
          assignedHours,
          targetHours: target?.targetHours ?? null,
          optedOut: target?.optedOut ?? false,
        };
      })
      .sort((a, b) => {
        const overA = a.targetHours !== null ? a.assignedHours - a.targetHours : -Infinity;
        const overB = b.targetHours !== null ? b.assignedHours - b.targetHours : -Infinity;
        return overB - overA;
      });
  }, [drafts, workerName, data.targets]);

  // Remove ONE worker from every block they're drafted in this week (not just one run).
  // A worker's whole-week block set is small (<= a full week of their own shifts), so a
  // single removeDraftSpan call is under the URI limit — no chunking needed here.
  const onRemoveWorker = useCallback(
    async (userId: string) => {
      const blockIds = Object.entries(drafts)
        .filter(([, users]) => users.includes(userId))
        .map(([blockId]) => blockId);
      setRemoveWorker(null);
      if (blockIds.length === 0) return;
      const snapshot = drafts;
      setDrafts((prev) => {
        const next: Record<string, string[]> = {};
        for (const [blockId, users] of Object.entries(prev)) {
          next[blockId] = users.filter((id) => id !== userId);
        }
        return next;
      });
      if (data.periodId !== null) {
        const periodId = data.periodId;
        const res = await runWrite(() => removeDraftSpan({ periodId, blockIds, userId }));
        if (!res.ok) setDrafts(snapshot);
      }
    },
    [drafts, data.periodId, runWrite],
  );

  // Wipe every draft for this house's build week (start from scratch). Scoped to the week's
  // blocks so a period shared across houses only loses THIS house's week.
  const onClearAll = useCallback(async () => {
    setClearOpen(false);
    const snapshot = drafts;
    setDrafts({});
    if (data.periodId !== null) {
      const periodId = data.periodId;
      const blockIds = data.blocks.map((b) => b.blockId);
      const res = await runWrite(() => clearDraftBlocks({ periodId, blockIds }));
      if (!res.ok) setDrafts(snapshot);
    }
  }, [drafts, data.blocks, data.periodId, runWrite]);

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
    clearSelection();
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
    clearSelection();
  };

  const onPublish = async () => {
    setPublishOpen(false);
    if (data.periodId === null) return;
    const periodId = data.periodId;
    const res = await runWrite(() => publishScheduleAction({ periodId, houseId: data.houseId }));
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
    <div
      data-testid="schedule-builder"
      className={`builder-page ${expanded ? 'is-expanded' : ''}`.trim()}
    >
      {/* desktop-only gate — shown ≤680px via CSS (§4.3) */}
      <div data-testid="builder-desktop-only-notice" className="builder-narrow">
        <Icon name="grid" size={32} />
        <div className="t-h2">Schedule builder is desktop-only</div>
        <div className="t-helper">
          Building a week needs a wide canvas — open this on a larger screen.
        </div>
      </div>

      <div className="builder-main">
        <BuilderToolbar
          houseLabel={prettifyHouse(data.houseId)}
          published={published}
          publishStats={publishStats}
          saving={saving}
          savedAt={savedAt}
          phase={phase}
          onPhaseChange={setPhase}
          showClearAll={!published && aiPreview === null && assignedBlockCount > 0}
          onClearAll={() => setClearOpen(true)}
          showExport={aiPreview !== null || assignedBlockCount > 0}
          onDownloadHtml={onDownloadHtml}
          onPrintPdf={onPrintPdf}
          onPublish={() => setPublishOpen(true)}
          onExpand={() => setExpanded(true)}
        />

        {error !== null && (
          <div data-testid="builder-error" className="side-note">
            <Notification kind="error" title="Something went wrong">
              {error}
            </Notification>
          </div>
        )}

        {/* Full-screen exit bar. Its own full-width row above the day header, so
            there is always one obvious way back (Esc also works). */}
        {expanded && (
          <div className="bld-expand-bar">
            <span className="t-h3">{prettifyHouse(data.houseId)} weekly template</span>
            <Button
              kind="secondary"
              size="sm"
              data-testid="builder-collapse-button"
              icon="collapse"
              onClick={() => setExpanded(false)}
            >
              Exit full screen
            </Button>
          </div>
        )}

        <div className="bld-content">
          <div className="bld-ai-slot">
            <AiSchedulePanel
              houseId={data.houseId}
              periodId={data.periodId}
              published={published}
              onPreviewChange={setAiPreview}
            />
          </div>

          <div className="bld-body">
            <Grid
              blocks={data.blocks}
              drafts={activeDrafts}
              preview={aiPreview !== null}
              workerName={workerName}
              anchorIdx={anchorIdx}
              hoverIdx={hoverIdx}
              dragColFrac={dragColFrac}
              dragging={dragging}
              selectedBlockIds={selectedBlockIds}
              focus={
                focusCurrent === null
                  ? null
                  : { userId: focusCurrent.userId, blockIds: focusCurrent.blockIds }
              }
              onCellDown={(idx, colFrac) => {
                gesture.current = { anchor: idx, hover: idx, frac: colFrac };
                setDragging(true);
                setAnchorIdx(idx);
                setHoverIdx(idx);
                setDragColFrac(colFrac);
                setSelectedBlockIds([]);
              }}
              onCellEnter={(idx, colFrac) => {
                if (gesture.current === null) return;
                gesture.current = { ...gesture.current, hover: idx, frac: colFrac };
                setHoverIdx(idx);
                setDragColFrac(colFrac);
              }}
              onRemoveSpan={onRemoveSpan}
              onResizeShift={onResizeShift}
              readOnly={aiPreview !== null || published}
            />

            <BuilderSideDock expanded={expanded} dock={sideDock}>
              {focusCurrent !== null && selectedBlockIds.length === 0 ? (
                <WorkerFocusPanel
                  name={workerName.get(focusCurrent.userId) ?? focusCurrent.userId}
                  focused={focusCurrent}
                  shifts={focusShifts}
                  dayBlocks={focusDayBlocks}
                  targetHours={data.targets[focusCurrent.userId]?.targetHours ?? null}
                  readOnly={aiPreview !== null || published}
                  onResizeShift={onResizeShift}
                  onRemoveShift={(shift) => void onRemoveSpan(shift.userId, shift.blockIds)}
                  onClose={() => setFocus(null)}
                />
              ) : selectedBlockIds.length === 0 ? (
                <SideEmptyPanel
                  workersOnSchedule={workersOnSchedule}
                  showRoster={aiPreview === null && !published}
                  onRequestRemove={setRemoveWorker}
                />
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
            </BuilderSideDock>
          </div>
        </div>
      </div>

      {pending && (pending.kind === 'over_target' || pending.kind === 'advisory') && (
        <OverrideConfirmModal
          kind={pending.kind}
          name={pending.name}
          advisories={pending.advisories}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            void commitAssign(pending.userId, pending.blockIds);
            clearSelection();
          }}
        />
      )}

      {removeWorker !== null && (
        <Modal
          testId="remove-worker-dialog"
          eyebrow="Remove from schedule"
          title={`Remove ${removeWorker.name}?`}
          width={440}
          onClose={() => setRemoveWorker(null)}
          footer={
            <>
              <Button kind="secondary" onClick={() => setRemoveWorker(null)}>
                Cancel
              </Button>
              <Button
                kind="danger"
                icon="close"
                data-testid="remove-worker-confirm"
                onClick={() => void onRemoveWorker(removeWorker.userId)}
              >
                Remove from week
              </Button>
            </>
          }
        >
          <Notification kind="warning" title={`Clear all of ${removeWorker.name}'s shifts?`}>
            This removes {removeWorker.name} from every block they hold in this build week. It only
            affects the draft, so you can add them back before publishing.
          </Notification>
        </Modal>
      )}

      {clearOpen && (
        <Modal
          testId="clear-all-dialog"
          eyebrow="Start from scratch"
          title="Clear the whole week?"
          width={440}
          onClose={() => setClearOpen(false)}
          footer={
            <>
              <Button kind="secondary" onClick={() => setClearOpen(false)}>
                Keep draft
              </Button>
              <Button
                kind="danger"
                icon="trash"
                data-testid="clear-all-confirm"
                onClick={() => void onClearAll()}
              >
                Clear all
              </Button>
            </>
          }
        >
          <Notification kind="warning" title="This empties the draft grid">
            Every assignment in this build week is removed so you can rebuild from scratch. It only
            affects the unpublished draft, not any already-published schedule.
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
// Phase1CardView / Phase2RosterView / advisoryText moved to RosterPanels.tsx
// (2026-07-29 extraction, this file is quarantined at the 600-line ceiling).
