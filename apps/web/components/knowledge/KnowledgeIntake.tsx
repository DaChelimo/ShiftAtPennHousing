'use client';

// KB Intake admin surface (INTAKE_PLAN Phase 3 + section 6.2): stat dashboard, the
// upload control, the live-status queue, and the review panel. Status labels are the
// operator-facing ones from the spec (no em/en dashes per project copy rule).

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import {
  approveIntake,
  getIntakeStatus,
  loadIntakeDetail,
  rejectIntake,
  uploadForIntake,
  type IntakeDetail,
  type IntakeQueue,
  type IntakeRow,
} from '../../lib/actions/kbIntake';
import type { KbIntakeStreamEvent } from '../../lib/kbIntakePipeline';
import {
  Button,
  Card,
  DataTable,
  Field,
  Icon,
  IconButton,
  Notification,
  Select,
  Tag,
  TextArea,
  TextInput,
  type Column,
  type TagKind,
} from '../ui';

import { DeleteDocumentControl } from './DeleteDocumentControl';
import { IntakeMetricsPanel } from './IntakeMetricsPanel';

const STATUS_LABEL: Record<string, string> = {
  uploaded: 'Uploaded',
  normalizing: 'Reading document',
  proposed: 'Ready for review',
  in_review: 'In review',
  approved: 'Approving',
  embedding: 'Adding to knowledge base',
  live: 'Live',
  rejected: 'Rejected',
  failed: 'Needs attention',
  deleted: 'Removed',
};

const STATUS_TAG_KIND: Record<string, TagKind> = {
  live: 'green',
  proposed: 'amber',
  in_review: 'amber',
  failed: 'red',
  rejected: 'gray',
  deleted: 'gray',
  uploaded: 'blue',
  normalizing: 'blue',
  embedding: 'blue',
  approved: 'blue',
};

const BUSY_STATUSES = ['uploaded', 'normalizing', 'embedding', 'approved'];

function StatusTag({ status }: { status: string }) {
  const busy = BUSY_STATUSES.includes(status);
  const icon =
    !busy && status === 'live'
      ? 'checkCircle'
      : !busy && status === 'failed'
        ? 'warnFill'
        : undefined;
  return (
    <Tag kind={STATUS_TAG_KIND[status] ?? 'gray'} dot={busy} icon={icon}>
      {STATUS_LABEL[status] ?? status}
    </Tag>
  );
}

type UploadStage = 'queued' | 'uploading' | 'processing' | 'done' | 'error';

// The 4 pipeline steps a card's progress rail tracks (upload -> extract -> propose
// -> ready). Extraction fans out per-page (see PageProgress); propose stays one
// step because it's a single holistic call over every page's combined text.
const UPLOAD_STEPS = ['Upload', 'Extract', 'Propose', 'Ready'] as const;

type PageStatus = 'pending' | 'active' | 'done' | 'error';

type PageProgress = {
  page: number;
  status: PageStatus;
  method?: 'text' | 'vision';
  preview?: string;
  message?: string;
};

type UploadItem = {
  id: string;
  file: File;
  stage: UploadStage;
  step: number; // index into UPLOAD_STEPS the progress rail highlights
  detail: string;
  error?: string;
  startedAt: number;
  pages: PageProgress[];
  proposeText: string;
};

let uploadItemSeq = 0;

// Consumes the streaming intake route (NDJSON, one JSON event per line) --
// same wire shape the route writes, see lib/kbIntakePipeline.ts. Calls
// onEvent for each parsed line as it arrives so the caller can update the
// card live instead of waiting for the whole pipeline to finish.
async function streamProcessIntake(
  intakeId: string,
  onEvent: (event: KbIntakeStreamEvent) => void,
): Promise<void> {
  const res = await fetch('/api/kb-intake/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intakeId }),
  });
  if (res.body === null) throw new Error('No response body from the processing stream.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() === '') continue;
      try {
        onEvent(JSON.parse(line) as KbIntakeStreamEvent);
      } catch {
        /* malformed line -- skip rather than kill the whole stream read */
      }
    }
  }
}

function stepForErrorStep(step: Extract<KbIntakeStreamEvent, { t: 'error' }>['step']): number {
  if (step === 'propose') return 2;
  if (step === 'download' || step === 'extract' || step === 'normalize') return 1;
  return 0;
}

