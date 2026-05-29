-- Batch C (SQL part): orchestrator/float correctness.
--   C2  — anchor HMOD leave resolution to the on-duty interval's start date
--         (F-07-002), not the firing moment's date.
--   C3a — when an urgent HM/HMOD notification has no resolvable recipient,
--         fall back to the project administrator (system_config terminal),
--         instead of silently dropping it (F-07-003).
--   C4  — source-status re-check under FOR UPDATE in
--         process_float_lookup_assignment: abort if a source row is no longer
--         scheduled/claimed (F-07-005, defense-in-depth).
-- (C1 shipped in 20260528000008; C5 is in packages/core; C4 snapshot flags and
--  C6a live in the Edge Function / packages/core.)

-- ============================================================
-- C2 — interval-start date for HMOD on-duty intervals (ARCH §2.6 / BSpec §2.6).
-- Weekday evening interval (Mon-Thu 17:00 -> next 08:00) is attributed to the
-- 17:00 day; the weekend continuous interval (Fri 17:00 -> Mon 08:00) is
-- attributed to the Friday.
-- ============================================================
CREATE OR REPLACE FUNCTION hmod_interval_start_date(p_at timestamptz)
RETURNS date
LANGUAGE sql STABLE AS $$
  WITH t AS (
    SELECT (p_at AT TIME ZONE 'America/New_York') AS local
  )
  SELECT CASE
    -- Weekend continuous interval: Fri 17:00 .. Mon 08:00 -> the Friday.
    WHEN (extract(isodow FROM local) = 5 AND extract(hour FROM local) >= 17)
      OR extract(isodow FROM local) IN (6, 7)
      OR (extract(isodow FROM local) = 1 AND extract(hour FROM local) < 8)
    THEN local::date - (((extract(isodow FROM local::date)::int + 2) % 7))
    -- Weekday evening interval: 17:00 -> next 08:00. Early-morning hours
    -- (before 08:00) belong to the previous day's 17:00 interval.
    WHEN extract(hour FROM local) < 8 THEN local::date - 1
    ELSE local::date
  END
  FROM t;
$$;

-- Drop the old 2-arg overload so the new optional-3rd-arg version is the only
-- match (otherwise resolve_hm_for_user(uuid, timestamptz) is ambiguous).
DROP FUNCTION IF EXISTS resolve_hm_for_user(uuid, timestamptz);

