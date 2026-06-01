'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser, isHouseAdmin } from '../auth';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';
import { createClient, createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

// Resolve the pre-filled mailto. D11: the server is the source of truth — the web
// surfaces `craft_hm_leave_mailto` (phase-12) via the `generate-leave-mailto` Edge
// Function. We call the Edge Function when it's served, and fall back to the RPC
// directly (the EF is a thin wrapper around the same RPC) so the flow still works
// against a bare local stack. Both yield an identical href.
async function craftLeaveMailto(leaveId: string): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (token !== undefined) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/generate-leave-mailto/leave-mailto?leave_id=${leaveId}`,
        { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } },
      );
      if (res.ok) {
        const body = (await res.json()) as { mailtoUrl?: string };
        if (typeof body.mailtoUrl === 'string') return body.mailtoUrl;
      }
    } catch {
      // Edge Function not served locally — fall through to the RPC.
    }
  }

  const svc = createServiceClient();
  const { data } = await svc.rpc('craft_hm_leave_mailto', { p_leave_id: leaveId });
  return (data as string | null) ?? null;
}

// §2.6: only an HM/BM may submit leave. Creates the active hm_leave row, then returns
// the pre-filled mailto for the SW-notification email.
export async function submitLeave(input: {
  startDate: string;
  endDate: string;
  replacementUserId: string | null;
}): Promise<ActionResult<{ leaveId: string; mailtoUrl: string | null }>> {
  const me = await getSessionUser();
  if (!isHouseAdmin(me)) return { ok: false, error: 'Only an HM or BM may submit leave.' };

  const svc = createServiceClient();
  const { data, error } = await svc
    .from('hm_leave')
    .insert({
      user_id: me!.userId,
      start_date: input.startDate,
      end_date: input.endDate,
      replacement_user_id: input.replacementUserId,
      status: 'active',
    })
    .select('leave_id')
    .single();
  if (error !== null) return { ok: false, error: error.message };

  const mailtoUrl = await craftLeaveMailto(data.leave_id);
  revalidatePath('/admin/leave');
  return { ok: true, data: { leaveId: data.leave_id, mailtoUrl } };
}

// §2.6 "I'm back": end an active leave early.
export async function returnFromLeave(input: { leaveId: string }): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!isHouseAdmin(me)) return { ok: false, error: 'Only an HM or BM may end leave.' };

  const svc = createServiceClient();
  const { error } = await svc
    .from('hm_leave')
    .update({ status: 'cancelled_early', cancelled_at: new Date().toISOString() })
    .eq('leave_id', input.leaveId)
    .eq('user_id', me!.userId)
    .eq('status', 'active');
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/admin/leave');
  return { ok: true, data: undefined };
}
