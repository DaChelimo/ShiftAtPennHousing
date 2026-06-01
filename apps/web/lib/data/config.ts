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
