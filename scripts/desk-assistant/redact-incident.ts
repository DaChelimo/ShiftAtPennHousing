// Desk Assistant — incident redaction (V1_SCOPE §7.2). Operator CLI.
//
//   tsx scripts/desk-assistant/redact-incident.ts <incident.txt> \
//        [--house <id>] [--occurred <YYYY-MM-DD>] [--dry-run] [--fake <lesson|none>]
//
// Stores the RAW incident (always, access-controlled, never indexed), asks Claude to
// classify + de-identify, and on a valid lesson ingests a de-identified
// incident_lesson document into the retrievable index. Disciplinary/private incidents
// store raw only. --fake lets you exercise the flow offline (no ANTHROPIC/VOYAGE keys):
//   --fake lesson  -> synthesize a generic lesson; --fake none -> no_lesson.
//
// Requires @shift/core built. Real lessons are embedded with Voyage before indexing.

import { readFileSync } from 'node:fs';

import { Client } from 'pg';

import {
  assertEmbeddingDimension,
  chunkDocument,
  containsIncidentLeakage,
  EMBEDDING_MODEL,
  parseRedactionDecision,
  REDACTION_SYSTEM_PROMPT,
  validateLesson,
  type RedactionDecision,
} from '../../packages/core/dist/index.js';

const DB_URL = process.env.SEED_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function classify(
  rawText: string,
  fake: string | undefined,
): Promise<RedactionDecision | null> {
  if (fake === 'lesson')
    return {
      kind: 'lesson',
      lesson:
        'Verify identity against the roster before granting any access, and do not grant when unsure.',
    };
  if (fake === 'none')
    return { kind: 'no_lesson', reason: 'disciplinary, no generalizable lesson' };

  const apiKey = process.env.CLAUDE_AI_CHATBOT_DESK_ASSISTANT;
  if (apiKey === undefined)
    throw new Error('CLAUDE_AI_CHATBOT_DESK_ASSISTANT not set (or pass --fake lesson|none)');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.DA_GENERATION_MODEL ?? 'claude-sonnet-5',
      max_tokens: 512,
      system: REDACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: rawText }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const text = json.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  try {
    return parseRedactionDecision(JSON.parse(text));
  } catch {
    return null;
  }
}

async function voyageEmbed(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts, model: EMBEDDING_MODEL, input_type: 'document' }),
  });
  if (!res.ok) throw new Error(`Voyage error ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { data: Array<{ embedding: number[] }> }).data.map(
    (d) => d.embedding,
  );
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (file === undefined || file.startsWith('--')) {
    throw new Error(
      'usage: redact-incident.ts <incident.txt> [--house id] [--occurred date] [--dry-run] [--fake lesson|none]',
    );
  }
  const house = arg('--house') ?? null;
  const occurred = arg('--occurred') ?? null;
  const dryRun = process.argv.includes('--dry-run');
  const fake = arg('--fake');
  const rawText = readFileSync(file, 'utf8').trim();

  const decision = await classify(rawText, fake);
  if (decision === null) throw new Error('could not parse a redaction decision from the model');

  console.log(`decision: ${decision.kind}`);
  if (decision.kind === 'lesson') {
    const check = validateLesson(decision.lesson);
    if (!check.ok) {
      throw new Error(
        `lesson failed PII validation (${check.violations.join(', ')}); NOT indexing. Store raw only.`,
      );
    }
    if (containsIncidentLeakage(decision.lesson))
      throw new Error('lesson tripped leakage guard; NOT indexing.');
    console.log(`  lesson: ${decision.lesson}`);
  } else {
    console.log(`  reason: ${decision.reason}`);
  }

  if (dryRun) {
    console.log('dry-run: no DB writes.');
    return;
  }

  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    const isLesson = decision.kind === 'lesson';
    let lessonDocId: string | null = null;

    if (isLesson) {
      const lesson = decision.lesson;
      const chunks = chunkDocument(lesson);
      let embeddings: number[][];
      if (fake) {
        embeddings = chunks.map(() => new Array(1024).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
      } else {
        embeddings = await voyageEmbed(
          chunks.map((c) => c.content),
          process.env.VOYAGE_API_KEY!,
        );
      }
      for (const e of embeddings) assertEmbeddingDimension(e);

      const doc = await db.query<{ document_id: string }>(
        `INSERT INTO kb_documents (title, source_type, source_ref, house_scope, sensitivity, allowed_roles)
         VALUES ($1, 'incident_lesson', $2, $3, 'general', '{}') RETURNING document_id`,
        ['Incident lesson', 'de-identified incident lesson', house],
      );
      lessonDocId = doc.rows[0]!.document_id;
      for (let i = 0; i < chunks.length; i += 1) {
        await db.query(
          `INSERT INTO kb_chunks (document_id, chunk_index, content, embedding, house_scope, sensitivity, allowed_roles, token_count)
           VALUES ($1, $2, $3, $4::vector, $5, 'general', '{}', $6)`,
          [
            lessonDocId,
            chunks[i]!.index,
            chunks[i]!.content,
            `[${embeddings[i]!.join(',')}]`,
            house,
            chunks[i]!.tokenCount,
          ],
        );
      }
    }

    await db.query(
      `INSERT INTO kb_incidents_raw (raw_content, occurred_on, house_id, classification, lesson_document_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [rawText, occurred, house, isLesson ? 'lesson_extracted' : 'private_no_lesson', lessonDocId],
    );

    await db.query('COMMIT');
    console.log(
      isLesson
        ? `stored raw incident + indexed lesson document ${lessonDocId}.`
        : 'stored raw incident only (no lesson indexed).',
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
