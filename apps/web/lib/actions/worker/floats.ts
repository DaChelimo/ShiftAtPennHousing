'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser } from '../../auth';

import { callEdge } from './edge';

// Inbound-float responses (BSpec §7.1). Acknowledge / decline route through the shared
// Edge Functions; the EF re-validates the ack deadline and the no-takeback rule. A float
// that is already pending/acknowledged is never revoked by these — decline is only valid
// strictly before the T-10m deadline.

export type FloatActionResult = { ok: true } | { ok: false; error: string };

async function respond(floatId: string, path: 'acknowledge-float' | 'decline-float'): Promise<FloatActionResult> {
  const me = await getSessionUser();
  if (me === null) return { ok: false, error: 'Your session has expired. Sign in again.' };

  const res = await callEdge(path, { float_id: floatId });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath('/home/updates');
  revalidatePath('/home/shifts');
  revalidatePath('/home');
  return { ok: true };
}

export async function acknowledgeFloat(floatId: string): Promise<FloatActionResult> {
  return respond(floatId, 'acknowledge-float');
}

export async function declineFloat(floatId: string): Promise<FloatActionResult> {
  return respond(floatId, 'decline-float');
}
