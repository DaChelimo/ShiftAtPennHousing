'use server';

import { revalidatePath } from 'next/cache';

import { adminHouseId, canBuildSchedule, getSessionUser } from '../auth';
import { createClient, createServiceClient } from '../supabase/server';

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

// Draft a worker into every block of the dragged span (§4.3 Phase 1/2 click-to-assign).
// Upsert is idempotent on the (period, block, user) unique key.
export async function assignDraft(input: {
  periodId: string;
  blockIds: string[];
  userId: string;
}): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) return { ok: false, error: 'Not authorized to build the schedule.' };

  const supabase = await createClient();
  const rows = input.blockIds.map((blockId) => ({
    period_id: input.periodId,
    block_id: blockId,
    user_id: input.userId,
    created_by: me!.userId,
  }));
  const { error } = await supabase
    .from('draft_block_assignments')
    .upsert(rows, { onConflict: 'period_id,block_id,user_id', ignoreDuplicates: true });
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/schedule-builder');
  return { ok: true, data: undefined };
}

// Remove a worker from a single block — the manual override "remove" action (§2.3).
export async function removeDraft(input: {
  periodId: string;
  blockId: string;
  userId: string;
}): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) return { ok: false, error: 'Not authorized to build the schedule.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('draft_block_assignments')
    .delete()
    .eq('period_id', input.periodId)
    .eq('block_id', input.blockId)
    .eq('user_id', input.userId);
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/schedule-builder');
  return { ok: true, data: undefined };
}

export type PublishStats = { scheduled: number; houseId: string };

// Publish the period for the admin's house (§4.3 Phase 3). publish_schedule is
// service_role-only (phase-04/batch-A3): converts drafts → assignments, fills the
// remaining headcount with vacancy rows, and is guarded against re-publish.
export async function publishScheduleAction(input: {
  periodId: string;
}): Promise<ActionResult<PublishStats>> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) return { ok: false, error: 'Not authorized to publish.' };
  const houseId = adminHouseId(me!);

  const service = createServiceClient();
  const { data, error } = await service.rpc('publish_schedule', {
    p_period_id: input.periodId,
    p_published_by: me!.userId,
    p_house_id: houseId,
  });
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/schedule-builder');
  revalidatePath('/');
  return { ok: true, data: { scheduled: (data as number | null) ?? 0, houseId } };
}
