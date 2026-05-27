-- Migration: schedule builder
-- Phase 04: preferences, period targets, draft assignments, publish, reminders.

CREATE TYPE preference_status_enum AS ENUM ('preferred', 'available', 'cannot', 'none');

CREATE OR REPLACE FUNCTION user_has_house_admin_role(
  check_user_id uuid,
  check_house_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = check_user_id
      AND role IN ('sm', 'hm', 'bm')
      AND scope_house_id = check_house_id
  );
$$;

CREATE TABLE preferences (
  user_id   uuid                   NOT NULL REFERENCES users (user_id),
  block_id  uuid                   NOT NULL REFERENCES shift_blocks (block_id),
  period_id uuid                   NOT NULL REFERENCES scheduling_periods (period_id),
  status    preference_status_enum NOT NULL,
  PRIMARY KEY (user_id, block_id, period_id)
);

CREATE TABLE period_targets (
  user_id      uuid    NOT NULL REFERENCES users (user_id),
  period_id    uuid    NOT NULL REFERENCES scheduling_periods (period_id),
  target_hours integer NOT NULL CHECK (target_hours >= 0),
  opted_out    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, period_id)
);

CREATE TABLE draft_block_assignments (
  draft_assignment_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id           uuid        NOT NULL REFERENCES scheduling_periods (period_id),
  block_id            uuid        NOT NULL REFERENCES shift_blocks (block_id),
  user_id             uuid        NOT NULL REFERENCES users (user_id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL REFERENCES users (user_id),
  UNIQUE (period_id, block_id, user_id)
);

CREATE INDEX preferences_period_id_idx
  ON preferences (period_id);

CREATE INDEX preferences_block_id_idx
  ON preferences (block_id);

CREATE INDEX period_targets_period_id_idx
  ON period_targets (period_id);

CREATE INDEX draft_block_assignments_period_id_idx
  ON draft_block_assignments (period_id);

CREATE INDEX draft_block_assignments_block_id_idx
  ON draft_block_assignments (block_id);

ALTER TABLE preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_block_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON preferences
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "workers can select own preferences" ON preferences
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "workers can insert own preferences" ON preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "workers can update own preferences" ON preferences
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "workers can delete own preferences" ON preferences
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "house admins can select house preferences" ON preferences
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = preferences.block_id
        AND user_has_house_admin_role(auth.uid(), shift_blocks.house_id)
    )
  );

CREATE POLICY "house admins can insert house preferences" ON preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = preferences.block_id
        AND user_has_house_admin_role(auth.uid(), shift_blocks.house_id)
    )
  );

CREATE POLICY "house admins can update house preferences" ON preferences
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = preferences.block_id
        AND user_has_house_admin_role(auth.uid(), shift_blocks.house_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = preferences.block_id
        AND user_has_house_admin_role(auth.uid(), shift_blocks.house_id)
    )
  );

CREATE POLICY "house admins can delete house preferences" ON preferences
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = preferences.block_id
        AND user_has_house_admin_role(auth.uid(), shift_blocks.house_id)
    )
  );

CREATE POLICY "service-role bypass" ON period_targets
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "workers can select own period targets" ON period_targets
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "workers can insert own period targets" ON period_targets
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "workers can update own period targets" ON period_targets
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "workers can delete own period targets" ON period_targets
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "house admins can select house period targets" ON period_targets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.user_id = period_targets.user_id
        AND user_has_house_admin_role(auth.uid(), users.home_house_id)
    )
  );

CREATE POLICY "house admins can insert house period targets" ON period_targets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.user_id = period_targets.user_id
        AND user_has_house_admin_role(auth.uid(), users.home_house_id)
    )
  );

CREATE POLICY "house admins can update house period targets" ON period_targets
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.user_id = period_targets.user_id
        AND user_has_house_admin_role(auth.uid(), users.home_house_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.user_id = period_targets.user_id
        AND user_has_house_admin_role(auth.uid(), users.home_house_id)
    )
  );

CREATE POLICY "house admins can delete house period targets" ON period_targets
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.user_id = period_targets.user_id
        AND user_has_house_admin_role(auth.uid(), users.home_house_id)
    )
  );

CREATE POLICY "service-role bypass" ON draft_block_assignments
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "house schedule-builders can select drafts" ON draft_block_assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = draft_block_assignments.block_id
        AND user_has_house_admin_role(auth.uid(), shift_blocks.house_id)
    )
  );

