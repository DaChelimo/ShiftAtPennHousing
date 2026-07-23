'use server';

// Desk Assistant KB Intake — web server actions (INTAKE_PLAN Phase 3). Web-first
// (locked): intake is a web-only admin pipeline, so the propose + commit orchestration
// runs here in Node importing @shift/core directly (no Deno EF that nothing else calls).
// The pure row-shaping, normalization, proposer prompt/parser, and temporal logic all
// come from @shift/core so the CLI and this path can never drift.
//
// Pipeline (INTAKE_PLAN section 2 + 6.2): upload -> normalize -> propose (Claude) ->
// review -> approve (embed + commit) | reject. Status advances at each step so the admin
// queue shows live progress. The normalize+propose step itself (download, per-page
// extraction, propose) lives in ../kbIntakePipeline as runIntakePipeline, invoked from
// the streaming route (app/api/kb-intake/process) rather than from a Server Action --
// Server Actions can't stream progress back to the client, which is why extraction and
// proposal drafting moved there instead of staying inline in this file.

import {
  buildKbChunkRows,
  buildKbDocumentRow,
  EMBEDDING_MODEL,
  estimateTokens,
  indexableItems,
  type KbChunkInput,
  type KbDocMeta,
  type NormalizedFormat,
  type ProposedDoc,
} from '@shift/core';
import { revalidatePath } from 'next/cache';

import { estimateVoyageCostUsd } from '../ai/pricing';
import { getSessionUser } from '../auth';
import { isKbAdmin, KB_LOG, withTotals, type IntakeMetrics } from '../kbIntakePipeline';
import { createServiceClient } from '../supabase/server';

const BUCKET = 'kb-uploads';
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

// kb_intake and the new temporal columns are not yet in the generated
// database.types.ts: the migration (20260711000001/2) is authored and validated but not
// applied to the drift-blocked local DB, so `supabase gen types` cannot include them.
// Reach the new tables through this untyped view until types are regenerated with
// `supabase gen types typescript --local` after the migration lands; storage stays typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseFrom = { from: (table: string) => any };

function formatFromName(name: string): NormalizedFormat {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  return 'text';
}

async function voyageEmbed(texts: string[]): Promise<{ embeddings: number[][]; tokens: number }> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (apiKey === undefined) throw new Error('VOYAGE_API_KEY not set');
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts, model: EMBEDDING_MODEL, input_type: 'document' }),
  });
  if (!res.ok) throw new Error(`Voyage error ${res.status}`);
  const json = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
    usage?: { total_tokens: number };
  };
  return { embeddings: json.data.map((d) => d.embedding), tokens: json.usage?.total_tokens ?? 0 };
}

function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

function nyDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export interface IntakeRow {
  intakeId: string;
  filename: string;
  format: string;
  status: string;
  statusDetail: string | null;
  documentId: string | null;
  createdAt: string;
}

export interface IntakeQueue {
  rows: IntakeRow[];
  counts: { awaitingReview: number; live: number; needsAttention: number };
  kb: { documents: number; chunks: number; lastIngestedAt: string | null };
}

/** Upload a file into the intake queue. Returns the intake id; the caller drives
 * normalize+propose separately via the streaming route (app/api/kb-intake/process)
 * so this action stays fast and the client regains control immediately. */
export async function uploadForIntake(form: FormData): Promise<ActionResult<{ intakeId: string }>> {
  const me = await getSessionUser();
  if (!isKbAdmin(me)) return { ok: false, error: 'not authorized' };
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'no file' };

  const svc = createServiceClient();
  const db = svc as unknown as LooseFrom;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = formatFromName(file.name);
  const path = `${me!.userId}/${nyDate(new Date())}-${file.name}`;

  const { error: upErr } = await svc.storage.from(BUCKET).upload(path, bytes, { upsert: true });
  if (upErr) return { ok: false, error: `upload failed: ${upErr.message}` };

  const { data: row, error: insErr } = await db
    .from('kb_intake')
    .insert({
      original_storage_path: path,
      original_filename: file.name,
      input_format: format,
      status: 'uploaded',
      created_by: me!.userId,
    })
    .select('intake_id')
    .single();
  if (insErr) return { ok: false, error: `queue insert failed: ${insErr.message}` };

  const intakeId = (row as { intake_id: string }).intake_id;
  revalidatePath('/admin/knowledge');
  return { ok: true, data: { intakeId } };
}

