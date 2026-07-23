-- Migration: retire the SM passive permanent-drop alert.
--
-- BSpec §8.4.1 / §10.1 (2026-07-13). The Student Manager is no longer notified when
-- a worker permanently drops a recurring slot: there is nothing actionable the SM does
-- in response to the passive `sm_permanent_drop_alert`, so it is retired. The dropping
-- worker's own `sw_permanent_removal_alert` (operator-initiated removals) is unchanged.
--
-- Mechanism: CREATE OR REPLACE permanent_drop_slot verbatim from
-- 20260614000005_permanent_drop_slot_boundary_fix.sql, with ONLY the SM-alert INSERT
-- removed. Signature, boundary lookup, vacate logic, v_affected_count, the SW-removal
-- INSERT, and the return shape are all carried over unchanged. The
-- `sm_permanent_drop_alert` enum value is intentionally LEFT in place (unused/retired);
-- only the row generation is dropped.

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
  -- Current-or-upcoming regular school year: the earliest such term not yet ended.
  -- Robust when `now` sits just before a term opens or between terms; still raises
  -- when `now` is past every term (no unbounded vacate — ARCH §7.1).
  SELECT end_date
    INTO v_semester_end_date
  FROM scheduling_periods
  WHERE profile_name = 'regular_school_year'
    AND end_date >= (p_drop_initiated_at AT TIME ZONE 'America/New_York')::date
  ORDER BY start_date
  LIMIT 1;

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

-- rollback: restore the SM-alert INSERT from
-- 20260614000005_permanent_drop_slot_boundary_fix.sql.
