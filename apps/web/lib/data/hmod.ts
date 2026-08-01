import { cache } from 'react';

import { cachedGlobal } from '../cache/ttl';
import { createServiceClient } from '../supabase/server';

// S6 — HMOD context I/O (web-remediation #18a/#8/#9). Thin service-client wrappers
// the layout + pages call: resolve who is HMOD now (reuses the existing
// resolve_hmod_on_duty RPC — no new RPC), the signed-in user's due/unread
// notification count for the bell, and the full house list for the switcher.
// The pure derivation (pill state, ?house= gating) lives in @shift/core.

// D2 — the on-duty HMOD's user_id at `now`, or null if no rotor row / unresolved.
// resolve_hmod_on_duty shifts the moment back 8h (Fri-08:00 boundary), snaps to the
// most-recent Friday, looks up hmod_rotor, and walks hm_leave. It is callable by the
// service client (no REVOKE) and returns a single uuid (or null).
// Wrapped in React's cache() (per-request): the layout and several pages all
// resolve HMOD-on-duty for the same `now` (itself memoized by simNow()), so this
// dedupes what used to be a repeat RPC round trip on every navigation.
export const getOnDutyHmodId = cache(async (now: Date = new Date()): Promise<string | null> => {
  const svc = createServiceClient();
  const { data, error } = await svc.rpc('resolve_hmod_on_duty', { p_at: now.toISOString() });
  if (error !== null || data === null || data === undefined) return null;
  return data;
});

// D4 — count of the user's DUE, unacknowledged notifications (unread = acknowledged_at
// IS NULL; there is no read_at column). Delivery is async/at-least-once, so the bell
// reflects "due + unacknowledged", not delivery confirmation.
export const getUnreadCount = cache(
  async (userId: string, now: Date = new Date()): Promise<number> => {
    const svc = createServiceClient();
    const { count } = await svc
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_user_id', userId)
      .is('acknowledged_at', null)
      .lte('scheduled_for', now.toISOString());
    return count ?? 0;
  },
);

// D11 — the full house list for the switcher (all 13). `harnwell` is restricted
// (Harnwell-trained only); the flag drives the switcher chip. Ordered by id so the
// menu is stable.
//
// Non-staffable houses are excluded: they exist only to own a non-worker account
// (Allied) and are not places anyone is scheduled. This list also gates `?house=`
// for the calendar, builder, hours and preferences pages, and supplies the
// transfer-destination menu, so a pseudo-house leaking in here is load-bearing.
// The 13 staffable houses are reference data: the row set changes only when a house is
// added or retired, yet the shell re-read it on every navigation for anyone who can
// switch houses. Memoized process-wide (it takes no arguments and is identical for every
// caller, so there is nothing user-scoped to leak) behind a short TTL, with React cache()
// still collapsing repeat calls inside a single render.
const SHELL_HOUSES_TTL_MS = 300_000;

export const getShellHouses = cache(
  async (): Promise<{ id: string; name: string; restricted: boolean }[]> =>
    cachedGlobal('houses:staffable', SHELL_HOUSES_TTL_MS, async () => {
      const svc = createServiceClient();
      const { data } = await svc
        .from('houses')
        .select('id, name')
        .eq('is_staffable', true)
        .order('id');
      return (data ?? []).map((h) => ({
        id: h.id,
        name: h.name,
        restricted: h.id === 'harnwell',
      }));
    }),
);
