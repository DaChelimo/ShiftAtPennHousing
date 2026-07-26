'use client';

// One in-flight upload's live-status card, plus the pure helpers that drive it
// (the NDJSON stream reader and the error->step mapper). Split out of
// KnowledgeIntake.tsx, which owns the state these helpers write into
// (uploads, via applyStreamEvent) but doesn't need to own their definitions.

import type { KbIntakeStreamEvent } from '../../lib/kbIntakePipeline';
import { Icon, IconButton } from '../ui';

// 'syncing' is the gap between the pipeline finishing (the server already
// committed status='proposed') and the queue table below actually showing
// that -- it only updates on router.refresh(). Without an explicit step here,
// the card would flash "Ready for review" while the queue row underneath it
// still says "Reading document," which reads as two systems disagreeing
// about the same document. The card holds 'syncing' until refresh confirms.
export type UploadStage = 'queued' | 'uploading' | 'processing' | 'syncing' | 'done' | 'error';

// The 4 pipeline steps a card's progress rail tracks (upload -> extract -> propose
// -> sync). Extraction fans out per-page (see PageProgress); propose stays one
// step because it's a single holistic call over every page's combined text.
export const UPLOAD_STEPS = ['Upload', 'Extract', 'Propose', 'Sync'] as const;

export type PageStatus = 'pending' | 'active' | 'done' | 'error';

export type PageProgress = {
  page: number;
  status: PageStatus;
  method?: 'text' | 'vision';
  preview?: string;
  message?: string;
};

export type UploadItem = {
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

// Consumes the streaming intake route (NDJSON, one JSON event per line) --
// same wire shape the route writes, see lib/kbIntakePipeline.ts. Calls
// onEvent for each parsed line as it arrives so the caller can update the
// card live instead of waiting for the whole pipeline to finish.
export async function streamProcessIntake(
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

export function stepForErrorStep(
  step: Extract<KbIntakeStreamEvent, { t: 'error' }>['step'],
): number {
  if (step === 'propose') return 2;
  if (step === 'download' || step === 'extract' || step === 'normalize') return 1;
  return 0;
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function UploadFileCard({
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
        {(item.stage === 'uploading' ||
          item.stage === 'processing' ||
          item.stage === 'syncing' ||
          item.stage === 'done') &&
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
