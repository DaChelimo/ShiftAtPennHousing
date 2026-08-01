// Process-level TTL memo for GLOBAL, non-user-scoped reads.
//
// The admin shell resolves the same handful of configuration rows on every single
// navigation — the house list, the designated project administrator, the dev clock
// offset. Each one is a remote Supabase round trip (~130ms p50, ~280ms p90 against
// the hosted project), and React's cache() only dedupes them WITHIN one request, so
// every tab click paid them again from scratch.
//
// This memo is deliberately process-wide and therefore ONLY safe for values that are
// identical for every caller. Never memoize anything derived from the signed-in user
// here: write scope is resolved from getSessionUser(), which stays per-request via
// React cache() for exactly that reason.
type Entry = { value: unknown; expiresAt: number };

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

export function cachedGlobal<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit !== undefined && hit.expiresAt > now) return Promise.resolve(hit.value as T);

  // Collapse a stampede: concurrent renders share one in-flight load rather than
  // each firing its own round trip while the entry is cold.
  const pending = inFlight.get(key);
  if (pending !== undefined) return pending as Promise<T>;

  const p = load()
    .then((value) => {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, p);
  return p;
}

// Called by the writers that change one of these rows so the next read is fresh
// instead of waiting out the TTL.
export function invalidateGlobal(key: string): void {
  entries.delete(key);
}
