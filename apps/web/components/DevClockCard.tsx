'use client';

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react';

import {
  clearSimClock,
  runOrchestratorTick,
  setSimClock,
  type OrchestratorTickSummary,
  type TickCoverage,
} from '../lib/actions/devClock';

import { TickResultCard } from './TickResultCard';

type LastTick = { summary: OrchestratorTickSummary; coverage: TickCoverage };
const LAST_TICK_KEY = 'shift.devclock.lastTick';

// Read the persisted last run (client-only; returns null during SSR).
function readStoredLastTick(): LastTick | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_TICK_KEY);
    return raw ? (JSON.parse(raw) as LastTick) : null;
  } catch {
    return null;
  }
}

// Simulated-clock control, admin-only in every environment including production
// (BSpec §14; the parent layout only passes a non-null `offsetSeconds` prop for the
// project administrator, and the DB additionally enforces this at the row level —
// see dev_sim_clock_admin_gate, migration 20260805000001). Sits left of the HMOD
// pill. Shows the live simulated clock (ticking forward at 1x) and lets you set it
// to any instant via a date/time picker or quick jumps, behind a confirm step
// since this moves the clock for every user, not just the operator's own view.
// Setting it writes an offset the website AND the orchestrator both read through
// app_now(), so escalation steps (T-3h broadcast, T-2h float lookup, HMOD
// escalation, T-15m no-ack) fire as simulated time crosses each boundary.
//
// The current offset arrives as a prop (server-read each render); every action here
// calls revalidatePath('/', 'layout') server-side, and Next streams the re-rendered
// tree back as part of the action response, so the prop re-flows on its own. Do NOT
// add a router.refresh() on top of that: it is a SECOND full RSC fetch of the same
// tree, and it is what made one button press re-render the whole admin shell twice
// (four times for set-clock-then-tick) against a hosted database.
// Live "now" comes from the ticking `nowMs` state, never a render-time Date.now().

const SECOND = 1000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Format an instant as a <input type="datetime-local"> value in the browser's
// local zone (round-trips with `new Date(value)`).
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const JUMPS: { label: string; ms: number }[] = [
  { label: '−1h', ms: -60 * 60 * SECOND },
  { label: '+15m', ms: 15 * 60 * SECOND },
  { label: '+1h', ms: 60 * 60 * SECOND },
  { label: '+3h', ms: 3 * 60 * 60 * SECOND },
  { label: '+1d', ms: 24 * 60 * 60 * SECOND },
];

// 1-second wall-clock tick as an external store (the AppShell theme pattern), so
// the live display reads it via useSyncExternalStore rather than a setState-in-
// effect. The snapshot is cached (only changes on tick) so React stays stable;
// the server snapshot is 0, which renders the "—" placeholder until mount.
let tickValue = 0;
function subscribeTick(onChange: () => void): () => void {
  tickValue = Date.now();
  onChange();
  const t = setInterval(() => {
    tickValue = Date.now();
    onChange();
  }, SECOND);
  return () => clearInterval(t);
}
function getTickSnapshot(): number {
  return tickValue;
}
function getTickServerSnapshot(): number {
  return 0;
}

