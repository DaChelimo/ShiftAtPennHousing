import { createServiceClient } from '../supabase/server';

// Dev-only simulated clock. The whole admin app reads "now" through simNow() so a
// time-travel offset (dev_sim_clock.offset_seconds, set from the top-bar card)
// fast-forwards both the website and the orchestrator off one shared clock. In a
// production build the offset is always 0 and the setter UI is gated off, so
// simNow() is identical to the wall clock.

// Time travel is a non-production affordance only. Mirrors the DB guarantee that
// the offset stays 0 in prod — this just hides the control so it can never be set.
export function isTimeTravelEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

// The current simulated instant, authoritative from the database (app_now()) so
// the web and Postgres agree to the millisecond. Falls back to the wall clock if
// the RPC is unavailable.
export async function simNow(): Promise<Date> {
  // Production short-circuit: no offset can exist (the setter is gated off), so
  // skip the round-trip and behave exactly like the old `new Date()`.
  if (!isTimeTravelEnabled()) return new Date();
  const svc = createServiceClient();
  const { data, error } = await svc.rpc('app_now');
  if (error === null && typeof data === 'string') {
    const parsed = new Date(data);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

// Offset (seconds) currently applied, for the card's live display. 0 = real time.
export async function getSimOffsetSeconds(): Promise<number> {
  const svc = createServiceClient();
  const { data } = await svc
    .from('dev_sim_clock')
    .select('offset_seconds')
    .eq('id', true)
    .maybeSingle();
  return data?.offset_seconds ?? 0;
}
