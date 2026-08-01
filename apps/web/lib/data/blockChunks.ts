// Shared guard for block_id-scoped PostgREST reads.
//
// A full build/calendar week is 224 block_ids (7 days × 32 blocks). Passing them
// all to a single `.in('block_id', …)` builds an ~8 KB URL that PostgREST rejects
// with "URI too long" (414) — which silently returned zero rows, so calendars and
// the builder rendered empty / "no preference". A large match set can also exceed
// PostgREST's default row cap. Chunk the id list: each ~50-id batch keeps the URL
// ~2 KB and the per-batch row count bounded.
export const BLOCK_ID_CHUNK = 50;

// How many chunks may be in flight at once.
//
// The chunks used to be awaited one after another, so a week's calendar paid five
// serial round trips per chunked read and the live calendar had three of them —
// roughly fifteen sequential trips to a remote Postgres (~130ms each) for data that
// has no ordering dependency whatsoever. They now overlap, bounded so a wide date
// range cannot open an unbounded number of connections against PostgREST at once.
const CHUNK_CONCURRENCY = 6;

type ChunkResult<R> = { data: R[] | null; error: { message: string } | null };

// Run an id-scoped select in overlapping chunks and union the rows IN CHUNK ORDER.
//
// Order matters to callers that reduce with last-write-wins (the calendar's
// block_step_status read orders by fired_at), so results are collected into a
// slot per chunk and flattened at the end rather than appended on completion.
// In practice each id appears in exactly one chunk, but preserving the original
// sequential ordering keeps this a pure latency change.
async function selectInChunks<R>(
  ids: string[],
  label: string,
  run: (chunk: string[]) => PromiseLike<ChunkResult<R>>,
): Promise<R[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += BLOCK_ID_CHUNK) {
    chunks.push(ids.slice(i, i + BLOCK_ID_CHUNK));
  }
  const slots: R[][] = new Array(chunks.length).fill(null).map(() => []);

  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= chunks.length) return;
      // An error THROWS rather than yielding `[]` — a silent empty is exactly the
      // failure mode that hid the URI-too-long bug; callers surface it via the route
      // error boundary.
      const { data, error } = await run(chunks[i]!);
      if (error !== null) throw new Error(`${label} query failed: ${error.message}`);
      slots[i] = data ?? [];
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, () => worker()),
  );
  return slots.flat();
}

export function selectByBlockIdChunks<R>(
  blockIds: string[],
  run: (chunk: string[]) => PromiseLike<ChunkResult<R>>,
): Promise<R[]> {
  return selectInChunks(blockIds, 'block_id', run);
}

// The same guard for assignment_id-scoped reads (the pending-swap marks on the live
// calendar). A week's worth of seats is the same order of magnitude as its blocks, so
// it hits the same 414 and the same row cap; the failure mode is identical and just as
// silent, which is why this reuses the chunk size rather than inventing one.
export function selectByAssignmentIdChunks<R>(
  assignmentIds: string[],
  run: (chunk: string[]) => PromiseLike<ChunkResult<R>>,
): Promise<R[]> {
  return selectInChunks(assignmentIds, 'assignment_id', run);
}