export type HouseOption = { id: string; name: string };

export function KnowledgeIntake({
  initial,
  houses,
}: {
  initial: IntakeQueue;
  houses: HouseOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<IntakeDetail | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Approximate the live queue by refreshing while anything is mid-pipeline. A Supabase
  // Realtime subscription is the follow-on; polling keeps the status honest for v1.
  const inFlight = initial.rows.some((r) => BUSY_STATUSES.includes(r.status));
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [inFlight, router]);

  const refresh = () => startTransition(() => router.refresh());

  // Ticks once a second while anything is mid-upload, so each card's elapsed-time
  // readout (now - item.startedAt) stays live. `now` is state set from an effect,
  // never read via a bare Date.now() call during render.
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!isUploading) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isUploading]);

  function addFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length === 0) return;
    setUploads((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: `u${uploadItemSeq++}`,
        file,
        stage: 'queued' as const,
        step: 0,
        detail: 'Waiting',
        startedAt: 0,
        pages: [] as PageProgress[],
        proposeText: '',
      })),
    ]);
  }

  function patchUpload(id: string, patch: Partial<UploadItem>) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  function updateUpload(id: string, updater: (u: UploadItem) => UploadItem) {
    setUploads((prev) => prev.map((u) => (u.id === id ? updater(u) : u)));
  }

  // Maps one stream event onto the card's live state -- this is what makes
  // extraction and proposal drafting visible instead of an opaque spinner.
  function applyStreamEvent(id: string, event: KbIntakeStreamEvent) {
    switch (event.t) {
      case 'download-start':
        updateUpload(id, (u) => ({ ...u, step: 1, detail: 'Downloading the uploaded file' }));
        break;
      case 'extract-start':
        updateUpload(id, (u) => ({
          ...u,
          step: 1,
          detail: `Reading ${event.totalPages} page${event.totalPages === 1 ? '' : 's'}`,
          pages: Array.from({ length: event.totalPages }, (_, i) => ({
            page: i + 1,
            status: 'pending' as const,
          })),
        }));
        break;
      case 'page-start':
        updateUpload(id, (u) => ({
          ...u,
          pages: u.pages.map((p) => (p.page === event.page ? { ...p, status: 'active' } : p)),
        }));
        break;
      case 'page-done':
        updateUpload(id, (u) => ({
          ...u,
          pages: u.pages.map((p) =>
            p.page === event.page
              ? { ...p, status: 'done', method: event.method, preview: event.preview }
              : p,
          ),
        }));
        break;
      case 'page-error':
        updateUpload(id, (u) => ({
          ...u,
          pages: u.pages.map((p) =>
            p.page === event.page ? { ...p, status: 'error', message: event.message } : p,
          ),
        }));
        break;
      case 'extract-done':
        updateUpload(id, (u) => ({
          ...u,
          detail:
            event.visionPages > 0
              ? `Extracted ${event.totalPages} page(s), ${event.visionPages} via image transcription`
              : `Extracted ${event.totalPages} page(s)`,
        }));
        break;
      case 'propose-start':
        updateUpload(id, (u) => ({
          ...u,
          step: 2,
          detail: 'Combining pages into one proposal with the assistant',
          proposeText: '',
        }));
        break;
      case 'propose-delta':
        updateUpload(id, (u) => ({ ...u, proposeText: u.proposeText + event.text }));
        break;
      case 'propose-done':
        updateUpload(id, (u) => ({ ...u, detail: 'Checking the drafted proposal' }));
        break;
      case 'result':
        updateUpload(id, (u) => ({ ...u, stage: 'done', step: 3, detail: 'Ready for review' }));
        break;
      case 'error':
        updateUpload(id, (u) => ({
          ...u,
          stage: 'error',
          step: stepForErrorStep(event.step),
          error: event.message,
        }));
        break;
    }
  }

  async function startUpload() {
    setIsUploading(true);
    try {
      // Sequential: every file drives the same normalize -> propose (Claude)
      // pipeline, so a small queue keeps per-file status readable instead of a
      // burst of concurrent proposals racing each other on the server. Within
      // one file's pipeline, page extraction itself IS parallelized server-side
      // (see runIntakePipeline) -- this loop is about not racing multiple
      // documents' proposals against each other, not about extraction speed.
      for (const item of uploads) {
        if (item.stage !== 'queued') continue;
        patchUpload(item.id, {
          stage: 'uploading',
          step: 0,
          detail: 'Uploading file',
          startedAt: Date.now(),
        });

        try {
          const form = new FormData();
          form.set('file', item.file);
          const res = await uploadForIntake(form);
          if (!res.ok) {
            patchUpload(item.id, { stage: 'error', error: res.error });
            continue;
          }
          const { intakeId } = res.data;
          patchUpload(item.id, { stage: 'processing', step: 1, detail: 'Starting...' });

          let sawTerminalEvent = false;
          await streamProcessIntake(intakeId, (event) => {
            applyStreamEvent(item.id, event);
            if (event.t === 'result' || event.t === 'error') sawTerminalEvent = true;
          });

          if (!sawTerminalEvent) {
            // The stream ended (connection dropped, server restarted mid-run)
            // without ever telling us it finished -- fall back to the row's
            // real status so the card reflects the truth instead of freezing
            // on its last-seen step forever.
            const final = await getIntakeStatus(intakeId);
            if (final.ok && final.data.status === 'proposed') {
              patchUpload(item.id, { stage: 'done', step: 3, detail: 'Ready for review' });
            } else if (final.ok && final.data.status === 'failed') {
              patchUpload(item.id, {
                stage: 'error',
                error: final.data.statusDetail ?? 'Processing stopped unexpectedly.',
              });
            } else {
              patchUpload(item.id, {
                stage: 'error',
                error: 'Lost connection to the processing stream.',
              });
            }
          }
        } catch (err) {
          patchUpload(item.id, {
            stage: 'error',
            error: err instanceof Error ? err.message : 'Upload failed unexpectedly',
          });
        }
      }
    } finally {
      // Always reached even if a file's error path above rethrew somehow -- an
      // upload must never leave the button stuck on "Uploading...".
      setIsUploading(false);
      refresh();
    }
  }

  const removeUpload = (id: string) => setUploads((prev) => prev.filter((u) => u.id !== id));
  const clearFinished = () =>
    setUploads((prev) => prev.filter((u) => u.stage === 'queued' || u.stage === 'uploading'));

  async function openReview(intakeId: string) {
    setQueueError(null);
    const res = await loadIntakeDetail(intakeId);
    if (res.ok) {
      setSelected(res.data);
    } else {
      // e.g. the row was deleted server-side since this page last loaded --
      // refresh the queue so the stale row disappears instead of leaving the
      // click looking like it silently did nothing.
      setQueueError(`Could not open this document: ${res.error}`);
      refresh();
    }
  }

  async function retryIntake(intakeId: string) {
    setQueueError(null);
    startTransition(async () => {
      let failureMessage: string | null = null;
      try {
        await streamProcessIntake(intakeId, (event) => {
          if (event.t === 'error') failureMessage = event.message;
        });
      } catch (err) {
        failureMessage = err instanceof Error ? err.message : 'Retry failed unexpectedly';
      }
      if (failureMessage !== null) setQueueError(`Retry failed: ${failureMessage}`);
      router.refresh();
    });
  }

  async function onApprove(finalProposed: NonNullable<IntakeDetail['proposed']>) {
    if (selected === null) return;
    setBusy(true);
    await approveIntake(selected.intakeId, finalProposed);
    setBusy(false);
    setSelected(null);
    refresh();
  }

  async function onReject() {
    if (selected === null) return;
    setBusy(true);
    await rejectIntake(selected.intakeId);
    setBusy(false);
    setSelected(null);
    refresh();
  }

  const queuedCount = uploads.filter((u) => u.stage === 'queued').length;
  const doneCount = uploads.filter((u) => u.stage === 'done').length;
  const totalCount = uploads.length;
  const hasFinished = uploads.some((u) => u.stage === 'done' || u.stage === 'error');

  const columns: Column<IntakeRow>[] = [
    {
      key: 'filename',
      header: 'Document',
      render: (r) => (
        <div className="row gap-2">
          <Icon name="doc" size={16} style={{ color: 'var(--text-secondary)' }} />
          <span>{r.filename}</span>
        </div>
      ),
    },
    {
      key: 'format',
      header: 'Format',
      render: (r) => <Tag kind="outline">{r.format.toUpperCase()}</Tag>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div className="col gap-1">
          <StatusTag status={r.status} />
          {r.status === 'failed' && r.statusDetail ? (
            <span className="t-helper" style={{ color: 'var(--st-danger)' }}>
              {r.statusDetail}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.status === 'proposed' || r.status === 'in_review' ? (
          <Button
            kind="tertiary"
            size="sm"
            onClick={() => openReview(r.intakeId)}
            data-testid="kb-review-open"
          >
            Review
          </Button>
        ) : r.status === 'failed' ? (
          <Button kind="tertiary" size="sm" icon="refresh" onClick={() => retryIntake(r.intakeId)}>
            Retry
          </Button>
        ) : r.status === 'live' ? (
          <div className="row gap-2">
            <Button
              kind="tertiary"
              size="sm"
              onClick={() => openReview(r.intakeId)}
              data-testid="kb-details-open"
            >
              Details
            </Button>
            <DeleteDocumentControl intakeId={r.intakeId} title={r.filename} />
          </div>
        ) : r.status === 'deleted' ? (
          <Button
            kind="tertiary"
            size="sm"
            onClick={() => openReview(r.intakeId)}
            data-testid="kb-details-open"
          >
            Details
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="col gap-5">
      <div className="statstrip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat label="Awaiting review" value={initial.counts.awaitingReview} />
        <Stat label="Live documents" value={initial.kb.documents} />
        <Stat label="Chunks indexed" value={initial.kb.chunks} />
        <Stat label="Needs attention" value={initial.counts.needsAttention} danger />
      </div>

      <Card pad data-testid="kb-upload-card">
        <div className="col gap-3">
          <div className="row gap-2 between">
            <span className="t-h3">Upload documents</span>
            <span className="t-helper">.md, .txt, or .pdf, select or drop several at once</span>
          </div>

          <div
            className={`dropzone ${isDragging ? 'is-dragging' : ''}`.trim()}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            role="button"
            tabIndex={0}
            data-testid="kb-dropzone"
          >
            <Icon name="upload" size={24} className="dropzone-icon" />
            <span className="t-body">Drag files here, or click to browse</span>
            <span className="t-helper">Multiple files are queued and uploaded in order</span>
            <input
              ref={inputRef}
              type="file"
              name="file"
              accept=".md,.markdown,.txt,.pdf"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
              data-testid="kb-upload-input"
            />
          </div>

          {uploads.length > 0 && (
            <div className="upload-card-grid">
              {uploads.map((u) => (
                <UploadFileCard key={u.id} item={u} now={now} onRemove={() => removeUpload(u.id)} />
              ))}
            </div>
          )}

          <div className="row gap-2 between">
            <span className="t-helper">
              {totalCount === 0
                ? 'No files selected'
                : `${doneCount} of ${totalCount} uploaded${
                    queuedCount > 0 ? `, ${queuedCount} waiting` : ''
                  }`}
            </span>
            <div className="row gap-2">
              {hasFinished && !isUploading && (
                <Button kind="tertiary" onClick={clearFinished}>
                  Clear finished
                </Button>
              )}
              <Button kind="secondary" icon="refresh" onClick={refresh} disabled={pending}>
                Refresh
              </Button>
              <Button
                kind="primary"
                icon="upload"
                onClick={startUpload}
                disabled={isUploading || queuedCount === 0}
                data-testid="kb-upload-submit"
              >
                {isUploading
                  ? 'Uploading...'
                  : `Upload ${queuedCount > 0 ? queuedCount : ''} document${
                      queuedCount === 1 ? '' : 's'
                    }`.trim()}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="col gap-3">
        <span className="t-h3">Intake queue</span>
        {queueError !== null && (
          <Notification kind="error" title="Something went wrong" testId="kb-queue-error">
            {queueError}
          </Notification>
        )}
        <div data-testid="kb-queue">
          <DataTable<IntakeRow>
            columns={columns}
            rows={initial.rows}
            getRowKey={(r) => r.intakeId}
            emptyText="No documents yet. Upload a guide, binder page, or email to begin."
          />
        </div>
      </div>

      {selected?.proposed && selected.status !== 'live' && selected.status !== 'deleted' ? (
        <>
          <ReviewPanel
            key={selected.intakeId}
            detail={selected}
            busy={busy}
            houses={houses}
            onChange={(proposed) => setSelected({ ...selected, proposed })}
            onApprove={onApprove}
            onReject={onReject}
            onClose={() => setSelected(null)}
          />
          {selected.metrics ? (
            <Card pad data-testid="kb-metrics-card">
              <div className="col gap-4">
                <span className="t-h3">Pipeline metrics so far</span>
                <IntakeMetricsPanel
                  intakeId={selected.intakeId}
                  status={selected.status}
                  metrics={selected.metrics}
                  chunks={selected.chunks}
                />
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {selected &&
      (selected.status === 'live' || selected.status === 'deleted') &&
      selected.metrics ? (
        <Card pad data-testid="kb-metrics-card">
          <div className="col gap-4">
            <div className="row gap-2 between">
              <span className="t-h2">
                Pipeline metrics: {selected.proposed?.title ?? selected.intakeId}
              </span>
              <div className="row gap-2" style={{ alignItems: 'center' }}>
                {selected.status === 'live' && (
                  <DeleteDocumentControl
                    intakeId={selected.intakeId}
                    title={selected.proposed?.title ?? selected.intakeId}
                    onDeleted={() => setSelected(null)}
                  />
                )}
                <IconButton icon="close" label="Close" onClick={() => setSelected(null)} />
              </div>
            </div>
            {selected.status === 'deleted' && (
              <Notification
                kind="warning"
                title="Removed from the knowledge base"
                testId="kb-deleted-note"
              >
                This document&apos;s chunks were deleted. The metrics below are kept for reference.
              </Notification>
            )}
            <IntakeMetricsPanel
              intakeId={selected.intakeId}
              status={selected.status}
              metrics={selected.metrics}
              chunks={selected.chunks}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="statcard">
      <span
        className="statcard-num"
        style={{ color: danger && value > 0 ? 'var(--st-danger)' : undefined }}
      >
        {value}
      </span>
      <span className="statcard-label">{label}</span>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function UploadFileCard({
  item,
  now,
  onRemove,
}: {
  item: UploadItem;
  now: number;
  onRemove: () => void;
}) {
  const elapsed = item.startedAt > 0 && now > 0 ? formatElapsed(now - item.startedAt) : null;
  const icon =
    item.stage === 'done'
      ? 'checkCircle'
      : item.stage === 'error'
        ? 'warnFill'
        : item.stage === 'queued'
          ? 'doc'
          : null;
  const iconColor =
    item.stage === 'done'
      ? 'var(--st-float-fg)'
      : item.stage === 'error'
        ? 'var(--st-danger)'
        : 'var(--text-secondary)';

  return (
    <div className={`upload-card upload-card-${item.stage}`} data-testid="kb-upload-row">
      <div className="row gap-2 between">
        <div className="row gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
          {icon !== null ? (
            <Icon name={icon} size={15} style={{ color: iconColor, flexShrink: 0 }} />
          ) : (
            <span className="spinner" aria-hidden="true" />
          )}
          <span className="upload-card-name t-body">{item.file.name}</span>
        </div>
        <div className="row gap-2" style={{ alignItems: 'center', flexShrink: 0 }}>
          {elapsed !== null && item.stage !== 'queued' && (
            <span className="t-helper upload-card-elapsed">{elapsed}</span>
          )}
          {item.stage === 'queued' && <IconButton icon="close" label="Remove" onClick={onRemove} />}
        </div>
      </div>

      {item.stage !== 'queued' && (
        <div className="upload-steps" aria-hidden="true">
          {UPLOAD_STEPS.map((label, i) => {
            const state =
              item.stage === 'error' && i === item.step
                ? 'error'
                : item.stage === 'done' || i < item.step
                  ? 'done'
                  : i === item.step
                    ? 'active'
                    : 'pending';
            return (
              <div className={`upload-step is-${state}`} key={label}>
                <span className="upload-step-dot" />
                <span className="upload-step-label">{label}</span>
              </div>
            );
          })}
        </div>
      )}

      <span
        className="t-helper"
        style={item.stage === 'error' ? { color: 'var(--st-danger)' } : undefined}
      >
        {item.stage === 'queued' && 'Waiting to upload'}
        {item.stage === 'error' && (item.error ?? 'Something went wrong')}
        {(item.stage === 'uploading' || item.stage === 'processing' || item.stage === 'done') &&
          item.detail}
      </span>

      {item.pages.length > 0 && (
        <div className="upload-pages">
          {item.pages.map((p) => (
            <div className={`upload-page upload-page-${p.status}`} key={p.page}>
              <span className="upload-page-icon" aria-hidden="true">
                {p.status === 'done' && (
                  <Icon name="checkCircle" size={12} style={{ color: 'var(--st-float-fg)' }} />
                )}
                {p.status === 'error' && (
                  <Icon name="warnFill" size={12} style={{ color: 'var(--st-danger)' }} />
                )}
                {p.status === 'active' && <span className="spinner spinner-sm" />}
                {p.status === 'pending' && <span className="upload-page-dot" />}
              </span>
              <span className="upload-page-label">
                Page {p.page}
                {p.method === 'vision' && ' (image transcription)'}
              </span>
              {p.status === 'done' && p.preview !== undefined && p.preview !== '' && (
                <span className="upload-page-preview">&quot;{p.preview}&quot;</span>
              )}
              {p.status === 'error' && p.message !== undefined && (
                <span className="upload-page-preview upload-page-error-msg">{p.message}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {item.proposeText.length > 0 && (
        <div className="upload-propose-live">
          <span className="upload-propose-live-label">Drafting proposal live</span>
          <div className="upload-propose-live-body">{item.proposeText}</div>
        </div>
      )}
    </div>
  );
}

function ReviewPanel({
  detail,
  busy,
  houses,
  onChange,
  onApprove,
  onReject,
  onClose,
}: {
  detail: IntakeDetail;
  busy: boolean;
  houses: HouseOption[];
  onChange: (proposed: NonNullable<IntakeDetail['proposed']>) => void;
  onApprove: (finalProposed: NonNullable<IntakeDetail['proposed']>) => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const p = detail.proposed!;
  const set = (patch: Partial<typeof p>) => onChange({ ...p, ...patch });

  // Deletion is a soft mark, not a splice: a deleted chunk stays in p.items
  // (and can be un-deleted) so it's tracked by its position in that array,
  // not removed from it. Items carry no stable id from the pipeline, so
  // content edits are still keyed by object identity against p.items.
  const [deletedIndices, setDeletedIndices] = useState<Set<number>>(new Set());
  const toggleDeleted = (idx: number) =>
    setDeletedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  // Only one group's full-page view is open at a time -- opening the other
  // closes this one, same as the pipeline-log / chunks-committed panels below.
  const [expandedGroup, setExpandedGroup] = useState<'durable' | 'dated' | null>(null);

  const indexed = p.items.map((item, idx) => ({ item, idx }));
  const durable = indexed.filter(({ item }) => item.kind === 'durable_rule');
  const dated = indexed.filter(({ item }) => item.kind === 'dated_announcement');
  const leave = p.items.filter((i) => i.kind === 'structured_leave');

  const updateItem = (target: (typeof p.items)[number], content: string) =>
    onChange({ ...p, items: p.items.map((it) => (it === target ? { ...it, content } : it)) });

  const handleApprove = () =>
    onApprove({ ...p, items: p.items.filter((_, idx) => !deletedIndices.has(idx)) });

  return (
    <Card pad data-testid="kb-review-panel">
      <div className="col gap-4">
        <div className="row gap-2 between">
          <span className="t-h2">Review: {p.title}</span>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>

        <div className="col gap-3">
          <Field label="Title">
            <TextInput value={p.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Source reference">
            <TextInput value={p.sourceRef} onChange={(e) => set({ sourceRef: e.target.value })} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="House scope" helper="Shared applies to every house">
              <Select
                value={p.houseScope ?? ''}
                onChange={(e) => set({ houseScope: e.target.value === '' ? null : e.target.value })}
              >
                <option value="">Shared, all houses</option>
                {houses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sensitivity">
              <Select
                value={p.sensitivity}
                onChange={(e) => set({ sensitivity: e.target.value as typeof p.sensitivity })}
              >
                <option value="general">general</option>
                <option value="internal">internal</option>
                <option value="restricted">restricted</option>
              </Select>
            </Field>
          </div>
        </div>

        <ItemGroup
          id="durable"
          title={`Durable rules (${durable.length}), indexed as timeless`}
          items={durable}
          deletedIndices={deletedIndices}
          onUpdate={updateItem}
          onToggleDeleted={toggleDeleted}
          expandedGroup={expandedGroup}
          setExpandedGroup={setExpandedGroup}
        />
        <ItemGroup
          id="dated"
          title={`Dated announcements (${dated.length}), indexed with an expiry window`}
          items={dated}
          deletedIndices={deletedIndices}
          onUpdate={updateItem}
          onToggleDeleted={toggleDeleted}
          expandedGroup={expandedGroup}
          setExpandedGroup={setExpandedGroup}
          groupByDate
        />
        {leave.length > 0 ? (
          <div
            className="col gap-2"
            data-testid="kb-leave-note"
            style={{
              background: 'var(--st-pending-bg)',
              borderRadius: 'var(--radius)',
              padding: '10px 12px',
            }}
          >
            <span className="t-body">
              <strong>{leave.length} leave item(s) not indexed.</strong> Enter these via the Housing
              Manager leave path so duty resolution honors them:
            </span>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {leave.map((i, k) => (
                <li key={k} className="t-helper">
                  {i.content}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {p.representations?.deIdentifiedLesson ? (
          <div
            className="col gap-1"
            style={{
              background: 'var(--surface-2)',
              borderRadius: 'var(--radius)',
              padding: '10px 12px',
            }}
          >
            <span className="t-body">
              <strong>De-identified lesson (indexed):</strong>{' '}
              {p.representations.deIdentifiedLesson}
            </span>
            <span className="t-helper">The raw incident record is never indexed.</span>
          </div>
        ) : null}

        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <Button kind="danger" onClick={onReject} disabled={busy}>
            Reject
          </Button>
          <Button kind="primary" onClick={handleApprove} disabled={busy} data-testid="kb-approve">
            {busy ? 'Approving...' : 'Approve and index'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

type ProposedItem = NonNullable<IntakeDetail['proposed']>['items'][number];
type IndexedItem = { item: ProposedItem; idx: number };

type GroupId = 'durable' | 'dated';

// The proposer resolves window dates as absolute YYYY-MM-DD; render that as a
// short human date rather than raw ISO. Parsed as UTC so the calendar day
// never shifts under a non-UTC local timezone.
function formatUntilDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// Many dated announcements share the same expiry (e.g. a dozen summer programs
// all "through Aug 7"). Bucketing by that date lets the date live once, on the
// bucket, instead of repeating an identical chip on every single card.
function buildDateGroups(
  items: IndexedItem[],
): Array<{ key: string; until: string | null; entries: IndexedItem[] }> {
  const map = new Map<string, IndexedItem[]>();
  for (const entry of items) {
    const key = entry.item.window.effectiveUntil ?? '';
    const bucket = map.get(key);
    if (bucket) bucket.push(entry);
    else map.set(key, [entry]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entries]) => ({ key, until: key === '' ? null : key, entries }));
}

function ItemGroup({
  id,
  title,
  items,
  deletedIndices,
  onUpdate,
  onToggleDeleted,
  groupByDate,
  expandedGroup,
  setExpandedGroup,
}: {
  id: GroupId;
  title: string;
  items: IndexedItem[];
  deletedIndices: Set<number>;
  onUpdate: (item: ProposedItem, content: string) => void;
  onToggleDeleted: (idx: number) => void;
  groupByDate?: boolean;
  expandedGroup: GroupId | null;
  setExpandedGroup: (id: GroupId | null) => void;
}) {
  // Groups start collapsed -- a long proposal shouldn't force a scroll past
  // rules the operator hasn't asked to see yet.
  const [collapsed, setCollapsed] = useState(true);
  if (items.length === 0) return null;
  const expanded = expandedGroup === id;
  const showFull = expanded || !collapsed;

  const chunkCard = ({ item, idx }: IndexedItem, index: number) => (
    <ChunkCard
      key={idx}
      index={index}
      item={item}
      deleted={deletedIndices.has(idx)}
      onSave={(content) => onUpdate(item, content)}
      onToggleDeleted={() => onToggleDeleted(idx)}
    />
  );

  let running = 0;
  const fullContent = groupByDate ? (
    <div className="kb-date-group-list">
      {buildDateGroups(items).map((group) => (
        <div className="kb-date-group" key={group.key}>
          <div className="kb-date-group-head">
            <Icon name="clock" size={13} />
            <span>{group.until ? `Until ${formatUntilDate(group.until)}` : 'No expiry set'}</span>
            <span className="kb-date-group-count">{group.entries.length}</span>
          </div>
          <div className="kb-chunk-list">
            {group.entries.map((entry) => chunkCard(entry, ++running))}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="kb-chunk-list">{items.map((entry, n) => chunkCard(entry, n + 1))}</div>
  );

  return (
    <>
      {expanded && <div className="kb-panel-backdrop" onClick={() => setExpandedGroup(null)} />}
      <div className={`kb-group ${expanded ? 'is-expanded' : ''}`.trim()}>
        <div className="kb-group-toprow">
          <button
            type="button"
            className="kb-group-header"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
          >
            <Icon name={collapsed ? 'chevRight' : 'chevDown'} size={16} />
            <span className="kb-group-title">{title}</span>
          </button>
          <IconButton
            icon={expanded ? 'collapse' : 'expand'}
            label={expanded ? 'Minimize' : 'Expand to full page'}
            onClick={() => setExpandedGroup(expanded ? null : id)}
          />
        </div>
        {showFull ? (
          fullContent
        ) : (
          <div className="kb-group-preview">
            {chunkCard(items[0], 1)}
            {items.length > 1 && (
              <button type="button" className="kb-group-more" onClick={() => setCollapsed(false)}>
                <Icon name="chevDown" size={14} />
                <span>Show {items.length - 1} more</span>
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ChunkCard({
  index,
  item,
  deleted,
  onSave,
  onToggleDeleted,
}: {
  index: number;
  item: ProposedItem;
  deleted: boolean;
  onSave: (content: string) => void;
  onToggleDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  // Approval here is a lightweight per-chunk review mark for the operator's
  // own tracking while working through a long proposal -- untouched and
  // approved chunks both index the same on "Approve and index" below. Only
  // `deleted` (the panel-level soft-delete set, toggled by this card's trash
  // button) actually excludes a chunk from what gets indexed.
  const [approved, setApproved] = useState(false);

  return (
    <div
      className={`kb-chunk-card ${deleted ? 'is-deleted' : approved ? 'is-approved' : ''}`.trim()}
      data-testid="kb-chunk-card"
    >
      <div className="kb-chunk-card-head">
        <div className="kb-chunk-head-tags">
          <span className="kb-chunk-index">{index}</span>
          {deleted ? (
            <Tag kind="red" icon="trash">
              Deleted
            </Tag>
          ) : approved ? (
            <Tag kind="green" icon="checkCircle">
              Approved
            </Tag>
          ) : null}
        </div>
        <div className="kb-chunk-actions">
          <IconButton
            className="icon-btn-sm"
            size={14}
            icon="check"
            label={approved ? 'Unapprove chunk' : 'Approve chunk'}
            active={approved}
            onClick={() => setApproved((a) => !a)}
          />
          <div className="kb-chunk-actions-group">
            <IconButton
              className="icon-btn-sm"
              size={14}
              icon="edit"
              label={editing ? 'Stop editing chunk' : 'Edit chunk'}
              active={editing}
              onClick={() => {
                if (!editing) setDraft(item.content);
                setEditing((e) => !e);
              }}
            />
            <IconButton
              className="icon-btn-sm"
              size={14}
              icon="trash"
              label={deleted ? 'Restore chunk' : 'Delete chunk'}
              active={deleted}
              onClick={onToggleDeleted}
            />
          </div>
        </div>
      </div>

      {editing ? (
        <div className="col gap-2">
          <TextArea value={draft} rows={4} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
            <Button kind="tertiary" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              kind="secondary"
              size="sm"
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="kb-chunk-text">{item.content}</p>
      )}
    </div>
  );
}
