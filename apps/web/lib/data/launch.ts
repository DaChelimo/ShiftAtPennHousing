import { createServiceClient } from '../supabase/server';
import { simNow } from '../time/simClock';

import { isStaggeredLaunchEnabled } from './config';

// Phase B — the staggered-launch admin console data. One board row per house with its
// launch state plus a lightweight readiness snapshot (roster size + whether future
// blocks exist) so the admin can judge whether a house is ready to go live.

export type LaunchHouse = {
  id: string;
  name: string;
  launchState: 'pre_launch' | 'live';
  launchedAt: string | null;
  rosterCount: number;
  futureBlockCount: number;
};

export type LaunchBoard = {
  enforced: boolean;
  houses: LaunchHouse[];
};

export async function getLaunchBoard(): Promise<LaunchBoard> {
  const service = createServiceClient();
  const nowIso = (await simNow()).toISOString();

  const [{ data: houseRows }, { data: rosterRows }] = await Promise.all([
    // Non-staffable houses are not launchable: they have no desk, no schedule and
    // no workers, so they would show as a permanently "no schedule" row.
    service
      .from('houses')
      .select('id, name, launch_state, launched_at')
      .eq('is_staffable', true)
      .order('name'),
    // Active workers' home houses, tallied in code (small set).
    service.from('users').select('home_house_id').eq('is_active', true),
  ]);

  const roster = new Map<string, number>();
  for (const r of rosterRows ?? []) {
    const h = r.home_house_id as string | null;
    if (h) roster.set(h, (roster.get(h) ?? 0) + 1);
  }

  const houses = houseRows ?? [];
  // Per-house count of live (non-voided) future blocks — a "has a schedule" signal.
  const futureCounts = await Promise.all(
    houses.map(async (h) => {
      const { count } = await service
        .from('shift_blocks')
        .select('*', { count: 'exact', head: true })
        .eq('house_id', h.id)
        .is('voided_at', null)
        .gt('block_start_at', nowIso);
      return count ?? 0;
    }),
  );

  return {
    enforced: await isStaggeredLaunchEnabled(),
    houses: houses.map((h, i) => ({
      id: h.id,
      name: h.name,
      launchState: (h.launch_state as 'pre_launch' | 'live') ?? 'pre_launch',
      launchedAt: h.launched_at,
      rosterCount: roster.get(h.id) ?? 0,
      futureBlockCount: futureCounts[i],
    })),
  };
}
