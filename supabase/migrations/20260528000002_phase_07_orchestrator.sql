-- Migration: Phase 07 orchestrator notification typing and cron schedule.

DO $$
BEGIN
  CREATE TYPE notification_type AS ENUM (
    'personal_shift',
    'broadcast',
    'hmod_urgent',
    'ack_reminder',
    'swap_request',
    'hm_leave_notice',
    'sm_permanent_drop_alert',
    'sw_permanent_removal_alert'
  );
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS notifications (
  notification_id   uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid              NOT NULL REFERENCES users (user_id),
  type              notification_type NOT NULL,
  delivered_at      timestamptz,
  scheduled_for     timestamptz,
  payload           jsonb             NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at   timestamptz
);

DO $$
DECLARE
  v_type_udt text;
BEGIN
  SELECT udt_name
    INTO v_type_udt
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'notifications'
    AND column_name = 'type';

  IF v_type_udt IS DISTINCT FROM 'notification_type' THEN
    -- Phase 05 used this string before the Phase 07 enum was introduced.
    -- Preserve existing rows by mapping them to the only reminder type in
    -- the Phase 07 notification taxonomy.
    UPDATE notifications
    SET type = 'ack_reminder'
    WHERE type = 'preference_reminder';

    ALTER TABLE notifications
      ALTER COLUMN type TYPE notification_type
      USING type::notification_type;
  END IF;
END;
$$;

ALTER TABLE IF EXISTS notifications
  ALTER COLUMN scheduled_for DROP DEFAULT,
  ALTER COLUMN scheduled_for DROP NOT NULL;

ALTER TABLE IF EXISTS notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service-role bypass" ON notifications;
CREATE POLICY "service-role bypass" ON notifications
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "users can select own notifications" ON notifications;
CREATE POLICY "users can select own notifications" ON notifications
  FOR SELECT
  TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE INDEX IF NOT EXISTS notifications_recipient_scheduled_idx
  ON notifications (recipient_user_id, scheduled_for);

DO $do$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    IF to_regprocedure('cron.unschedule(text)') IS NOT NULL THEN
      BEGIN
        PERFORM cron.unschedule('orchestrator-tick');
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END IF;

    PERFORM cron.schedule(
      'orchestrator-tick',
      '* * * * *',
      $sql$
        SELECT net.http_post(
          url := current_setting('app.supabase_url') || '/functions/v1/orchestrator-tick',
          headers := jsonb_build_object(
            'Authorization',
            'Bearer ' || current_setting('app.service_role_key')
          )
        )
      $sql$
    );
  END IF;
EXCEPTION
  WHEN invalid_schema_name OR undefined_function THEN
    NULL;
END;
$do$;

-- Keep the Phase 04 reminder helper executable after notifications.type
-- becomes an enum. Preference reminders predate the Phase 07 notification
-- taxonomy, so they are stored as ack_reminder with a payload discriminator.
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
      AND now() >= sp.preference_deadline - (threshold_values.threshold_days || ' days')::interval
      AND now() < sp.preference_deadline - (threshold_values.threshold_days || ' days')::interval
        + interval '1 hour'
  ),
  candidate_workers AS (
    SELECT
      active_thresholds.period_id,
      users.user_id,
      active_thresholds.threshold_days
    FROM active_thresholds
    JOIN users
      ON users.is_active = true
    WHERE NOT EXISTS (
        SELECT 1
        FROM period_targets
        WHERE period_targets.period_id = active_thresholds.period_id
          AND period_targets.user_id = users.user_id
      )
  ),
  recorded_sends AS (
    INSERT INTO preference_reminder_sends (
      period_id,
      user_id,
      threshold_days
    )
    SELECT
      candidate_workers.period_id,
      candidate_workers.user_id,
      candidate_workers.threshold_days
    FROM candidate_workers
    ON CONFLICT (period_id, user_id, threshold_days) DO NOTHING
    RETURNING period_id, user_id, threshold_days, notification_id, sent_at
  ),
  inserted_notifications AS (
    INSERT INTO notifications (
      notification_id,
      recipient_user_id,
      type,
      scheduled_for,
      payload
    )
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
  SELECT count(*)::integer
    INTO v_inserted
  FROM inserted_notifications;

  RETURN v_inserted;
END;
$$;

-- rollback:
-- SELECT cron.unschedule('orchestrator-tick');
-- DROP INDEX IF EXISTS notifications_recipient_scheduled_idx;
-- ALTER TABLE notifications ALTER COLUMN type TYPE text USING type::text;
-- DROP TYPE IF EXISTS notification_type;
