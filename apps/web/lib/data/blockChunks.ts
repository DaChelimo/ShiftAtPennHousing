// Shared guard for block_id-scoped PostgREST reads.
//
// A full build/calendar week is 224 block_ids (7 days × 32 blocks). Passing them
// all to a single `.in('block_id', …)` builds an ~8 KB URL that PostgREST rejects
// with "URI too long" (414) — which silently returned zero rows, so calendars and
// the builder rendered empty / "no preference". A large match set can also exceed
// PostgREST's default row cap. Chunk the id list: each ~50-id batch keeps the URL
// ~2 KB and the per-batch row count bounded.
export const BLOCK_ID_CHUNK = 50;

// Run a block_id-scoped select in chunks and union the rows. Unlike a bare query,
// an error THROWS rather than yielding `[]` — a silent empty is exactly the failure
// mode that hid the URI-too-long bug; callers surface it via the route error boundary.
export async function selectByBlockIdChunks<R>(
  blockIds: string[],
  run: (chunk: string[]) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < blockIds.length; i += BLOCK_ID_CHUNK) {
    const { data, error } = await run(blockIds.slice(i, i + BLOCK_ID_CHUNK));
    if (error !== null) throw new Error(`block_id query failed: ${error.message}`);
    if (data !== null) out.push(...data);
  }
  return out;
}
