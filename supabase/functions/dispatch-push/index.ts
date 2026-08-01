import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cert, getApps, initializeApp } from 'npm:firebase-admin@13/app';
import { getMessaging } from 'npm:firebase-admin@13/messaging';

import { buildFcmMessage, resolvePushPresentation } from '../_shared/push-presentation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const TOKEN_BATCH_SIZE = 500;

type PushToken = {
  push_token_id: string;
  device_token: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function firebaseMessaging() {
  if (getApps().length === 0) {
    const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (serviceAccountJson === undefined) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
    }
    initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });
  }
  return getMessaging();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const pathname = new URL(req.url).pathname;
  if (!/^(?:\/dispatch-push)?\/dispatch-push$/.test(pathname)) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }
  const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (token !== serviceRoleKey) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const { user_id: userId, notification_id: notificationId } =
    typeof body === 'object' && body !== null
      ? (body as { user_id?: unknown; notification_id?: unknown })
      : {};
  if (!isUuid(userId) || !isUuid(notificationId)) {
    return jsonResponse({ error: 'user_id and notification_id must be UUIDs' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: notification, error: notificationError } = await supabase
    .from('notifications')
    .select('notification_id, recipient_user_id, type, payload, delivered_at')
    .eq('notification_id', notificationId)
    .eq('recipient_user_id', userId)
    .maybeSingle();
  if (notificationError !== null) {
    return jsonResponse({ error: notificationError.message }, 500);
  }
  if (notification === null) {
    return jsonResponse({ error: 'Notification not found' }, 404);
  }
  if (notification.delivered_at !== null) {
    return jsonResponse({ ok: true, delivered: false, reason: 'already_delivered' });
  }

  // pg_net dispatch is asynchronous. Re-check the queue at execution time so a
  // float acknowledged after cron enqueues this request does not receive a stale
  // reminder.
  //
  // Delivery is intentionally AT-LEAST-ONCE. The once-a-minute deliver_pending_
  // notifications cron may enqueue a still-in-flight notification again; the
  // re-check below plus deliver_notification's idempotent delivered_at stamp bound
  // the effect, but a notification whose dispatch straddles a minute boundary can
  // be pushed twice. We do NOT stamp delivered_at before sending: §10.1 personal
  // notifications are mandatory and cannot be silenced, so a rare duplicate push is
  // strictly preferable to the lost-delivery risk of marking-then-failing-to-send.
  const { data: pendingNotification, error: pendingError } = await supabase
    .rpc('pending_notification_deliveries', { p_now: new Date().toISOString() })
    .eq('notification_id', notificationId)
    .maybeSingle();
  if (pendingError !== null) {
    return jsonResponse({ error: pendingError.message }, 500);
  }
  if (pendingNotification === null) {
    return jsonResponse({ ok: true, delivered: false, reason: 'suppressed_or_not_due' });
  }

  const { data: pushable, error: pushableError } = await supabase.rpc('notification_is_pushable', {
    p_type: notification.type,
  });
  if (pushableError !== null) {
    return jsonResponse({ error: pushableError.message }, 500);
  }

  let attemptedTokens: PushToken[] = [];
  let successCount = 0;
  let failureCount = 0;
  if (pushable === true) {
    const { data, error } = await supabase.rpc('notification_push_targets', {
      p_user_id: userId,
    });
    if (error !== null) {
      return jsonResponse({ error: error.message }, 500);
    }
    attemptedTokens = (data ?? []) as PushToken[];

    // Platform routing is intentionally NOT branched here. notification_push_targets
    // returns every device token for the user (both 'android' and 'ios' rows), and
    // Firebase Admin routes Android tokens via FCM and iOS tokens via APNs through
    // this single Messaging API. This requires iOS clients to register their Firebase
    // FCM registration token (not a raw APNs device token) — the standard Firebase
    // iOS integration (see AGENTS.md Phase-12 note).
    if (attemptedTokens.length > 0) {
      // Cost audit F-03. Everything from here to the end of the block used to be
      // UNGUARDED. firebaseMessaging() throws outright when FIREBASE_SERVICE_ACCOUNT_JSON
      // is unset — a documented deploy-time requirement, so exactly the thing that is
      // missing on day one — and the throw propagated out of Deno.serve. The function
      // 500'd, deliver_notification below never ran, delivered_at stayed NULL, and the
      // cron re-POSTed the same notification 60 seconds later. Forever, with the stuck
      // set only ever growing.
      //
      // Two things close the loop, and the ORDER is the point:
      //
      //   1. Count the attempt BEFORE sending. If we only counted in the catch, a
      //      runtime death no catch block can observe (OOM, worker eviction, hard
      //      timeout) would leave the counter untouched and the loop unbounded again.
      //   2. Record the failure in the catch, which dead-letters past the ceiling.
      //
      // delivered_at is still NOT stamped here. §10.1 personal notifications are
      // mandatory, so a rare duplicate push beats a lost one — that at-least-once
      // decision is unchanged and this must never become a stamp-then-send.
      await supabase.rpc('begin_notification_delivery_attempt', {
        p_notification_id: notificationId,
        p_now: new Date().toISOString(),
      });

      try {
        const messaging = firebaseMessaging();
        // Platform-aware presentation. This block used to send `data` ALONE, with no
        // `notification`, no `apns` and no `android` config. Android coped, because its
        // messaging service rebuilds a local notification from the data map, but iOS
        // displayed NOTHING: APNs was never asked to present anything, so the
        // AppDelegate's `willPresent` never fired. Every iOS push in this system was
        // silently dropped. The data map is unchanged, so existing clients keep
        // working and the deep-link path is untouched.
        const presentation = resolvePushPresentation(notification.type, notification.payload);
        for (const batch of chunk(attemptedTokens, TOKEN_BATCH_SIZE)) {
          const result = await messaging.sendEachForMulticast({
            tokens: batch.map((pushToken) => pushToken.device_token),
            ...buildFcmMessage(presentation, {
              notification_id: notification.notification_id,
              type: notification.type,
              payload: JSON.stringify(notification.payload),
            }),
          });
          successCount += result.successCount;
          failureCount += result.failureCount;
        }
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : String(sendError);
        const { data: deadLettered } = await supabase.rpc('record_notification_delivery_failure', {
          p_notification_id: notificationId,
          p_now: new Date().toISOString(),
          p_error: message,
        });
        // Loud on purpose. The original failure mode was invisible: it only triggers for
        // users who actually registered a push token, so it never appears in a test
        // environment and only shows up as a bill.
        console.error(
          JSON.stringify({
            event: 'dispatch_push_send_failed',
            notification_id: notificationId,
            dead_lettered: deadLettered === true,
            error: message,
          }),
        );
        return jsonResponse(
          { error: message, delivered: false, deadLettered: deadLettered === true },
          502,
        );
      }

      const { error: touchError } = await supabase
        .from('push_tokens')
        .update({ last_used_at: new Date().toISOString() })
        .in(
          'push_token_id',
          attemptedTokens.map((pushToken) => pushToken.push_token_id),
        );
      if (touchError !== null) {
        return jsonResponse({ error: touchError.message }, 500);
      }
    }
  }

  const { data: delivered, error: deliveryError } = await supabase.rpc('deliver_notification', {
    p_notification_id: notificationId,
    p_now: new Date().toISOString(),
  });
  if (deliveryError !== null) {
    return jsonResponse({ error: deliveryError.message }, 500);
  }

  return jsonResponse({
    ok: true,
    delivered,
    pushable,
    attemptedDevices: attemptedTokens.length,
    successCount,
    failureCount,
  });
});
