// Desk Assistant — retrieval ranking + grounding decision (V1_SCOPE §4.1, §7.3).
// Pure. The Edge Function runs the pgvector similarity query, hands the candidate
// rows here for scope-filtering + ranking + the grounded-or-defer decision, then
// generates over the returned context.

import { OVERLAY_TOLERANCE, overlayBoost } from './overlay.js';
import { canReadItem } from './scope.js';
import { DURABLE_WINDOW, isInEffect, type EffectiveWindow } from './temporal.js';
import type { ItemScope, RequesterContext } from './types.js';

export interface RetrievalCandidate {
  chunkId: string;
  documentId: string;
  content: string;
  /** Human citation label from the parent document, e.g. "summer binder, keys". */
  sourceRef: string;
  scope: ItemScope;
  /** Cosine similarity in [0,1]; 1 = identical. Computed by the vector query. */
  similarity: number;
  /**
   * Validity window (INTAKE_PLAN section 4a). Omit for a durable rule. When `asOf` is
   * supplied to selectContext, chunks not in effect as of that date are dropped so an
   * expired announcement never grounds an answer.
   */
  effective?: EffectiveWindow;
  /**
   * Parent source's last-updated ISO timestamp, if known. Used only as a recency
   * tiebreak so a newer source supersedes an older one on a near-tie (INTAKE_PLAN
   * section 4a.3 #4). Write-time idempotent replace does the primary supersession.
   */
  sourceUpdatedAt?: string;
}

export interface RankedChunk extends RetrievalCandidate {
  rank: number;
}

export interface RetrievalOptions {
  topK?: number;
  /** Similarity at which the best chunk grounds outright, with no background comparison. */
  groundingThreshold?: number;
  /** Hard floor: below this the best chunk never grounds. See isGroundedByDistribution. */
  groundingFloor?: number;
  /** Required gap between the best chunk and the pool median. See isGroundedByDistribution. */
  groundingMargin?: number;
  /** Cap chunks per source document so one long doc cannot crowd out others. */
  perDocumentLimit?: number;
  /**
   * The asking worker's home house. When set, home-house overlay chunks get a small
   * precedence boost over shared chunks within OVERLAY_TOLERANCE (V1_SCOPE §6.2).
   * Omit for house-agnostic ranking.
   */
  requesterHouseId?: string;
  /** Override the overlay precedence tolerance (default OVERLAY_TOLERANCE). */
  overlayTolerance?: number;
  /**
   * NY-local ISO date/timestamp the question is "as of" (usually the query time, but a
   * dated question like "next Tuesday" passes that date). When set, chunks whose
   * validity window is not in effect as of this value are filtered out before ranking.
   * Omit to disable temporal filtering (durable-only corpora).
   */
  asOf?: string;
}

export interface RetrievalResult {
  /** Scope-filtered, ranked context passed to generation (may be empty). */
  context: RankedChunk[];
  /** True iff at least one in-scope chunk meets the grounding threshold. */
  grounded: boolean;
}

export const DEFAULT_TOP_K = 6;
/** Similarity at which the best chunk is grounding outright, with no background comparison. */
export const DEFAULT_GROUNDING_THRESHOLD = 0.5;
/** Hard floor: below this the best chunk never grounds, however isolated it looks. */
export const DEFAULT_GROUNDING_FLOOR = 0.3;
/** How far the best chunk must stand above the query's background to count as a real match. */
export const DEFAULT_GROUNDING_MARGIN = 0.08;
export const DEFAULT_PER_DOCUMENT_LIMIT = 3;

/**
 * Decide grounding from the SHAPE of the candidate distribution, not an absolute cutoff alone.
 *
 * Absolute cosine similarity is not comparable across questions. Measured against the Harnwell
 * summer binder on 2026-07-22, the very same correct chunk scored 0.5346 for a long keyword-rich
 * question but only 0.3688 for a short one, while an off-topic "wifi password" question scored an
 * irrelevant chunk 0.4080. A single 0.5 cutoff therefore deferred two of three valid MindCore
 * guest questions and would have admitted the off-topic one had the cutoff simply been lowered.
 *
 * What DOES separate them is how far the best chunk stands above the background of its OWN query's
 * pool: on-topic tops beat their pool median by 0.11 to 0.15, off-topic tops by only 0.03 to 0.07.
 *
 * The background statistic is the pool MEDIAN, deliberately NOT the runner-up. Once the KB holds
 * several documents that genuinely bear on one question (a program's own row PLUS the house-wide
 * definition of "day visitor", say), the runner-up is itself relevant, so a top-vs-runner-up margin
 * would collapse toward zero and wrongly defer exactly the best-covered questions. A median barely
 * moves when a handful of chunks are relevant, so it keeps working as the KB grows.
 */
