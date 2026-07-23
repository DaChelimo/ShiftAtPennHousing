'use client';

// KB intake dev-mode instrumentation panel: the same pipeline metrics that land in
// [kb-intake] server logs and kb_intake.metrics, rendered for an admin reviewing one
// upload. Two independently expandable panels (pipeline log replay + committed
// chunks) so either can fill the page without the other crowding it.

import { type ReactNode, useState } from 'react';

import type { CommittedChunk } from '../../lib/actions/kbIntake';
import type { IntakeMetrics } from '../../lib/kbIntakePipeline';
import { DataTable, IconButton, Tag, type Column, type TagKind } from '../ui';

function formatUsd(v: number): string {
  return `$${v.toFixed(4)}`;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const WINDOW_TAG: Record<string, TagKind> = {
  durable: 'blue',
  expires: 'amber',
  until_superseded: 'green',
};

type LogLine = { indent?: boolean; content: ReactNode };

function buildLogLines(intakeId: string, m: IntakeMetrics, chunks: CommittedChunk[]): LogLine[] {
  const lines: LogLine[] = [];
  if (m.extraction) {
    const e = m.extraction;
    lines.push({
      content: (
        <>
          extraction done: <b className="kb-log-num">{e.pageCount ?? '?'}</b> pages,{' '}
          <b className="kb-log-num">{e.visionCalls}</b> vision call(s),{' '}
          <b className="kb-log-num">{formatDuration(e.durationMs)}</b>,{' '}
          <b className="kb-log-ok">{formatUsd(e.costUsd)}</b>
        </>
      ),
    });
  }
  if (m.propose) {
    const p = m.propose;
    lines.push({
      content: (
        <>
          propose done: <b className="kb-log-num">{formatDuration(p.durationMs)}</b>,{' '}
          <b className="kb-log-num">{p.inputTokens}</b> in /{' '}
          <b className="kb-log-num">{p.outputTokens}</b> out tokens,{' '}
          <b className="kb-log-ok">{formatUsd(p.costUsd)}</b>
        </>
      ),
    });
  }
  if (m.embed) {
    const em = m.embed;
    lines.push({
      content: (
        <>
          embed done: <b className="kb-log-num">{formatDuration(em.durationMs)}</b>,{' '}
          <b className="kb-log-num">{em.tokens}</b> tokens,{' '}
          <b className="kb-log-ok">{formatUsd(em.costUsd)}</b>,{' '}
          <b className="kb-log-num">{em.chunkCount}</b> chunk(s):
        </>
      ),
    });
    chunks.forEach((c, i) => {
      lines.push({
        indent: true,
        content: (
          <>
            chunk {i + 1}/{chunks.length} <span className="kb-log-flag">[{c.temporality}]</span>:{' '}
            {c.content}
          </>
        ),
      });
    });
  }
  if (m.commit) {
    lines.push({
      content: (
        <>
          intake {intakeId} live: document {m.commit.documentId}, total{' '}
          <b className="kb-log-num">{formatDuration(m.totalDurationMs)}</b>, total{' '}
          <b className="kb-log-ok">{formatUsd(m.totalCostUsd)}</b>
        </>
      ),
    });
  }
  return lines;
}

function ExpandablePanel({
  id,
  title,
  count,
  expandedId,
  setExpandedId,
  children,
}: {
  id: string;
  title: string;
  count: string;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  children: ReactNode;
}) {
  const expanded = expandedId === id;
  return (
    <>
      {expanded && <div className="kb-panel-backdrop" onClick={() => setExpandedId(null)} />}
      <div className={`kb-panel ${expanded ? 'is-expanded' : ''}`.trim()}>
        <div className="kb-panel-head">
          <span className="t-label">{title}</span>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <span className="kb-panel-count">{count}</span>
            <IconButton
              icon={expanded ? 'collapse' : 'expand'}
              label={expanded ? 'Minimize' : 'Expand to full page'}
              onClick={() => setExpandedId(expanded ? null : id)}
            />
          </div>
        </div>
        {children}
      </div>
    </>
  );
}

export function IntakeMetricsPanel({
  intakeId,
  status,
  metrics,
  chunks,
}: {
  intakeId: string;
  status: string;
  metrics: IntakeMetrics;
  chunks: CommittedChunk[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const lines = buildLogLines(intakeId, metrics, chunks);
  const visionPages = metrics.extraction
    ? `${metrics.extraction.visionPages}/${metrics.extraction.pageCount ?? '?'}`
    : '—';

  return (
    <div className="col gap-3" data-testid="kb-metrics-panel">
      <div className="statstrip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <MiniStat label="Total duration" value={formatDuration(metrics.totalDurationMs)} />
        <MiniStat label="Total cost" value={formatUsd(metrics.totalCostUsd)} />
        <MiniStat
          label="Chunks written"
          value={String(metrics.embed?.chunkCount ?? chunks.length)}
        />
        <MiniStat label="Vision pages" value={visionPages} />
      </div>

      <div className="kb-metrics-grid">
        <ExpandablePanel
          id="log"
          title="Pipeline log"
          count="[kb-intake]"
          expandedId={expandedId}
          setExpandedId={setExpandedId}
        >
          <div className="kb-log">
            {lines.map((l, i) => (
              <div className={`kb-log-line ${l.indent ? 'is-indent' : ''}`.trim()} key={i}>
                <span className="kb-log-tag">[kb-intake]</span>
                <span className="kb-log-msg">{l.content}</span>
              </div>
            ))}
          </div>
        </ExpandablePanel>

        <ExpandablePanel
          id="chunks"
          title="Chunks committed"
          count="kb_chunks"
          expandedId={expandedId}
          setExpandedId={setExpandedId}
        >
          <div className="kb-chunk-scroll">
            <ChunkTable chunks={chunks} deleted={status === 'deleted'} />
          </div>
        </ExpandablePanel>
      </div>
    </div>
  );
}

function ChunkTable({ chunks, deleted }: { chunks: CommittedChunk[]; deleted: boolean }) {
  if (chunks.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        <span className="t-helper">
          {deleted
            ? 'This document was removed from the knowledge base; its chunks were deleted with it.'
            : 'Not embedded yet. Chunks appear here once the upload is approved.'}
        </span>
      </div>
    );
  }
  const columns: Column<CommittedChunk>[] = [
    {
      key: 'idx',
      header: '#',
      render: (r) => <span className="kb-chunk-idx">{chunks.indexOf(r) + 1}</span>,
    },
    {
      key: 'window',
      header: 'Window',
      render: (r) => (
        <div>
          <Tag kind={WINDOW_TAG[r.temporality] ?? 'gray'}>{r.temporality}</Tag>
          {r.temporality !== 'durable' && (r.effectiveFrom ?? r.effectiveUntil) ? (
            <span className="kb-window-note">
              {r.effectiveFrom ?? '...'} &rarr; {r.effectiveUntil ?? '...'}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'content',
      header: 'Content',
      render: (r) => <span className="kb-chunk-content">{r.content}</span>,
    },
    {
      key: 'tok',
      header: 'Tok',
      numeric: true,
      render: (r) => <span className="kb-chunk-tok">{r.tokenCount ?? '—'}</span>,
    },
  ];
  return (
    <div className="kb-chunk-table">
      <DataTable<CommittedChunk>
        columns={columns}
        rows={chunks}
        getRowKey={(r) => r.content.slice(0, 40)}
      />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="statcard">
      <span className="statcard-num">{value}</span>
      <span className="statcard-label">{label}</span>
    </div>
  );
}
