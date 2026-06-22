'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser } from '../auth';
import { createServiceClient } from '../supabase/server';
import { isTimeTravelEnabled } from '../time/simClock';

export type DevClockResult = { ok: true; offsetSeconds: number } | { ok: false; error: string };

// Set the simulated clock to `targetISO`. Stored as an offset from the real
// clock, so simulated time keeps advancing at 1x from that instant (app_now()
// adds the fixed offset to live now()). Gated to non-production builds.
export async function setSimClock(targetISO: string): Promise<DevClockResult> {
  if (!isTimeTravelEnabled()) {
    return { ok: false, error: 'Time travel is disabled in this environment.' };
  }
  const target = new Date(targetISO);
  if (Number.isNaN(target.getTime())) {
    return { ok: false, error: 'Invalid date/time.' };
  }
  const me = await getSessionUser();
  const offsetSeconds = (target.getTime() - Date.now()) / 1000;

  const svc = createServiceClient();
  const { error } = await svc
    .from('dev_sim_clock')
    .update({
      offset_seconds: offsetSeconds,
      set_at: new Date().toISOString(),
      set_by: me?.userId ?? null,
    })
    .eq('id', true);
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/', 'layout');
  return { ok: true, offsetSeconds };
}

// Reset to real wall-clock time (offset 0).
export async function clearSimClock(): Promise<DevClockResult> {
  if (!isTimeTravelEnabled()) {
    return { ok: false, error: 'Time travel is disabled in this environment.' };
  }
  const me = await getSessionUser();
  const svc = createServiceClient();
  const { error } = await svc
    .from('dev_sim_clock')
    .update({ offset_seconds: 0, set_at: new Date().toISOString(), set_by: me?.userId ?? null })
    .eq('id', true);
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/', 'layout');
  return { ok: true, offsetSeconds: 0 };
}
