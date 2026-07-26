-- Migration: bound push-delivery retries and index the delivery queue
-- (cost audit F-03, F-08).
--
-- ===========================================================================
-- F-03 -- dispatch-push failure was an unbounded, permanently compounding loop.
--
-- The delivery contract: deliver_pending_notifications() selects everything still
-- undelivered and fires one net.http_post per row, once a minute. A notification leaves
-- that set ONLY when delivered_at is stamped, and delivered_at is stamped ONLY by the
-- last statement of the dispatch-push handler.
--
-- Between the two sat an UNGUARDED Firebase send. firebaseMessaging() throws outright if
-- FIREBASE_SERVICE_ACCOUNT_JSON is unset -- and that secret is a documented deploy-time
-- requirement, i.e. exactly the thing that is missing or wrong on day one. There was no
-- try/catch, so the throw propagated out of Deno.serve, the function 500'd, delivered_at
-- stayed NULL, and the same notification was re-POSTed 60 seconds later. Forever.
--
-- No attempt counter, no backoff, no dead-letter, no cap. The cost is triangular, not
-- flat: every new notification joins the stuck set and nothing ever leaves it. A
-- Harnwell evening producing 20 notifications with Firebase misconfigured reaches
-- 20 x 1,440 = 28,800 Edge Function invocations on day one, 57,600 on day two, and so
-- on. It is the only finding in the audit whose cost does not stabilise.
--
-- It is also invisible in testing: the send is guarded by `attemptedTokens.length > 0`,
-- so the loop only triggers for users who have successfully registered a push token --
-- real launched users, never empty test accounts.
--
-- WHAT THIS DOES NOT DO, and must never do: stamp delivered_at before the send.
-- Personal notifications under BSpec §10.1 are mandatory and cannot be silenced, so a
-- rare duplicate push is strictly preferable to a lost one. That at-least-once decision
-- is recorded in supabase/AGENTS.md and stands unchanged. The fix is to stop
-- RE-SELECTING a known-failing row every 60 seconds, not to pretend it succeeded.
--
-- The accounting is deliberately split in two, and the order matters:
--
--   * begin_notification_delivery_attempt() runs BEFORE the send. It increments the
--     counter and stamps last_attempt_at. Doing it first is what makes the loop bounded
--     even when the runtime dies in a way no catch block can observe -- an OOM, a
--     worker eviction, a hard timeout. An attempt that is never accounted for is exactly
--     how an "impossible" infinite loop comes back.
--   * record_notification_delivery_failure() runs in the CATCH. It only records the
--     error text and, past the ceiling, dead-letters the row.
--
-- Incrementing on the success path too is harmless: that row gets delivered_at and
-- leaves the queue on the same request.
--
-- ===========================================================================
-- F-08 -- pending_notification_deliveries was an unindexed seq scan, once a minute,
--         over a table with no retention.
--
-- notifications carried only notifications_pkey and (recipient_user_id, scheduled_for).
-- The delivery query has no recipient_user_id predicate, so that composite index was
-- unusable and there was nothing at all supporting `delivered_at IS NULL`. Seq scan
-- every 60 seconds, plus a correlated NOT EXISTS against float_assignments per candidate
-- row.
--
-- Worse, two categories of row were STUCK in the scanned set permanently:
--
--   1. Suppressed ack reminders. The NOT EXISTS clause excludes an ack_reminder whose
--      float is no longer pending. Excluded means never enqueued, which means never
--      stamped delivered_at -- so every acknowledged float left a tombstone the scan had
--      to re-filter every minute, forever.
--   2. F-03's failed deliveries, also permanently delivered_at IS NULL.
--
-- Both now get a terminal state (suppressed_at / dead_lettered_at), and the partial
-- index is defined over the LIVE QUEUE only, so terminal rows physically leave it. The
-- index is therefore bounded by the size of the queue rather than by all history.

-- ---------------------------------------------------------------------------
-- 1. Delivery accounting columns.
-- ---------------------------------------------------------------------------
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_delivery_error text,
  ADD COLUMN IF NOT EXISTS dead_lettered_at  timestamptz,
  ADD COLUMN IF NOT EXISTS suppressed_at     timestamptz;

