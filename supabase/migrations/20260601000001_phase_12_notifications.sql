-- Migration: Phase 12 notification delivery, push tokens, Realtime, and HM-leave mailto.

CREATE TABLE IF NOT EXISTS push_tokens (
  push_token_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  platform      text        NOT NULL CHECK (platform IN ('android', 'ios')),
  device_token  text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  UNIQUE (user_id, device_token)
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service-role bypass" ON push_tokens;
CREATE POLICY "service-role bypass" ON push_tokens
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "users can select own push tokens" ON push_tokens;
CREATE POLICY "users can select own push tokens" ON push_tokens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users can insert own push tokens" ON push_tokens;
CREATE POLICY "users can insert own push tokens" ON push_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users can update own push tokens" ON push_tokens;
CREATE POLICY "users can update own push tokens" ON push_tokens
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users can delete own push tokens" ON push_tokens;
CREATE POLICY "users can delete own push tokens" ON push_tokens
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION notification_is_pushable(p_type notification_type)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT p_type NOT IN (
    'sm_permanent_drop_alert'::notification_type,
    'sw_permanent_removal_alert'::notification_type
  );
$$;

CREATE OR REPLACE FUNCTION notification_push_targets(p_user_id uuid)
RETURNS SETOF push_tokens
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT push_tokens.*
  FROM push_tokens
  WHERE push_tokens.user_id = p_user_id
  ORDER BY push_tokens.created_at, push_tokens.push_token_id;
$$;

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
    AND (notifications.scheduled_for IS NULL OR notifications.scheduled_for <= p_now)
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

CREATE OR REPLACE FUNCTION deliver_notification(
  p_notification_id uuid,
  p_now timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE notifications
  SET delivered_at = p_now
  WHERE notification_id = p_notification_id
    AND delivered_at IS NULL;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION mark_notification_read(
  p_notification_id uuid,
  p_user_id uuid,
  p_now timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN false;
  END IF;

  UPDATE notifications
  SET acknowledged_at = p_now
  WHERE notification_id = p_notification_id
    AND recipient_user_id = p_user_id
    AND acknowledged_at IS NULL;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION url_encode_mailto_component(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT replace(
           replace(
             replace(
               replace(
                 replace(
                   replace(p_value, '%', '%25'),
                   E'\r', ''),
                 E'\n', '%0A'),
               ' ', '%20'),
             '&', '%26'),
           '?', '%3F');
$$;

CREATE OR REPLACE FUNCTION craft_hm_leave_mailto(p_leave_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leaving_name     text;
  v_replacement_name text;
  v_replacement_role text;
  v_house_id         text;
  v_start_date       date;
  v_end_date         date;
  v_recipients       text;
  v_subject          text;
  v_body             text;
BEGIN
  SELECT leaving_user.name,
         replacement_user.name,
         CASE replacement_role.role
           WHEN 'bm'::user_role_enum THEN 'Building Manager'
           WHEN 'hm'::user_role_enum THEN 'House Manager'
           ELSE 'Project Administrator'
         END,
         leaving_user.home_house_id,
         hm_leave.start_date,
         hm_leave.end_date
    INTO v_leaving_name,
         v_replacement_name,
         v_replacement_role,
         v_house_id,
         v_start_date,
         v_end_date
  FROM hm_leave
  JOIN users AS leaving_user
    ON leaving_user.user_id = hm_leave.user_id
  LEFT JOIN users AS replacement_user
    ON replacement_user.user_id = hm_leave.replacement_user_id
  LEFT JOIN LATERAL (
    SELECT user_roles.role
    FROM user_roles
    WHERE user_roles.user_id = hm_leave.replacement_user_id
      AND user_roles.role IN ('bm', 'hm')
    ORDER BY CASE user_roles.role WHEN 'bm'::user_role_enum THEN 1 ELSE 2 END
    LIMIT 1
  ) AS replacement_role ON true
  WHERE hm_leave.leave_id = p_leave_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT string_agg(DISTINCT users.email, ',' ORDER BY users.email)
    INTO v_recipients
  FROM users
  JOIN user_roles
    ON user_roles.user_id = users.user_id
   AND user_roles.role = 'sw'
  WHERE users.home_house_id = v_house_id
    AND users.is_active = true;

  v_subject := 'Housing Manager leave notice';
  v_body := format(
    '%s is on leave from %s through %s. For emergency assistance, contact %s (%s).',
    v_leaving_name,
    v_start_date,
    v_end_date,
    COALESCE(v_replacement_name, 'the project administrator'),
    v_replacement_role
  );

  RETURN 'mailto:' || COALESCE(v_recipients, '') ||
    '?subject=' || url_encode_mailto_component(v_subject) ||
    '&body=' || url_encode_mailto_component(v_body);
END;
$$;

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

ALTER TABLE notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION notification_push_targets(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION pending_notification_deliveries(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION deliver_notification(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_notification_read(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION deliver_pending_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION craft_hm_leave_mailto(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION notification_push_targets(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION pending_notification_deliveries(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION deliver_notification(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION mark_notification_read(uuid, uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION deliver_pending_notifications() TO service_role;
GRANT EXECUTE ON FUNCTION craft_hm_leave_mailto(uuid) TO service_role;

DO $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    IF to_regprocedure('cron.unschedule(text)') IS NOT NULL THEN
      BEGIN
        PERFORM cron.unschedule('deliver-notifications');
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END IF;

    PERFORM cron.schedule(
      'deliver-notifications',
      '* * * * *',
      'SELECT deliver_pending_notifications()'
    );
  END IF;
EXCEPTION
  WHEN invalid_schema_name OR undefined_function THEN
    NULL;
END;
$$;

-- rollback:
-- SELECT cron.unschedule('deliver-notifications');
-- ALTER PUBLICATION supabase_realtime DROP TABLE notifications;
-- DROP TABLE IF EXISTS push_tokens CASCADE;
