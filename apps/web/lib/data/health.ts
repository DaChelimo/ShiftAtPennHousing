import { createServiceClient } from '../supabase/server';

export type OrchestratorHealth = {
  lastTickAt: string;
  blocksScanned: number;
  stepsFired: number;
  floatsVoided: number;
  swapsExpired: number;
  errors: string[];
};

export async function getOrchestratorHealth(): Promise<OrchestratorHealth | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('orchestrator_health')
    .select('last_tick_at, blocks_scanned, steps_fired, floats_voided, swaps_expired, errors')
    .eq('singleton', true)
    .maybeSingle();
  if (error !== null) throw error;
  return data === null
    ? null
    : {
        lastTickAt: data.last_tick_at,
        blocksScanned: data.blocks_scanned,
        stepsFired: data.steps_fired,
        floatsVoided: data.floats_voided,
        swapsExpired: data.swaps_expired,
        errors: data.errors,
      };
}

export type PushDeliveryHealth = {
  /** Undelivered, currently-due notifications (what the dispatch cron would process now). */
  backlog: number;
  /** created_at of the oldest undelivered due notification; null when the backlog is empty. */
  oldestPendingAt: string | null;
  /** Age of that oldest row at snapshot time (same clock as the due check); null when empty. */
  oldestPendingAgeMs: number | null;
  /** Registered push_tokens device rows. */
  tokens: { total: number; android: number; ios: number };
};

// Push-delivery backlog per phase 12: `pending_notification_deliveries` is a
// SECURITY DEFINER *function* over `notifications` (delivered_at IS NULL, due
// per scheduled_for, suppressed float-ack reminders excluded) — service-role
// only, so this uses the service client like getOrchestratorHealth above.
export async function getPushDeliveryHealth(): Promise<PushDeliveryHealth> {
  const service = createServiceClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const [pending, tokensTotal, tokensAndroid, tokensIos] = await Promise.all([
    service
      .rpc('pending_notification_deliveries', { p_now: nowIso }, { count: 'exact' })
      .select('created_at')
      .order('created_at', { ascending: true })
      .limit(1),
    service.from('push_tokens').select('*', { count: 'exact', head: true }),
    service
      .from('push_tokens')
      .select('*', { count: 'exact', head: true })
      .eq('platform', 'android'),
    service.from('push_tokens').select('*', { count: 'exact', head: true }).eq('platform', 'ios'),
  ]);

  if (pending.error !== null) throw pending.error;
  if (tokensTotal.error !== null) throw tokensTotal.error;
  if (tokensAndroid.error !== null) throw tokensAndroid.error;
  if (tokensIos.error !== null) throw tokensIos.error;

  const oldestPendingAt = pending.data?.[0]?.created_at ?? null;
  return {
    backlog: pending.count ?? 0,
    oldestPendingAt,
    oldestPendingAgeMs:
      oldestPendingAt === null ? null : Math.max(0, nowMs - Date.parse(oldestPendingAt)),
    tokens: {
      total: tokensTotal.count ?? 0,
      android: tokensAndroid.count ?? 0,
      ios: tokensIos.count ?? 0,
    },
  };
}
