'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser, isHouseAdmin } from '../auth';
import { createServiceClient } from '../supabase/server';
import { simNow } from '../time/simClock';

import type { ActionResult } from './builder';

// S3 — Allied resolved-state + mark-read (web-remediation #3, BSpec §2.6/§7.1).
//
// Two thin web-layer wrappers over existing/added SECURITY DEFINER RPCs, called via
// the service client (the authorized pattern shared with override.ts /
// publishScheduleAction). Both pass the SIGNED-IN user as p_user_id and a server
// p_now; the RPC re-checks authorization authoritatively (the spoof guard + house /
// HMOD gate inside set_allied_resolved). The web gates below only fail fast.
//
// Resolved ≠ covered: setAlliedResolved mutates NO coverage state — it is an inbox
// acknowledgement that a human has actioned the Allied alert. revalidatePath
// refreshes the inbox so a resolved alert leaves the default view.

// Map the RPC's bare RAISE tokens to readable copy (the override.ts pattern).
// Anything unmapped falls through verbatim so nothing is hidden.
function friendlyMessage(raw: string): string {
  const msg = raw.trim();
  const MAP: Record<string, string> = {
    not_authorized: 'You are not authorized to resolve this Allied request.',
    not_resolvable: 'Only Allied-coverage alerts can be resolved.',
    notification_not_found: 'That notification no longer exists.',
  };
  for (const [reason, friendly] of Object.entries(MAP)) {
    if (msg === reason || msg.includes(reason)) return friendly;
  }
  return msg;
}

// Set or clear the resolved marker on an hmod_urgent alert. A successful RPC call
// resolves to { ok:true } whether the RPC returned true (changed) or false (already
// in the target state — an idempotent no-op, not an error).
export async function setAlliedResolved(input: {
  notificationId: string;
  resolved: boolean;
}): Promise<ActionResult<undefined>> {
  const me = await getSessionUser();
  if (!isHouseAdmin(me)) {
    return { ok: false, error: 'You are not authorized to resolve this Allied request.' };
  }

  const service = createServiceClient();
  const { error } = await service.rpc('set_allied_resolved', {
    p_notification_id: input.notificationId,
    p_user_id: me!.userId,
    p_resolved: input.resolved,
    p_now: (await simNow()).toISOString(),
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };

  revalidatePath('/inbox');
  return { ok: true, data: undefined };
}

// "I've called the desk" — acknowledge an off-hours Allied-page ladder alert. Resolves
// the ladder so no further rung (SM, then desk) fires. Reuses the same service-client +
// signed-in-user pattern; the acknowledge_allied_page RPC (migration 20260713000001)
// verifies the caller actually received an allied_page alert for the block, so a manager
// cannot resolve a ladder they were never paged for.
export async function acknowledgeAlliedPage(input: {
  blockId: string;
}): Promise<ActionResult<undefined>> {
  const me = await getSessionUser();
  if (me === null) {
    return { ok: false, error: 'Your session has expired. Sign in again.' };
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc('acknowledge_allied_page', {
    p_block_id: input.blockId,
    p_user_id: me.userId,
    p_now: (await simNow()).toISOString(),
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };
  const result = (data ?? null) as { acknowledged?: boolean; reason?: string } | null;
  if (result?.acknowledged === false && result.reason === 'not_a_recipient') {
    return { ok: false, error: 'This alert was not sent to you.' };
  }

  revalidatePath('/inbox');
  return { ok: true, data: undefined };
}

// Mark a (non-urgent) notification read — reuses the existing mark_notification_read
// RPC (migration 20260601000001). Any signed-in user may mark their own read; the
// RPC's spoof guard + recipient scope enforce ownership.
export async function markRead(input: {
  notificationId: string;
}): Promise<ActionResult<undefined>> {
  const me = await getSessionUser();
  if (me === null) {
    return { ok: false, error: 'Your session has expired. Sign in again.' };
  }

  const service = createServiceClient();
  const { error } = await service.rpc('mark_notification_read', {
    p_notification_id: input.notificationId,
    p_user_id: me.userId,
    p_now: (await simNow()).toISOString(),
  });
  if (error !== null) return { ok: false, error: friendlyMessage(error.message) };

  revalidatePath('/inbox');
  return { ok: true, data: undefined };
}
