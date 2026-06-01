'use server';

import { revalidatePath } from 'next/cache';

import { canModifyWeeklyCap, getSessionUser } from '../auth';
import type { WeeklyCapAudit } from '../data/cap';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

function isMonday(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
}

export async function saveWeeklyCap(input: {
  weekStartDate: string;
  hoursCap: 20 | 40;
  notes: string;
}): Promise<ActionResult<WeeklyCapAudit>> {
  const me = await getSessionUser();
  if (!canModifyWeeklyCap(me)) {
    return { ok: false, error: 'Only an HM or BM may modify the weekly cap.' };
  }
  if (!isMonday(input.weekStartDate)) {
    return { ok: false, error: 'Choose the Monday that begins the calendar week.' };
  }
  if (input.hoursCap !== 20 && input.hoursCap !== 40) {
    return { ok: false, error: 'The weekly cap must be 20 or 40 hours.' };
  }

  const modifiedAt = new Date().toISOString();
  const service = createServiceClient();
  const { data, error } = await service
    .from('weekly_cap_overrides')
    .upsert(
      {
        week_start_date: input.weekStartDate,
        hours_cap: input.hoursCap,
        cap_enforcement: input.hoursCap === 20 ? 'soft' : 'hard',
        modified_by: me!.userId,
        modified_at: modifiedAt,
        notes: input.notes.trim() || null,
      },
      { onConflict: 'week_start_date' },
    )
    .select('modified_at, notes')
    .single();
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/admin/cap');
  revalidatePath('/admin/hours-cap');
  return {
    ok: true,
    data: {
      modifiedByName: me!.name,
      modifiedAt: data.modified_at,
      notes: data.notes,
    },
  };
}
