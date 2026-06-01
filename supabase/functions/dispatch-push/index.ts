import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cert, getApps, initializeApp } from 'npm:firebase-admin@13/app';
import { getMessaging } from 'npm:firebase-admin@13/messaging';

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

    if (attemptedTokens.length > 0) {
      const messaging = firebaseMessaging();
      for (const batch of chunk(attemptedTokens, TOKEN_BATCH_SIZE)) {
        const result = await messaging.sendEachForMulticast({
          tokens: batch.map((pushToken) => pushToken.device_token),
          data: {
            notification_id: notification.notification_id,
            type: notification.type,
            payload: JSON.stringify(notification.payload),
          },
        });
        successCount += result.successCount;
        failureCount += result.failureCount;
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