CREATE OR REPLACE FUNCTION resolve_hm_for_user(
  p_user_id uuid,
  p_at timestamptz,
  p_interval_start_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_user_id uuid := p_user_id;
  v_leave_date date;
  v_replacement_user_id uuid;
  v_is_active boolean;
  v_iteration integer := 0;
BEGIN
  -- HMOD callers pass the interval start; HM (weekday) callers leave it NULL
  -- and the firing moment's date is used.
  v_leave_date := COALESCE(p_interval_start_date, (p_at AT TIME ZONE 'America/New_York')::date);

  WHILE v_iteration < 10 AND v_current_user_id IS NOT NULL LOOP
    SELECT replacement_user_id
      INTO v_replacement_user_id
    FROM hm_leave
    WHERE user_id     = v_current_user_id
      AND status      = 'active'
      AND start_date  <= v_leave_date
      AND end_date    >= v_leave_date
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT is_active INTO v_is_active
      FROM users
      WHERE user_id = v_current_user_id;

      RETURN CASE WHEN v_is_active THEN v_current_user_id ELSE NULL END;
    END IF;

    v_current_user_id := v_replacement_user_id;
    v_iteration       := v_iteration + 1;
  END LOOP;

  RETURN NULL;
END;
$$;

-- resolve_hmod_on_duty: keep the Friday-anchored rotor lookup (from
-- 20260528000008) and pass the interval-start date to the leave walk.
CREATE OR REPLACE FUNCTION resolve_hmod_on_duty(p_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_shifted_date    date;
  v_week_start_date date;
  v_hmod_user_id    uuid;
BEGIN
  v_shifted_date := (
    (p_at AT TIME ZONE 'America/New_York') - interval '8 hours'
  )::date;

  v_week_start_date := v_shifted_date
    - (((extract(isodow FROM v_shifted_date)::int + 2) % 7));

  SELECT hmod_user_id
    INTO v_hmod_user_id
  FROM hmod_rotor
  WHERE week_start_date = v_week_start_date;

  IF v_hmod_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN resolve_hm_for_user(v_hmod_user_id, p_at, hmod_interval_start_date(p_at));
END;
$$;

-- ============================================================
-- C3a — project-administrator fallback for urgent notifications.
-- Re-create process_hmod_notify_allied_step so that a NULL recipient routes
-- to the project administrator (system_config 'project_administrator_user_id')
-- instead of dropping the event.
-- ============================================================
CREATE OR REPLACE FUNCTION process_hmod_notify_allied_step(
  p_block_id uuid,
  p_house_id text,
  p_block_start_at timestamptz,
  p_now timestamptz,
  p_reason text DEFAULT 'escalation_chain'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed_count       integer;
  v_recipient_user_id   uuid;
  v_target              text;
  v_admin_id            uuid;
BEGIN
  INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
  VALUES (p_block_id, 'hmod_notify_allied', 'fired', p_now, p_now)
  ON CONFLICT (block_id, step_name) DO NOTHING;

  GET DIAGNOSTICS v_claimed_count = ROW_COUNT;

  IF v_claimed_count = 0 THEN
    UPDATE block_step_status
    SET status     = 'fired',
        fired_at   = p_now,
        updated_at = p_now
    WHERE block_id  = p_block_id
      AND step_name = 'hmod_notify_allied'
      AND status    = 'rolled_back';

    GET DIAGNOSTICS v_claimed_count = ROW_COUNT;
  END IF;

  IF v_claimed_count = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'recipient_user_id', NULL, 'target', NULL);
  END IF;

  IF is_hm_working_time(p_now) AND is_hm_working_time(p_block_start_at) THEN
    v_recipient_user_id := resolve_hm_for_house(p_house_id, p_now);
    v_target := 'hm';
    IF v_recipient_user_id IS NULL THEN
      v_recipient_user_id := resolve_hmod_on_duty(p_now);
      v_target := 'hmod';
    END IF;
  ELSE
    v_recipient_user_id := resolve_hmod_on_duty(p_now);
    v_target := 'hmod';
  END IF;

  IF v_recipient_user_id IS NULL THEN
    -- C3a: fall back to the project administrator terminal.
    SELECT config_value::uuid INTO v_admin_id
    FROM system_config
    WHERE config_key = 'project_administrator_user_id';

    IF v_admin_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM users WHERE user_id = v_admin_id AND is_active) THEN
      v_recipient_user_id := v_admin_id;
      v_target := 'project_admin';
    ELSE
      RETURN jsonb_build_object('claimed', true, 'recipient_user_id', NULL, 'target', v_target);
    END IF;
  END IF;

  INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
  VALUES (
    v_recipient_user_id,
    'hmod_urgent'::notification_type,
    p_now,
    jsonb_build_object(
      'target',         v_target,
      'reason',         p_reason,
      'block_id',       p_block_id,
      'house_id',       p_house_id,
      'block_start_at', p_block_start_at
    )
  );

  RETURN jsonb_build_object('claimed', true, 'recipient_user_id', v_recipient_user_id, 'target', v_target);
END;
$$;

-- ============================================================
-- C4 — source-status re-check in process_float_lookup_assignment.
-- ============================================================
CREATE OR REPLACE FUNCTION process_float_lookup_assignment(
  p_worker_id uuid,
  p_source_house_id text,
  p_source_assignment_ids uuid[],
  p_destination_assignment_ids uuid[],
  p_destination_house_id text,
  p_now timestamptz,
  p_retention_days integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_float_id              uuid;
  v_latest_block_start_at timestamptz;
  v_destination_blocks    uuid[];
  v_destinations_locked   integer;
  v_sources_locked        integer;
BEGIN
  SELECT array_agg(assignment_id), count(*)::integer
    INTO v_destination_blocks, v_destinations_locked
  FROM (
    SELECT assignment_id
    FROM shift_block_assignments
    WHERE assignment_id = ANY(p_destination_assignment_ids)
      AND status = 'vacant'
    FOR UPDATE
  ) locked;

  IF v_destinations_locked IS NULL
     OR v_destinations_locked < cardinality(p_destination_assignment_ids) THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'destination_not_vacant');
  END IF;

  -- Lock the source assignments and verify they are still in a valid
  -- pre-float state (scheduled or claimed). Abort if any has changed under
  -- us (concurrent drop/float/fire), mirroring the destination re-check.
  SELECT count(*)::integer
    INTO v_sources_locked
  FROM (
    SELECT assignment_id
    FROM shift_block_assignments
    WHERE assignment_id = ANY(p_source_assignment_ids)
      AND status IN ('scheduled', 'claimed')
    FOR UPDATE
  ) locked_sources;

  IF v_sources_locked IS NULL
     OR v_sources_locked < cardinality(p_source_assignment_ids) THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'source_not_available');
  END IF;

  SELECT max(sb.block_start_at)
    INTO v_latest_block_start_at
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(p_destination_assignment_ids);

  INSERT INTO float_assignments (
    user_id, source_assignment_ids, destination_assignment_ids,
    status, initiated_by, expires_for_cleanup_at
  )
  VALUES (
    p_worker_id, p_source_assignment_ids, p_destination_assignment_ids,
    'pending', 'automated',
    v_latest_block_start_at + (p_retention_days || ' days')::interval
  )
  RETURNING float_id INTO v_float_id;

  UPDATE shift_block_assignments
  SET user_id         = p_worker_id,
      status          = 'pending_float_in',
      vacancy_origin  = 'none',
      is_float        = true,
      source_house_id = p_source_house_id,
      parent_float_id = v_float_id
  WHERE assignment_id = ANY(p_destination_assignment_ids);

  UPDATE shift_block_assignments
  SET status          = 'pending_float_out',
      vacancy_origin  = 'none',
      is_float        = false,
      source_house_id = NULL,
      parent_float_id = v_float_id
  WHERE assignment_id = ANY(p_source_assignment_ids);

  INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
  VALUES (
    p_worker_id, 'personal_shift', p_now,
    jsonb_build_object(
      'kind', 'float_assigned',
      'float_id', v_float_id,
      'destination_house_id', p_destination_house_id,
      'block_ids', (SELECT array_agg(block_id ORDER BY block_id)
                    FROM shift_block_assignments
                    WHERE assignment_id = ANY(p_destination_assignment_ids))
    )
  );

  RETURN jsonb_build_object('assigned', true, 'float_id', v_float_id);
END;
$$;

REVOKE ALL ON FUNCTION process_float_lookup_assignment(uuid, text, uuid[], uuid[], text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_float_lookup_assignment(uuid, text, uuid[], uuid[], text, timestamptz, integer) TO service_role;
