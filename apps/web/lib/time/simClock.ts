import { cache } from 'react';

import { cachedGlobal, invalidateGlobal } from '../cache/ttl';
import { createServiceClient } from '../supabase/server';

// Simulated clock. The whole app reads "now" through simNow() so a time-travel offset
// (dev_sim_clock.offset_seconds, set from the top-bar card) fast-forwards both the website
// and the orchestrator off one shared clock. Moving it is admin-only, enforced at the
// database layer (dev_sim_clock_admin_gate, migration 20260805000001) regardless of
// environment — production included, deliberately, so the project administrator can still
// exercise time-driven flows there. The default and the only state anyone else ever sees is
// offset 0, which makes simNow() identical to the wall clock.

const OFFSET_KEY = 'dev_sim_clock:offset_seconds';
// Short: the offset only moves when someone drives the dev clock card, and that
// action invalidates the entry explicitly (see devClock actions), so this TTL is a
// backstop for an offset changed by the orchestrator harness or by raw SQL.
const OFFSET_TTL_MS = 5_000;

// Offset (seconds) currently applied, for the card's live display. 0 = real time.
//
// One globally-shared row, so it is memoized process-wide rather than re-read on every
// navigation. React cache() still collapses repeat calls within a single render.
export const getSimOffsetSeconds = cache(
  async (): Promise<number> =>
    cachedGlobal(OFFSET_KEY, OFFSET_TTL_MS, async () => {
      const svc = createServiceClient();
      const { data } = await svc
        .from('dev_sim_clock')
        .select('offset_seconds')
        .eq('id', true)
        .maybeSingle();
      return data?.offset_seconds ?? 0;
    }),
);

// Drop the memoized offset so the next read reflects a just-written value.
export function invalidateSimOffset(): void {
  invalidateGlobal(OFFSET_KEY);
}

// The current simulated instant.
//
// This used to call the app_now() RPC, one remote round trip on every render of every
// page (the layout plus most pages, deduped per request but paid again on every
// navigation). app_now() is by definition `now() + dev_sim_clock.offset_seconds`, so the
// same instant is available from the memoized offset above with no round trip at all on
// the hot path. The DB is still the single source of the OFFSET, which is what actually
// has to agree between the website and the orchestrator; only the "what time is it"
// half is read locally.
//
// Wrapped in React's cache() (per-request) so one navigation sees one consistent `now`
// across the layout and every page segment.
export const simNow = cache(async (): Promise<Date> => {
  return new Date(Date.now() + (await getSimOffsetSeconds()) * 1000);
});
