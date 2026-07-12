import { createServiceClient } from '../supabase/server';

export type SystemConfigRow = {
  configKey: string;
  configValue: string;
  valueType: string;
  modifiedByName: string | null;
  modifiedAt: string;
  notes: string | null;
};

export async function isProjectAdministrator(userId: string): Promise<boolean> {
  const service = createServiceClient();
  const { data } = await service
    .from('system_config')
    .select('config_value')
    .eq('config_key', 'project_administrator_user_id')
    .maybeSingle();
  return data?.config_value === userId;
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
