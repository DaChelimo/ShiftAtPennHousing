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
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

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
// "5 AM" / "12 PM" for a pinned time-rail tick (shown only on the hour so the rail stays
// uncluttered). The per-cell gray time labels were removed in favour of these rails.
function railHourLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: 'numeric',
    hour12: true,
  }).format(new Date(iso));
}

// Like railHourLabel, but includes the minute when the block isn't on the hour —
// used only for the rail's forced-visible first row, so an odd opening time (e.g.
// 05:30 for summer Harnwell) reads as "5:30 AM", not a misleading "5 AM".
function railTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  }).format(new Date(iso));
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
      if (pending !== null || publishOpen || clearOpen || removeWorker !== null) return;
      setDragging(false);
      setAnchorIdx(null);
      setHoverIdx(null);
      setDragColFrac(null);
      setSelectedBlockIds([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, publishOpen, clearOpen, removeWorker]);

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

  // The distinct workers currently drafted anywhere this week, with their block counts —
  // powers the "On this schedule" list + its per-worker "remove from the whole week" control.
  const workersOnSchedule = useMemo(() => {
    const count = new Map<string, number>();
    for (const users of Object.values(drafts)) {
      for (const userId of users) count.set(userId, (count.get(userId) ?? 0) + 1);
    }
    return [...count.entries()]
      .map(([userId, blocks]) => ({ userId, name: workerName.get(userId) ?? userId, blocks }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [drafts, workerName]);

  // Workers drafted anywhere INSIDE the current selection, with the exact blocks each holds
  // within it. Powers the "In this range" list, which trims a worker out of just the selected
  // slice (e.g. drop Bob from 4:00-6:00 of his 12:00-20:00 run, splitting the run in two)
  // without disturbing the rest of the run — the surgical middle-of-a-shift removal the
  // whole-run "×" and the whole-week "Remove all" can't do.
  const workersInSelection = useMemo(() => {
    if (selectedBlockIds.length === 0) return [];
    const byUser = new Map<string, string[]>();
    for (const blockId of selectedBlockIds) {
      for (const userId of drafts[blockId] ?? []) {
        const list = byUser.get(userId) ?? [];
        list.push(blockId);
        byUser.set(userId, list);
      }
    }
    return [...byUser.entries()]
      .map(([userId, blockIds]) => ({ userId, name: workerName.get(userId) ?? userId, blockIds }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedBlockIds, drafts, workerName]);

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
              <h1 className="t-h1">{prettifyHouse(data.houseId)} weekly template</h1>
              {published ? (
                <span data-testid="schedule-published-badge">
                  <Tag kind="green" icon="check">
                    Published{publishStats !== null && ` · ${publishStats.scheduled} scheduled`}
                  </Tag>
                </span>
              ) : (
                <Tag kind="amber">Draft</Tag>
              )}
              <SaveStatus saving={saving} savedAt={savedAt} />
            </div>
            <div className="t-helper">
              Drag consecutive blocks, then pick who works them. This repeating pattern applies to
              every week until you edit a specific week.
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
            {!published && aiPreview === null && assignedBlockCount > 0 && (
              <Button
                kind="ghost"
                data-testid="clear-all-button"
                icon="trash"
                onClick={() => setClearOpen(true)}
              >
                Clear all
              </Button>
            )}
            {(aiPreview !== null || assignedBlockCount > 0) && (
              <>
                <Button
                  kind="ghost"
                  data-testid="export-html-button"
                  icon="download"
                  onClick={onDownloadHtml}
                >
                  Download HTML
                </Button>
                <Button
                  kind="ghost"
                  data-testid="export-pdf-button"
                  icon="download"
                  onClick={onPrintPdf}
                >
                  Print / Save as PDF
                </Button>
              </>
            )}
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

        <div className="bld-content">
          <AiSchedulePanel
            houseId={data.houseId}
            periodId={data.periodId}
            published={published}
            deadlineOpen={data.deadlineOpen}
            onPreviewChange={setAiPreview}
          />

          <div className="bld-body">
            <Grid
              blocks={data.blocks}
              drafts={aiPreview ?? drafts}
              preview={aiPreview !== null}
              workerName={workerName}
              anchorIdx={anchorIdx}
              hoverIdx={hoverIdx}
              dragColFrac={dragColFrac}
              dragging={dragging}
              selectedBlockIds={selectedBlockIds}
              onCellDown={(idx, colFrac) => {
                setDragging(true);
                setAnchorIdx(idx);
                setHoverIdx(idx);
                setDragColFrac(colFrac);
                setSelectedBlockIds([]);
              }}
              onCellEnter={(idx, colFrac) => {
                if (!dragging) return;
                setHoverIdx(idx);
                setDragColFrac(colFrac);
              }}
              onRemoveSpan={onRemoveSpan}
            />

            <aside className="builder-side">
              {selectedBlockIds.length === 0 ? (
                <>
                  <div className="side-empty">
                    <Icon name="drag" size={24} />
                    <div className="t-h3">Select blocks to assign</div>
                    <div className="t-helper">
                      Drag across one or more consecutive cells to pick a span. Press Esc to clear
                      it.
                    </div>
                    <div className="side-stat">
                      <span className="t-meta">Assigned so far</span>
                      <b className="t-mono">{assignedBlockCount} blocks</b>
                    </div>
                  </div>
                  {aiPreview === null && !published && workersOnSchedule.length > 0 && (
                    <div className="side-workers" data-testid="side-workers">
                      <span className="side-list-label t-label">On this schedule</span>
                      <div className="t-helper side-workers-hint">
                        Removes a worker from their whole week. To drop just part of a shift, select
                        that time range on the grid instead.
                      </div>
                      <div className="side-worker-list">
                        {workersOnSchedule.map((w) => (
                          <div key={w.userId} className="side-worker-row">
                            <Avatar name={w.name} size={26} />
                            <div className="side-worker-meta">
                              <b>{w.name}</b>
                              <span className="t-meta">
                                {w.blocks * HOURS_PER_BLOCK}h · {w.blocks} blocks
                              </span>
                            </div>
                            <Button
                              kind="ghost"
                              size="sm"
                              icon="trash"
                              data-testid={`remove-worker-${w.userId}`}
                              aria-label={`Remove ${w.name} from the whole week`}
                              onClick={() => setRemoveWorker({ userId: w.userId, name: w.name })}
                            >
                              Remove all
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
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
                  {aiPreview === null && !published && workersInSelection.length > 0 && (
                    <div className="side-workers" data-testid="side-in-range">
                      <span className="side-list-label t-label">In this range</span>
                      <div className="side-worker-list">
                        {workersInSelection.map((w) => (
                          <div key={w.userId} className="side-worker-row">
                            <Avatar name={w.name} size={26} />
                            <div className="side-worker-meta">
                              <b>{w.name}</b>
                              <span className="t-meta">
                                {w.blockIds.length * HOURS_PER_BLOCK}h in this range
                              </span>
                            </div>
                            <Button
                              kind="ghost"
                              size="sm"
                              icon="close"
                              data-testid={`remove-in-range-${w.userId}`}
                              aria-label={`Remove ${w.name} from ${spanLabel}`}
                              onClick={() => void onRemoveSpan(w.userId, w.blockIds)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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

// A2: surfaces that every assignment is saved the instant it's made (the
// builder has no batch "Save" — drafts persist per-action), so the HM can
// close the tab and resume later without losing work. The indicator is ALWAYS
// present (even before the first edit) so the autosave contract is discoverable,
// not something the SM has to be told about.
function savedTimeLabel(ts: number): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(ts),
  );
}

const tip = 'Every change saves automatically. You can close this and pick up where you left off.';
function SaveStatus({ saving, savedAt }: { saving: boolean; savedAt: number | null }) {
  if (saving) {
    return (
      <span data-testid="builder-save-status" className="bld-savestate is-saving" title={tip}>
        <Icon name="refresh" size={13} className="bld-spin" />
        Saving…
      </span>
    );
  }
  if (savedAt !== null) {
    return (
      <span data-testid="builder-save-status" className="bld-savestate is-saved" title={tip}>
        <Icon name="check" size={13} />
        Saved {savedTimeLabel(savedAt)}
      </span>
    );
  }
  return (
    <span data-testid="builder-save-status" className="bld-savestate is-idle" title={tip}>
      <Icon name="check" size={13} />
      Saves automatically
    </span>
  );
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
// An unfilled required seat: a contiguous run of blocks in one lane where the block's
// required_headcount demands a body but none is drafted. This is what makes the staffing
// pattern visible — a Harnwell afternoon (required 2) with one worker shows one ghost seat,
// so the SM sees the second seat is still open (it becomes an open shift on publish).
type SeatGap = { lane: number; startLocal: number; len: number; req: number };

// Split a run into contiguous segments of constant required_headcount. Each segment renders
// at its OWN width/lane offset, so a run is full width exactly where the desk is single-staff
// and narrows to a half/third exactly at the block where the house doubles/triples up — not
// for the run's whole length. Without this, a run that STARTS single-staff and later crosses
// into a double-staff stretch (e.g. Ben 10:00-14:00 where only 12:00-14:00 is required=2)
// would draw half width the whole way, leaving a misleading empty "lane" beside its
// single-staff portion where no second seat actually exists. Mirrors computeSeatGaps, which
// already breaks ghost seats at every required-headcount change.
type RunSegment = { startLocal: number; len: number; req: number };
function runSegments(dayBlocks: BuilderBlock[], run: BlockRun): RunSegment[] {
  const segs: RunSegment[] = [];
  let i = 0;
  while (i < run.len) {
    const req = dayBlocks[run.startLocal + i]?.requiredHeadcount ?? 1;
    let j = i;
    while (j + 1 < run.len && (dayBlocks[run.startLocal + j + 1]?.requiredHeadcount ?? 1) === req) {
      j += 1;
    }
    segs.push({ startLocal: run.startLocal + i, len: j - i + 1, req });
    i = j + 1;
  }
  return segs;
}

// Derive the ghost seats for a day. Lanes 0..laneCount-1 are the staffing slots; lane `l`
// is "required" at a block when that block's required_headcount > l. A seat is a gap wherever
// a required lane is not covered by a drafted run. Contiguous gaps in the same lane coalesce
// into one placeholder — but a gap also BREAKS when the required headcount changes (noon on a
// Harnwell weekday), so each seat spans a single width and the morning ghost is full width
// while the afternoon ghosts are half width.
function computeSeatGaps(
  dayBlocks: BuilderBlock[],
  laned: LanedRun[],
  laneCount: number,
): SeatGap[] {
  const covered: boolean[][] = Array.from({ length: laneCount }, () =>
    new Array(dayBlocks.length).fill(false),
  );
  for (const run of laned) {
    for (let k = 0; k < run.len; k += 1) covered[run.lane]![run.startLocal + k] = true;
  }
  const reqOf = (idx: number) => dayBlocks[idx]?.requiredHeadcount ?? 1;

  const gaps: SeatGap[] = [];
  for (let lane = 0; lane < laneCount; lane += 1) {
    let i = 0;
    while (i < dayBlocks.length) {
      const req = reqOf(i);
      if (req <= lane || covered[lane]![i]) {
        i += 1;
        continue;
      }
      let j = i;
      while (
        j + 1 < dayBlocks.length &&
        reqOf(j + 1) === req &&
        reqOf(j + 1) > lane &&
        !covered[lane]![j + 1]
      ) {
        j += 1;
      }
      gaps.push({ lane, startLocal: i, len: j - i + 1, req });
      i = j + 1;
    }
  }
  return gaps;
}

// "08:00–12:00" for a [startLocal, startLocal+len) span — the END is the last block's
// start + 30 min, so the span reads as one continuous block and the 11:30-vs-12:00
// "is that the end?" ambiguity disappears. Shared by both assigned runs and empty seats,
// so an open slot's start/end time is always visible, not just an assigned one's.
function rangeLabel(dayBlocks: BuilderBlock[], startLocal: number, len: number): string {
  const first = dayBlocks[startLocal]!;
  const last = dayBlocks[startLocal + len - 1]!;
  const end = nyTime(new Date(new Date(last.startAtIso).getTime() + 30 * 60000));
  return `${first.timeLabel}-${end}`;
}

function runRangeLabel(dayBlocks: BuilderBlock[], run: BlockRun): string {
  return rangeLabel(dayBlocks, run.startLocal, run.len);
}

// Pinned time axis. One rail is rendered on the LEFT and one on the RIGHT of the grid, both
// sticky to their edge, so the SM can always read a block's time no matter how far they've
// scrolled horizontally (§ design: mirrors the live calendar's frozen gutter). Rows align 1:1
// with each day column's 30-min cells, so the per-cell gray time labels are no longer needed.
function TimeRail({ cells, side }: { cells: BuilderBlock[]; side: 'left' | 'right' }) {
  return (
    <div className={`bld-rail bld-rail-${side}`} aria-hidden="true">
      <div className="bld-rail-head" />
      {cells.map((b, i) => {
        // Always label the very first row with the day's real open time (e.g.
        // 05:30 for summer Harnwell), even off the hour — then only label
        // on-the-hour rows after that (06:00, 07:00…), not every 30-min step
        // relative to an odd origin, which is unreadable.
        const showLabel = i === 0 || b.timeKey.endsWith('00');
        const isLast = i === cells.length - 1;
        return (
          <div className="bld-tick" key={b.blockId} style={{ height: CELL_H }}>
            {showLabel && (
              <span className={`bld-tick-label t-mono ${i === 0 ? 'is-first' : ''}`.trim()}>
                {i === 0 ? railTimeLabel(b.startAtIso) : railHourLabel(b.startAtIso)}
              </span>
            )}
            {/* The closing boundary (e.g. midnight) isn't the START of any cell, so
                it never gets a label above — without this the rail's end time is
                never shown at all. */}
            {isLast && (
              <span className="bld-tick-label t-mono is-last">
                {railTimeLabel(
                  new Date(new Date(b.startAtIso).getTime() + 30 * 60000).toISOString(),
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Grid({
  blocks,
  drafts,
  preview = false,
  workerName,
  anchorIdx,
  hoverIdx,
  dragColFrac,
  dragging,
  selectedBlockIds,
  onCellDown,
  onCellEnter,
  onRemoveSpan,
}: {
  blocks: BuilderBlock[];
  drafts: Record<string, string[]>;
  // Read-only AI preview mode: renders `drafts` as ghost proposal cells filling
  // in, with drag/select and the per-run remove control suppressed (CSS).
  preview?: boolean;
  workerName: Map<string, string>;
  anchorIdx: number | null;
  hoverIdx: number | null;
  // Fraction (0..1) across a day column's own width, tracking the pointer's
  // horizontal position during a drag — this is what lets the highlighted seat
  // track "the side of the row the mouse is currently over" (see the drag
  // handlers on .bld-cell below).
  dragColFrac: number | null;
  dragging: boolean;
  selectedBlockIds: string[];
  onCellDown: (idx: number, colFrac: number) => void;
  onCellEnter: (idx: number, colFrac: number) => void;
  onRemoveSpan: (userId: string, blockIds: string[]) => void;
}) {
  const lo = anchorIdx !== null && hoverIdx !== null ? Math.min(anchorIdx, hoverIdx) : -1;
  const hi = anchorIdx !== null && hoverIdx !== null ? Math.max(anchorIdx, hoverIdx) : -1;
  const selected = new Set(selectedBlockIds);
  const days = [...new Set(blocks.map((b) => b.dayKey))];
  // The time rails read their rows from the first day's blocks; every day in a period shares
  // the same 30-min row set (the grid already stacks days on identical rows), so the left and
  // right rails line up with all columns.
  const railCells = blocks.filter((b) => b.dayKey === days[0]);

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
    <div
      data-testid="schedule-builder-grid"
      className={`bld-grid ${preview ? 'is-ai-preview' : ''}`.trim()}
    >
      <TimeRail cells={railCells} side="left" />
      {days.map((day) => {
        // This day's blocks, paired with their index in the flat `blocks` array (the drag
        // model keys on the flat index). The local index drives vertical positioning.
        const dayCells: Array<{ b: BuilderBlock; flatIdx: number }> = [];
        blocks.forEach((b, flatIdx) => {
          if (b.dayKey === day) dayCells.push({ b, flatIdx });
        });
        const dayBlocks = dayCells.map((c) => c.b);
        const assigned = assignLanes(computeRuns(dayBlocks, drafts));
        // Seat lanes = the day's peak required headcount (Harnwell 1 before noon, 2 after;
        // Quad 3), so every required slot has its own lane even when it's still empty. The
        // capacity guard keeps drafted lanes <= required, so this never truncates a real run.
        const maxReq = dayBlocks.reduce((m, b) => Math.max(m, b.requiredHeadcount), 1);
        const laneCount = Math.max(assigned.laneCount, maxReq);
        const laned = assigned.laned;
        const seatGaps = computeSeatGaps(dayBlocks, laned, laneCount);

        // Exactly ONE lane is ever highlighted per row: the single lane directly
        // under the pointer, never the whole multi-seat row and never a second
        // lane. Which lane comes from the pointer's live horizontal position
        // (dragColFrac, a 0..1 fraction of the day column's width) mapped into
        // THIS row's own seat count — so the highlight tracks the mouse across
        // lanes and, when a drag crosses from a single-seat row into a two-seat
        // row, lands on the side the mouse is actually over. A single-seat row
        // has just one full-width lane, so its highlight naturally spans the row.
        const selLane: Array<number | null> = dayCells.map(({ b, flatIdx }) => {
          const on = (dragging && flatIdx >= lo && flatIdx <= hi) || selected.has(b.blockId);
          if (!on) return null;
          const req = b.requiredHeadcount;
          const frac = dragColFrac ?? 0;
          return Math.min(req - 1, Math.max(0, Math.floor(frac * req)));
        });
        // Coalesce contiguous blocks that share a lane (and seat count) into one band.
        const selSegs: Array<{ seat: number; startLocal: number; len: number; req: number }> = [];
        {
          let i = 0;
          while (i < dayBlocks.length) {
            const lane = selLane[i];
            if (lane === null) {
              i += 1;
              continue;
            }
            const req = dayBlocks[i]!.requiredHeadcount;
            let j = i;
            while (
              j + 1 < dayBlocks.length &&
              selLane[j + 1] === lane &&
              dayBlocks[j + 1]!.requiredHeadcount === req
            ) {
              j += 1;
            }
            selSegs.push({ seat: lane, startLocal: i, len: j - i + 1, req });
            i = j + 1;
          }
        }

        return (
          <div className="bld-day" key={day}>
            <div className="bld-dayhead">
              <span className="cal-dow">{dowLabel(day)}</span>
            </div>
            <div className="bld-col">
              {/* Drag layer: one target per 30-min block (preserves the e2e drag contract).
                  The assignee name stays in the cell (visually hidden) so each block's
                  testid still reports who's on it; the visible block is the overlay. */}
              {dayCells.map(({ b, flatIdx }) => {
                const isHour = b.timeKey.endsWith('00');
                const assignees = drafts[b.blockId] ?? [];
                // The cell is a bare drag target now — the time reference lives in the pinned
                // left/right rails, not repeated in every cell (that was too crowded). The
                // assignee name stays here (visually hidden) so each block's testid keeps
                // reporting who's on it for the e2e drag contract.
                // Fraction (0..1) across THIS cell's own width — the shared x-position
                // signal that lets every row (regardless of its own seat count) pick
                // "the lane under the mouse" independently. Read on down/enter/move so
                // the highlighted lane keeps tracking the pointer even while it drifts
                // horizontally without crossing into a new row.
                const fracX = (e: MouseEvent<HTMLDivElement>): number => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (rect.width === 0) return 0;
                  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                };
                return (
                  <div
                    key={b.blockId}
                    data-testid={`block-${b.cellKey}`}
                    onMouseDown={(e) => onCellDown(flatIdx, fracX(e))}
                    onMouseEnter={(e) => onCellEnter(flatIdx, fracX(e))}
                    onMouseMove={(e) => dragging && onCellEnter(flatIdx, fracX(e))}
                    className={`bld-cell ${isHour ? 'is-hour' : ''}`.trim()}
                    style={{ height: CELL_H }}
                  >
                    {assignees.length > 0 && (
                      <span className="bld-cell-assignee" aria-hidden="true">
                        {assignees.map((u) => workerName.get(u) ?? u).join(', ')}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Empty seats — one dashed slot per required seat the house's pattern defines
                  for that span (1 / 2 / 3 = the season's max headcount for the block). A
                  single-staff span is one full-width slot; a double-staff span splits into two,
                  a triple into three. Purely visual (pointer-events none) so a drag passes
                  straight through to the cells beneath; the SM fills a slot by dragging. */}
              {seatGaps.map((seat) => (
                <div
                  key={`seat-${seat.lane}-${seat.startLocal}`}
                  className="bld-seat"
                  style={{
                    top: seat.startLocal * CELL_H,
                    height: seat.len * CELL_H,
                    left: `${(seat.lane / seat.req) * 100}%`,
                    width: `${100 / seat.req}%`,
                  }}
                  aria-hidden="true"
                />
              ))}

              {/* Selection highlight — one band per contiguous same-lane run, ONE lane wide.
                  Exactly one lane is highlighted per row: the single lane under the pointer.
                  Never both sides of a multi-seat row at once. */}
              {selSegs.map((s) => (
                <div
                  key={`sel-${s.seat}-${s.startLocal}`}
                  className="bld-selection"
                  style={{
                    top: s.startLocal * CELL_H,
                    height: s.len * CELL_H,
                    left: `${(s.seat / s.req) * 100}%`,
                    width: `${100 / s.req}%`,
                  }}
                  aria-hidden="true"
                />
              ))}

              {/* Assignment layer — each contiguous run is ONE continuous block, but rendered
                  as one rectangle PER required-headcount segment so it's full width where the
                  desk is single-staff and narrows only where it doubles up (no phantom empty
                  lane beside a single-staff stretch). The name/time/× live on the tallest
                  segment; the others are plain tinted rectangles so the run still reads as one
                  L-shaped block. */}
              {laned.map((run) => {
                const name = workerName.get(run.userId) ?? run.userId;
                const segs = runSegments(dayBlocks, run);
                // The tallest segment carries the label + remove control (most room to show it).
                let labelSeg = 0;
                for (let s = 1; s < segs.length; s += 1) {
                  if (segs[s]!.len > segs[labelSeg]!.len) labelSeg = s;
                }
                return segs.map((seg, si) => {
                  // A run covering a block never sits in a lane >= that block's seat count, so
                  // this clamp is just defensive; for a single-staff segment it forces full width.
                  const laneOffset = Math.min(run.lane, seg.req - 1);
                  return (
                    <div
                      key={`${run.userId}-${seg.startLocal}`}
                      className="bld-run"
                      style={{
                        top: seg.startLocal * CELL_H,
                        height: seg.len * CELL_H,
                        left: `${(laneOffset / seg.req) * 100}%`,
                        width: `${100 / seg.req}%`,
                      }}
                    >
                      {si === labelSeg && (
                        <>
                          <span className="bld-run-name">{name}</span>
                          <span className="bld-run-time t-mono">
                            {runRangeLabel(dayBlocks, run)}
                          </span>
                          <button
                            type="button"
                            className="bld-run-x"
                            aria-label={`Remove ${name}`}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => onRemoveSpan(run.userId, run.blockIds)}
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>
                  );
                });
              })}
            </div>
          </div>
        );
      })}
      <TimeRail cells={railCells} side="right" />
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
                        ? `Cannot at ${nyTime(entry.blockedReason.blockStartAt)}`
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
