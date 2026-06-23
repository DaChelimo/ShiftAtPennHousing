'use server';

import { revalidatePath } from 'next/cache';

import { getSessionUser } from '../auth';
import { SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../env';
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

// The orchestrator-tick TickSummary fields we surface to the operator.
export type OrchestratorTickSummary = {
  tickedAt: string;
  blocksScanned: number;
  stepsFired: number;
  floatsVoided: number;
  swapsExpired: number;
  errors: string[];
};

export type OrchestratorTickResult =
  | { ok: true; summary: OrchestratorTickSummary }
  | { ok: false; error: string };

// Run the orchestrator-tick Edge Function on demand instead of waiting for the
// once-a-minute pg_cron job. The orchestrator sources its "now" from app_now(),
// so a tick fired here evaluates every escalation boundary (T-3h broadcast, T-2h
// float lookup, HMOD-for-Allied, T-15m no-ack void) against the SIMULATED clock —
// the set-clock-then-tick loop that makes the time-driven flows testable without
// real-time waits. Gated to non-production builds, same as the clock setter.
//
// Unlike force-trigger (which the EF authorises from the signed-in user's token),
// the orchestrator runs as the system: it authenticates with the service-role key
// (the EF requires Authorization === service role), exactly like the cron caller.
export async function runOrchestratorTick(): Promise<OrchestratorTickResult> {
  if (!isTimeTravelEnabled()) {
    return { ok: false, error: 'Time travel is disabled in this environment.' };
  }

  let body: unknown;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/orchestrator-tick`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    body = await res.json();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not reach the orchestrator.',
    };
  }

  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Unexpected orchestrator response.' };
  }
  const b = body as Record<string, unknown>;
  const summary: OrchestratorTickSummary = {
    tickedAt: typeof b.tickedAt === 'string' ? b.tickedAt : new Date().toISOString(),
    blocksScanned: Number(b.blocksScanned ?? 0),
    stepsFired: Number(b.stepsFired ?? 0),
    floatsVoided: Number(b.floatsVoided ?? 0),
    swapsExpired: Number(b.swapsExpired ?? 0),
    errors: Array.isArray(b.errors) ? (b.errors as string[]) : [],
  };

  // A tick may have created/voided floats, fired steps, or routed escalations —
  // refresh every server component (coverage board, inbox, dashboard) so the
  // operator sees the result immediately.
  revalidatePath('/', 'layout');
  return { ok: true, summary };
}
