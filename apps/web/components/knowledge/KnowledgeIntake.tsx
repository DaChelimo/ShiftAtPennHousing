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
import { Button, Card, DataTable, Icon, Notification } from '../ui';

import { IntakeRowExpansion } from './IntakeReviewPanel';
import {
  stepForErrorStep,
  streamProcessIntake,
  UploadFileCard,
  type PageProgress,
  type UploadItem,
} from './UploadFileCard';
import { BUSY_STATUSES, buildIntakeQueueColumns } from './intakeQueueColumns';

let uploadItemSeq = 0;

export type HouseOption = { id: string; name: string };

export function KnowledgeIntake({
  initial,
  houses,
  isProjectAdmin,
  currentUserHouseId,
}: {
  initial: IntakeQueue;
  houses: HouseOption[];
  isProjectAdmin: boolean;
  currentUserHouseId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The row currently expanded inline in the queue table, and the detail data
  // it shows once loaded. Split in two so the row expands immediately on click
  // (better feedback) while `selected` (and its loading state) fills in async.
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [selected, setSelected] = useState<IntakeDetail | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Resolved once router.refresh()'s transition actually commits, so callers
  // can await "the queue table now reflects the latest server state" instead
  // of firing the refresh and hoping it lands before they show it as done.
  const refreshResolversRef = useRef<Array<() => void>>([]);
  useEffect(() => {
    if (pending) return;
    const resolvers = refreshResolversRef.current;
    if (resolvers.length === 0) return;
    refreshResolversRef.current = [];
    resolvers.forEach((r) => r());
  }, [pending]);
  function refreshAndWait(): Promise<void> {
    return new Promise((resolve) => {
      refreshResolversRef.current.push(resolve);
      startTransition(() => router.refresh());
    });
  }

  // Approximate the live queue by refreshing while anything is mid-pipeline. A Supabase
  // Realtime subscription is the follow-on; polling keeps the status honest for v1.
  //
  // Cost audit F-13. This polled every 3 s, and router.refresh() re-renders the ENTIRE
  // server component tree for the route — which per F-07 cost 3 GoTrue round trips and
  // 4 DB queries on its own, before the knowledge page's own loaders. A large PDF ingest
  // running several minutes meant low hundreds of full RSC re-renders.
  //
  // Two changes, no behavioural loss: 3 s was far tighter than an embedding pipeline's
  // actual state-change rate, so the base interval is now 5 s; and the interval BACKS
  // OFF as the ingest runs long (5 s, then 10 s, then 20 s, capped at 30 s), because a
  // job still going after a minute is not one whose status is about to flip. A fast job
  // still resolves at the same perceived speed, since the first few polls are the ones
  // that matter. The gate is unchanged: no polling at all when nothing is in flight.
  const inFlight = initial.rows.some((r) => BUSY_STATUSES.includes(r.status));
  useEffect(() => {
    if (!inFlight) return;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = Math.min(5000 * 2 ** Math.floor(polls / 4), 30000);
      timer = setTimeout(() => {
        polls += 1;
        router.refresh();
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timer);
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
        // The pipeline is finished server-side (status is already 'proposed'
        // in the DB), but the queue table below is still showing whatever it
        // last rendered. Hold here until startUpload's refresh confirms it.
        updateUpload(id, (u) => ({
          ...u,
          stage: 'syncing',
          step: 3,
          detail: 'Syncing to the queue...',
        }));
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

          let sawResult = false;
          let sawError = false;
          await streamProcessIntake(intakeId, (event) => {
            applyStreamEvent(item.id, event);
            if (event.t === 'result') sawResult = true;
            if (event.t === 'error') sawError = true;
          });

          if (sawResult) {
            // applyStreamEvent already parked the card on 'syncing' -- wait for
            // the queue table to actually confirm the new status before the
            // card claims 'Ready for review' too, so the two can never
            // contradict each other on screen.
            await refreshAndWait();
            patchUpload(item.id, { stage: 'done', detail: 'Ready for review' });
          } else if (!sawError) {
            // The stream ended (connection dropped, server restarted mid-run)
            // without ever telling us it finished -- fall back to the row's
            // real status so the card reflects the truth instead of freezing
            // on its last-seen step forever.
            const final = await getIntakeStatus(intakeId);
            if (final.ok && final.data.status === 'proposed') {
              patchUpload(item.id, {
                stage: 'syncing',
                step: 3,
                detail: 'Syncing to the queue...',
              });
              await refreshAndWait();
              patchUpload(item.id, { stage: 'done', detail: 'Ready for review' });
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
    // A second click on the same row's Review/Details button closes it.
    if (expandedRowId === intakeId) {
      setExpandedRowId(null);
      setSelected(null);
      return;
    }
    setQueueError(null);
    setExpandedRowId(intakeId);
    setSelected(null);
    setSelectedLoading(true);
    const res = await loadIntakeDetail(intakeId);
    setSelectedLoading(false);
    if (res.ok) {
      setSelected(res.data);
    } else {
      // e.g. the row was deleted server-side since this page last loaded --
      // refresh the queue so the stale row disappears instead of leaving the
      // click looking like it silently did nothing.
      setQueueError(`Could not open this document: ${res.error}`);
      setExpandedRowId(null);
      refresh();
    }
  }

  function closeReview() {
    setExpandedRowId(null);
    setSelected(null);
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

  // Re-runs approval (embed + commit) for an intake that already has a proposal --
  // either a 'failed' row whose failure happened AFTER proposing (so re-running the
  // extract/propose pipeline would discard the reviewed/edited proposal), or an
  // 'embedding' row that's been abandoned mid-commit (a crashed request never
  // finished it, and nothing times it out automatically). Safe to re-run: the
  // commit itself is one atomic transaction (see commit_kb_intake), so there's
  // nothing partial left over to clean up first.
  async function resumeApproval(intakeId: string) {
    setQueueError(null);
    startTransition(async () => {
      const res = await approveIntake(intakeId);
      if (!res.ok) setQueueError(`Could not finish adding this document: ${res.error}`);
      router.refresh();
    });
  }

  async function onApprove(finalProposed: NonNullable<IntakeDetail['proposed']>) {
    if (selected === null) return;
    setBusy(true);
    await approveIntake(selected.intakeId, finalProposed);
    setBusy(false);
    closeReview();
    refresh();
  }

  async function onReject() {
    if (selected === null) return;
    setBusy(true);
    await rejectIntake(selected.intakeId);
    setBusy(false);
    closeReview();
    refresh();
  }

  const queuedCount = uploads.filter((u) => u.stage === 'queued').length;
  const doneCount = uploads.filter((u) => u.stage === 'done').length;
  const totalCount = uploads.length;
  const hasFinished = uploads.some((u) => u.stage === 'done' || u.stage === 'error');

  const columns = buildIntakeQueueColumns({
    expandedRowId,
    openReview,
    retryIntake,
    resumeApproval,
  });

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
            expandedKey={expandedRowId}
            renderExpanded={(r) => (
              <IntakeRowExpansion
                row={r}
                detail={selected?.intakeId === r.intakeId ? selected : null}
                loading={selectedLoading}
                busy={busy}
                houses={houses}
                isProjectAdmin={isProjectAdmin}
                currentUserHouseId={currentUserHouseId}
                onChange={(proposed) =>
                  setSelected((prev) => (prev ? { ...prev, proposed } : prev))
                }
                onApprove={onApprove}
                onReject={onReject}
                onClose={closeReview}
                onDeleted={closeReview}
              />
            )}
          />
        </div>
      </div>
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