/** Lightweight poll target: just the two fields that change. Used as a fallback if
 * the stream connection drops; the stream itself is the primary progress source. */
export async function getIntakeStatus(
  intakeId: string,
): Promise<ActionResult<{ status: string; statusDetail: string | null }>> {
  const me = await getSessionUser();
  if (!isKbAdmin(me)) return { ok: false, error: 'not authorized' };
  const svc = createServiceClient();
  const db = svc as unknown as LooseFrom;
  const { data, error } = await db
    .from('kb_intake')
    .select('status, status_detail')
    .eq('intake_id', intakeId)
    .single();
  if (error || data === null) return { ok: false, error: 'intake not found' };
  const rec = data as { status: string; status_detail: string | null };
  return { ok: true, data: { status: rec.status, statusDetail: rec.status_detail } };
}

/** Approve a proposal: embed the indexable items and commit them to the knowledge base. */
export async function approveIntake(
  intakeId: string,
  editedMeta?: ProposedDoc,
): Promise<ActionResult<{ documentId: string; chunks: number }>> {
  const me = await getSessionUser();
  if (!isKbAdmin(me)) return { ok: false, error: 'not authorized' };
  const svc = createServiceClient();
  const db = svc as unknown as LooseFrom;

  const { data: row, error } = await db
    .from('kb_intake')
    .select('proposed_meta, metrics')
    .eq('intake_id', intakeId)
    .single();
  if (error || row === null) return { ok: false, error: 'intake not found' };
  const proposed = (editedMeta ??
    (row as { proposed_meta: ProposedDoc }).proposed_meta) as ProposedDoc | null;
  if (proposed === null) return { ok: false, error: 'no proposal to approve' };
  const priorMetrics = (row as { metrics: IntakeMetrics | null }).metrics ?? undefined;

  await db
    .from('kb_intake')
    .update({ status: 'embedding', status_detail: 'Adding to knowledge base' })
    .eq('intake_id', intakeId);

  // One chunk per indexable item, each carrying its own validity window (INTAKE_PLAN
  // section 4a). structured_leave items are intentionally NOT indexed.
  const items = indexableItems(proposed);
  if (items.length === 0) {
    await db
      .from('kb_intake')
      .update({ status: 'failed', status_detail: 'Nothing indexable to approve.' })
      .eq('intake_id', intakeId);
    return { ok: false, error: 'no indexable items' };
  }

  const docMeta: KbDocMeta = {
    title: proposed.title,
    sourceType: proposed.sourceType,
    sourceRef: proposed.sourceRef,
    houseScope: proposed.houseScope,
    sensitivity: proposed.sensitivity,
    allowedRoles: proposed.allowedRoles,
  };
  const chunkInputs: KbChunkInput[] = items.map((i) => ({
    content: i.content,
    tokenCount: estimateTokens(i.content),
    window: i.window,
  }));

  let embeddings: number[][];
  let embedMetrics: IntakeMetrics['embed'];
  const embedStartedAt = Date.now();
  try {
    const result = await voyageEmbed(chunkInputs.map((c) => c.content));
    embeddings = result.embeddings;
    embedMetrics = {
      durationMs: Date.now() - embedStartedAt,
      tokens: result.tokens,
      costUsd: estimateVoyageCostUsd(EMBEDDING_MODEL, result.tokens),
      chunkCount: chunkInputs.length,
    };
    console.log(
      `${KB_LOG} embed done: ${embedMetrics.durationMs}ms, ${embedMetrics.tokens} tokens, ` +
        `$${embedMetrics.costUsd.toFixed(4)}, ${embedMetrics.chunkCount} chunk(s):`,
    );
    chunkInputs.forEach((c, i) => {
      const temporality = c.window?.temporality ?? 'durable';
      console.log(
        `${KB_LOG}   chunk ${i + 1}/${chunkInputs.length} [${temporality}]: ${c.content}`,
      );
    });
  } catch (err) {
    await db
      .from('kb_intake')
      .update({
        status: 'failed',
        status_detail: `embedding failed: ${err instanceof Error ? err.message : 'unknown'}`,
      })
      .eq('intake_id', intakeId);
    return { ok: false, error: 'embedding failed' };
  }

  const commitStartedAt = Date.now();
  const docRow = buildKbDocumentRow(docMeta);
  const { data: docData, error: docErr } = await db
    .from('kb_documents')
    .insert(docRow)
    .select('document_id')
    .single();
  if (docErr || docData === null) {
    await db
      .from('kb_intake')
      .update({ status: 'failed', status_detail: `commit failed: ${docErr?.message ?? 'unknown'}` })
      .eq('intake_id', intakeId);
    return { ok: false, error: 'commit failed' };
  }
  const documentId = (docData as { document_id: string }).document_id;

  const chunkRows = buildKbChunkRows(docMeta, chunkInputs).map((r, i) => ({
    ...r,
    document_id: documentId,
    embedding: toVectorLiteral(embeddings[i]!),
  }));
  const { error: chunkErr } = await db.from('kb_chunks').insert(chunkRows);
  if (chunkErr) {
    await db
      .from('kb_intake')
      .update({ status: 'failed', status_detail: `chunk write failed: ${chunkErr.message}` })
      .eq('intake_id', intakeId);
    return { ok: false, error: 'chunk write failed' };
  }
  const commitMetrics: IntakeMetrics['commit'] = {
    durationMs: Date.now() - commitStartedAt,
    documentId,
  };

  const metrics = withTotals({
    extraction: priorMetrics?.extraction,
    propose: priorMetrics?.propose,
    embed: embedMetrics,
    commit: commitMetrics,
  });
  console.log(
    `${KB_LOG} intake ${intakeId} live: document ${documentId}, ${chunkRows.length} chunk(s) added, ` +
      `total ${metrics.totalDurationMs}ms, total $${metrics.totalCostUsd.toFixed(4)}`,
  );

  await db
    .from('kb_intake')
    .update({ status: 'live', status_detail: 'Live', document_id: documentId, metrics })
    .eq('intake_id', intakeId);
  revalidatePath('/admin/knowledge');
  return { ok: true, data: { documentId, chunks: chunkRows.length } };
}

