'use server';

import { revalidatePath } from 'next/cache';

import { canBuildForHouse, canBuildSchedule, getSessionUser } from '../auth';
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

// Clear EVERY worker from the given blocks — the builder's "Clear all" / start-from-scratch.
// Scoped to the block ids passed in (the current house's build week), NOT the whole period:
// a scheduling period spans all houses, so a period-wide wipe would blow away other houses'
// drafts. The caller passes this house's week block ids. Chunked because a full week is 200+
// block ids and a single `.in(...)` filter 414s ("URI too long") — same limit as the reads.
export async function clearDraftBlocks(input: {
  periodId: string;
  blockIds: string[];
}): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) return { ok: false, error: 'Not authorized to build the schedule.' };

  const supabase = await createClient();
  const CHUNK = 100;
  for (let i = 0; i < input.blockIds.length; i += CHUNK) {
    const chunk = input.blockIds.slice(i, i + CHUNK);
    if (chunk.length === 0) continue;
    const { error } = await supabase
      .from('draft_block_assignments')
      .delete()
      .eq('period_id', input.periodId)
      .in('block_id', chunk);
    if (error !== null) return { ok: false, error: error.message };
  }

  revalidatePath('/schedule-builder');
  return { ok: true, data: undefined };
}

export type PublishStats = { scheduled: number; houseId: string };

// Publish the period for `houseId` (§4.3 Phase 3). publish_schedule is
// service_role-only (phase-04/batch-A3): converts drafts → assignments, fills the
// remaining headcount with vacancy rows, and is guarded against re-publish.
//
// 2026-06-27 cross-house: a schedule admin (hm/bm/rsm) may publish any house —
// the target is the builder's loaded house (data.houseId), not the admin's own.
// An sm is held to their own house (canBuildForHouse). The RPC re-checks
// user_can_build_schedule(published_by, house) authoritatively.
export async function publishScheduleAction(input: {
  periodId: string;
  houseId: string;
}): Promise<ActionResult<PublishStats>> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) return { ok: false, error: 'Not authorized to publish.' };
  const houseId = input.houseId;
  if (!canBuildForHouse(me, houseId)) {
    return { ok: false, error: 'You are not authorized to publish this house’s schedule.' };
  }

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