COMMENT ON COLUMN notifications.delivery_attempts IS
  'Dispatch attempts started (incremented BEFORE the push is sent, so a hard runtime '
  'kill still counts). Drives the retry backoff and the dead-letter ceiling. Cost audit F-03.';
COMMENT ON COLUMN notifications.dead_lettered_at IS
  'Set when delivery exhausted max_notification_delivery_attempts(). The row leaves the '
  'delivery queue and the partial index, and becomes operator-visible via '
  'dead_lettered_notifications. It is NOT delivered.';
COMMENT ON COLUMN notifications.suppressed_at IS
  'Set when a notification is deliberately NOT sent (an ack_reminder whose float stopped '
  'being pending). Distinct from delivered_at, which must only ever mean "a push was '
  'successfully sent" (BSpec §10.1 at-least-once).';

-- ---------------------------------------------------------------------------
-- 2. Retry policy. Both knobs are system_config so an operator can widen or tighten
--    them during an incident without a migration.
-- ---------------------------------------------------------------------------
INSERT INTO system_config (config_key, config_value, value_type, notes)
VALUES
  ('max_notification_delivery_attempts', '12', 'integer',
   'Dispatch attempts before a notification is dead-lettered. With the capped '
   'exponential backoff below this is roughly 7 hours of retrying.'),
  ('notification_retry_backoff_cap_minutes', '60', 'integer',
   'Ceiling on the exponential retry backoff between dispatch attempts.')
ON CONFLICT (config_key) DO NOTHING;

CREATE OR REPLACE FUNCTION max_notification_delivery_attempts()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT NULLIF(regexp_replace(config_value, '\D', '', 'g'), '')::integer
       FROM system_config WHERE config_key = 'max_notification_delivery_attempts'),
    12
  );
$$;

CREATE OR REPLACE FUNCTION notification_retry_backoff(p_attempts integer)
RETURNS interval
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Capped exponential: 1, 2, 4, 8, 16, 32, then the cap. A zero-attempt row has no
  -- backoff at all, so first delivery is still immediate on the next cron pass.
  SELECT CASE
    WHEN COALESCE(p_attempts, 0) <= 0 THEN interval '0'
    ELSE make_interval(mins => LEAST(
      power(2, LEAST(COALESCE(p_attempts, 0) - 1, 20))::integer,
      COALESCE(
        (SELECT NULLIF(regexp_replace(config_value, '\D', '', 'g'), '')::integer
           FROM system_config WHERE config_key = 'notification_retry_backoff_cap_minutes'),
        60
      )
    ))
  END;
$$;

