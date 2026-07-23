'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser, isHouseAdmin, isRsm } from '../auth';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';
import { createClient, createServiceClient } from '../supabase/server';
import { simNow } from '../time/simClock';

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

// §2.6: only an HM/BM may submit leave. Creates the active hm_leave row via the
// `submit_hm_leave` RPC — which re-runs the incoming-chain (cycle) check inside the
// insert transaction (the picker's selection-time exclusion is not enough; another HM
// may create a leave between picker-load and submit) — then returns the pre-filled
// mailto for the SW-notification email.
export async function submitLeave(input: {
  startDate: string;
  endDate: string;
  replacementUserId: string | null;
}): Promise<ActionResult<{ leaveId: string; mailtoUrl: string | null }>> {
  const me = await getSessionUser();
  if (!isHouseAdmin(me)) return { ok: false, error: 'Only an HM, RSM or BM may submit leave.' };

  // Pilot policy (Option 1, 2026-07-13): while the off-hours Allied-page ladder is the
  // escalation path, an RSM's on-hours coverage notifications resolve strictly to the
  // replacement they name. A null replacement would fall through to the HMOD terminal,
  // which the pilot deliberately avoids, so require an explicit replacement for an RSM.
  if (isRsm(me) && input.replacementUserId === null) {
    return { ok: false, error: 'An RSM must name a replacement when submitting leave.' };
  }

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('submit_hm_leave', {
    p_user_id: me!.userId,
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    // null → omit so the SQL DEFAULT NULL applies (project-administrator terminal, §2.6).
    ...(input.replacementUserId !== null ? { p_replacement_user_id: input.replacementUserId } : {}),
  });
  if (error !== null) return { ok: false, error: error.message };
  const leaveId = data as string;

  const mailtoUrl = await craftLeaveMailto(leaveId);
  revalidatePath('/admin/leave');
  return { ok: true, data: { leaveId, mailtoUrl } };
}

// §2.6 #6 "I'm back": end an active leave early. The `end_hm_leave_early` RPC flips the
// leave to cancelled_early (+ cancelled_at), notifies the current replacement in-app that
// they are no longer covering, and returns the "back from leave" SW-notification mailto.
export async function returnFromLeave(input: {
  leaveId: string;
}): Promise<ActionResult<{ mailtoUrl: string | null }>> {
  const me = await getSessionUser();
  if (!isHouseAdmin(me)) return { ok: false, error: 'Only an HM, RSM or BM may end leave.' };

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('end_hm_leave_early', {
    p_leave_id: input.leaveId,
    p_user_id: me!.userId,
    p_now: (await simNow()).toISOString(),
  });
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/admin/leave');
  return { ok: true, data: { mailtoUrl: (data as string | null) ?? null } };
}
