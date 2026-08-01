import { cache } from 'react';

import { cachedGlobal, invalidateGlobal } from '../cache/ttl';
import { createServiceClient } from '../supabase/server';

export type SystemConfigRow = {
  configKey: string;
  configValue: string;
  valueType: string;
  modifiedByName: string | null;
  modifiedAt: string;
  notes: string | null;
};

// Who is the designated project administrator? This is ONE globally-shared config row
// that changes about never, but the admin shell read it on every navigation (twice per
// render before React cache() landed, once after). Memoize the row itself process-wide
// with a short TTL — it is not user-scoped, so it is safe to share — and keep the
// per-user comparison outside the cache. React cache() still wraps the exported
// function so repeat calls in one render are free even on a TTL miss.
const PROJECT_ADMIN_KEY = 'system_config:project_administrator_user_id';
const PROJECT_ADMIN_TTL_MS = 60_000;

async function projectAdministratorId(): Promise<string | null> {
  return cachedGlobal(PROJECT_ADMIN_KEY, PROJECT_ADMIN_TTL_MS, async () => {
    const service = createServiceClient();
    const { data } = await service
      .from('system_config')
      .select('config_value')
      .eq('config_key', 'project_administrator_user_id')
      .maybeSingle();
    return data?.config_value ?? null;
  });
}

export const isProjectAdministrator = cache(async (userId: string): Promise<boolean> => {
  const adminId = await projectAdministratorId();
  return adminId !== null && adminId === userId;
});

// Called by the config editor after a write so a changed project administrator takes
// effect on the next render rather than after the TTL lapses.
export function invalidateProjectAdministrator(): void {
  invalidateGlobal(PROJECT_ADMIN_KEY);
}

// Staggered-launch master switch. When absent/false the gate is disabled and every
// house behaves as live (matches the DB helper is_staggered_launch_enabled()).
export async function isStaggeredLaunchEnabled(): Promise<boolean> {
  const service = createServiceClient();
  const { data } = await service
    .from('system_config')
    .select('config_value')
    .eq('config_key', 'staggered_launch_enabled')
    .maybeSingle();
  return data?.config_value === 'true';
}

export type HouseGate = { isLive: boolean; houseName: string };

// Home-house launch gate for the worker portal: is this house live, and what is its
// display name (for the placeholder copy). Delegates liveness to the DB helper
// house_is_live so web and mobile share one definition.
//
// FAIL-OPEN, deliberately: any read error resolves to live. This matches the mobile
// fetchHomeHouseGate and, critically, survives a staged deploy where the web bundle
// ships before migration 20260712000001 (the RPC would 404 and, fail-closed, would
// otherwise strand EVERY worker on the placeholder). The gate is a soft UX guard, not
// a security boundary (RLS is unchanged), so failing open is the safe direction.
export async function getHouseGate(houseId: string): Promise<HouseGate> {
  const service = createServiceClient();
  const [liveResult, houseResult] = await Promise.all([
    service.rpc('house_is_live', { p_house_id: houseId }),
    service.from('houses').select('name').eq('id', houseId).maybeSingle(),
  ]);
  if (liveResult.error !== null) {
    console.error('[launch-gate] house_is_live check failed, failing open', liveResult.error);
  }
  const isLive = liveResult.error !== null ? true : liveResult.data === true;
  return { isLive, houseName: houseResult.data?.name ?? houseId };
}

export async function getSystemConfig(): Promise<SystemConfigRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('system_config')
    .select('config_key, config_value, value_type, modified_by, modified_at, notes')
    .order('config_key');
  if (error !== null) throw error;

  const actorIds = [...new Set((data ?? []).flatMap((row) => row.modified_by ?? []))];
  const { data: actors } =
    actorIds.length === 0
      ? { data: [] }
      : await service.from('users').select('user_id, name').in('user_id', actorIds);
  const actorName = new Map((actors ?? []).map((actor) => [actor.user_id, actor.name]));

  return (data ?? []).map((row) => ({
    configKey: row.config_key,
    configValue: row.config_value,
    valueType: row.value_type,
    modifiedByName:
      row.modified_by === null ? null : (actorName.get(row.modified_by) ?? 'Unknown user'),
    modifiedAt: row.modified_at,
    notes: row.notes,
  }));
}
