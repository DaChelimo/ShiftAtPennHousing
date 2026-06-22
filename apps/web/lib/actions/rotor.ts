'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser, isHouseAdmin } from '../auth';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

// §2.5: only HMs/BMs may populate the rotor. Upserts one HMOD per week
// (hmod_rotor.week_start_date is the PK → exactly one HMOD/week). The
// enforce_hmod_rotor_role trigger rejects a non-HM/BM hmod_user_id.
export async function saveRotor(input: {
  entries: Array<{ weekStartDate: string; hmodUserId: string }>;
}): Promise<ActionResult> {
  const me = await getSessionUser();
  if (!isHouseAdmin(me)) return { ok: false, error: 'Only an HM, RSM or BM may plan the rotor.' };

  if (input.entries.length === 0) return { ok: true, data: undefined };

  const svc = createServiceClient();
  const rows = input.entries.map((e) => ({
    week_start_date: e.weekStartDate,
    hmod_user_id: e.hmodUserId,
  }));
  const { error } = await svc.from('hmod_rotor').upsert(rows, { onConflict: 'week_start_date' });
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/admin/rotor');
  return { ok: true, data: undefined };
}