export interface IntakeDetail {
  intakeId: string;
  status: string;
  normalizedText: string | null;
  proposed: ProposedDoc | null;
  metrics: IntakeMetrics | null;
  chunks: CommittedChunk[];
}

export interface CommittedChunk {
  content: string;
  temporality: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  tokenCount: number | null;
}

/** Load one intake row's normalized text + proposal for the review panel. */
export async function loadIntakeDetail(intakeId: string): Promise<ActionResult<IntakeDetail>> {
  const me = await getSessionUser();
  if (!isKbAdmin(me)) return { ok: false, error: 'not authorized' };
  const svc = createServiceClient();
  const db = svc as unknown as LooseFrom;
  const { data, error } = await db
    .from('kb_intake')
    .select('intake_id, status, normalized_text, proposed_meta, metrics, document_id')
    .eq('intake_id', intakeId)
    .single();
  if (error || data === null) return { ok: false, error: 'intake not found' };
  const rec = data as Record<string, unknown>;
  const documentId = rec.document_id as string | null;

  let chunks: CommittedChunk[] = [];
  if (documentId !== null) {
    const { data: chunkRows } = await db
      .from('kb_chunks')
      .select('content, temporality, effective_from, effective_until, token_count')
      .eq('document_id', documentId)
      .order('chunk_index', { ascending: true });
    chunks = ((chunkRows ?? []) as Array<Record<string, unknown>>).map((c) => ({
      content: c.content as string,
      temporality: c.temporality as string,
      effectiveFrom: (c.effective_from as string | null) ?? null,
      effectiveUntil: (c.effective_until as string | null) ?? null,
      tokenCount: (c.token_count as number | null) ?? null,
    }));
  }

  return {
    ok: true,
    data: {
      intakeId: rec.intake_id as string,
      status: rec.status as string,
      normalizedText: (rec.normalized_text as string | null) ?? null,
      proposed: (rec.proposed_meta as ProposedDoc | null) ?? null,
      metrics: (rec.metrics as IntakeMetrics | null) ?? null,
      chunks,
    },
  };
}

