// Desk Assistant — knowledge ingestion (V1_SCOPE §7.1). Operator CLI, not an Edge
// Function: ingestion is a controlled pipeline over pre-approved sources, so it runs
// as a script with the service-role DB connection.
//
//   tsx scripts/desk-assistant/ingest.ts <file.md> [--replace] [--dry-run] [--fake]
//
//   --replace   delete any prior document with the same (source_type, source_ref,
//               house_scope) before inserting (idempotent re-ingestion).
//   --dry-run   parse + chunk + print the plan; touch neither embeddings nor the DB.
//   --fake      use the deterministic offline embedder instead of Voyage (no API key
//               needed; for local verification only). Real ingest uses VOYAGE_API_KEY.
//
// Requires @shift/core built (pnpm --filter @shift/core build) — imported from dist
// because package `exports` do not resolve under a root-run tsx (see seasons-cast.ts).

import { readFileSync } from 'node:fs';

import { Client } from 'pg';

import {
  assertEmbeddingDimension,
  buildKbChunkRows,
  buildKbDocumentRow,
  chunkDocument,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  type KbDocMeta,
  type TextChunk,
} from '../../packages/core/dist/index.js';

const DB_URL = process.env.SEED_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

interface DocMeta {
  title: string;
  sourceType: string;
  sourceRef: string;
  houseScope: string | null;
  sensitivity: string;
  allowedRoles: string[];
}

function parseArgs(argv: string[]): {
  file: string;
  replace: boolean;
  dryRun: boolean;
  fake: boolean;
} {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const file = argv.find((a) => !a.startsWith('--'));
  if (file === undefined) {
    throw new Error('usage: ingest.ts <file.md> [--replace] [--dry-run] [--fake]');
  }
  return {
    file,
    replace: flags.has('--replace'),
    dryRun: flags.has('--dry-run'),
    fake: flags.has('--fake'),
  };
}

// Minimal frontmatter parser: a leading `---\n ... \n---\n` block of `key: value`
// lines. Empty value = null (house_scope) or [] (allowed_roles).
function parseFrontmatter(raw: string): { meta: DocMeta; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (match === null) throw new Error('missing frontmatter block');
  const [, fmText, body] = match as unknown as [string, string, string];

  const fm: Record<string, string> = {};
  for (const line of fmText.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  const list = (v: string | undefined): string[] =>
    v === undefined || v === ''
      ? []
      : v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

  const meta: DocMeta = {
    title: fm.title ?? 'Untitled',
    sourceType: fm.source_type ?? 'fixture',
    sourceRef: fm.source_ref ?? 'unknown',
    houseScope: fm.house_scope && fm.house_scope !== '' ? fm.house_scope : null,
    sensitivity: fm.sensitivity ?? 'general',
    allowedRoles: list(fm.allowed_roles),
  };
  return { meta, body: body.trim() };
}

// Deterministic offline embedder: token-hash bag of words into EMBEDDING_DIM, then
// L2-normalize. Cosine similarity then tracks token overlap, so retrieval is
// meaningful without a provider. NEVER used for real ingest (Voyage is).
function fakeEmbed(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i += 1) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    vec[Math.abs(h) % EMBEDDING_DIM] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}

async function voyageEmbed(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts, model: EMBEDDING_MODEL, input_type: 'document' }),
  });
  if (!res.ok) throw new Error(`Voyage error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

async function main(): Promise<void> {
  const { file, replace, dryRun, fake } = parseArgs(process.argv.slice(2));
  const { meta, body } = parseFrontmatter(readFileSync(file, 'utf8'));
  const chunks: TextChunk[] = chunkDocument(body);

  console.log(`document: ${meta.title}`);
  console.log(
    `  source_ref=${meta.sourceRef} house_scope=${meta.houseScope ?? '(shared)'} ` +
      `sensitivity=${meta.sensitivity} allowed_roles=[${meta.allowedRoles.join(',')}]`,
  );
  console.log(`  ${chunks.length} chunk(s)`);

  if (dryRun) {
    for (const c of chunks) {
      console.log(
        `  [${c.index}] ~${c.tokenCount} tok: ${c.content.slice(0, 72).replace(/\n/g, ' ')}...`,
      );
    }
    console.log('dry-run: no embeddings, no DB writes.');
    return;
  }

  let embeddings: number[][];
  if (fake) {
    embeddings = chunks.map((c) => fakeEmbed(c.content));
  } else {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (apiKey === undefined)
      throw new Error('VOYAGE_API_KEY not set (or pass --fake for offline)');
    embeddings = await voyageEmbed(
      chunks.map((c) => c.content),
      apiKey,
    );
  }
  for (const e of embeddings) assertEmbeddingDimension(e);

  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    if (replace) {
      await db.query(
        `DELETE FROM kb_documents
           WHERE source_type = $1::da_source_type_enum AND source_ref = $2
             AND house_scope IS NOT DISTINCT FROM $3`,
        [meta.sourceType, meta.sourceRef, meta.houseScope],
      );
    }
    // Row shaping is shared with the web approve path via packages/core (INTAKE_PLAN
    // section 5). The CLI markdown path is all-durable; the intake path passes per-item
    // windows. Both funnel through buildKb*Row so the columns can never drift.
    const docMeta: KbDocMeta = {
      title: meta.title,
      sourceType: meta.sourceType as KbDocMeta['sourceType'],
      sourceRef: meta.sourceRef,
      houseScope: meta.houseScope,
      sensitivity: meta.sensitivity as KbDocMeta['sensitivity'],
      allowedRoles: meta.allowedRoles as KbDocMeta['allowedRoles'],
    };
    const docRow = buildKbDocumentRow(docMeta);
    const doc = await db.query<{ document_id: string }>(
      `INSERT INTO kb_documents
         (title, source_type, source_ref, house_scope, sensitivity, allowed_roles,
          temporality, effective_from, effective_until)
       VALUES ($1, $2::da_source_type_enum, $3, $4, $5::da_sensitivity_enum, $6,
               $7::da_temporality_enum, $8, $9)
       RETURNING document_id`,
      [
        docRow.title,
        docRow.source_type,
        docRow.source_ref,
        docRow.house_scope,
        docRow.sensitivity,
        docRow.allowed_roles,
        docRow.temporality,
        docRow.effective_from,
        docRow.effective_until,
      ],
    );
    const documentId = doc.rows[0]!.document_id;

    const chunkRows = buildKbChunkRows(
      docMeta,
      chunks.map((c) => ({ content: c.content, tokenCount: c.tokenCount })),
    );
    for (let i = 0; i < chunkRows.length; i += 1) {
      const r = chunkRows[i]!;
      await db.query(
        `INSERT INTO kb_chunks
           (document_id, chunk_index, content, embedding, house_scope, sensitivity,
            allowed_roles, token_count, temporality, effective_from, effective_until)
         VALUES ($1, $2, $3, $4::vector, $5, $6::da_sensitivity_enum, $7, $8,
                 $9::da_temporality_enum, $10, $11)`,
        [
          documentId,
          r.chunk_index,
          r.content,
          toVectorLiteral(embeddings[i]!),
          r.house_scope,
          r.sensitivity,
          r.allowed_roles,
          r.token_count,
          r.temporality,
          r.effective_from,
          r.effective_until,
        ],
      );
    }
    await db.query('COMMIT');
    console.log(
      `ingested document ${documentId} with ${chunks.length} chunk(s)${fake ? ' (fake embeddings)' : ''}.`,
    );
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
