'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { claimBreakBlocks, setBreakOptOut } from '../../lib/actions/worker/breaks';
import type { WorkerBreakBoard } from '../../lib/data/worker/breaks';
import { Button } from '../ui/Button';
import { Notification } from '../ui/Notification';
import { PageHead } from '../ui/PageHead';
import { Toggle } from '../ui/Toggle';

function phaseBanner(phase: string): {
  kind: 'info' | 'success' | 'warning';
  title: string;
  body: string;
} {
  if (phase === 'claim_window') {
    return {
      kind: 'success',
      title: 'Claim window is open',
      body: 'Select the front-desk shifts you want to cover, then claim them. First come, first served.',
    };
  }
  if (phase === 'pre_open') {
    return {
      kind: 'info',
      title: 'Claiming has not opened yet',
      body: 'This break is upcoming. You can review the schedule now and claim once the window opens.',
    };
  }
  return {
    kind: 'warning',
    title: 'Claim window has closed',
    body: 'Any remaining break shifts have moved to the open-shifts feed.',
  };
}

export function BreakClaim({ board }: { board: WorkerBreakBoard }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [optedOut, setOptedOut] = useState(board.optedOut);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);

  const painting = useRef(false);
  const addMode = useRef(true);

  useEffect(() => {
    const stop = () => {
      painting.current = false;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const canClaim = board.claimable && !optedOut;

  const applySelect = useCallback((blockId: string, add: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (add) next.add(blockId);
      else next.delete(blockId);
      return next;
    });
  }, []);

  const onCellDown = useCallback(
    (blockId: string) => {
      if (!canClaim) return;
      const add = !selected.has(blockId);
      addMode.current = add;
      painting.current = true;
      applySelect(blockId, add);
      setResult(null);
    },
    [canClaim, selected, applySelect],
  );

  const onCellEnter = useCallback(
    (blockId: string) => {
      if (!canClaim || !painting.current) return;
      applySelect(blockId, addMode.current);
    },
    [canClaim, applySelect],
  );

  async function onClaim() {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setResult(null);
    const res = await claimBreakBlocks([...selected]);
    setBusy(false);
    if (res.ok) {
      setSelected(new Set());
      setResult({
        kind: 'ok',
        message:
          res.claimed === 0
            ? 'Those shifts were just taken. Nothing was claimed.'
            : `Claimed ${String(res.claimed)} shift${res.claimed === 1 ? '' : 's'}.`,
      });
      router.refresh();
    } else {
      setResult({ kind: 'error', message: res.error });
    }
  }

  async function onToggleOptOut(next: boolean) {
    if (board.break === null || busy) return;
    setBusy(true);
    const res = await setBreakOptOut(board.break.breakId, next);
    setBusy(false);
    if (res.ok) {
      setOptedOut(next);
      setSelected(new Set());
      router.refresh();
    } else {
      setResult({ kind: 'error', message: res.error });
    }
  }

  if (board.break === null) {
    return (
      <div className="page">
        <PageHead eyebrow="Breaks" title="Break coverage" />
        <Notification kind="info" title="No break scheduled" testId="break-none">
          There is no upcoming break right now. Break shifts appear here once your administrator
          declares a break.
        </Notification>
      </div>
    );
  }

  const banner = phaseBanner(board.phase);

  return (
    <div className="page" data-testid="break-claim">
      <PageHead
        eyebrow="Breaks"
        title={board.break.breakName}
        sub={`${board.houseName || 'Your house'} · ${board.break.startDate} to ${board.break.endDate}`}
        actions={
          <label className="pref-optout" data-testid="break-optout">
            <Toggle checked={optedOut} onChange={onToggleOptOut} disabled={busy} />
            No break hours
          </label>
        }
      />

      <Notification kind={banner.kind} title={banner.title} testId="break-phase">
        {banner.body}
      </Notification>
      {result && (
        <Notification
          kind={result.kind === 'ok' ? 'success' : 'error'}
          title={result.kind === 'ok' ? 'Done' : 'Could not claim'}
          testId="break-claim-result"
        >
          {result.message}
        </Notification>
      )}

      {optedOut ? (
        <Notification kind="info" title="You opted out of break hours" testId="break-optout-note">
          Turn off the no-break-hours toggle to claim shifts for this break.
        </Notification>
      ) : (
        <>
          <div className="break-legend">
            <span className="break-legend-item">
              <span className="pref-cell brk-claimable" /> Claimable
            </span>
            <span className="break-legend-item">
              <span className="pref-cell brk-selected" /> Selected
            </span>
            <span className="break-legend-item">
              <span className="pref-cell brk-mine" /> Yours
            </span>
            <span className="break-legend-item">
              <span className="pref-cell brk-full" /> Full
            </span>
          </div>

          <div
            className="pref-grid-wrap"
            data-testid="break-grid"
            style={{ userSelect: 'none', touchAction: 'none' }}
          >
            <div
              className="pref-grid"
              style={{
                gridTemplateColumns: `80px repeat(${String(board.dates.length)}, minmax(64px, 1fr))`,
              }}
            >
              <div className="pref-corner" />
              {board.dateLabels.map((label) => (
                <div key={label} className="pref-dayhead">
                  {label}
                </div>
              ))}

              {board.rows.map((row) => (
                <div key={row.minuteOfDay} style={{ display: 'contents' }}>
                  <div className="pref-time">{row.label}</div>
                  {row.cells.map((cell, col) => {
                    if (cell === null) {
                      return <div key={col} className="pref-cell pref-cell-empty" />;
                    }
                    const isSel = selected.has(cell.blockId);
                    const cls =
                      cell.state === 'mine'
                        ? 'brk-mine'
                        : cell.state === 'full'
                          ? 'brk-full'
                          : isSel
                            ? 'brk-selected'
                            : 'brk-claimable';
                    const selectable = canClaim && cell.state === 'claimable';
                    return (
                      <button
                        key={col}
                        type="button"
                        className={`pref-cell ${cls}`}
                        data-testid={`break-cell-${cell.blockId}`}
                        data-state={cell.state}
                        aria-label={`${board.dateLabels[col]} ${row.label}: ${cell.state}${
                          cell.state === 'claimable' ? `, ${String(cell.vacant)} open` : ''
                        }`}
                        aria-pressed={isSel}
                        disabled={!selectable && cell.state !== 'claimable'}
                        onPointerDown={() => selectable && onCellDown(cell.blockId)}
                        onPointerEnter={() => selectable && onCellEnter(cell.blockId)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="break-claimbar">
            <span className="t-helper" data-testid="break-selected-count">
              {selected.size === 0
                ? 'No shifts selected'
                : `${String(selected.size)} shift${selected.size === 1 ? '' : 's'} selected`}
            </span>
            <Button
              kind="primary"
              iconRight="checkCircle"
              data-testid="break-claim-submit"
              disabled={!canClaim || selected.size === 0 || busy}
              onClick={onClaim}
            >
              {busy ? 'Claiming...' : 'Claim selected'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
