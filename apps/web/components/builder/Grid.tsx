'use client';

// Schedule builder: the week grid.
//
// Extracted out of ScheduleBuilder.tsx (quarantined for size). Each day is a
// relative column with a drag layer of 30-min cells (the e2e drag targets) and
// three absolute overlays: ghost seats, the selection band, and one continuous
// block per contiguous same-worker run. Overlays are pointer-events:none so a
// drag passes through to the cells beneath.

import { useEffect, useRef, useState, type MouseEvent } from 'react';

import type { BuilderBlock } from '../../lib/data/scheduleBuilder';
import { workerColor } from '../../lib/workerColor';
import { Icon } from '../ui';

import {
  assignLanes,
  CELL_H,
  computeRuns,
  computeSeatGaps,
  runRangeLabel,
  runSegments,
} from './gridModel';

const NY = 'America/New_York';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

// Like railHourLabel, but includes the minute when the block isn't on the hour.
// Used only for the rail's forced-visible first row, so an odd opening time
// (e.g. 05:30 for summer Harnwell) reads as "5:30 AM", not a misleading "5 AM".
function railTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  }).format(new Date(iso));
}

// Pinned time axis. One rail is rendered on the LEFT and one on the RIGHT of the grid, both
// sticky to their edge, so the SM can always read a block's time no matter how far they've
// scrolled horizontally (design: mirrors the live calendar's frozen gutter). Rows align 1:1
// with each day column's 30-min cells, so the per-cell gray time labels are no longer needed.
function TimeRail({ cells, side }: { cells: BuilderBlock[]; side: 'left' | 'right' }) {
  return (
    <div className={`bld-rail bld-rail-${side}`} aria-hidden="true">
      <div className="bld-rail-head" />
      {cells.map((b, i) => {
        // Always label the very first row with the day's real open time (e.g.
        // 05:30 for summer Harnwell), even off the hour, then only label
        // on-the-hour rows after that (06:00, 07:00), not every 30-min step
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
                it never gets a label above; without this the rail's end time is
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

// The worker whose shifts are currently highlighted, and which single shift of
// theirs was clicked. Everything else in the week dims behind them.
export type GridFocus = { userId: string; blockIds: string[] };

// Live state for a drag on one of the focused shift's top/bottom handles. Kept
// as a ref (not just state) so mousemove can mutate the authoritative
// start/len every frame without fighting React's async state batching. The
// mirrored `resizePreview` state below exists purely to trigger a repaint.
type ResizeGesture = {
  userId: string;
  dayKey: string;
  dayBlocks: BuilderBlock[];
  edge: 'top' | 'bottom';
  anchorLocal: number; // the FIXED boundary (opposite the edge being dragged)
  colTop: number; // the day column's viewport top at drag start
  originalBlockIds: string[];
  startLocal: number;
  len: number;
  left: string;
  width: string;
};

type ResizePreview = {
  dayKey: string;
  userId: string;
  startLocal: number;
  len: number;
  left: string;
  width: string;
};

export function Grid({
  blocks,
  drafts,
  preview = false,
  readOnly = false,
  workerName,
  anchorIdx,
  hoverIdx,
  dragColFrac,
  dragging,
  selectedBlockIds,
  focus,
  onCellDown,
  onCellEnter,
  onRemoveSpan,
  onResizeShift,
}: {
  blocks: BuilderBlock[];
  drafts: Record<string, string[]>;
  // Read-only AI preview mode: renders `drafts` as ghost proposal cells filling
  // in, with drag/select and the per-run remove control suppressed (CSS).
  preview?: boolean;
  // Published week or AI preview: suppresses the resize handles (nothing here
  // should let the SM rewrite a schedule that's already live).
  readOnly?: boolean;
  workerName: Map<string, string>;
  anchorIdx: number | null;
  hoverIdx: number | null;
  // Fraction (0..1) across a day column's own width, tracking the pointer's
  // horizontal position during a drag. This is what lets the highlighted seat
  // track "the side of the row the mouse is currently over" (see the drag
  // handlers on .bld-cell below).
  dragColFrac: number | null;
  dragging: boolean;
  selectedBlockIds: string[];
  focus: GridFocus | null;
  onCellDown: (idx: number, colFrac: number) => void;
  onCellEnter: (idx: number, colFrac: number) => void;
  onRemoveSpan: (userId: string, blockIds: string[]) => void;
  // Dragging the focused shift's top/bottom handle (or editing its times in
  // the side panel) ends here: `oldBlockIds` to `newBlockIds` for one worker on
  // one day. The caller diffs the two sets into an add plus a remove.
  onResizeShift?: (
    userId: string,
    dayKey: string,
    oldBlockIds: string[],
    newBlockIds: string[],
  ) => void;
}) {
  const lo = anchorIdx !== null && hoverIdx !== null ? Math.min(anchorIdx, hoverIdx) : -1;
  const hi = anchorIdx !== null && hoverIdx !== null ? Math.max(anchorIdx, hoverIdx) : -1;
  const selected = new Set(selectedBlockIds);
  const focusedBlocks = new Set(focus?.blockIds ?? []);
  const days = [...new Set(blocks.map((b) => b.dayKey))];
  const resizeGesture = useRef<ResizeGesture | null>(null);
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);

  useEffect(() => {
    const onMove = (e: globalThis.MouseEvent) => {
      const g = resizeGesture.current;
      if (g === null) return;
      const raw = Math.round((e.clientY - g.colTop) / CELL_H);
      const idx = Math.min(g.dayBlocks.length - 1, Math.max(0, raw));
      if (g.edge === 'top') {
        g.startLocal = Math.min(idx, g.anchorLocal);
        g.len = g.anchorLocal - g.startLocal + 1;
      } else {
        const end = Math.max(idx, g.anchorLocal);
        g.startLocal = g.anchorLocal;
        g.len = end - g.anchorLocal + 1;
      }
      setResizePreview({
        dayKey: g.dayKey,
        userId: g.userId,
        startLocal: g.startLocal,
        len: g.len,
        left: g.left,
        width: g.width,
      });
    };
    const onUp = () => {
      const g = resizeGesture.current;
      resizeGesture.current = null;
      setResizePreview(null);
      if (g === null) return;
      const newBlockIds = g.dayBlocks
        .slice(g.startLocal, g.startLocal + g.len)
        .map((b) => b.blockId);
      onResizeShift?.(g.userId, g.dayKey, g.originalBlockIds, newBlockIds);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onResizeShift]);
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
      className={`bld-grid ${preview ? 'is-ai-preview' : ''} ${
        focus !== null ? 'is-focusing' : ''
      }`.trim()}
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
        // THIS row's own seat count, so the highlight tracks the mouse across
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
                // Fraction (0..1) across THIS cell's own width: the shared x-position
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
                    onMouseMove={(e) => onCellEnter(flatIdx, fracX(e))}
                    className={`bld-cell ${isHour ? 'is-hour' : ''} ${assignees.length > 0 ? 'is-assigned' : ''}`.trim()}
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

              {/* Empty seats: one dashed slot per required seat the house's pattern defines
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

              {/* Selection highlight: one band per contiguous same-lane run, ONE lane wide.
                  Exactly one lane is highlighted per row, the single lane under the pointer.
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

              {/* Live preview while a top/bottom resize handle is being dragged: a dashed
                  brand-colored band tracking the pointer, independent of the run's own
                  (unchanged-until-drop) rectangle underneath. Committed on mouseup via
                  onResizeShift, same as an edit typed into the side panel. */}
              {resizePreview !== null && resizePreview.dayKey === day && (
                <div
                  className="bld-run-resize-preview"
                  style={{
                    top: resizePreview.startLocal * CELL_H,
                    height: resizePreview.len * CELL_H,
                    left: resizePreview.left,
                    width: resizePreview.width,
                  }}
                  aria-hidden="true"
                />
              )}

              {/* Assignment layer: each contiguous run is ONE continuous block, but rendered
                  as one rectangle PER required-headcount segment so it's full width where the
                  desk is single-staff and narrows only where it doubles up (no phantom empty
                  lane beside a single-staff stretch). The name/time/x live on the tallest
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
                // Focus state: the clicked shift, another shift of the same
                // worker, or someone else's (dimmed while a focus is active).
                let focusClass = '';
                if (focus !== null) {
                  if (run.userId !== focus.userId) focusClass = 'is-dimmed';
                  else if (run.blockIds.some((id) => focusedBlocks.has(id)))
                    focusClass = 'is-focus';
                  else focusClass = 'is-peer';
                }
                // The top/bottom drag handles attach to the label segment's own lane
                // (width/left), so they line up with the rectangle that carries the
                // name and time even on a multi-segment run (a headcount change mid-run).
                const labelReq = segs[labelSeg]!.req;
                const labelLaneOffset = Math.min(run.lane, labelReq - 1);
                const handleLeft = `${(labelLaneOffset / labelReq) * 100}%`;
                const handleWidth = `${100 / labelReq}%`;

                const beginResize = (edge: 'top' | 'bottom', e: MouseEvent<HTMLDivElement>) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const colEl = (e.currentTarget as HTMLElement).closest('.bld-col');
                  if (colEl === null) return;
                  const colTop = colEl.getBoundingClientRect().top;
                  const anchorLocal =
                    edge === 'top' ? run.startLocal + run.len - 1 : run.startLocal;
                  resizeGesture.current = {
                    userId: run.userId,
                    dayKey: day,
                    dayBlocks,
                    edge,
                    anchorLocal,
                    colTop,
                    originalBlockIds: run.blockIds,
                    startLocal: run.startLocal,
                    len: run.len,
                    left: handleLeft,
                    width: handleWidth,
                  };
                  setResizePreview({
                    dayKey: day,
                    userId: run.userId,
                    startLocal: run.startLocal,
                    len: run.len,
                    left: handleLeft,
                    width: handleWidth,
                  });
                };

                return [
                  ...segs.map((seg, si) => {
                    // A run covering a block never sits in a lane >= that block's seat count, so
                    // this clamp is just defensive; for a single-staff segment it forces full width.
                    const laneOffset = Math.min(run.lane, seg.req - 1);
                    return (
                      <div
                        key={`${run.userId}-${seg.startLocal}`}
                        data-testid={
                          focusClass === 'is-focus' && si === labelSeg ? 'focused-shift' : undefined
                        }
                        className={`bld-run ${focusClass}`.trim()}
                        style={{
                          top: seg.startLocal * CELL_H,
                          height: seg.len * CELL_H,
                          left: `${(laneOffset / seg.req) * 100}%`,
                          width: `${100 / seg.req}%`,
                          ['--wc' as string]: workerColor(run.userId),
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
                  }),
                  ...(focusClass === 'is-focus' && !readOnly
                    ? [
                        <div
                          key={`${run.userId}-handle-top`}
                          data-testid="focused-shift-handle-top"
                          className="bld-run-handle bld-run-handle-top"
                          style={{
                            top: run.startLocal * CELL_H,
                            left: handleLeft,
                            width: handleWidth,
                          }}
                          onMouseDown={(e) => beginResize('top', e)}
                          role="presentation"
                          aria-hidden="true"
                        />,
                        <div
                          key={`${run.userId}-handle-bottom`}
                          data-testid="focused-shift-handle-bottom"
                          className="bld-run-handle bld-run-handle-bottom"
                          style={{
                            top: (run.startLocal + run.len) * CELL_H,
                            left: handleLeft,
                            width: handleWidth,
                          }}
                          onMouseDown={(e) => beginResize('bottom', e)}
                          role="presentation"
                          aria-hidden="true"
                        />,
                      ]
                    : []),
                ];
              })}
            </div>
          </div>
        );
      })}
      <TimeRail cells={railCells} side="right" />
    </div>
  );
}
