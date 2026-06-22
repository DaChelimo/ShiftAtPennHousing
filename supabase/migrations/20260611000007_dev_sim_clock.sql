-- Migration: dev-only simulated clock (time-travel for manual testing).
--
-- Adds an injectable "now" so the whole system can be fast-forwarded from the
-- admin web UI to exercise time-triggered behaviour (T-3h broadcast, T-2h float
-- lookup, HMOD-for-Allied escalation, T-15m no-ack void, ack reminders, swap
-- expiry, break-claim phases, preference reminders) without waiting in real time.
--
-- Mechanism: a single-row dev_sim_clock table holds an OFFSET in seconds. The
-- clock keeps ticking forward at 1x from the chosen instant, because app_now()
-- adds the fixed offset to the live now(). With offset 0 (the default, and the
-- only possible state in production -- the setter UI is gated to non-prod builds)
-- app_now() === now(), so production behaviour is byte-for-byte unchanged.
--
-- app_now() is SECURITY DEFINER + STABLE so any caller resolves the simulated
-- instant without needing read access to dev_sim_clock. Every time-triggered
-- function and the orchestrator source their "now" from app_now().

-- == storage ================================================================
CREATE TABLE IF NOT EXISTS dev_sim_clock (
  id              boolean PRIMARY KEY DEFAULT true,
  offset_seconds  double precision NOT NULL DEFAULT 0,
  set_at          timestamptz,
  set_by          uuid REFERENCES users (user_id),
  CONSTRAINT dev_sim_clock_singleton CHECK (id)
);

INSERT INTO dev_sim_clock (id, offset_seconds)
VALUES (true, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE dev_sim_clock ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) reads/writes the row
-- directly. Everyone else reads the simulated instant through app_now() below.

COMMENT ON TABLE dev_sim_clock IS
  'Dev-only time-travel: single-row offset (seconds) added to now() by app_now(). Offset stays 0 in production.';

-- == the injectable clock ====================================================
CREATE OR REPLACE FUNCTION app_now()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT now() + make_interval(
    secs => COALESCE((SELECT offset_seconds FROM dev_sim_clock WHERE id), 0)
  );
$$;

COMMENT ON FUNCTION app_now() IS
  'Simulated-clock-aware now(): now() + dev_sim_clock offset. Equals now() when the offset is 0.';

GRANT EXECUTE ON FUNCTION app_now() TO PUBLIC;

-- == re-point the wall-clock-bound functions onto app_now() ===================
-- These four functions previously read now() internally, so they ignored any
-- injected clock. Swapping now() -> app_now() is a no-op at offset 0. Bodies are
-- reproduced verbatim from their defining migrations with that single change.

-- send_preference_reminders (was 20260528000013_batch_d_reminders_rotor.sql)
CREATE OR REPLACE FUNCTION send_preference_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH active_thresholds AS (
    SELECT
      sp.period_id,
      sp.period_name,
      sp.preference_deadline,
      threshold_days
    FROM scheduling_periods sp
    CROSS JOIN (VALUES (5), (3), (1)) AS threshold_values(threshold_days)
    WHERE sp.preference_deadline IS NOT NULL
      AND sp.published_at IS NULL
      AND app_now() >= sp.preference_deadline - (threshold_values.threshold_days || ' days')::interval
      AND app_now() < sp.preference_deadline - (threshold_values.threshold_days || ' days')::interval
        + interval '1 hour'
  ),
  candidate_workers AS (
    SELECT DISTINCT
      active_thresholds.period_id,
      users.user_id,
      active_thresholds.threshold_days
    FROM active_thresholds
    JOIN users
      ON users.is_active = true
    JOIN user_roles ur
      ON ur.user_id = users.user_id
     AND ur.role IN ('sw', 'sm')
    WHERE NOT EXISTS (
        SELECT 1
        FROM period_targets
        WHERE period_targets.period_id = active_thresholds.period_id
          AND period_targets.user_id = users.user_id
      )
  ),
  recorded_sends AS (
    INSERT INTO preference_reminder_sends (period_id, user_id, threshold_days)
    SELECT period_id, user_id, threshold_days
    FROM candidate_workers
    ON CONFLICT (period_id, user_id, threshold_days) DO NOTHING
    RETURNING period_id, user_id, threshold_days, notification_id, sent_at
  ),
  inserted_notifications AS (
    INSERT INTO notifications (notification_id, recipient_user_id, type, scheduled_for, payload)
    SELECT
      recorded_sends.notification_id,
      recorded_sends.user_id,
      'ack_reminder'::notification_type,
      recorded_sends.sent_at,
      jsonb_build_object(
        'kind', 'preference_reminder',
        'period_id', recorded_sends.period_id,
        'threshold_days', recorded_sends.threshold_days
      )
    FROM recorded_sends
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_inserted FROM inserted_notifications;

  RETURN v_inserted;
END;
$$;

-- preference_deadline_is_open (was 20260527000005_schedule_builder.sql)
CREATE OR REPLACE FUNCTION preference_deadline_is_open(check_period_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT preference_deadline IS NULL OR app_now() <= preference_deadline
      FROM scheduling_periods
      WHERE period_id = check_period_id
    ),
    false
  );
$$;

-- execute_due_break_transitions (was 20260531000002_phase_11_break_claim.sql)
CREATE OR REPLACE FUNCTION execute_due_break_transitions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_break record;
  v_executed integer := 0;
BEGIN
  FOR v_break IN
    SELECT
      bp.break_id,
      (bp.start_date::timestamp + op.claim_phase_open_offset)
        AT TIME ZONE 'America/New_York' AS open_at,
      (bp.start_date::timestamp + op.claim_phase_alert_offset)
        AT TIME ZONE 'America/New_York' AS alert_at,
      (bp.start_date::timestamp + op.claim_phase_close_offset)
        AT TIME ZONE 'America/New_York' AS close_at
    FROM break_periods bp
    JOIN operating_profiles op USING (profile_name)
  LOOP
    IF app_now() >= v_break.open_at THEN
      v_executed := v_executed + CASE
        WHEN clear_break_period(v_break.break_id) >= 0 THEN 1
        ELSE 0
      END;
    END IF;

    IF app_now() >= v_break.alert_at THEN
      v_executed := v_executed + CASE
        WHEN send_break_nag(v_break.break_id) >= 0 THEN 1
        ELSE 0
      END;
    END IF;

    IF app_now() >= v_break.close_at THEN
      v_executed := v_executed + close_break_claim_pool(v_break.break_id);
    END IF;
  END LOOP;

  RETURN v_executed;
END;
$$;

-- deliver_pending_notifications (was 20260601000001_phase_12_notifications.sql)
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

  FOR v_notification IN
    SELECT * FROM pending_notification_deliveries(app_now())
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

-- == re-point the swap-expiry cron job onto app_now() =========================
-- The job runs inline SQL (no function), so re-schedule it. Mirrors the guarded
-- DO-block pattern from 20260530000001_phase_09_swaps.sql.
DO $do$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    IF to_regprocedure('cron.unschedule(text)') IS NOT NULL THEN
      BEGIN
        PERFORM cron.unschedule('swap-expiry');
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END IF;

    PERFORM cron.schedule(
      'swap-expiry',
      '* * * * *',
      $sql$UPDATE swap_requests SET status='expired' WHERE status='pending' AND expires_at <= app_now()$sql$
    );
  END IF;
EXCEPTION
  WHEN invalid_schema_name OR undefined_function THEN
    NULL;
END;
$do$;
