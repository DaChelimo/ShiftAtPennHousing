// Desk Assistant — citation assembly (V1_SCOPE §4.1: every substantive answer
// states where the guidance came from). Pure. Consumed by da-ask to attach
// citations to the assistant message and by the UI to render source chips.

import type { RankedChunk } from './retrieval.js';

export interface Citation {
  documentId: string;
  sourceRef: string;
  /** The specific chunks from this document that supported the answer. */
  chunkIds: string[];
}

/** Group ranked context by source document, preserving first-seen (rank) order. */
export function buildCitations(context: readonly RankedChunk[]): Citation[] {
  const byDoc = new Map<string, Citation>();
  for (const chunk of context) {
    const existing = byDoc.get(chunk.documentId);
    if (existing) {
      existing.chunkIds.push(chunk.chunkId);
    } else {
      byDoc.set(chunk.documentId, {
        documentId: chunk.documentId,
        sourceRef: chunk.sourceRef,
        chunkIds: [chunk.chunkId],
      });
    }
  }
  return [...byDoc.values()];
}

/**
 * One-line human attribution, e.g. "per the summer binder, keys section; per the
 * HM guide". No em/en dashes (project convention). Empty citations → ''.
 */
export function formatCitationLine(citations: readonly Citation[]): string {
  if (citations.length === 0) return '';
  return citations.map((c) => `per ${c.sourceRef}`).join('; ');
}
