'use server';

import { revalidatePath } from 'next/cache';

import { canBuildSchedule, getSessionUser } from '../auth';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

const NY = 'America/New_York';

// The minute-resolution UTC offset (e.g. -240) for `America/New_York` on a given
// wall-clock date — DST-correct, per Hard Invariant #6 (never naive timestamps,
// never wall-clock arithmetic across DST). We resolve the offset of NY at the
// requested local instant by formatting it back through the zone.
function nyOffsetMinutes(localDate: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    timeZoneName: 'shortOffset',
  });
  const part = dtf.formatToParts(localDate).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  // e.g. "GMT-4", "GMT-4:30", "GMT" (UTC) — parse hours[:minutes].
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
  if (match === null) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? '0'));
}

// Convert a `YYYY-MM-DD` wall-clock date (the date input) into an ISO timestamptz
// anchored to end-of-day (23:59) in America/New_York — the latest a worker may
// still submit on the chosen day. Returns null on a malformed date.
function nyEndOfDayIso(dateValue: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
  const [y, m, d] = dateValue.split('-').map(Number);
  // First-pass UTC instant for 23:59 local, then correct by the zone offset.
  const naiveUtc = Date.UTC(y, m - 1, d, 23, 59, 0);
  const offsetMin = nyOffsetMinutes(new Date(naiveUtc));
  return new Date(naiveUtc - offsetMin * 60 * 1000).toISOString();
}

export async function setPreferenceDeadline(input: {
  periodId: string;
  /** `YYYY-MM-DD` (NY wall-clock) from the date input. */
  deadlineDate: string;
}): Promise<ActionResult<{ deadlineIso: string }>> {
  const me = await getSessionUser();
  if (!canBuildSchedule(me)) {
    return {
      ok: false,
      error: 'Only a Student Manager, Housing Manager, or Building Manager may set the deadline.',
    };
  }

  const deadlineIso = nyEndOfDayIso(input.deadlineDate);
  if (deadlineIso === null) {
    return { ok: false, error: 'Choose a valid deadline date.' };
  }

  const service = createServiceClient();
  const { data, error } = await service
    .rpc('set_preference_deadline', {
      p_actor_user_id: me!.userId,
      p_period_id: input.periodId,
      p_preference_deadline: deadlineIso,
    })
    .single<{ period_id: string; preference_deadline: string }>();
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/admin/preferences');
  return { ok: true, data: { deadlineIso: data.preference_deadline } };
}
