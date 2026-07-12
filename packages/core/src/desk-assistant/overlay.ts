// Desk Assistant — per-house overlay precedence (V1_SCOPE §6.2). Pure.
//
// Most procedures are shared; the per-house overlay differs mainly in
// contacts/access specifics. So when the worker's HOME-house overlay chunk and a
// shared chunk match a query with SIMILAR scores, the overlay should win placement
// (it is the more specific guidance for that house). We implement this as a small
// additive boost to a home-overlay chunk's effective sort score: an overlay outranks
// a shared chunk whenever `shared.similarity - overlay.similarity <= OVERLAY_TOLERANCE`.
// A clearly-more-relevant shared chunk (gap beyond tolerance) still wins.
//
// Grounding is judged on RAW similarity, never the boosted score — house preference
// must not manufacture grounding where the match quality is not there.

export const OVERLAY_TOLERANCE = 0.05;

/** A chunk is a home overlay when its house scope equals the worker's home house. */
export function isHomeOverlay(houseScope: string | null, homeHouseId: string | null): boolean {
  return houseScope !== null && homeHouseId !== null && houseScope === homeHouseId;
}

/** Additive sort boost for a home-overlay chunk (0 otherwise). */
export function overlayBoost(
  houseScope: string | null,
  homeHouseId: string | null,
  tolerance = OVERLAY_TOLERANCE,
): number {
  return isHomeOverlay(houseScope, homeHouseId) ? tolerance : 0;
}

/**
 * Stable re-rank applying overlay precedence. Exposed for direct testing; the
 * retrieval path folds the same boost into its single sort.
 */
export function applyOverlayPrecedence<
  T extends { chunkId: string; similarity: number; houseScope: string | null },
>(items: readonly T[], homeHouseId: string | null, tolerance = OVERLAY_TOLERANCE): T[] {
  return [...items].sort((a, b) => {
    const ea = a.similarity + overlayBoost(a.houseScope, homeHouseId, tolerance);
    const eb = b.similarity + overlayBoost(b.houseScope, homeHouseId, tolerance);
    if (eb !== ea) return eb - ea;
    return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0;
  });
}