export async function rejectIntake(intakeId: string): Promise<ActionResult<null>> {
  const me = await getSessionUser();
  if (!isKbAdmin(me)) return { ok: false, error: 'not authorized' };
  const svc = createServiceClient();
  const db = svc as unknown as LooseFrom;
  await db
    .from('kb_intake')
    .update({ status: 'rejected', status_detail: 'Rejected' })
    .eq('intake_id', intakeId);
  revalidatePath('/admin/knowledge');
  return { ok: true, data: null };
}

/**
 * Remove a LIVE document from the knowledge base (e.g. the wrong file was
 * approved by mistake). Deletes the kb_documents row, which cascades to every
 * kb_chunks row indexed from it (existing FK ON DELETE CASCADE) -- the
 * assistant can no longer retrieve or cite it. The kb_intake row is kept (not
 * deleted) and flipped to 'deleted' so the pipeline cost/duration/chunk-count
 * metrics captured at approval time stay reviewable after the fact.
 */
export async function deleteDocument(intakeId: string): Promise<ActionResult<null>> {
  const me = await getSessionUser();
  if (!isKbAdmin(me)) return { ok: false, error: 'not authorized' };
  const svc = createServiceClient();
  const db = svc as unknown as LooseFrom;

  const { data: row, error } = await db
    .from('kb_intake')
    .select('document_id')
    .eq('intake_id', intakeId)
    .single();
  if (error || row === null) return { ok: false, error: 'intake not found' };
  const documentId = (row as { document_id: string | null }).document_id;

  if (documentId !== null) {
    const { error: delErr } = await db.from('kb_documents').delete().eq('document_id', documentId);
    if (delErr) return { ok: false, error: `delete failed: ${delErr.message}` };
  }

  await db
    .from('kb_intake')
    .update({
      status: 'deleted',
      status_detail: 'Removed from the knowledge base',
      document_id: null,
    })
    .eq('intake_id', intakeId);
  revalidatePath('/admin/knowledge');
  return { ok: true, data: null };
}

/** Queue + aggregate dashboard (INTAKE_PLAN section 6.2). */
export async function loadIntakeQueue(): Promise<ActionResult<IntakeQueue>> {
  const me = await getSessionUser();
  if (!isKbAdmin(me)) return { ok: false, error: 'not authorized' };
  const svc = createServiceClient();
  const db = svc as unknown as LooseFrom;

  const { data: rows } = await db
    .from('kb_intake')
    .select(
      'intake_id, original_filename, input_format, status, status_detail, document_id, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100);
  const list = (rows ?? []) as Array<Record<string, unknown>>;

  const queue: IntakeRow[] = list.map((r) => ({
    intakeId: r.intake_id as string,
    filename: r.original_filename as string,
    format: r.input_format as string,
    status: r.status as string,
    statusDetail: (r.status_detail as string | null) ?? null,
    documentId: (r.document_id as string | null) ?? null,
    createdAt: r.created_at as string,
  }));

  const awaitingReview = queue.filter(
    (r) => r.status === 'proposed' || r.status === 'in_review',
  ).length;
  const live = queue.filter((r) => r.status === 'live').length;
  const needsAttention = queue.filter((r) => r.status === 'failed').length;

  const { count: docCount } = await db
    .from('kb_documents')
    .select('document_id', { count: 'exact', head: true });
  const { count: chunkCount } = await db
    .from('kb_chunks')
    .select('chunk_id', { count: 'exact', head: true });
  const lastIngested = queue.find((r) => r.status === 'live')?.createdAt ?? null;

  return {
    ok: true,
    data: {
      rows: queue,
      counts: { awaitingReview, live, needsAttention },
      kb: { documents: docCount ?? 0, chunks: chunkCount ?? 0, lastIngestedAt: lastIngested },
    },
  };
}
