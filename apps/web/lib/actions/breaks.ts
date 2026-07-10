'use server';

import { compileBreak, type BreakAuthoringInput } from '@shift/core';
import type { Json } from '@shift/shared';
import { revalidatePath } from 'next/cache';

import { getSessionUser, isAdmin } from '../auth';
import { createClient } from '../supabase/server';

export type AffectedWorker = { house: string; worker: string; when: string; kind: string };

export type BreakImpact = {
  dryRun: boolean;
  blocksGenerated: number;
  blocksVoided: number;
  seatsAdded: number;
  seatsRemoved: number;
  assignmentsCancelled: number;
  floatsVoided: number;
  affected: AffectedWorker[];
};

export type BreakApplyResult = { ok: true; impact: BreakImpact } | { ok: false; error: string };
export type BreakActionResult = { ok: true } | { ok: false; error: string };

function friendlyError(message: string | undefined, code: string | undefined): string {
  if (code === '42501') return 'Only a project administrator can author break periods.';
  if (code === '23514' || code === '42804' || code === 'check_violation') {
    return 'These dates overlap a summer season or another break. Pick dates within the regular school year.';
  }
  if (code === '22023') return 'Check the dates: the end must be on or after the start.';
  return message ?? 'The break could not be saved.';
}

function num(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === 'number' ? v : 0;
}

function parseImpact(data: unknown, dryRun: boolean): BreakImpact {
  const o = (data ?? {}) as Record<string, unknown>;
  const affectedRaw = Array.isArray(o.affected_workers) ? o.affected_workers : [];
  const affected: AffectedWorker[] = affectedRaw.map((a) => {
    const r = (a ?? {}) as Record<string, unknown>;
    return {
      house: String(r.house ?? ''),
      worker: String(r.worker ?? ''),
      when: String(r.when ?? ''),
      kind: String(r.kind ?? 'shift'),
    };
  });
  return {
    dryRun,
    blocksGenerated: num(o, 'blocks_generated'),
    blocksVoided: num(o, 'blocks_voided'),
    seatsAdded: num(o, 'seats_added'),
    seatsRemoved: num(o, 'seats_removed'),
    assignmentsCancelled: num(o, 'assignments_cancelled'),
    floatsVoided: num(o, 'floats_voided'),
    affected,
  };
}

// Compile the per-house break config and preview (dry-run) or apply it via
// apply_compiled_break. Admin-gated here and, authoritatively, inside the RPC
// (auth.uid()) — called through the user's RLS client so the DB sees the real admin.
export async function previewOrApplyBreak(
  input: BreakAuthoringInput,
  dryRun: boolean,
): Promise<BreakApplyResult> {
  const me = await getSessionUser();
  if (!isAdmin(me)) {
    return { ok: false, error: 'Only a project administrator can author break periods.' };
  }

  let compiled;
  try {
    compiled = compileBreak(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid break configuration.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('apply_compiled_break', {
    p_calling_user_id: me!.userId,
    p_payload: compiled as unknown as Json,
    p_dry_run: dryRun,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  if (!dryRun) revalidatePath('/admin/breaks');
  return { ok: true, impact: parseImpact(data, dryRun) };
}

// Remove a break period: restore its calendar dates + drop the per-break profile
// and reconcile the window's blocks back to the school year.
export async function removeBreak(breakId: string): Promise<BreakActionResult> {
  const me = await getSessionUser();
  if (!isAdmin(me)) {
    return { ok: false, error: 'Only a project administrator can remove break periods.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('remove_break_period', {
    p_actor_user_id: me!.userId,
    p_break_id: breakId,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePath('/admin/breaks');
  return { ok: true };
}