CREATE POLICY "house schedule-builders can insert drafts" ON draft_block_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = draft_block_assignments.block_id
        AND user_has_house_admin_role(auth.uid(), shift_blocks.house_id)
    )
  );

CREATE POLICY "house schedule-builders can update drafts" ON draft_block_assignments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = draft_block_assignments.block_id
        AND user_has_house_admin_role(auth.uid(), shift_blocks.house_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = draft_block_assignments.block_id
        AND user_has_house_admin_role(auth.uid(), shift_blocks.house_id)
    )
  );

CREATE POLICY "house schedule-builders can delete drafts" ON draft_block_assignments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = draft_block_assignments.block_id
        AND user_has_house_admin_role(auth.uid(), shift_blocks.house_id)
    )
  );

CREATE OR REPLACE FUNCTION preference_deadline_is_open(check_period_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT preference_deadline IS NULL OR now() <= preference_deadline
      FROM scheduling_periods
      WHERE period_id = check_period_id
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION enforce_preference_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id uuid;
BEGIN
  v_period_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.period_id ELSE NEW.period_id END;

  IF NOT preference_deadline_is_open(v_period_id) THEN
    RAISE EXCEPTION 'preference deadline has passed for period %', v_period_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER preferences_enforce_deadline
  BEFORE INSERT OR UPDATE OR DELETE ON preferences
  FOR EACH ROW
  EXECUTE FUNCTION enforce_preference_deadline();

CREATE TRIGGER period_targets_enforce_deadline
  BEFORE INSERT OR UPDATE OR DELETE ON period_targets
  FOR EACH ROW
  EXECUTE FUNCTION enforce_preference_deadline();

CREATE OR REPLACE FUNCTION enforce_period_target_hours_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap integer;
BEGIN
  SELECT op.default_hours_cap
    INTO v_cap
  FROM scheduling_periods sp
  JOIN operating_profiles op
    ON op.profile_name = sp.profile_name
  WHERE sp.period_id = NEW.period_id;

  IF v_cap IS NULL THEN
    RAISE EXCEPTION 'unknown scheduling period %', NEW.period_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.target_hours > v_cap THEN
    RAISE EXCEPTION 'target_hours % exceeds cap % for period %',
      NEW.target_hours, v_cap, NEW.period_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER period_targets_enforce_hours_cap
  BEFORE INSERT OR UPDATE OF target_hours, period_id ON period_targets
  FOR EACH ROW
  EXECUTE FUNCTION enforce_period_target_hours_cap();

CREATE OR REPLACE FUNCTION enforce_harnwell_assignment_training()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_house_id text;
  v_home_house_id text;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT house_id
    INTO v_house_id
  FROM shift_blocks
  WHERE block_id = NEW.block_id;

  IF v_house_id = 'harnwell' THEN
    SELECT home_house_id
      INTO v_home_house_id
    FROM users
    WHERE user_id = NEW.user_id;

    IF v_home_house_id IS DISTINCT FROM 'harnwell' THEN
      RAISE EXCEPTION 'non-Harnwell workers may not staff Harnwell'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER shift_block_assignments_enforce_harnwell_training
  BEFORE INSERT OR UPDATE OF block_id, user_id ON shift_block_assignments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_harnwell_assignment_training();

CREATE TRIGGER draft_block_assignments_enforce_harnwell_training
  BEFORE INSERT OR UPDATE OF block_id, user_id ON draft_block_assignments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_harnwell_assignment_training();

CREATE OR REPLACE FUNCTION submit_preferences(
  p_user_id uuid,
  p_period_id uuid,
  p_preferences jsonb,
  p_target_hours integer,
  p_opted_out boolean DEFAULT false
)
RETURNS TABLE (
  preferences_upserted integer,
  target_upserted integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preferences_upserted integer := 0;
  v_target_upserted integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_preferences, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'preferences must be an array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT preference_deadline_is_open(p_period_id) THEN
    RAISE EXCEPTION 'preference deadline has passed for period %', p_period_id
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO preferences (user_id, block_id, period_id, status)
  SELECT
    p_user_id,
    (entry.value ->> 'block_id')::uuid,
    p_period_id,
    (entry.value ->> 'status')::preference_status_enum
  FROM jsonb_array_elements(COALESCE(p_preferences, '[]'::jsonb)) AS entry(value)
  ON CONFLICT (user_id, block_id, period_id)
  DO UPDATE SET status = EXCLUDED.status;

  GET DIAGNOSTICS v_preferences_upserted = ROW_COUNT;

  INSERT INTO period_targets (user_id, period_id, target_hours, opted_out)
  VALUES (p_user_id, p_period_id, p_target_hours, COALESCE(p_opted_out, false))
  ON CONFLICT (user_id, period_id)
  DO UPDATE SET
    target_hours = EXCLUDED.target_hours,
    opted_out = EXCLUDED.opted_out;

  GET DIAGNOSTICS v_target_upserted = ROW_COUNT;

  RETURN QUERY SELECT v_preferences_upserted, v_target_upserted;
END;
$$;

CREATE OR REPLACE FUNCTION publish_schedule_impl(
  p_period_id uuid,
  p_published_by uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period scheduling_periods%ROWTYPE;
  v_scheduled_count integer := 0;
  v_vacant_count integer := 0;
BEGIN
  SELECT *
    INTO v_period
  FROM scheduling_periods
  WHERE period_id = p_period_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'scheduling period % not found', p_period_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_period.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'scheduling period % is already published', p_period_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_published_by IS NOT NULL AND EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT b.house_id
      FROM shift_blocks b
      WHERE (b.block_start_at AT TIME ZONE 'America/New_York')::date
        BETWEEN v_period.start_date AND v_period.end_date
    ) AS period_houses
    WHERE NOT user_has_house_admin_role(p_published_by, period_houses.house_id)
  ) THEN
    RAISE EXCEPTION 'publisher % is not authorized for every house in period %',
      p_published_by, p_period_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM shift_block_assignments a
    JOIN shift_blocks b
      ON b.block_id = a.block_id
    WHERE (b.block_start_at AT TIME ZONE 'America/New_York')::date
      BETWEEN v_period.start_date AND v_period.end_date
  ) THEN
    RAISE EXCEPTION 'cannot publish period % with pre-existing live assignments', p_period_id
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO shift_block_assignments (
    block_id,
    user_id,
    status,
    vacancy_origin,
    is_float,
    is_cross_house_pickup,
    source_house_id
  )
  SELECT
    draft_block_assignments.block_id,
    draft_block_assignments.user_id,
    'scheduled'::shift_status_enum,
    'none'::vacancy_origin_enum,
    false,
    false,
    NULL::text
  FROM draft_block_assignments
  WHERE draft_block_assignments.period_id = p_period_id;

  GET DIAGNOSTICS v_scheduled_count = ROW_COUNT;

  WITH period_blocks AS (
    SELECT b.block_id, b.required_headcount
    FROM shift_blocks b
    WHERE (b.block_start_at AT TIME ZONE 'America/New_York')::date
      BETWEEN v_period.start_date AND v_period.end_date
  ),
  draft_counts AS (
    SELECT d.block_id, count(*)::integer AS drafted_count
    FROM draft_block_assignments d
    WHERE d.period_id = p_period_id
    GROUP BY d.block_id
  ),
  missing_seats AS (
    SELECT
      period_blocks.block_id,
      period_blocks.required_headcount - COALESCE(draft_counts.drafted_count, 0) AS missing_count
    FROM period_blocks
    LEFT JOIN draft_counts
      ON draft_counts.block_id = period_blocks.block_id
    WHERE period_blocks.required_headcount > COALESCE(draft_counts.drafted_count, 0)
  )
  INSERT INTO shift_block_assignments (
    block_id,
    user_id,
    status,
    vacancy_origin,
    is_float,
    is_cross_house_pickup,
    source_house_id
  )
  SELECT
    missing_seats.block_id,
    NULL::uuid,
    'vacant'::shift_status_enum,
    'never_assigned'::vacancy_origin_enum,
    false,
    false,
    NULL::text
  FROM missing_seats
  CROSS JOIN LATERAL generate_series(1, missing_seats.missing_count);

  GET DIAGNOSTICS v_vacant_count = ROW_COUNT;

  DELETE FROM draft_block_assignments
  WHERE period_id = p_period_id;

  UPDATE scheduling_periods
  SET published_at = now()
  WHERE period_id = p_period_id;

  RETURN v_scheduled_count + v_vacant_count;
