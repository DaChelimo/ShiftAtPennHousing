// Desk Assistant — Voyage AI embeddings client (Deno). voyage-3, 1024-dim (must
// match the vector(1024) column + EMBEDDING_DIM in packages/core). Deploy-time
// secret VOYAGE_API_KEY; callers handle absence with a clear 503 (never crash).

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
export const VOYAGE_MODEL = 'voyage-3';
export const VOYAGE_DIM = 1024;

/** Embed texts. input_type 'query' for a question, 'document' for corpus text. */
export async function voyageEmbed(
  texts: string[],
  opts: { apiKey: string; inputType: 'query' | 'document' },
): Promise<number[][]> {
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts, model: VOYAGE_MODEL, input_type: opts.inputType }),
  });
  if (!res.ok) {
    throw new Error(`Voyage error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}
