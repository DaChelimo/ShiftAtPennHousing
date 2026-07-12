// Desk Assistant — embeddings provider seam (V1_SCOPE §7.1, decision 2026-07-10).
//
// The provider is Voyage AI voyage-3 (1024-dim). It sits behind this interface so
// the pipeline (chunker, ingest, retrieval) never hard-codes a vendor: the Edge
// Function supplies a concrete `EmbeddingProvider`, and a future switch is a
// re-embed, not a rewrite. EMBEDDING_DIM MUST equal the vector(N) column dimension
// in the foundations migration.

export const EMBEDDING_MODEL = 'voyage-3';
export const EMBEDDING_DIM = 1024;

export interface EmbeddingProvider {
  /** Vendor model id, e.g. "voyage-3". */
  readonly model: string;
  /** Output dimension; MUST match the vector(N) column. */
  readonly dimension: number;
  /**
   * Embed a batch of texts, preserving order. Implementations live in the Edge
   * Function layer (they make the network call); core stays pure.
   */
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Guard used by the ingest path: a provider whose dimension disagrees with the
 * schema would silently corrupt the index, so we fail fast instead.
 */
export function assertEmbeddingDimension(vector: readonly number[]): void {
  if (vector.length !== EMBEDDING_DIM) {
    throw new Error(
      `embedding dimension mismatch: expected ${EMBEDDING_DIM}, got ${vector.length}`,
    );
  }
}
