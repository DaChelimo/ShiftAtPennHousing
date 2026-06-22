'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react';

import { clearSimClock, setSimClock } from '../lib/actions/devClock';

// Dev-only time-travel control. Sits left of the HMOD pill. Shows the live
// simulated clock (ticking forward at 1x) and lets you set it to any instant via
// a date/time picker or quick jumps. Setting it writes an offset the website AND
// the orchestrator both read through app_now(), so escalation steps (T-3h
// broadcast, T-2h float lookup, HMOD escalation, T-15m no-ack) fire as simulated
// time crosses each boundary. Rendered only in non-production builds.
//
// The current offset arrives as a prop (server-read each render); after a change
// we router.refresh() so the prop re-flows rather than mirroring it into state.
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
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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
    setPick(toLocalInput(simMs));
    setOpen((o) => !o);
  }

  function apply(targetISO: string) {
    setError(null);
    startTransition(async () => {
      const result = await setSimClock(targetISO);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function jump(deltaMs: number) {
    apply(new Date(simMs + deltaMs).toISOString());
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
      router.refresh();
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
        title="Simulated clock (dev only)"
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
            boxShadow: '0 8px 28px rgba(0,0,0,0.16)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>Simulated clock</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)', lineHeight: 1.4 }}>
            Sets the clock for the whole app and orchestrator, then ticks forward at 1×. Advance one
            trigger boundary at a time (e.g. into T‑2h to watch float lookup).
          </div>

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
              color: 'inherit',
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
              onClick={() => apply(new Date(pick).toISOString())}
              style={{
                ...chipStyle,
                flex: 1,
                background: '#0061FC',
                color: '#fff',
                borderColor: '#0061FC',
                fontWeight: 600,
              }}
            >
              {pending ? 'Setting…' : 'Set time'}
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
        </div>
      )}
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border, #e5e7eb)',
  background: 'var(--surface-2, transparent)',
  color: 'inherit',
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