export function isGroundedByDistribution(
  similarities: readonly number[],
  options: { groundingThreshold?: number; groundingFloor?: number; groundingMargin?: number } = {},
): boolean {
  const threshold = options.groundingThreshold ?? DEFAULT_GROUNDING_THRESHOLD;
  const floor = options.groundingFloor ?? DEFAULT_GROUNDING_FLOOR;
  const margin = options.groundingMargin ?? DEFAULT_GROUNDING_MARGIN;
  if (similarities.length === 0) return false;
  const top = Math.max(...similarities);
  if (top < floor) return false;
  if (top >= threshold) return true;
  // Too small a pool to have a meaningful background; fall back to the absolute cutoff.
  if (similarities.length < 3) return false;
  const sorted = [...similarities].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return top - median >= margin;
}

/**
 * Filter candidates to what the requester may read, rank by similarity, cap per
 * document, take top-K, and decide whether the result is grounded. A non-grounded
 * result MUST trigger the defer-and-route path (V1_SCOPE §8 rule 1) — the caller
 * checks `grounded`.
 */
export function selectContext(
  requester: RequesterContext,
  candidates: readonly RetrievalCandidate[],
  options: RetrievalOptions = {},
): RetrievalResult {
  const topK = Math.max(1, options.topK ?? DEFAULT_TOP_K);
  const threshold = options.groundingThreshold ?? DEFAULT_GROUNDING_THRESHOLD;
  const perDoc = Math.max(1, options.perDocumentLimit ?? DEFAULT_PER_DOCUMENT_LIMIT);

  const readable = candidates
    .filter((c) => canReadItem(requester, c.scope))
    // Temporal validity: drop chunks not in effect as of the query date (INTAKE_PLAN
    // section 4a). A chunk with no window is durable and always kept.
    .filter(
      (c) => options.asOf === undefined || isInEffect(c.effective ?? DURABLE_WINDOW, options.asOf),
    );

  // Stable sort by EFFECTIVE score (raw similarity + optional home-overlay boost),
  // then newer source first (supersession tiebreak), then chunkId asc for determinism.
  // Grounding below still uses RAW similarity, so neither the overlay boost nor the
  // recency tiebreak affects grounding, only placement.
  const homeHouse = options.requesterHouseId ?? null;
  const tolerance = options.overlayTolerance ?? OVERLAY_TOLERANCE;
  const effective = (c: RetrievalCandidate): number =>
    c.similarity + overlayBoost(c.scope.houseScope, homeHouse, tolerance);
  const newer = (a: RetrievalCandidate, b: RetrievalCandidate): number => {
    const av = a.sourceUpdatedAt ?? '';
    const bv = b.sourceUpdatedAt ?? '';
    return av === bv ? 0 : av > bv ? -1 : 1;
  };
  const sorted = [...readable].sort(
    (a, b) =>
      effective(b) - effective(a) ||
      newer(a, b) ||
      (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0),
  );

  const perDocCount = new Map<string, number>();
  const picked: RetrievalCandidate[] = [];
  for (const c of sorted) {
    const n = perDocCount.get(c.documentId) ?? 0;
    if (n >= perDoc) continue;
    perDocCount.set(c.documentId, n + 1);
    picked.push(c);
    if (picked.length >= topK) break;
  }

  const context = picked.map((c, i) => ({ ...c, rank: i }));
  // Grounding reads the FULL readable pool, not just the topK slice: the background median is a
  // better estimate over the whole candidate set, and the best chunk is the same either way.
  const grounded = isGroundedByDistribution(
    readable.map((c) => c.similarity),
    // Spread the optional keys conditionally rather than passing them as explicit
    // `undefined`: under `exactOptionalPropertyTypes` an absent key and a key set to
    // undefined are different types, and the callee declares these as optional-absent.
    {
      groundingThreshold: threshold,
      ...(options.groundingFloor === undefined ? {} : { groundingFloor: options.groundingFloor }),
      ...(options.groundingMargin === undefined
        ? {}
        : { groundingMargin: options.groundingMargin }),
    },
  );
  return { context, grounded };
}
