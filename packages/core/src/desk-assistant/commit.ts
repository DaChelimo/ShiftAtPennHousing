// Desk Assistant — KB write-row builder (INTAKE_PLAN Phase 3, section 5). Pure: no
// Supabase, no pg. This is the ONE place that decides which columns a document and its
// chunks get written with, so the CLI (scripts/desk-assistant/ingest.ts), the web approve
// action, and the intake flow all shape rows identically. Each caller owns only the
// actual INSERT (with its own client) + attaching the embedding vector per chunk.
//
// Temporal fields (INTAKE_PLAN section 4a) are denormalized parent -> chunk exactly like
// house_scope / sensitivity, so match_kb_chunks can filter by validity without a join.

import { DURABLE_WINDOW, type EffectiveWindow } from './temporal.js';
import type { DeskRole, Sensitivity, SourceType } from './types.js';

export interface KbDocMeta {
  title: string;
  sourceType: SourceType;
  sourceRef: string;
  houseScope: string | null;
  sensitivity: Sensitivity;
  allowedRoles: DeskRole[];
  /** Document-level window; defaults to durable. Chunks may carry narrower windows. */
  window?: EffectiveWindow;
}

/** One chunk to be embedded + written, with its own validity window. */
export interface KbChunkInput {
  content: string;
  tokenCount: number;
  window?: EffectiveWindow;
}

export interface KbDocumentRow {
  title: string;
  source_type: SourceType;
  source_ref: string;
  house_scope: string | null;
  sensitivity: Sensitivity;
  allowed_roles: DeskRole[];
  temporality: EffectiveWindow['temporality'];
  effective_from: string | null;
  effective_until: string | null;
}

export interface KbChunkRow {
  chunk_index: number;
  content: string;
  house_scope: string | null;
  sensitivity: Sensitivity;
  allowed_roles: DeskRole[];
  token_count: number;
  temporality: EffectiveWindow['temporality'];
  effective_from: string | null;
  effective_until: string | null;
}

export function buildKbDocumentRow(meta: KbDocMeta): KbDocumentRow {
  const w = meta.window ?? DURABLE_WINDOW;
  return {
    title: meta.title,
    source_type: meta.sourceType,
    source_ref: meta.sourceRef,
    house_scope: meta.houseScope,
    sensitivity: meta.sensitivity,
    allowed_roles: meta.allowedRoles,
    temporality: w.temporality,
    effective_from: w.effectiveFrom,
    effective_until: w.effectiveUntil,
  };
}

/**
 * Build the chunk rows (without embeddings; the caller zips embedding[i] on by index).
 * Each chunk inherits the document scope and carries its own window (defaulting to the
 * document window, then durable). chunk_index is the array position.
 */
export function buildKbChunkRows(meta: KbDocMeta, chunks: readonly KbChunkInput[]): KbChunkRow[] {
  const docWindow = meta.window ?? DURABLE_WINDOW;
  return chunks.map((c, index) => {
    const w = c.window ?? docWindow;
    return {
      chunk_index: index,
      content: c.content,
      house_scope: meta.houseScope,
      sensitivity: meta.sensitivity,
      allowed_roles: meta.allowedRoles,
      token_count: c.tokenCount,
      temporality: w.temporality,
      effective_from: w.effectiveFrom,
      effective_until: w.effectiveUntil,
    };
  });
}
