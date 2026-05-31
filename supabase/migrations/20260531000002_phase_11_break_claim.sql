-- Migration: Phase 11 claim-based scheduling for breaks.

ALTER TABLE break_periods
  ADD COLUMN IF NOT EXISTS claim_pool_closed_at timestamptz;

CREATE TABLE IF NOT EXISTS break_phase_log (
  break_id    uuid        NOT NULL REFERENCES break_periods (break_id) ON DELETE CASCADE,
  phase       text        NOT NULL CHECK (phase IN ('cleared', 'nag_sent', 'pool_closed')),
  executed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (break_id, phase)
);

ALTER TABLE break_phase_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service-role bypass" ON break_phase_log;
CREATE POLICY "service-role bypass" ON break_phase_log
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS break_optouts (
  break_id     uuid        NOT NULL REFERENCES break_periods (break_id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users (user_id),
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (break_id, user_id)
);

ALTER TABLE break_optouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service-role bypass" ON break_optouts;
CREATE POLICY "service-role bypass" ON break_optouts
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "users can select own break optouts" ON break_optouts;
CREATE POLICY "users can select own break optouts" ON break_optouts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users can insert own break optouts" ON break_optouts;
CREATE POLICY "users can insert own break optouts" ON break_optouts
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users can update own break optouts" ON break_optouts;
CREATE POLICY "users can update own break optouts" ON break_optouts
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "users can delete own break optouts" ON break_optouts;
CREATE POLICY "users can delete own break optouts" ON break_optouts
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION break_claim_phase(
  p_break_id uuid,
  p_as_of timestamptz
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_as_of < ((bp.start_date::timestamp + op.claim_phase_open_offset)
                    AT TIME ZONE 'America/New_York')
      THEN 'pre_open'
    WHEN p_as_of < ((bp.start_date::timestamp + op.claim_phase_close_offset)
                    AT TIME ZONE 'America/New_York')
      THEN 'claim_window'
    ELSE 'open_feed'
  END
  FROM break_periods bp
  JOIN operating_profiles op USING (profile_name)
  WHERE bp.break_id = p_break_id;
$$;

CREATE OR REPLACE FUNCTION break_is_highlighted(
  p_break_id uuid,
  p_as_of timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(break_claim_phase(p_break_id, p_as_of) <> 'pre_open', false);
$$;

CREATE OR REPLACE FUNCTION worker_opted_out_of_break(
  p_user_id uuid,
  p_break_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM break_optouts
    WHERE break_id = p_break_id
      AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION open_break_claim_calendar(
  p_break_id uuid,
  p_house_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cleared integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM shift_block_assignments sba
    JOIN shift_blocks sb USING (block_id)
    JOIN break_periods bp
      ON bp.break_id = p_break_id
     AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date
         BETWEEN bp.start_date AND bp.end_date
    WHERE sb.house_id = p_house_id
      AND (
        sba.parent_float_id IS NOT NULL
        OR sba.status IN ('pending_float_in', 'pending_float_out', 'floated_in', 'floated_out')
      )
  ) THEN
    RAISE EXCEPTION 'break_clear_float_commitment_requires_manual_override';
  END IF;

  SELECT count(*)::integer
    INTO v_cleared
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  JOIN break_periods bp
    ON bp.break_id = p_break_id
   AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date
       BETWEEN bp.start_date AND bp.end_date
  WHERE sb.house_id = p_house_id
    AND sba.status <> 'vacant';

  UPDATE shift_block_assignments sba
  SET
    user_id = NULL,
    status = 'vacant',
    vacancy_origin = 'never_assigned',
    is_float = false,
    is_cross_house_pickup = false,
    source_house_id = NULL,
    parent_float_id = NULL
  FROM shift_blocks sb, break_periods bp
  WHERE sba.block_id = sb.block_id
    AND bp.break_id = p_break_id
    AND sb.house_id = p_house_id
    AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date
        BETWEEN bp.start_date AND bp.end_date;

  RETURN v_cleared;
END;
$$;

CREATE OR REPLACE FUNCTION break_claim_calendar_pool(
  p_house_id text,
  p_as_of timestamptz DEFAULT now()
)
RETURNS SETOF shift_block_assignments
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sba.*
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  JOIN operating_calendar oc
    ON oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
  JOIN break_periods bp
    ON oc.date BETWEEN bp.start_date AND bp.end_date
   AND oc.profile_name = bp.profile_name
  WHERE sb.house_id = p_house_id
    AND sba.status = 'vacant'
    AND break_claim_phase(bp.break_id, p_as_of) = 'claim_window'
  ORDER BY sb.block_start_at, sba.assignment_id;
$$;

CREATE OR REPLACE FUNCTION claim_break_shift(
  p_assignment_id uuid,
  p_user_id uuid,
  p_as_of timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target record;
  v_claimer record;
  v_week_start_date date;
  v_week_start_at timestamptz;
  v_week_end_at timestamptz;
  v_current_blocks integer;
  v_cap record;
  v_claimed_assignment_id uuid;
BEGIN
  SELECT
    sba.assignment_id,
    sb.block_id,
    sb.house_id,
    sb.block_start_at,
    bp.break_id
  INTO v_target
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  JOIN operating_calendar oc
    ON oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
  JOIN break_periods bp
    ON oc.date BETWEEN bp.start_date AND bp.end_date
   AND oc.profile_name = bp.profile_name
  WHERE sba.assignment_id = p_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_unavailable';
  END IF;

  IF break_claim_phase(v_target.break_id, p_as_of) <> 'claim_window' THEN
    RAISE EXCEPTION 'break_claim_window_closed';
  END IF;

  SELECT user_id, home_house_id, is_active
    INTO v_claimer
  FROM users
  WHERE user_id = p_user_id;

  IF NOT FOUND OR v_claimer.is_active = false THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  IF v_target.house_id = 'harnwell' AND v_claimer.home_house_id <> 'harnwell' THEN
    RAISE EXCEPTION 'harnwell_training_required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM shift_block_assignments existing
    JOIN shift_blocks existing_block USING (block_id)
    WHERE existing.user_id = p_user_id
      AND existing.status <> 'vacant'
      AND existing.status <> 'allied'
      AND existing_block.block_start_at = v_target.block_start_at
  ) THEN
    RAISE EXCEPTION 'time_conflict';
  END IF;

  v_week_start_date := date_trunc(
    'week',
    v_target.block_start_at AT TIME ZONE 'America/New_York'
  )::date;
  v_week_start_at := v_week_start_date::timestamp AT TIME ZONE 'America/New_York';
  v_week_end_at := (v_week_start_date + 7)::timestamp AT TIME ZONE 'America/New_York';

  SELECT count(*)::integer
    INTO v_current_blocks
  FROM shift_block_assignments existing
  JOIN shift_blocks existing_block USING (block_id)
  WHERE existing.user_id = p_user_id
    AND existing.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
    AND existing_block.block_start_at >= v_week_start_at
    AND existing_block.block_start_at < v_week_end_at;

  SELECT *
    INTO v_cap
  FROM effective_weekly_cap(v_week_start_date, v_target.block_start_at);

  IF v_cap.cap_enforcement = 'hard'
     AND ((v_current_blocks + 1)::numeric * 0.5) > v_cap.hours_cap THEN
    RAISE EXCEPTION 'hard_cap_exceeded';
  END IF;

  UPDATE shift_block_assignments
  SET
    status = 'claimed',
    user_id = p_user_id,
    vacancy_origin = 'none',
    is_cross_house_pickup = (v_claimer.home_house_id <> v_target.house_id),
    source_house_id = CASE
      WHEN v_claimer.home_house_id <> v_target.house_id THEN v_claimer.home_house_id
      ELSE NULL
    END
  WHERE assignment_id = p_assignment_id
    AND status = 'vacant'
  RETURNING assignment_id INTO v_claimed_assignment_id;

  IF v_claimed_assignment_id IS NULL THEN
    RAISE EXCEPTION 'shift_unavailable';
  END IF;

  RETURN v_claimed_assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION weekly_open_shifts_feed(
  p_house_id text,
  p_as_of timestamptz DEFAULT now()
)
RETURNS SETOF shift_block_assignments
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sba.*
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sb.house_id = p_house_id
    AND sba.status = 'vacant'
    AND sb.block_start_at > p_as_of
    AND sb.block_start_at <= p_as_of + interval '30 days'
    AND NOT EXISTS (
      SELECT 1
      FROM operating_calendar oc
      JOIN break_periods bp
        ON oc.date BETWEEN bp.start_date AND bp.end_date
       AND oc.profile_name = bp.profile_name
      WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
        AND break_claim_phase(bp.break_id, p_as_of) <> 'open_feed'
    )
  ORDER BY sb.block_start_at, sba.assignment_id;
$$;

CREATE OR REPLACE FUNCTION clear_break_period(p_break_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logged integer;
  v_cleared integer := 0;
  v_house record;
BEGIN
  INSERT INTO break_phase_log (break_id, phase)
  VALUES (p_break_id, 'cleared')
  ON CONFLICT DO NOTHING
  RETURNING 1 INTO v_logged;

  IF v_logged IS NULL THEN
    RETURN -1;
  END IF;

  FOR v_house IN
    SELECT DISTINCT sb.house_id
    FROM shift_blocks sb
    JOIN break_periods bp
      ON bp.break_id = p_break_id
     AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date
         BETWEEN bp.start_date AND bp.end_date
  LOOP
    v_cleared := v_cleared + open_break_claim_calendar(p_break_id, v_house.house_id);
  END LOOP;

  RETURN v_cleared;
END;
$$;

CREATE OR REPLACE FUNCTION send_break_nag(p_break_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logged integer;
  v_sent integer;
BEGIN
  INSERT INTO break_phase_log (break_id, phase)
  VALUES (p_break_id, 'nag_sent')
  ON CONFLICT DO NOTHING
  RETURNING 1 INTO v_logged;

  IF v_logged IS NULL THEN
    RETURN -1;
  END IF;

  WITH break_houses AS (
    SELECT DISTINCT sb.house_id
    FROM shift_blocks sb
    JOIN break_periods bp
      ON bp.break_id = p_break_id
     AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date
         BETWEEN bp.start_date AND bp.end_date
  ),
  candidates AS (
    SELECT u.user_id
    FROM users u
    WHERE u.is_active = true
      AND EXISTS (
        SELECT 1
        FROM break_houses
        WHERE break_houses.house_id = u.home_house_id
      )
      AND NOT worker_opted_out_of_break(u.user_id, p_break_id)
      AND NOT EXISTS (
        SELECT 1
        FROM shift_block_assignments sba
        JOIN shift_blocks sb USING (block_id)
        JOIN break_periods bp
          ON bp.break_id = p_break_id
         AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date
             BETWEEN bp.start_date AND bp.end_date
        WHERE sba.user_id = u.user_id
          AND sba.status <> 'vacant'
      )
  ),
  inserted AS (
    INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
    SELECT
      candidates.user_id,
      'ack_reminder'::notification_type,
      now(),
      jsonb_build_object('kind', 'break_claim_nag', 'break_id', p_break_id)
    FROM candidates
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_sent FROM inserted;

  RETURN v_sent;
END;
$$;

CREATE OR REPLACE FUNCTION close_break_claim_pool(p_break_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logged integer;
BEGIN
  INSERT INTO break_phase_log (break_id, phase)
  VALUES (p_break_id, 'pool_closed')
  ON CONFLICT DO NOTHING
  RETURNING 1 INTO v_logged;

  IF v_logged IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE break_periods
  SET claim_pool_closed_at = COALESCE(claim_pool_closed_at, now())
  WHERE break_id = p_break_id;

  RETURN 1;
END;
$$;

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
    IF now() >= v_break.open_at THEN
      v_executed := v_executed + CASE
        WHEN clear_break_period(v_break.break_id) >= 0 THEN 1
        ELSE 0
      END;
    END IF;

    IF now() >= v_break.alert_at THEN
      v_executed := v_executed + CASE
        WHEN send_break_nag(v_break.break_id) >= 0 THEN 1
        ELSE 0
      END;
    END IF;

    IF now() >= v_break.close_at THEN
      v_executed := v_executed + close_break_claim_pool(v_break.break_id);
    END IF;
  END LOOP;

  RETURN v_executed;
END;
$$;

REVOKE ALL ON FUNCTION open_break_claim_calendar(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_break_shift(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION clear_break_period(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION send_break_nag(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION close_break_claim_pool(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION execute_due_break_transitions() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION open_break_claim_calendar(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION claim_break_shift(uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION clear_break_period(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION send_break_nag(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION close_break_claim_pool(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION execute_due_break_transitions() TO service_role;

DO $do$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    IF to_regprocedure('cron.unschedule(text)') IS NOT NULL THEN
      BEGIN
        PERFORM cron.unschedule('break-phase-transitions');
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END IF;

    PERFORM cron.schedule(
      'break-phase-transitions',
      '*/15 * * * *',
      $sql$SELECT execute_due_break_transitions()$sql$
    );
  END IF;
EXCEPTION
  WHEN invalid_schema_name OR undefined_function THEN
    NULL;
END;
$do$;
