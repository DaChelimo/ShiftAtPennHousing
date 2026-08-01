'use client';

import { useEffect, useRef, useState } from 'react';

import { blockLabel } from './format';

// A draggable dual-thumb range slider over the shift's 30-min blocks. Either thumb
// snaps to a block boundary. This is the ONLY way to size the sub-range, there is
// no typed from/to entry, by design (2026-07-25 redesign). Split out of
// ShiftOverrideEditor.tsx to keep that file under the repo's 600-line ceiling; it
// has no dependency on EditSection's state, so this is a pure file move.
export function RangeSlider({
  startBlock,
  endBlock,
  fromBlock,
  toBlock,
  originMin,
  onChange,
}: {
  startBlock: number;
  endBlock: number;
  fromBlock: number;
  toBlock: number;
  originMin: number;
  onChange: (from: number, to: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<'from' | 'to' | null>(null);
  const span = endBlock - startBlock;

  useEffect(() => {
    if (drag === null) return;
    const blockAt = (clientX: number): number | null => {
      const el = trackRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const frac = (clientX - r.left) / r.width;
      return Math.max(startBlock, Math.min(endBlock, startBlock + Math.round(frac * span)));
    };
    const move = (e: PointerEvent) => {
      const b = blockAt(e.clientX);
      if (b === null) return;
      if (drag === 'from') onChange(Math.min(b, toBlock - 1), toBlock);
      else onChange(fromBlock, Math.max(b, fromBlock + 1));
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, fromBlock, toBlock, startBlock, endBlock, span, onChange]);

  const fromPct = ((fromBlock - startBlock) / span) * 100;
  const toPct = ((toBlock - startBlock) / span) * 100;

  const onKey = (which: 'from' | 'to') => (e: React.KeyboardEvent) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -1
          : 0;
    if (delta === 0) return;
    e.preventDefault();
    if (which === 'from')
      onChange(Math.min(Math.max(fromBlock + delta, startBlock), toBlock - 1), toBlock);
    else onChange(fromBlock, Math.max(Math.min(toBlock + delta, endBlock), fromBlock + 1));
  };

  // One tick per 30-min block boundary (a "marked" slider, mirroring the discrete-
  // step feel of the mobile BlockRangeSlider) so it reads as a stepped control, not
  // a freeform drag — every stop is a real, snappable block.
  const ticks: number[] = [];
  for (let i = 0; i <= span; i++) ticks.push((i / span) * 100);

  return (
    <div className="range-slider">
      <div className="range-slider-bounds" aria-hidden="true">
        <span>{blockLabel(startBlock, originMin)}</span>
        <span>{blockLabel(endBlock, originMin)}</span>
      </div>
      <div className="range-slider-track" ref={trackRef}>
        <div
          className="range-slider-fill"
          style={{ left: `${fromPct}%`, width: `${toPct - fromPct}%` }}
        />
        {ticks.map((pct) => (
          <span key={pct} className="range-slider-tick" style={{ left: `${pct}%` }} />
        ))}
        <button
          type="button"
          className="range-thumb"
          style={{ left: `${fromPct}%` }}
          role="slider"
          aria-label="Start time"
          aria-valuemin={startBlock}
          aria-valuemax={toBlock - 1}
          aria-valuenow={fromBlock}
          aria-valuetext={blockLabel(fromBlock, originMin)}
          data-testid="override-range-from-thumb"
          onPointerDown={(e) => {
            e.preventDefault();
            setDrag('from');
          }}
          onKeyDown={onKey('from')}
        >
          <span className="range-thumb-badge" aria-hidden="true">
            {blockLabel(fromBlock, originMin)}
          </span>
        </button>
        <button
          type="button"
          className="range-thumb"
          style={{ left: `${toPct}%` }}
          role="slider"
          aria-label="End time"
          aria-valuemin={fromBlock + 1}
          aria-valuemax={endBlock}
          aria-valuenow={toBlock}
          aria-valuetext={blockLabel(toBlock, originMin)}
          data-testid="override-range-to-thumb"
          onPointerDown={(e) => {
            e.preventDefault();
            setDrag('to');
          }}
          onKeyDown={onKey('to')}
        >
          <span className="range-thumb-badge" aria-hidden="true">
            {blockLabel(toBlock, originMin)}
          </span>
        </button>
      </div>
    </div>
  );
}
