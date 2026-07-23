// KB intake pipeline core: download -> extract (parallel per-page vision) ->
// normalize -> propose (streamed). Pulled out of lib/actions/kbIntake.ts so the
// streaming route (app/api/kb-intake/process/route.ts) and the plain server
// actions (approveIntake's metrics types) share one implementation instead of
// two copies that could drift.
//
// Extraction runs pages CONCURRENTLY (bounded pool, see CONCURRENCY below):
// each page's vision transcription is independent of every other page, so
// nothing about page 2 depends on page 1 finishing first. Propose is the
// opposite -- one holistic call over every page's combined text, since the
// assistant needs the whole document to draft a coherent proposal. That
// asymmetry is why extraction fans out and propose stays a single streamed
// call (streamed so the caller can show the proposal being drafted live
// instead of a blind spinner for however long the model takes).

import {
  assessLayoutRisk,
  normalize,
  parseProposedDoc,
  proposeSystemPrompt,
  type NormalizedFormat,
  type ProposedDoc,
  type TextItemPosition,
} from '@shift/core';

import { emptyUsage, estimateCostUsd, type ScheduleUsage } from './ai/pricing';
import { isAdmin, isHouseAdmin, isRsm, type SessionUser } from './auth';
import { KB_PROPOSE_KEY, KB_UPLOAD_CHUNKER_KEY } from './env';
import { createServiceClient } from './supabase/server';

export const KB_LOG = '[kb-intake]';
export const PROPOSE_MODEL = 'claude-sonnet-5';
export const VISION_MODEL = 'claude-sonnet-5';
const BUCKET = 'kb-uploads';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// How many pages extract concurrently. Each vision call is a real Anthropic
// round-trip (image + prompt); 4 at a time gives a big wall-clock win over
// sequential (a 10-page scanned doc finishes in ~3 waves, not 10) without
// bursting the whole document's worth of calls at once.
const EXTRACT_CONCURRENCY = 4;

export function isKbAdmin(u: SessionUser | null): boolean {
  return isHouseAdmin(u) || isRsm(u) || isAdmin(u);
}

