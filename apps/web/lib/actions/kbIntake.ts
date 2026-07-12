'use server';

// Desk Assistant KB Intake — web server actions (INTAKE_PLAN Phase 3). Web-first
// (locked): intake is a web-only admin pipeline, so the propose + commit orchestration
// runs here in Node importing @shift/core directly (no Deno EF that nothing else calls).
// The pure row-shaping, normalization, proposer prompt/parser, and temporal logic all
// come from @shift/core so the CLI and this path can never drift.
//
// Pipeline (INTAKE_PLAN section 2 + 6.2): upload -> normalize -> propose (Claude) ->
// review -> approve (embed + commit) | reject. Status advances at each step so the admin
// queue shows live progress.

import {
  buildKbChunkRows,
  buildKbDocumentRow,
  EMBEDDING_MODEL,
  estimateTokens,
  indexableItems,
  normalize,
  parseProposedDoc,
  proposeSystemPrompt,
  type KbChunkInput,
  type KbDocMeta,
  type NormalizedFormat,
  type ProposedDoc,
} from '@shift/core';
import { revalidatePath } from 'next/cache';

import { getSessionUser, isAdmin, isHouseAdmin, isRsm, type SessionUser } from '../auth';
import { createServiceClient } from '../supabase/server';

const BUCKET = 'kb-uploads';
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

// kb_intake and the new temporal columns are not yet in the generated
// database.types.ts: the migration (20260711000001/2) is authored and validated but not
// applied to the drift-blocked local DB, so `supabase gen types` cannot include them.
// Reach the new tables through this untyped view until types are regenerated with
// `supabase gen types typescript --local` after the migration lands; storage stays typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseFrom = { from: (table: string) => any };

function isKbAdmin(u: SessionUser | null): boolean {
  return isHouseAdmin(u) || isRsm(u) || isAdmin(u);
}

function formatFromName(name: string): NormalizedFormat {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  return 'text';
}

// PDF text extraction implements the core PdfTextExtractor seam (INTAKE_PLAN Phase 1).
// unpdf is a serverless-friendly pdf.js build (no native deps, no filesystem), so it runs
// in the Next server runtime. Returns the merged text layer + page count; an empty text
// layer (a scan) falls through to normalizePdfText's "needs OCR" warning downstream.
async function extractPdf(bytes: Uint8Array): Promise<{ text: string; pageCount?: number } | null> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes);
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text, pageCount: totalPages };
}

async function voyageEmbed(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (apiKey === undefined) throw new Error('VOYAGE_API_KEY not set');
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts, model: EMBEDDING_MODEL, input_type: 'document' }),
  });
  if (!res.ok) throw new Error(`Voyage error ${res.status}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

async function claudePropose(text: string, anchorDate: string): Promise<ProposedDoc | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system: proposeSystemPrompt(anchorDate),
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}`);
  const json = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const raw = json.content.find((c) => c.type === 'text')?.text ?? '';
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) return null;
  try {
    return parseProposedDoc(JSON.parse(raw.slice(jsonStart, jsonEnd + 1)));
  } catch {
    return null;
  }
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

/** Upload a file into the intake queue, then normalize + propose. Returns the intake id. */
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
  await processIntake(intakeId); // normalize + propose inline; advances status
  revalidatePath('/admin/knowledge');
  return { ok: true, data: { intakeId } };
}

/** Normalize the stored file and draft a proposal with Claude. Advances status. */
export async function processIntake(intakeId: string): Promise<ActionResult<{ status: string }>> {
  const me = await getSessionUser();
  if (!isKbAdmin(me)) return { ok: false, error: 'not authorized' };
  const svc = createServiceClient();
  const db = svc as unknown as LooseFrom;

  const { data: row, error } = await db
    .from('kb_intake')
    .select('original_storage_path, input_format, created_at')
    .eq('intake_id', intakeId)
    .single();
  if (error || row === null) return { ok: false, error: 'intake not found' };
  const rec = row as {
    original_storage_path: string;
    input_format: NormalizedFormat;
    created_at: string;
  };

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

  await setStatus('normalizing', 'Reading document');
  const { data: blob, error: dlErr } = await svc.storage
    .from(BUCKET)
    .download(rec.original_storage_path);
  if (dlErr || blob === null) {
    await setStatus('failed', `download failed: ${dlErr?.message ?? 'unknown'}`);
    return { ok: false, error: 'download failed' };
  }

  let raw: string;
  let pageCount: number | undefined;
  if (rec.input_format === 'pdf') {
    const extracted = await extractPdf(new Uint8Array(await blob.arrayBuffer()));
    if (extracted === null) {
      await setStatus('failed', 'PDF text extractor is not configured on the server yet.');
      return { ok: false, error: 'pdf extractor unavailable' };
    }
    raw = extracted.text;
    pageCount = extracted.pageCount;
  } else {
    raw = await blob.text();
  }

  const normalized = normalize({ format: rec.input_format, raw, pageCount });
  if (normalized.text.length === 0) {
    await setStatus('failed', 'Document is empty after normalization.');
    return { ok: false, error: 'empty' };
  }

  let proposed: ProposedDoc | null;
  try {
    proposed = await claudePropose(normalized.text, nyDate(new Date(rec.created_at)));
  } catch (err) {
    await setStatus('failed', `proposal failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return { ok: false, error: 'propose failed' };
  }
  if (proposed === null) {
    await setStatus('failed', 'Could not draft a valid proposal from this document.');
    return { ok: false, error: 'invalid proposal' };
  }

  await setStatus('proposed', 'Ready for review', {
    normalized_text: normalized.text,
    proposed_meta: proposed,
    representations: proposed.representations,
  });
  revalidatePath('/admin/knowledge');
  return { ok: true, data: { status: 'proposed' } };
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
    .select('proposed_meta')
    .eq('intake_id', intakeId)
    .single();
  if (error || row === null) return { ok: false, error: 'intake not found' };
  const proposed = (editedMeta ??
    (row as { proposed_meta: ProposedDoc }).proposed_meta) as ProposedDoc | null;
  if (proposed === null) return { ok: false, error: 'no proposal to approve' };

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
  try {
    embeddings = await voyageEmbed(chunkInputs.map((c) => c.content));
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

  await db
    .from('kb_intake')
    .update({ status: 'live', status_detail: 'Live', document_id: documentId })
    .eq('intake_id', intakeId);
  revalidatePath('/admin/knowledge');
  return { ok: true, data: { documentId, chunks: chunkRows.length } };
}

export interface IntakeDetail {
  intakeId: string;
  status: string;
  normalizedText: string | null;
  proposed: ProposedDoc | null;
}

/** Load one intake row's normalized text + proposal for the review panel. */
export async function loadIntakeDetail(intakeId: string): Promise<ActionResult<IntakeDetail>> {
  const me = await getSessionUser();
  if (!isKbAdmin(me)) return { ok: false, error: 'not authorized' };
  const svc = createServiceClient();
  const db = svc as unknown as LooseFrom;
  const { data, error } = await db
    .from('kb_intake')
    .select('intake_id, status, normalized_text, proposed_meta')
    .eq('intake_id', intakeId)
    .single();
  if (error || data === null) return { ok: false, error: 'intake not found' };
  const rec = data as Record<string, unknown>;
  return {
    ok: true,
    data: {
      intakeId: rec.intake_id as string,
      status: rec.status as string,
      normalizedText: (rec.normalized_text as string | null) ?? null,
      proposed: (rec.proposed_meta as ProposedDoc | null) ?? null,
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
