'use server';

import { validateCandidate, type AiAssignment } from '@shift/core';
import { revalidatePath } from 'next/cache';

import { canBuildForHouse, canBuildSchedule, getSessionUser } from '../auth';
import { getAiScheduleContext } from '../data/aiSchedule';
import { BLOCK_ID_CHUNK } from '../data/blockChunks';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

// Generation is a streaming route handler (app/api/schedule/ai-generate), not
// a server action, so the SM sees per-day progress; the DTO shape lives in
// lib/ai/proposal. This module owns only the write path.

const AT_CAPACITY_MESSAGE =
  'A block filled up while accepting. Generate again to rebuild against the latest drafts.';
const HARNWELL_MESSAGE = 'Only Harnwell residents can staff Harnwell.';

// Replace-all accept: delete the house's template-week drafts for the
// period, then bulk-insert the winning candidate. The payload is
// re-validated against a FRESH snapshot first, so the DB headcount and
// Harnwell triggers are a backstop for concurrent racing edits only.
// Delete-then-insert spans two PostgREST calls (not one transaction);
// both steps are idempotent, so the recovery path is simply re-accepting.
export async function acceptAiSchedule(input: {
  houseId: string;
  periodId: string;
  assignments: AiAssignment[];
}): Promise<ActionResult<{ deleted: number; inserted: number }>> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) return { ok: false, error: 'Not authorized to build the schedule.' };
  if (!canBuildForHouse(me, input.houseId)) {
    return { ok: false, error: 'You are not authorized to build this schedule.' };
  }
  if (input.assignments.length === 0) {
    return { ok: false, error: 'This proposal has no assignments to accept.' };
  }

  const ctx = await getAiScheduleContext(input.houseId);
  if (!ctx.gate.canGenerate || ctx.input === null) {
    return { ok: false, error: ctx.gate.reason ?? 'This schedule can no longer be drafted.' };
  }
  if (ctx.input.periodId !== input.periodId) {
    return { ok: false, error: 'The scheduling period changed. Generate a new proposal.' };
  }

  // Re-validate against current data (roster or blocks may have moved
  // since generation; also rejects forged payloads).
  const validation = validateCandidate(ctx.input, input.assignments);
  if (!validation.feasible) {
    return {
      ok: false,
      error: 'This proposal no longer fits the current schedule data. Generate a new one.',
    };
  }

  const service = createServiceClient();
  const weekBlockIds = ctx.input.blocks.map((b) => b.blockId);

  // 1. Replace-all delete, chunked like every block_id-scoped call.
  let deleted = 0;
  for (let i = 0; i < weekBlockIds.length; i += BLOCK_ID_CHUNK) {
    const chunk = weekBlockIds.slice(i, i + BLOCK_ID_CHUNK);
    const { data, error } = await service
      .from('draft_block_assignments')
      .delete()
      .eq('period_id', input.periodId)
      .in('block_id', chunk)
      .select('draft_assignment_id');
    if (error !== null) {
      return { ok: false, error: `Could not clear the existing drafts: ${error.message}` };
    }
    deleted += (data ?? []).length;
  }

  // 2. Bulk insert the winner (idempotent on the unique key, so a retry
  // after a partial failure simply completes the write).
  const rows = input.assignments.map((a) => ({
    period_id: input.periodId,
    block_id: a.blockId,
    user_id: a.workerId,
    created_by: me!.userId,
  }));
  const { error } = await service
    .from('draft_block_assignments')
    .upsert(rows, { onConflict: 'period_id,block_id,user_id', ignoreDuplicates: true });
  if (error !== null) {
    if (error.message.includes('block_over_capacity')) {
      return { ok: false, error: AT_CAPACITY_MESSAGE };
    }
    if (error.message.includes('non-Harnwell')) {
      return { ok: false, error: HARNWELL_MESSAGE };
    }
    return {
      ok: false,
      error: `Could not write the drafts: ${error.message}. Accept again to retry.`,
    };
  }

  revalidatePath('/schedule-builder');
  return { ok: true, data: { deleted, inserted: rows.length } };
}