// Per-upload dev-mode telemetry (INTAKE_PLAN instrumentation). Populated
// incrementally as the intake advances through extraction/propose (this file)
// and embed/commit (approveIntake in lib/actions/kbIntake.ts), then persisted
// on kb_intake.metrics so it survives past one process's console output.
export interface IntakeMetrics {
  extraction?: {
    durationMs: number;
    pageCount?: number;
    visionPages: number;
    visionCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  propose?: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  embed?: {
    durationMs: number;
    tokens: number;
    costUsd: number;
    chunkCount: number;
  };
  commit?: {
    durationMs: number;
    documentId: string;
  };
  totalDurationMs: number;
  totalCostUsd: number;
}

export function withTotals(
  m: Omit<IntakeMetrics, 'totalDurationMs' | 'totalCostUsd'>,
): IntakeMetrics {
  const totalDurationMs =
    (m.extraction?.durationMs ?? 0) +
    (m.propose?.durationMs ?? 0) +
    (m.embed?.durationMs ?? 0) +
    (m.commit?.durationMs ?? 0);
  const totalCostUsd =
    (m.extraction?.costUsd ?? 0) + (m.propose?.costUsd ?? 0) + (m.embed?.costUsd ?? 0);
  return { ...m, totalDurationMs, totalCostUsd };
}

// Wire protocol for the streaming intake route (NDJSON, one JSON object per
// line) -- mirrors the shape of lib/ai/streamTypes.ts's AiStreamEvent.
export type KbIntakeStreamEvent =
  | { t: 'download-start' }
  | { t: 'extract-start'; totalPages: number }
  | { t: 'page-start'; page: number; totalPages: number }
  | {
      t: 'page-done';
      page: number;
      totalPages: number;
      method: 'text' | 'vision';
      preview: string;
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
    }
  | { t: 'page-error'; page: number; totalPages: number; message: string }
  | {
      t: 'extract-done';
      totalPages: number;
      visionPages: number;
      durationMs: number;
      costUsd: number;
    }
  | { t: 'propose-start' }
  | { t: 'propose-delta'; text: string }
  | {
      t: 'propose-done';
      durationMs: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    }
  | { t: 'result'; title: string }
  | {
      t: 'error';
      step: 'lookup' | 'download' | 'extract' | 'normalize' | 'propose';
      message: string;
      rawPreview?: string;
    };

function previewOf(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  return collapsed.length > 160 ? `${collapsed.slice(0, 160)}...` : collapsed;
}

// Bounded-concurrency map: at most `limit` calls to `fn` in flight at once,
// results returned in the original order regardless of completion order.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// unpdf's renderPageAsImage composites the page through pdf.js's canvas-based renderer,
// which is the right path for vector-drawn content (native flowcharts/tables). But
// pdf.js's inline-image-painting step uses its own internal Node canvas factory that
// does not pick up the `canvasImport` option and throws for any page whose content is a
// raster image -- which is exactly a scanned PDF page (the CamScanner case this module
// exists for). Fall back to extracting the embedded raster directly (no canvas
// compositing involved) and re-encoding it with sharp when rendering throws.
type PdfDocumentProxy = Awaited<ReturnType<(typeof import('unpdf'))['getDocumentProxy']>>;

async function renderPageForVision(pdf: PdfDocumentProxy, pageNumber: number): Promise<string> {
  const { extractImages, renderPageAsImage } = await import('unpdf');
  try {
    return await renderPageAsImage(pdf, pageNumber, {
      scale: 2,
      toDataURL: true,
      canvasImport: () => import('@napi-rs/canvas'),
    });
  } catch {
    const images = await extractImages(pdf, pageNumber);
    if (images.length === 0) throw new Error(`page ${pageNumber} has no renderable content`);
    const largest = images.reduce((max, img) =>
      img.width * img.height > max.width * max.height ? img : max,
    );
    const sharp = (await import('sharp')).default;
    const png = await sharp(Buffer.from(largest.data), {
      raw: { width: largest.width, height: largest.height, channels: largest.channels },
    })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  }
}

const VISION_TRANSCRIBE_PROMPT = `This image is one page of an internal staff operations document. It may be a decision-tree flowchart, a table, or plain text.

Transcribe it into complete, information-preserving prose:
- For a flowchart: describe every decision question, every branch (yes/no or otherwise), and exactly what action or contact follows each branch, using explicit conditional language (for example: "If the emergency affects physical safety, call UPPD at 511. Otherwise, if the problem is a facilities emergency affecting a resident's safety, call Facilities at..."). Preserve every phone number, name, and escalation order exactly as written, including nested sub-steps inside callout boxes.
- For a table: describe every row as one complete sentence naming all column values in order. Include any notes or footnotes below the table verbatim, and state which rows or scope they apply to.
- For plain text: transcribe it faithfully.

Do not omit or summarize away any phone number, name, date, or instruction visible in the image. Output only the transcription, with no commentary or preamble.`;

async function visionTranscribePage(
  imageDataUrl: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const apiKey = KB_UPLOAD_CHUNKER_KEY;
  if (apiKey === '') throw new Error('CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER not set');
  const commaIdx = imageDataUrl.indexOf(',');
  const mediaType = imageDataUrl.slice(5, imageDataUrl.indexOf(';')) || 'image/png';
  const base64 = imageDataUrl.slice(commaIdx + 1);
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: VISION_TRANSCRIBE_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic vision error ${res.status}`);
  const json = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };
  return {
    text: (json.content.find((c) => c.type === 'text')?.text ?? '').trim(),
    inputTokens: json.usage.input_tokens,
    outputTokens: json.usage.output_tokens,
  };
}

// PDF text extraction implements the core PdfTextExtractor seam (INTAKE_PLAN Phase 1).
// unpdf is a serverless-friendly pdf.js build (no native deps, no filesystem), so it runs
// in the Next server runtime.
//
// A PDF's text layer is extracted in content-stream order, not visual reading order.
// That coincides with reading order for ordinary single-column prose, but NOT for a
// flowchart (free-floating callout boxes) or a table (a grid of short cells) -- those
// can extract as non-empty, non-warned text that has silently lost its branching logic
// or row/column structure. A scanned PDF (no text layer at all) is the other failure
// mode. Both are routed page-by-page to Claude vision instead of the plain text layer:
// the empty-text case via the pre-existing check, the "text present but wrong" case via
// assessLayoutRisk's positional heuristic (packages/core/src/desk-assistant/layout-heuristic.ts).
async function extractPdfConcurrent(
  bytes: Uint8Array,
  emit: (e: KbIntakeStreamEvent) => void,
): Promise<{
  text: string;
  pageCount?: number;
  warnings: string[];
  metrics: IntakeMetrics['extraction'];
} | null> {
  const startedAt = Date.now();
  const { extractText, extractTextItems, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes);
  const [{ text: pageTexts, totalPages }, { items }] = await Promise.all([
    extractText(pdf, { mergePages: false }),
    extractTextItems(pdf),
  ]);

  const risk = assessLayoutRisk(
    items.map((pageItems): TextItemPosition[] =>
      pageItems.map((it) => ({
        text: it.str,
        x: it.x,
        y: it.y,
        width: it.width,
        height: it.height,
      })),
    ),
  );

  emit({ t: 'extract-start', totalPages });

  const finalPages: string[] = new Array(totalPages);
  const warnings: string[] = [];
  const visionUsage = emptyUsage();
  const pageIndices = Array.from({ length: totalPages }, (_, i) => i);

  await mapWithConcurrency(pageIndices, EXTRACT_CONCURRENCY, async (i) => {
    const pageText = pageTexts[i] ?? '';
    const pageRisk = risk.pages[i];
    const emptyLayer = pageText.trim().length === 0;
    const needsVision = emptyLayer || (pageRisk?.risky ?? false);

    if (!needsVision) {
      finalPages[i] = pageText;
      emit({
        t: 'page-done',
        page: i + 1,
        totalPages,
        method: 'text',
        preview: previewOf(pageText),
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
      });
      return;
    }

    emit({ t: 'page-start', page: i + 1, totalPages });
    const pageStartedAt = Date.now();
    try {
      const imageDataUrl = await renderPageForVision(pdf, i + 1);
      const vision = await visionTranscribePage(imageDataUrl);
      finalPages[i] = vision.text;
      visionUsage.calls += 1;
      visionUsage.inputTokens += vision.inputTokens;
      visionUsage.outputTokens += vision.outputTokens;
      const why = emptyLayer ? 'empty text layer' : pageRisk!.reasons.join(', ');
      warnings.push(`page ${i + 1}: vision fallback used (${why})`);
      console.log(
        `${KB_LOG} extraction page ${i + 1}/${totalPages}: vision fallback (${why}), ` +
          `${vision.inputTokens} in / ${vision.outputTokens} out tokens`,
      );
      emit({
        t: 'page-done',
        page: i + 1,
        totalPages,
        method: 'vision',
        preview: previewOf(vision.text),
        inputTokens: vision.inputTokens,
        outputTokens: vision.outputTokens,
        durationMs: Date.now() - pageStartedAt,
      });
    } catch (err) {
      finalPages[i] = pageText;
      const message = err instanceof Error ? err.message : 'vision transcription failed';
      warnings.push(`page ${i + 1}: vision fallback failed (${message}), using raw text layer`);
      emit({ t: 'page-error', page: i + 1, totalPages, message });
    }
  });

  const durationMs = Date.now() - startedAt;
  const costUsd = estimateCostUsd(VISION_MODEL, visionUsage);
  console.log(
    `${KB_LOG} extraction done: ${totalPages} pages, ${visionUsage.calls} vision call(s), ` +
      `${durationMs}ms, $${costUsd.toFixed(4)}`,
  );
  emit({ t: 'extract-done', totalPages, visionPages: visionUsage.calls, durationMs, costUsd });

  return {
    text: finalPages.join('\f'),
    pageCount: totalPages,
    warnings,
    metrics: {
      durationMs,
      pageCount: totalPages,
      visionPages: visionUsage.calls,
      visionCalls: visionUsage.calls,
      inputTokens: visionUsage.inputTokens,
      outputTokens: visionUsage.outputTokens,
      costUsd,
    },
  };
}

// Streams the propose call token-by-token (Anthropic SSE) via onDelta, so the
// caller can show the proposal being drafted live instead of a blind wait --
// this is the one step that genuinely cannot be parallelized (it needs every
// page's combined text at once to draft one coherent proposal).
async function claudeProposeStream(
  text: string,
  anchorDate: string,
  onDelta: (chunk: string) => void,
): Promise<{
  doc: ProposedDoc | null;
  usage: ScheduleUsage;
  failureReason?: string;
  rawPreview?: string;
}> {
  const apiKey = KB_PROPOSE_KEY;
  if (apiKey === '') throw new Error('CLAUDE_AI_CHATBOT_PROPOSE not set');
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: PROPOSE_MODEL,
      // A dense multi-page source (several flowcharts + a large table, say)
      // proposes many indexable items; verified live against a real 4-page
      // flowchart+schedule-table document that 4096 truncated at output
      // position 1448 and even 8192 truncated at position 9082 -- both hit
      // their exact token cap, not a model mistake. 16384 gives real dense
      // documents room to finish while staying well under Sonnet's ceiling.
      max_tokens: 16384,
      system: proposeSystemPrompt(anchorDate),
      messages: [{ role: 'user', content: text }],
      stream: true,
    }),
  });
  if (!res.ok || res.body === null) throw new Error(`Anthropic error ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '') continue;
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.type === 'message_start') {
        const usage = (evt.message as { usage?: { input_tokens?: number } } | undefined)?.usage;
        inputTokens = usage?.input_tokens ?? 0;
      } else if (evt.type === 'content_block_delta') {
        const delta = evt.delta as { type?: string; text?: string } | undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          raw += delta.text;
          onDelta(delta.text);
        }
      } else if (evt.type === 'message_delta') {
        const usage = evt.usage as { output_tokens?: number } | undefined;
        if (usage?.output_tokens !== undefined) outputTokens = usage.output_tokens;
      }
    }
  }

  const usage: ScheduleUsage = {
    calls: 1,
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  const rawPreview = raw.length > 300 ? `${raw.slice(0, 300)}...` : raw;
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    return {
      doc: null,
      usage,
      failureReason:
        raw.trim().length === 0
          ? 'The assistant returned an empty response'
          : 'The assistant response did not contain a JSON object',
      rawPreview,
    };
  }
  try {
    return { doc: parseProposedDoc(JSON.parse(raw.slice(jsonStart, jsonEnd + 1))), usage };
  } catch (err) {
    return {
      doc: null,
      usage,
      failureReason:
        err instanceof Error
          ? `The assistant's JSON did not match the expected shape (${err.message})`
          : "The assistant's JSON did not match the expected shape",
      rawPreview,
    };
  }
}

function nyDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseFrom = { from: (table: string) => any };

/**
 * Run the full download -> extract -> normalize -> propose pipeline for one
 * intake row, emitting a KbIntakeStreamEvent at every step so a caller (the
 * streaming route) can relay live progress. Persists status/status_detail/
 * metrics to kb_intake exactly as the old synchronous processIntake did, so
 * the queue table and IntakeMetricsPanel stay correct whether or not anyone
 * is watching the stream live.
 */
export async function runIntakePipeline(
  intakeId: string,
  emit: (e: KbIntakeStreamEvent) => void,
): Promise<{ ok: boolean; error?: string }> {
  const svc = createServiceClient();
  const db = svc as unknown as LooseFrom;

  const setStatus = async (
    status: string,
    detail: string | null,
    extra: Record<string, unknown> = {},
  ) => {
    await db
      .from('kb_intake')
      .update({ status, status_detail: detail, ...extra })
      .eq('intake_id', intakeId);
  };

  const { data: row, error } = await db
    .from('kb_intake')
    .select('original_storage_path, input_format, created_at')
    .eq('intake_id', intakeId)
    .single();
  if (error || row === null) {
    emit({ t: 'error', step: 'lookup', message: 'This upload could not be found.' });
    return { ok: false, error: 'intake not found' };
  }
  const rec = row as {
    original_storage_path: string;
    input_format: NormalizedFormat;
    created_at: string;
  };

  emit({ t: 'download-start' });
  await setStatus('normalizing', 'Downloading the uploaded file');
  const { data: blob, error: dlErr } = await svc.storage
    .from(BUCKET)
    .download(rec.original_storage_path);
  if (dlErr || blob === null) {
    const message = `Could not download the uploaded file: ${dlErr?.message ?? 'unknown error'}`;
    await setStatus('failed', message);
    emit({ t: 'error', step: 'download', message });
    return { ok: false, error: 'download failed' };
  }

  let raw: string;
  let pageCount: number | undefined;
  let extractionWarnings: string[] = [];
  let extractionMetrics: IntakeMetrics['extraction'];
  if (rec.input_format === 'pdf') {
    await setStatus('normalizing', 'Reading document');
    let extracted: Awaited<ReturnType<typeof extractPdfConcurrent>>;
    try {
      extracted = await extractPdfConcurrent(new Uint8Array(await blob.arrayBuffer()), (e) => {
        emit(e);
        if (e.t === 'page-start') {
          void setStatus(
            'normalizing',
            `Reading page ${e.page} of ${e.totalPages} (image transcription)`,
          );
        }
      });
    } catch (err) {
      // unpdf throws (rather than returning null) on a malformed or non-PDF
      // file -- without this catch the row is stranded at 'normalizing'
      // forever even though the pipeline has actually stopped.
      const message = err instanceof Error ? err.message : 'Could not read this PDF.';
      await setStatus('failed', message);
      emit({ t: 'error', step: 'extract', message });
      return { ok: false, error: message };
    }
    if (extracted === null) {
      const message = 'PDF text extractor is not configured on the server yet.';
      await setStatus('failed', message);
      emit({ t: 'error', step: 'extract', message });
      return { ok: false, error: 'pdf extractor unavailable' };
    }
    raw = extracted.text;
    pageCount = extracted.pageCount;
    extractionWarnings = extracted.warnings;
    extractionMetrics = extracted.metrics;
  } else {
    raw = await blob.text();
  }

  const normalized = normalize({ format: rec.input_format, raw, pageCount });
  normalized.warnings.push(...extractionWarnings);
  if (normalized.text.length === 0) {
    const message = 'Document is empty after normalization.';
    await setStatus('failed', message);
    emit({ t: 'error', step: 'normalize', message });
    return { ok: false, error: 'empty' };
  }

  emit({ t: 'propose-start' });
  await setStatus(
    'normalizing',
    extractionMetrics
      ? `Combining ${extractionMetrics.pageCount ?? '?'} page(s) into one proposal`
      : 'Drafting a proposal with the assistant',
  );
  const proposeStartedAt = Date.now();
  let proposeResult: Awaited<ReturnType<typeof claudeProposeStream>>;
  try {
    proposeResult = await claudeProposeStream(
      normalized.text,
      nyDate(new Date(rec.created_at)),
      (delta) => {
        emit({ t: 'propose-delta', text: delta });
      },
    );
  } catch (err) {
    const message = `The proposal request failed: ${err instanceof Error ? err.message : 'unknown error'}`;
    await setStatus('failed', message);
    emit({ t: 'error', step: 'propose', message });
    return { ok: false, error: 'propose failed' };
  }
  const proposeMetrics: IntakeMetrics['propose'] = {
    durationMs: Date.now() - proposeStartedAt,
    inputTokens: proposeResult.usage.inputTokens,
    outputTokens: proposeResult.usage.outputTokens,
    costUsd: estimateCostUsd(PROPOSE_MODEL, proposeResult.usage),
  };
  console.log(
    `${KB_LOG} propose done: ${proposeMetrics.durationMs}ms, ${proposeMetrics.inputTokens} in / ` +
      `${proposeMetrics.outputTokens} out tokens, $${proposeMetrics.costUsd.toFixed(4)}`,
  );
  emit({
    t: 'propose-done',
    durationMs: proposeMetrics.durationMs,
    inputTokens: proposeMetrics.inputTokens,
    outputTokens: proposeMetrics.outputTokens,
    costUsd: proposeMetrics.costUsd,
  });

  if (proposeResult.doc === null) {
    const why = proposeResult.failureReason ?? 'unknown reason';
    const detail = proposeResult.rawPreview
      ? `Could not draft a valid proposal: ${why}. What the assistant returned: "${proposeResult.rawPreview}"`
      : `Could not draft a valid proposal: ${why}.`;
    console.log(`${KB_LOG} propose invalid: ${why}`);
    await setStatus('failed', detail);
    emit({ t: 'error', step: 'propose', message: detail, rawPreview: proposeResult.rawPreview });
    return { ok: false, error: 'invalid proposal' };
  }

  const metrics = withTotals({ extraction: extractionMetrics, propose: proposeMetrics });
  await setStatus('proposed', 'Ready for review', {
    normalized_text: normalized.text,
    proposed_meta: proposeResult.doc,
    representations: proposeResult.doc.representations,
    metrics,
  });
  console.log(
    `${KB_LOG} intake ${intakeId} proposed: ${metrics.totalDurationMs}ms so far, ` +
      `$${metrics.totalCostUsd.toFixed(4)} so far`,
  );
  emit({ t: 'result', title: proposeResult.doc.title });
  return { ok: true };
}
