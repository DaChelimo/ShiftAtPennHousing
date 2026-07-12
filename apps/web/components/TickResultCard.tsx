'use client';

import { useEffect } from 'react';

import type {
  CoverageSpan,
  DeskCoverage,
  FloatCoverage,
  OrchestratorTickSummary,
  TickCoverage,
} from '../lib/actions/devClock';

// Centered modal summarising what a single orchestrator tick did: floats placed,
// desks routed to Allied, seats broadcast for pickup, and floats voided. Blocks
// are merged into contiguous spans. Dev-only; opened after "Run orchestrator now"
// and reopenable from the dev panel. ✕ / click-outside / Esc dismiss it.

type LastTick = { summary: OrchestratorTickSummary; coverage: TickCoverage };

function fmtSpan(s: CoverageSpan): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  };
  const start = new Date(s.startISO).toLocaleTimeString(undefined, opts);
  const end = new Date(s.endISO).toLocaleTimeString(undefined, opts);
  const blocks = `${s.blocks} block${s.blocks === 1 ? '' : 's'}`;
  return `${start} to ${end} (${blocks})`;
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function SpanList({ spans }: { spans: CoverageSpan[] }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      {spans.map((s, i) => (
        <span key={i} style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>
          {fmtDay(s.startISO)} · {fmtSpan(s)}
        </span>
      ))}
    </div>
  );
}

function Section({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: accent }} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {title} ({count})
        </span>
      </div>
      {children}
    </div>
  );
}

function FloatRow({ f }: { f: FloatCoverage }) {
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid var(--border, #e5e7eb)',
        background: 'var(--surface-2, #f9fafb)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>{f.worker}</div>
      <div style={{ fontSize: 12, margin: '2px 0 4px' }}>
        {f.fromHouseName} <span style={{ color: 'var(--text-muted, #6b7280)' }}>to</span>{' '}
        {f.toHouseName}
        {f.status ? (
          <span style={{ color: 'var(--text-muted, #6b7280)' }}> · {f.status.replace(/_/g, ' ')}</span>
        ) : null}
      </div>
      <SpanList spans={f.spans} />
    </div>
  );
}

function DeskRow({ d, verb }: { d: DeskCoverage; verb: string }) {
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid var(--border, #e5e7eb)',
        background: 'var(--surface-2, #f9fafb)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        {d.houseName} <span style={{ color: 'var(--text-muted, #6b7280)', fontWeight: 400 }}>{verb}</span>
      </div>
      <SpanList spans={d.spans} />
    </div>
  );
}

export function TickResultCard({ last, onClose }: { last: LastTick; onClose: () => void }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const { summary, coverage } = last;
  const nothing =
    coverage.floats.length === 0 &&
    coverage.allied.length === 0 &&
    coverage.broadcasts.length === 0 &&
    coverage.voided.length === 0;

  const tickedLabel = new Date(summary.tickedAt).toLocaleString(undefined, {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Orchestrator run result"
      data-testid="tick-result-card"
      onMouseDown={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.32)',
        padding: 16,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          maxHeight: '82vh',
          overflowY: 'auto',
          borderRadius: 14,
          border: '1px solid var(--border, #e5e7eb)',
          background: 'var(--surface, #fff)',
          color: 'var(--text, #111827)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div className="col" style={{ gap: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Orchestrator run</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>{tickedLabel} (NY)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="tick-result-close"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--border, #e5e7eb)',
              background: 'var(--surface-2, #f3f4f6)',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            fontSize: 12,
            color: 'var(--text-muted, #6b7280)',
          }}
        >
          <Chip label={`${summary.blocksScanned} scanned`} />
          <Chip label={`${summary.stepsFired} steps fired`} />
          <Chip label={`${summary.floatsVoided} voided`} />
          <Chip label={`${summary.swapsExpired} swaps expired`} />
        </div>

        {summary.errors.length > 0 && (
          <div
            style={{
              fontSize: 12,
              color: '#b91c1c',
              background: 'rgba(220,38,38,0.08)',
              border: '1px solid rgba(220,38,38,0.25)',
              borderRadius: 8,
              padding: '8px 10px',
            }}
          >
            {summary.errors.join('; ')}
          </div>
        )}

        {nothing ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted, #6b7280)' }}>
            No coverage actions this tick. Nothing crossed an escalation boundary.
          </div>
        ) : (
          <div className="col" style={{ gap: 16 }}>
            <Section title="Floats placed" count={coverage.floats.length} accent="#0061FC">
              <div className="col" style={{ gap: 8 }}>
                {coverage.floats.map((f, i) => (
                  <FloatRow key={i} f={f} />
                ))}
              </div>
            </Section>

            <Section title="Routed to Allied" count={coverage.allied.length} accent="#b45309">
              <div className="col" style={{ gap: 8 }}>
                {coverage.allied.map((d, i) => (
                  <DeskRow key={i} d={d} verb="to Allied" />
                ))}
              </div>
            </Section>

            <Section title="Broadcast for pickup" count={coverage.broadcasts.length} accent="#15803d">
              <div className="col" style={{ gap: 8 }}>
                {coverage.broadcasts.map((d, i) => (
                  <DeskRow key={i} d={d} verb="opened for pickup" />
                ))}
              </div>
            </Section>

            <Section title="Floats voided" count={coverage.voided.length} accent="#6b7280">
              <div className="col" style={{ gap: 4 }}>
                {coverage.voided.map((v, i) => (
                  <span key={i} style={{ fontSize: 12 }}>
                    {v.worker}
                    {v.toHouseName ? ` · was covering ${v.toHouseName}` : ''}
                  </span>
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span
      style={{
        padding: '3px 8px',
        borderRadius: 999,
        border: '1px solid var(--border, #e5e7eb)',
        background: 'var(--surface-2, #f3f4f6)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {label}
    </span>
  );
}