REVOKE ALL ON FUNCTION max_notification_delivery_attempts() FROM PUBLIC;
REVOKE ALL ON FUNCTION notification_retry_backoff(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION max_notification_delivery_attempts() TO service_role;
GRANT EXECUTE ON FUNCTION notification_retry_backoff(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. F-08 index over the LIVE QUEUE only.
--
-- The predicate mirrors pending_notification_deliveries' terminal conditions, so a
-- delivered, suppressed or dead-lettered row physically leaves the index. That is what
-- makes its size track the queue instead of all history.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS notifications_delivery_queue_idx
  ON notifications (scheduled_for, notification_id)
  WHERE delivered_at IS NULL
    AND suppressed_at IS NULL
    AND dead_lettered_at IS NULL;

-- Supports the retention sweep (20260726000005).
CREATE INDEX IF NOT EXISTS notifications_created_at_idx
  ON notifications (created_at);

-- ---------------------------------------------------------------------------
-- 4. The delivery queue, with backoff and terminal states.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pending_notification_deliveries(p_now timestamptz)
RETURNS SETOF notifications
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT notifications.*
  FROM notifications
  WHERE notifications.delivered_at IS NULL
    -- F-08: terminal states. Without these, a deliberately-unsent reminder and a
    -- permanently-failing push both stay in the scanned set forever.
    AND notifications.suppressed_at IS NULL
    AND notifications.dead_lettered_at IS NULL
    AND (notifications.scheduled_for IS NULL OR notifications.scheduled_for <= p_now)
    -- F-03: exponential backoff. A row that has never been attempted has zero backoff,
    -- so first-time delivery is unchanged and still fires on the next pass.
    AND (
      notifications.last_attempt_at IS NULL
      OR notifications.last_attempt_at
         + notification_retry_backoff(notifications.delivery_attempts) <= p_now
    )
    -- Unchanged §7.1 suppression: an ack reminder whose float is no longer pending must
    -- not be sent. Kept as a live re-check even though sweep_suppressed_ack_reminders()
    -- now stamps these rows, because a float can be acknowledged between the sweep and
    -- this read within the same minute.
    AND NOT (
      notifications.type = 'ack_reminder'::notification_type
      AND notifications.payload ->> 'kind' = 'float_ack_reminder'
      AND NOT EXISTS (
        SELECT 1
        FROM float_assignments
        WHERE float_assignments.float_id::text = notifications.payload ->> 'float_id'
          AND float_assignments.status = 'pending'
          AND float_assignments.acknowledged_at IS NULL
          AND float_assignments.declined_at IS NULL
      )
    )
  ORDER BY notifications.scheduled_for NULLS FIRST, notifications.notification_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. Attempt accounting.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION begin_notification_delivery_attempt(
  p_notification_id uuid,
  p_now timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer;
BEGIN
  UPDATE notifications
  SET delivery_attempts = delivery_attempts + 1,
      last_attempt_at = p_now
  WHERE notification_id = p_notification_id
    AND delivered_at IS NULL
  RETURNING delivery_attempts INTO v_attempts;

  RETURN COALESCE(v_attempts, 0);
END;
$$;

COMMENT ON FUNCTION begin_notification_delivery_attempt(uuid, timestamptz) IS
  'Count a dispatch attempt BEFORE the push is sent (cost audit F-03). Deliberately not '
  'delivered_at: this records that we TRIED, never that we succeeded, so the BSpec §10.1 '
  'at-least-once guarantee is untouched. Called pre-send so an unobservable crash (OOM, '
  'eviction, hard timeout) still advances the backoff.';

CREATE OR REPLACE FUNCTION record_notification_delivery_failure(
  p_notification_id uuid,
  p_now timestamptz,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dead_lettered boolean := false;
BEGIN
  UPDATE notifications
  SET last_delivery_error = left(COALESCE(p_error, 'unknown'), 1000),
      dead_lettered_at = CASE
        WHEN delivery_attempts >= max_notification_delivery_attempts() THEN p_now
        ELSE dead_lettered_at
      END
  WHERE notification_id = p_notification_id
    AND delivered_at IS NULL
  RETURNING dead_lettered_at IS NOT NULL INTO v_dead_lettered;

  RETURN COALESCE(v_dead_lettered, false);
END;
$$;

COMMENT ON FUNCTION record_notification_delivery_failure(uuid, timestamptz, text) IS
  'Record why a push failed and, once delivery_attempts reaches the configured ceiling, '
  'dead-letter the row so it stops being re-selected every 60 seconds (cost audit F-03). '
  'Never stamps delivered_at.';

-- ---------------------------------------------------------------------------
-- 6. Drain the suppressed-ack-reminder tombstones (F-08 category 1).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sweep_suppressed_ack_reminders(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_swept integer := 0;
BEGIN
  UPDATE notifications
  SET suppressed_at = p_now
  WHERE delivered_at IS NULL
    AND suppressed_at IS NULL
    AND type = 'ack_reminder'::notification_type
    AND payload ->> 'kind' = 'float_ack_reminder'
    AND NOT EXISTS (
      SELECT 1
      FROM float_assignments
      WHERE float_assignments.float_id::text = notifications.payload ->> 'float_id'
        AND float_assignments.status = 'pending'
        AND float_assignments.acknowledged_at IS NULL
        AND float_assignments.declined_at IS NULL
    );

  GET DIAGNOSTICS v_swept = ROW_COUNT;
  RETURN v_swept;
END;
$$;

COMMENT ON FUNCTION sweep_suppressed_ack_reminders(timestamptz) IS
  'Give a deliberately-unsent ack reminder a terminal state so it leaves the delivery '
  'queue and its partial index instead of being re-filtered every minute forever (cost '
  'audit F-08). Safe precisely because the row is being deliberately NOT sent, which is '
  'a different thing from F-03''s prohibition on stamping delivered_at before a send.';

-- ---------------------------------------------------------------------------
-- 7. Operator visibility. A dead-lettered notification is a real operational event
--    (almost always a misconfigured FIREBASE_SERVICE_ACCOUNT_JSON) and must not be
--    silent -- the whole failure mode this migration fixes was invisible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW dead_lettered_notifications AS
  SELECT
    notification_id,
    recipient_user_id,
    type,
    created_at,
    delivery_attempts,
    last_attempt_at,
    dead_lettered_at,
    last_delivery_error
  FROM notifications
  WHERE dead_lettered_at IS NOT NULL
  ORDER BY dead_lettered_at DESC;

REVOKE ALL ON dead_lettered_notifications FROM PUBLIC;
GRANT SELECT ON dead_lettered_notifications TO service_role;

COMMENT ON VIEW dead_lettered_notifications IS
  'Notifications that exhausted their delivery attempts. A non-empty result means pushes '
  'are failing -- check FIREBASE_SERVICE_ACCOUNT_JSON first. Cost audit F-03.';

-- ---------------------------------------------------------------------------
-- 8. The cron pass: sweep tombstones, then enqueue the live queue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deliver_pending_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  v_notification notifications%ROWTYPE;
  v_supabase_url text := current_setting('app.supabase_url', true);
  v_service_key  text := current_setting('app.service_role_key', true);
  v_queued       integer := 0;
BEGIN
  IF v_supabase_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'deliver_pending_notifications: app.supabase_url and app.service_role_key must be configured';
    RETURN 0;
  END IF;

  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE WARNING 'deliver_pending_notifications: pg_net net.http_post is unavailable';
    RETURN 0;
  END IF;

  -- One set-based statement per minute that permanently drains the tombstones, instead
  -- of re-filtering them per row forever (F-08).
  PERFORM sweep_suppressed_ack_reminders(now());

  FOR v_notification IN
    SELECT * FROM pending_notification_deliveries(now())
  LOOP
    PERFORM net.http_post(
      url := rtrim(v_supabase_url, '/') || '/functions/v1/dispatch-push',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'user_id', v_notification.recipient_user_id,
        'notification_id', v_notification.notification_id
      )
    );
    v_queued := v_queued + 1;
  END LOOP;

  RETURN v_queued;
END;
$$;

REVOKE ALL ON FUNCTION pending_notification_deliveries(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION begin_notification_delivery_attempt(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_notification_delivery_failure(uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION sweep_suppressed_ack_reminders(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION deliver_pending_notifications() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION pending_notification_deliveries(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION begin_notification_delivery_attempt(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION record_notification_delivery_failure(uuid, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION sweep_suppressed_ack_reminders(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION deliver_pending_notifications() TO service_role;

-- rollback:
-- (re-apply pending_notification_deliveries + deliver_pending_notifications from
--  20260601000001_phase_12_notifications.sql)
-- DROP VIEW IF EXISTS dead_lettered_notifications;
-- DROP FUNCTION IF EXISTS sweep_suppressed_ack_reminders(timestamptz);
-- DROP FUNCTION IF EXISTS record_notification_delivery_failure(uuid, timestamptz, text);
-- DROP FUNCTION IF EXISTS begin_notification_delivery_attempt(uuid, timestamptz);
-- DROP FUNCTION IF EXISTS notification_retry_backoff(integer);
-- DROP FUNCTION IF EXISTS max_notification_delivery_attempts();
-- DROP INDEX IF EXISTS notifications_created_at_idx;
-- DROP INDEX IF EXISTS notifications_delivery_queue_idx;
-- ALTER TABLE notifications
--   DROP COLUMN IF EXISTS suppressed_at, DROP COLUMN IF EXISTS dead_lettered_at,
--   DROP COLUMN IF EXISTS last_delivery_error, DROP COLUMN IF EXISTS last_attempt_at,
--   DROP COLUMN IF EXISTS delivery_attempts;
