-- Migration: Phase 10 permanent drop and permanent pickup operations.

CREATE OR REPLACE FUNCTION permanent_drop_slot(
  p_dropping_user_id uuid,
  p_house_id text,
  p_day_of_week integer,
  p_block_start_locals text[],
  p_drop_initiated_at timestamptz,
  p_operator_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_semester_end_date date;
  v_affected_count integer;
BEGIN
  SELECT end_date
    INTO v_semester_end_date
  FROM scheduling_periods
  WHERE (p_drop_initiated_at AT TIME ZONE 'America/New_York')::date BETWEEN start_date AND end_date
    AND profile_name = 'regular_school_year';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'semester_boundary_not_found';
  END IF;

  UPDATE shift_block_assignments sba
  SET
    user_id = NULL,
    status = 'vacant',
    vacancy_origin = 'permanent_drop'
  WHERE sba.user_id = p_dropping_user_id
    AND sba.block_id IN (
      SELECT sb.block_id
      FROM shift_blocks sb
      JOIN operating_calendar oc
        ON oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
      WHERE sb.house_id = p_house_id
        AND EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York') = p_day_of_week
        AND TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI') = ANY (p_block_start_locals)
        AND sb.block_start_at > p_drop_initiated_at
        AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date <= v_semester_end_date
        AND oc.profile_name = 'regular_school_year'
    )
    AND sba.status NOT IN ('floated_out', 'pending_float_out');

  GET DIAGNOSTICS v_affected_count = ROW_COUNT;

  INSERT INTO notifications (recipient_user_id, type, delivered_at, scheduled_for, payload)
  SELECT
    ur.user_id,
    'sm_permanent_drop_alert'::notification_type,
    NULL,
    now(),
    jsonb_build_object(
      'dropping_user_id', p_dropping_user_id,
      'house_id', p_house_id,
      'day_of_week', p_day_of_week,
      'block_start_locals', p_block_start_locals,
      'semester_end_date', v_semester_end_date
    )
  FROM user_roles ur
  WHERE ur.scope_house_id = p_house_id
    AND ur.role = 'sm';

  IF p_operator_user_id IS NOT NULL AND p_operator_user_id <> p_dropping_user_id THEN
    INSERT INTO notifications (recipient_user_id, type, delivered_at, scheduled_for, payload)
    VALUES (
      p_dropping_user_id,
      'sw_permanent_removal_alert'::notification_type,
      NULL,
      now(),
      jsonb_build_object(
        'operator_user_id', p_operator_user_id,
        'house_id', p_house_id,
        'day_of_week', p_day_of_week,
        'block_start_locals', p_block_start_locals,
        'semester_end_date', v_semester_end_date
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'affected_count', v_affected_count,
    'semester_end_date', v_semester_end_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION permanent_drop(
  dropping_user_id uuid,
  slot_house_id text,
  slot_day_of_week integer,
  slot_block_start_times text[],
  drop_initiated_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (permanent_drop_slot(
      dropping_user_id,
      slot_house_id,
      slot_day_of_week,
      slot_block_start_times,
      drop_initiated_at,
      NULL
    ) ->> 'affected_count')::integer;
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = 'semester_boundary_not_found' THEN
      RAISE EXCEPTION 'Cannot determine semester boundary. Contact administrator.';
    END IF;
    RAISE;
END;
$$;

-- Signature changed in this phase (added p_skipped_block_ids); drop the prior
-- 2-arg form so a re-applied migration leaves exactly one overload.
DROP FUNCTION IF EXISTS permanent_pickup_slot(uuid, uuid[]);

CREATE OR REPLACE FUNCTION permanent_pickup_slot(
  p_picking_user_id uuid,
  p_assigned_block_ids uuid[],
  p_skipped_block_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_home_house_id text;
  v_assigned_count integer;
  v_skipped_count integer;
BEGIN
  SELECT home_house_id
    INTO v_home_house_id
  FROM users
  WHERE user_id = p_picking_user_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  -- Harnwell training invariant (AGENTS #1) guards every block this call
  -- touches — both the seats being claimed and the seats being re-flagged.
  IF EXISTS (
    SELECT 1
    FROM shift_blocks sb
    WHERE sb.block_id = ANY (
        COALESCE(p_assigned_block_ids, ARRAY[]::uuid[])
        || COALESCE(p_skipped_block_ids, ARRAY[]::uuid[])
      )
      AND sb.house_id = 'harnwell'
      AND v_home_house_id <> 'harnwell'
  ) THEN
    RAISE EXCEPTION 'harnwell_training_required';
  END IF;

  -- Assigned weeks: claim them. Race-safe — only seats still in the
  -- permanent-drop vacancy are taken, so a concurrent pickup/claim that already
  -- grabbed a week is left intact (ARCH §7.2 step 6).
  UPDATE shift_block_assignments sba
  SET
    user_id = p_picking_user_id,
    status = 'claimed',
    vacancy_origin = 'none',
    is_cross_house_pickup = (sb.house_id <> v_home_house_id),
    source_house_id = CASE
      WHEN sb.house_id <> v_home_house_id THEN v_home_house_id
      ELSE NULL
    END
  FROM shift_blocks sb
  WHERE sba.block_id = sb.block_id
    AND sba.block_id = ANY (COALESCE(p_assigned_block_ids, ARRAY[]::uuid[]))
    AND sba.status = 'vacant'
    AND sba.vacancy_origin = 'permanent_drop';

  GET DIAGNOSTICS v_assigned_count = ROW_COUNT;

  -- Skipped weeks (hours-cap / time-conflict): re-flag them OFF permanent_drop
  -- in the SAME transaction. They stay vacant (so weekly_open_shifts_feed still
  -- surfaces them within the 30-day horizon and they undergo standard weekly
  -- escalation), but leave permanent_openings_feed (which filters
  -- vacancy_origin = 'permanent_drop') and can no longer be permanently
  -- re-picked-up. This is the §8.4.3 / ARCH §7.2-step-8 guarantee: after any
  -- pickup the slot leaves the permanent feed regardless of completeness, and
  -- "partial pickups are final." Race-safe predicate leaves raced-away seats
  -- (now claimed by someone else) untouched.
  UPDATE shift_block_assignments sba
  SET vacancy_origin = 'temporary_drop'
  WHERE sba.block_id = ANY (COALESCE(p_skipped_block_ids, ARRAY[]::uuid[]))
    AND sba.status = 'vacant'
    AND sba.vacancy_origin = 'permanent_drop';

  GET DIAGNOSTICS v_skipped_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'assigned_count', v_assigned_count,
    'skipped_count', v_skipped_count
  );
END;
$$;

REVOKE ALL ON FUNCTION permanent_drop_slot(uuid, text, integer, text[], timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION permanent_drop(uuid, text, integer, text[], timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION permanent_pickup_slot(uuid, uuid[], uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION permanent_drop_slot(uuid, text, integer, text[], timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION permanent_drop(uuid, text, integer, text[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION permanent_pickup_slot(uuid, uuid[], uuid[]) TO service_role;