export function DevClockCard({ offsetSeconds }: { offsetSeconds: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState<{ ok: boolean; text: string } | null>(null);
  // A staged target awaiting the "you're about to change production time" warning.
  // null = no confirmation pending. Reset (back to real time) never goes through this —
  // only a move AWAY from real time needs the operator to stop and confirm.
  const [confirmTargetISO, setConfirmTargetISO] = useState<string | null>(null);
  // Lazy-init from storage so the card can be reopened across refreshes/reloads.
  const [lastTick, setLastTick] = useState<LastTick | null>(readStoredLastTick);
  const [cardOpen, setCardOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [ticking, startTick] = useTransition();
  const nowMs = useSyncExternalStore(subscribeTick, getTickSnapshot, getTickServerSnapshot);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const simMs = nowMs + offsetSeconds * SECOND;
  const active = Math.abs(offsetSeconds) >= 1;

  function openPanel() {
    setError(null);
    setConfirmTargetISO(null);
    setPick(toLocalInput(simMs));
    setOpen((o) => !o);
  }

  // The actual write, run only after the warning has been confirmed (or skipped,
  // for a reset back to real time — see reset() below).
  function apply(targetISO: string) {
    setError(null);
    startTransition(async () => {
      const result = await setSimClock(targetISO);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmTargetISO(null);
      setOpen(false);
    });
  }

  // "Set time" and the quick jumps stage the change and surface the warning instead
  // of writing immediately — moving this clock moves every escalation deadline in the
  // system, production included, for every user, not just the operator's own view.
  function requestApply(targetISO: string) {
    setError(null);
    setConfirmTargetISO(targetISO);
  }

  function jump(deltaMs: number) {
    requestApply(new Date(simMs + deltaMs).toISOString());
  }

  function reset() {
    setError(null);
    startTransition(async () => {
      const result = await clearSimClock();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  function runTick() {
    setError(null);
    startTick(async () => {
      const result = await runOrchestratorTick();
      if (!result.ok) {
        setTick({ ok: false, text: result.error });
        return;
      }
      setTick({ ok: true, text: summarizeTick(result.summary) });
      const next: LastTick = { summary: result.summary, coverage: result.coverage };
      setLastTick(next);
      setCardOpen(true);
      try {
        localStorage.setItem(LAST_TICK_KEY, JSON.stringify(next));
      } catch {
        // ignore storage failures
      }
    });
  }

  const accent = active ? '#b45309' : 'var(--text-muted, #6b7280)';
  const dateLabel =
    nowMs === 0
      ? '—'
      : new Date(simMs).toLocaleString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

  return (
    <div ref={ref} className="hdr-nonessential" style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="dev-clock-pill"
        onClick={openPanel}
        aria-label="Simulated clock"
        aria-expanded={open}
        title="Simulated clock (project administrator only)"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          borderRadius: 8,
          border: `1px solid ${active ? '#f59e0b' : 'var(--border, #e5e7eb)'}`,
          background: active ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
          cursor: 'pointer',
          font: 'inherit',
          lineHeight: 1.1,
        }}
      >
        <ClockGlyph color={accent} />
        <span className="col" style={{ lineHeight: 1.1, alignItems: 'flex-start', minWidth: 96 }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4, color: accent }}>
            {active ? 'SIM TIME' : 'LIVE'}
          </span>
          <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{dateLabel}</span>
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Set simulated clock"
          data-testid="dev-clock-panel"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 50,
            width: 280,
            padding: 12,
            borderRadius: 10,
            border: '1px solid var(--border, #e5e7eb)',
            background: 'var(--surface, #fff)',
            color: 'var(--text, #111827)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.16)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>Simulated clock</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)', lineHeight: 1.4 }}>
            Sets the clock for the whole app and orchestrator, in every environment including
            production, then ticks forward at 1×. Advance one trigger boundary at a time (e.g. into
            T‑2h to watch float lookup).
          </div>

          {confirmTargetISO !== null ? (
            <div
              data-testid="dev-clock-warning"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 10,
                borderRadius: 8,
                border: '1px solid #f59e0b',
                background: 'rgba(245, 158, 11, 0.12)',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: '#b45309' }}>
                You&rsquo;re about to change production time
              </div>
              <div style={{ fontSize: 11, lineHeight: 1.4 }}>
                This moves every escalation deadline in the system (broadcasts, float lookup, Allied
                notifications) for every user, immediately — not just your own view. Reset back to
                real time is always available if you change your mind.
              </div>
              <div style={{ fontSize: 12, fontWeight: 500 }}>
                New simulated time: {new Date(confirmTargetISO).toLocaleString()}
              </div>
              {error && <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={pending}
                  data-testid="dev-clock-confirm"
                  onClick={() => apply(confirmTargetISO)}
                  style={{
                    ...chipStyle,
                    flex: 1,
                    background: '#b45309',
                    color: '#fff',
                    borderColor: '#b45309',
                    fontWeight: 600,
                  }}
                >
                  {pending ? 'Setting…' : 'Yes, change simulated time'}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  data-testid="dev-clock-cancel"
                  onClick={() => {
                    setError(null);
                    setConfirmTargetISO(null);
                  }}
                  style={chipStyle}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <input
                type="datetime-local"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                data-testid="dev-clock-input"
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #e5e7eb)',
                  background: 'var(--surface, #fff)',
                  color: 'var(--text, #111827)',
                  font: 'inherit',
                  fontSize: 13,
                }}
              />

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {JUMPS.map((j) => (
                  <button
                    key={j.label}
                    type="button"
                    disabled={pending}
                    onClick={() => jump(j.ms)}
                    style={chipStyle}
                  >
                    {j.label}
                  </button>
                ))}
              </div>

              {error && <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={pending || pick === ''}
                  data-testid="dev-clock-set"
                  onClick={() => requestApply(new Date(pick).toISOString())}
                  style={{
                    ...chipStyle,
                    flex: 1,
                    background: '#0061FC',
                    color: '#fff',
                    borderColor: '#0061FC',
                    fontWeight: 600,
                  }}
                >
                  Set time
                </button>
                <button
                  type="button"
                  disabled={pending || !active}
                  data-testid="dev-clock-reset"
                  onClick={reset}
                  style={{ ...chipStyle, opacity: active ? 1 : 0.5 }}
                >
                  Reset
                </button>
              </div>
            </>
          )}

          <div style={{ height: 1, background: 'var(--border, #e5e7eb)', margin: '2px 0' }} />

          <div style={{ fontWeight: 600, fontSize: 13 }}>Orchestrator</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)', lineHeight: 1.4 }}>
            Runs the escalation tick now. Set the clock into a boundary, then tick to fire broadcast
            / float lookup / no-ack void at the simulated instant. It also auto-runs every minute
            wherever the orchestrator-tick cron is registered (check verify_scheduled_jobs; local
            dev deliberately has no cron and is manual-only).
          </div>
          <button
            type="button"
            disabled={ticking}
            data-testid="dev-clock-tick"
            onClick={runTick}
            style={{
              ...chipStyle,
              background: '#0061FC',
              color: '#fff',
              borderColor: '#0061FC',
              fontWeight: 600,
            }}
          >
            {ticking ? 'Running…' : 'Run orchestrator now'}
          </button>
          {tick && (
            <div
              data-testid="dev-clock-tick-result"
              style={{ fontSize: 11, lineHeight: 1.4, color: tick.ok ? '#15803d' : '#dc2626' }}
            >
              {tick.text}
            </div>
          )}
          {lastTick && (
            <button
              type="button"
              data-testid="dev-clock-view-last"
              onClick={() => {
                setCardOpen(true);
                setOpen(false);
              }}
              style={chipStyle}
            >
              View last run
            </button>
          )}
        </div>
      )}

      {cardOpen && lastTick && (
        <TickResultCard last={lastTick} onClose={() => setCardOpen(false)} />
      )}
    </div>
  );
}

// One-line outcome of a tick for the panel — counts plus any errors.
function summarizeTick(s: OrchestratorTickSummary): string {
  const base = `Ticked · ${s.blocksScanned} scanned · ${s.stepsFired} fired · ${s.floatsVoided} voided · ${s.swapsExpired} swaps expired`;
  return s.errors.length ? `${base} · ${s.errors.length} error(s): ${s.errors.join('; ')}` : base;
}

const chipStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border, #e5e7eb)',
  background: 'var(--surface-2, #f3f4f6)',
  color: 'var(--text, #111827)',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
};

function ClockGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" />
      <path d="M12 7v5l3 2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
