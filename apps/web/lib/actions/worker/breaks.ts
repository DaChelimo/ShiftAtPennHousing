'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser } from '../../auth';
import { createClient } from '../../supabase/server';

import { callEdge } from './edge';

export type ClaimBreakResult = { ok: true; claimed: number } | { ok: false; error: string };

type BreakClaimResponse = { claimed?: { block_id: string; assignment_id: string }[] };

// Claim one vacant seat per selected break block, FCFS, via the shared break-claim
// Edge Function. The server trims to what was still vacant (hard-cap + conflicts),
// so the returned `claimed` count reconciles the optimistic selection.
export async function claimBreakBlocks(blockIds: string[]): Promise<ClaimBreakResult> {
  if (blockIds.length === 0) return { ok: false, error: 'Select at least one shift to claim.' };
  const res = await callEdge<BreakClaimResponse>('break-claim', {
    claim_type: 'temporary',
    block_ids: blockIds,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath('/home/breaks');
  revalidatePath('/home');
  return { ok: true, claimed: res.data.claimed?.length ?? 0 };
}

export type OptOutResult = { ok: true } | { ok: false; error: string };

// "No break hours" for this break (§4.4). Presence of a break_optouts row = opted
// out; own-row RLS lets the worker set/clear it directly (mobile does the same).
export async function setBreakOptOut(breakId: string, optedOut: boolean): Promise<OptOutResult> {
  const me = await getSessionUser();
  if (me === null) return { ok: false, error: 'Your session has expired. Sign in again.' };
  const supabase = await createClient();

  if (optedOut) {
    const { error } = await supabase
      .from('break_optouts')
      .upsert({ break_id: breakId, user_id: me.userId }, { onConflict: 'break_id,user_id' });
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from('break_optouts')
      .delete()
      .eq('break_id', breakId)
      .eq('user_id', me.userId);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/home/breaks');
  return { ok: true };
}
