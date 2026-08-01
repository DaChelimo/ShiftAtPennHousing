'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser } from '../auth';
import { invalidateProjectAdministrator, isProjectAdministrator } from '../data/config';
import type { SystemConfigRow } from '../data/config';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

export async function saveSystemConfig(input: {
  configKey: string;
  configValue: string;
  notes: string;
}): Promise<ActionResult<SystemConfigRow>> {
  const me = await getSessionUser();
  if (me === null || !(await isProjectAdministrator(me.userId))) {
    return { ok: false, error: 'Only the project administrator may edit system configuration.' };
  }
  if (input.configKey.length === 0 || input.configValue.trim().length === 0) {
    return { ok: false, error: 'Configuration key and value are required.' };
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('system_config')
    .update({
      config_value: input.configValue.trim(),
      modified_by: me.userId,
      modified_at: new Date().toISOString(),
      notes: input.notes.trim() || null,
    })
    .eq('config_key', input.configKey)
    .select('config_key, config_value, value_type, modified_at, notes')
    .maybeSingle();
  if (error !== null) return { ok: false, error: error.message };
  if (data === null) return { ok: false, error: 'Unknown configuration key.' };

  invalidateProjectAdministrator();
  revalidatePath('/admin/config');
  return {
    ok: true,
    data: {
      configKey: data.config_key,
      configValue: data.config_value,
      valueType: data.value_type,
      modifiedByName: me.name,
      modifiedAt: data.modified_at,
      notes: data.notes,
    },
  };
}
