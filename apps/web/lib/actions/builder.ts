'use server';

import { revalidatePath } from 'next/cache';

import { adminHouseId, canBuildSchedule, getSessionUser } from '../auth';
import { createClient, createServiceClient } from '../supabase/server';

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const AT_CAPACITY_MESSAGE =
  'Those blocks are already fully staffed for this house. Remove the current worker before assigning another.';

// Draft a worker into every block of the dragged span (§4.3 Phase 1/2 click-to-assign).
// Upsert is idempotent on the (period, block, user) unique key.
//
// Staffing-limit guard: a block may hold at most `required_headcount` workers (1 for a
// regular house, 2 Harnwell, 3 Quad). This pre-check returns a friendly message before
// writing; the DB trigger `draft_block_assignments_enforce_headcount` is the authoritative
// backstop (it also catches a concurrent race), and its raw error is mapped below.
export async function assignDraft(input: {
  periodId: string;
  blockIds: string[];
  userId: string;
}): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) return { ok: false, error: 'Not authorized to build the schedule.' };

  const service = createServiceClient();
  const { data: blockRows } = await service
    .from('shift_blocks')
    .select('block_id, required_headcount')
    .in('block_id', input.blockIds);
  const reqByBlock = new Map((blockRows ?? []).map((b) => [b.block_id, b.required_headcount]));

  const { data: existing } = await service
    .from('draft_block_assignments')
    .select('block_id, user_id')
    .eq('period_id', input.periodId)
    .in('block_id', input.blockIds);
  const othersByBlock = new Map<string, number>();
  const meDrafted = new Set<string>();
  for (const d of existing ?? []) {
    if (d.user_id === input.userId) meDrafted.add(d.block_id);
    else othersByBlock.set(d.block_id, (othersByBlock.get(d.block_id) ?? 0) + 1);
  }
  const overCapacity = input.blockIds.some((blockId) => {
    const req = reqByBlock.get(blockId) ?? 1;
    const others = othersByBlock.get(blockId) ?? 0;
    const adding = meDrafted.has(blockId) ? 0 : 1;
    return others + adding > req;
  });
  if (overCapacity) return { ok: false, error: AT_CAPACITY_MESSAGE };

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
  if (error !== null) {
    return {
      ok: false,
      error: error.message.includes('block_over_capacity') ? AT_CAPACITY_MESSAGE : error.message,
    };
  }

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

// Remove a worker from a whole contiguous span at once — the "×" on a continuous
// assignment block (which spans every 30-min block of the run).
export async function removeDraftSpan(input: {
  periodId: string;
  blockIds: string[];
  userId: string;
}): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) return { ok: false, error: 'Not authorized to build the schedule.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('draft_block_assignments')
    .delete()
    .eq('period_id', input.periodId)
    .eq('user_id', input.userId)
    .in('block_id', input.blockIds);
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