END;
$$;

CREATE OR REPLACE FUNCTION publish_schedule(p_period_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT publish_schedule_impl(p_period_id, NULL::uuid);
$$;

CREATE OR REPLACE FUNCTION publish_schedule(
  p_period_id uuid,
  p_published_by uuid
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT publish_schedule_impl(p_period_id, p_published_by);
$$;

CREATE TABLE notifications (
  notification_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid        NOT NULL REFERENCES users (user_id),
  type              text        NOT NULL,
  delivered_at      timestamptz,
  scheduled_for     timestamptz NOT NULL DEFAULT now(),
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE preference_reminder_sends (
  period_id      uuid        NOT NULL REFERENCES scheduling_periods (period_id),
  user_id        uuid        NOT NULL REFERENCES users (user_id),
  threshold_days integer     NOT NULL CHECK (threshold_days IN (5, 3, 1)),
  notification_id uuid       NOT NULL DEFAULT gen_random_uuid(),
  sent_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_id, user_id, threshold_days)
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE preference_reminder_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON notifications
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "users can select own notifications" ON notifications
  FOR SELECT
  TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE POLICY "service-role bypass" ON preference_reminder_sends
  TO service_role
  USING (true)
  WITH CHECK (true);

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
  -- A worker has "submitted" per BSpec §4.2 if they have ANY row in either
  -- preferences or period_targets for the period. The submit_preferences RPC
  -- creates a period_targets row in every flow (including "no hours" opt-out
  -- and target-hours-only with no block markings), so period_targets existence
  -- is the spec-aligned proxy for "went through the submission flow."
  -- Reminders fire only for workers with neither row.
  candidate_workers AS (
    SELECT DISTINCT
      active_thresholds.period_id,
      active_thresholds.period_name,
      active_thresholds.preference_deadline,
      active_thresholds.threshold_days,
      users.user_id
    FROM active_thresholds
    JOIN users
      ON users.is_active = true
    JOIN user_roles
      ON user_roles.user_id = users.user_id
     AND user_roles.role IN ('sw', 'sm', 'hm')
    WHERE NOT EXISTS (
        SELECT 1
        FROM preferences
        WHERE preferences.period_id = active_thresholds.period_id
          AND preferences.user_id = users.user_id
      )
      AND NOT EXISTS (
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
      'preference_reminder',
      recorded_sends.sent_at,
      jsonb_build_object(
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

DO $do$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule(
      'preference-reminders',
      '0 * * * *',
      $sql$SELECT send_preference_reminders()$sql$
    );
  END IF;
EXCEPTION
  WHEN invalid_schema_name OR undefined_function THEN
    NULL;
END;
$do$;

-- rollback:
-- SELECT cron.unschedule('preference-reminders');
-- DROP FUNCTION IF EXISTS send_preference_reminders();
-- DROP POLICY IF EXISTS "service-role bypass" ON preference_reminder_sends;
-- DROP POLICY IF EXISTS "users can select own notifications" ON notifications;
-- DROP POLICY IF EXISTS "service-role bypass" ON notifications;
-- DROP TABLE IF EXISTS preference_reminder_sends CASCADE;
-- DROP TABLE IF EXISTS notifications CASCADE;
-- DROP FUNCTION IF EXISTS publish_schedule(uuid, uuid);
-- DROP FUNCTION IF EXISTS publish_schedule(uuid);
-- DROP FUNCTION IF EXISTS publish_schedule_impl(uuid, uuid);
-- DROP FUNCTION IF EXISTS submit_preferences(uuid, uuid, jsonb, integer, boolean);
-- DROP TRIGGER IF EXISTS draft_block_assignments_enforce_harnwell_training ON draft_block_assignments;
-- DROP TRIGGER IF EXISTS shift_block_assignments_enforce_harnwell_training ON shift_block_assignments;
-- DROP FUNCTION IF EXISTS enforce_harnwell_assignment_training();
-- DROP TRIGGER IF EXISTS period_targets_enforce_hours_cap ON period_targets;
-- DROP FUNCTION IF EXISTS enforce_period_target_hours_cap();
-- DROP TRIGGER IF EXISTS period_targets_enforce_deadline ON period_targets;
-- DROP TRIGGER IF EXISTS preferences_enforce_deadline ON preferences;
-- DROP FUNCTION IF EXISTS enforce_preference_deadline();
-- DROP FUNCTION IF EXISTS preference_deadline_is_open(uuid);
-- DROP TABLE IF EXISTS draft_block_assignments CASCADE;
-- DROP TABLE IF EXISTS period_targets CASCADE;
-- DROP TABLE IF EXISTS preferences CASCADE;
-- DROP TYPE IF EXISTS preference_status_enum;
