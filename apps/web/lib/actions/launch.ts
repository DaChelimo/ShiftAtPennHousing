'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser, isAdmin } from '../auth';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

// Phase B — staggered-launch admin console mutations. Both are project-admin-only
// (isAdmin); the DB RPCs re-check user_is_admin(auth.uid()) authoritatively, so these
// are the fail-fast web gates. The service client carries no user identity, so we pass
// nothing user-supplied to the RPC beyond the target: the RPC reads auth.uid() from the
// caller's JWT... but the service client bypasses RLS and has no auth.uid(). Therefore
// these actions MUST verify isAdmin here (the web gate is authoritative for the service
// path), mirroring how publish/override actions gate before calling service RPCs.

export async function setStaggeredLaunch(input: {
  enabled: boolean;
}): Promise<ActionResult<{ enabled: boolean }>> {
  const me = await getSessionUser();
  if (!isAdmin(me)) {
    return { ok: false, error: 'Only the project administrator may change the launch switch.' };
  }
  const service = createServiceClient();
  // Set directly (service role bypasses RLS); the RPC's own auth.uid() check would fail
  // under the service client, so we write the config row here after the isAdmin gate.
  const { error } = await service.from('system_config').upsert(
    {
      config_key: 'staggered_launch_enabled',
      config_value: input.enabled ? 'true' : 'false',
      value_type: 'enum',
      modified_by: me!.userId,
      modified_at: new Date().toISOString(),
    },
    { onConflict: 'config_key' },
  );
  if (error !== null) return { ok: false, error: error.message };
  revalidatePath('/admin/launch');
  return { ok: true, data: { enabled: input.enabled } };
}

export async function setHouseLaunch(input: {
  houseId: string;
  live: boolean;
}): Promise<ActionResult<{ houseId: string; live: boolean }>> {
  const me = await getSessionUser();
  if (!isAdmin(me)) {
    return { ok: false, error: 'Only the project administrator may launch a house.' };
  }
  const service = createServiceClient();

  const { data: house, error: findError } = await service
    .from('houses')
    .select('id, launched_at')
    .eq('id', input.houseId)
    .maybeSingle();
  if (findError !== null) return { ok: false, error: findError.message };
  if (house === null) return { ok: false, error: 'That house could not be found.' };

  // Preserve the first-go-live audit stamp (mirrors the set_house_launch_state RPC):
  // set launched_at only on the first transition to live; never clear it.
  const update: { launch_state: 'pre_launch' | 'live'; launched_at?: string } = {
    launch_state: input.live ? 'live' : 'pre_launch',
  };
  if (input.live && house.launched_at === null) {
    update.launched_at = new Date().toISOString();
  }

  const { error } = await service.from('houses').update(update).eq('id', input.houseId);
  if (error !== null) return { ok: false, error: error.message };
  revalidatePath('/admin/launch');
  return { ok: true, data: { houseId: input.houseId, live: input.live } };
}
