'use server';

import type { PreferenceStatus } from '@shift/core';
import { revalidatePath } from 'next/cache';

import { canBuildForHouse, canBuildSchedule, getSessionUser } from '../auth';
import { nyEndOfDayIso } from '../nyTime';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

export async function setPreferenceDeadline(input: {
  periodId: string;
  /** `YYYY-MM-DD` (NY wall-clock) from the date input. */
  deadlineDate: string;
}): Promise<ActionResult<{ deadlineIso: string }>> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) {
    return {
      ok: false,
      error: 'Only a Student Manager, Housing Manager, or Building Manager may set the deadline.',
    };
  }

  const deadlineIso = nyEndOfDayIso(input.deadlineDate);
  if (deadlineIso === null) {
    return { ok: false, error: 'Choose a valid deadline date.' };
  }

  const service = createServiceClient();
  const { data, error } = await service
    .rpc('set_preference_deadline', {
      p_actor_user_id: me!.userId,
      p_period_id: input.periodId,
      p_preference_deadline: deadlineIso,
    })
    .single<{ period_id: string; preference_deadline: string }>();
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/admin/preferences');
  return { ok: true, data: { deadlineIso: data.preference_deadline } };
}

export type AdminSubmitPreferencesInput = {
  targetUserId: string;
  periodId: string;
  preferences: { block_id: string; status: PreferenceStatus }[];
  targetHours: number;
  optedOut: boolean;
};

// Author ONE worker's semester preferences on their behalf (from
// /admin/preferences/[userId]). Mirrors the override.ts pattern: a service-role
// client (auth.uid() is NULL) calls the SECURITY DEFINER admin_submit_preferences,
// which re-verifies the actor may build that worker's house. The web gate below is
// the fail-fast / clean-error layer — it resolves the target's home house and
// checks canBuildForHouse (sm own-house; hm/bm/rsm/admin cross-house). Managers
// may override a passed deadline (the RPC opens the window for the write).
export async function submitPreferencesForWorker(
  input: AdminSubmitPreferencesInput,
): Promise<ActionResult<{ preferencesUpserted: number; targetUpserted: number }>> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) {
    return { ok: false, error: 'You are not authorized to edit preferences.' };
  }

  const service = createServiceClient();

  const { data: worker } = await service
    .from('users')
    .select('home_house_id')
    .eq('user_id', input.targetUserId)
    .maybeSingle();
  if (worker === null || worker === undefined) {
    return { ok: false, error: 'That worker could not be found.' };
  }

  if (!canBuildForHouse(me, worker.home_house_id)) {
    return {
      ok: false,
      error: 'You can only edit preferences for workers in a house you manage.',
    };
  }

  const { data, error } = await service
    .rpc('admin_submit_preferences', {
      p_actor_user_id: me!.userId,
      p_target_user_id: input.targetUserId,
      p_period_id: input.periodId,
      p_preferences: input.preferences,
      p_target_hours: input.optedOut ? 0 : Math.max(0, Math.round(input.targetHours)),
      p_opted_out: input.optedOut,
    })
    .single<{ preferences_upserted: number; target_upserted: number }>();
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/admin/preferences');
  revalidatePath(`/admin/preferences/${input.targetUserId}`);
  return {
    ok: true,
    data: { preferencesUpserted: data.preferences_upserted, targetUpserted: data.target_upserted },
  };
}
