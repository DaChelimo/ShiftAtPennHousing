// Desk Assistant — document chunking (V1_SCOPE §7.1). Pure: no Supabase, no
// network. The ingest Edge Function calls this, then embeds each chunk.
//
// Strategy: pack paragraphs (blank-line-separated) into chunks up to a character
// budget, carrying a small trailing overlap into the next chunk so a fact split
// across a boundary stays retrievable in at least one chunk. A single paragraph
// longer than the budget is hard-split on sentence boundaries, then by characters
// as a last resort. Deterministic — same input, same chunks.

export interface ChunkingOptions {
  /** Soft max characters per chunk. Default ~2000 (~500 tokens at 4 chars/token). */
  maxChars?: number;
  /** Characters of trailing context copied into the next chunk. Default 200. */
  overlapChars?: number;
}

export interface TextChunk {
  index: number;
  content: string;
  /** Rough token estimate (chars / 4); the embedder reports the real count. */
  tokenCount: number;
}

const DEFAULT_MAX_CHARS = 2000;
const DEFAULT_OVERLAP_CHARS = 200;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkDocument(text: string, options: ChunkingOptions = {}): TextChunk[] {
  const maxChars = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS);
  const overlapChars = Math.max(
    0,
    Math.min(options.overlapChars ?? DEFAULT_OVERLAP_CHARS, maxChars - 1),
  );

  const paragraphs = splitParagraphs(text);
  // Expand any oversized paragraph into budget-sized pieces up front.
  const units: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      units.push(para);
    } else {
      units.push(...hardSplit(para, maxChars));
    }
  }

  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    if (current === '') {
      current = unit;
      continue;
    }
    if (current.length + 2 + unit.length <= maxChars) {
      current = `${current}\n\n${unit}`;
    } else {
      chunks.push(current);
      current = overlapChars > 0 ? withOverlap(current, unit, overlapChars) : unit;
    }
  }
  if (current !== '') chunks.push(current);

  return chunks.map((content, index) => ({
    index,
    content,
    tokenCount: estimateTokens(content),
  }));
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// Copy the last `overlapChars` of the previous chunk (trimmed to a whitespace
// boundary so we do not cut a word) ahead of the next unit.
function withOverlap(prev: string, unit: string, overlapChars: number): string {
  let tail = prev.slice(-overlapChars);
  const space = tail.indexOf(' ');
  if (space > 0) tail = tail.slice(space + 1);
  return `${tail}\n\n${unit}`;
}

// Split an oversized paragraph on sentence boundaries, packing to the budget;
// fall back to a raw character slice for a single monster sentence.
function hardSplit(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [paragraph];
  const pieces: string[] = [];
  let current = '';
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence.length > maxChars) {
      if (current) {
        pieces.push(current);
        current = '';
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        pieces.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    if (current === '') {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= maxChars) {
      current = `${current} ${sentence}`;
    } else {
      pieces.push(current);
      current = sentence;
    }
  }
  if (current !== '') pieces.push(current);
  return pieces;
}
