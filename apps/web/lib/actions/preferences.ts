'use server';

import { revalidatePath } from 'next/cache';

import { canBuildSchedule, getSessionUser } from '../auth';
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
