'use server';

import type { PreferenceStatus } from '@shift/core';
import { revalidatePath } from 'next/cache';

import { getSessionUser } from '../../auth';

import { callEdge } from './edge';

export type SubmitPreferencesInput = {
  periodId: string;
  preferences: { block_id: string; status: PreferenceStatus }[];
  targetHours: number;
  optedOut: boolean;
};

export type SubmitResult = { ok: true } | { ok: false; error: string };

// Submit the worker's semester preferences via the shared `submit-preferences`
// Edge Function (the same path mobile uses). The EF derives the actor from the
// bearer token and re-validates the deadline + status enum authoritatively, so this
// is thin glue: forward the payload, then revalidate the worker surfaces.
export async function submitPreferences(input: SubmitPreferencesInput): Promise<SubmitResult> {
  const me = await getSessionUser();
  if (me === null) return { ok: false, error: 'Your session has expired. Sign in again.' };

  const res = await callEdge('submit-preferences/preferences', {
    period_id: input.periodId,
    preferences: input.preferences,
    target_hours: input.optedOut ? 0 : Math.max(0, Math.round(input.targetHours)),
    opted_out: input.optedOut,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath('/home/preferences');
  revalidatePath('/home');
  return { ok: true };
}
