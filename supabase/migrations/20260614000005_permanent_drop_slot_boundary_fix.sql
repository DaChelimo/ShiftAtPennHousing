-- Migration: permanent_drop_slot — robust semester-boundary resolution.
--
-- BSpec §8.x / ARCH §7.1 (permanent drop bounds future occurrences by the
-- semester end). Fixes `semester_boundary_not_found` on the live-calendar
-- "This week onward" (permanent) Remove + Replace, surfaced when the operating
-- clock sits in the gap just BEFORE a term opens.
--
-- The original lookup required `now` to fall strictly inside a regular_school_year
-- period:
--
--     WHERE (now AT TIME ZONE NY)::date BETWEEN start_date AND end_date
--       AND profile_name = 'regular_school_year';
--     IF NOT FOUND THEN RAISE 'semester_boundary_not_found';
--
-- But a manager edits the LIVE calendar for a week that is inside the term while
-- `now` can legitimately be the day before it starts (e.g. the Sunday before the
-- Monday a semester opens) or between terms — so `now` is in no period and the
-- drop fails even though the clicked occurrence (and every future occurrence) IS
-- in the upcoming term. This is exactly the case the admin_assign_worker /
-- admin_replace_seat permanent path already handles robustly (it joins each future
-- block to ITS regular_school_year period), so the drop side was the lone gap:
-- a permanent Replace that drops an incumbent first, and a permanent Remove, both
-- raised here.
--
-- Fix: anchor on the CURRENT-OR-UPCOMING regular school year — the earliest
-- regular_school_year period that has not yet ended (`end_date >= now`). When `now`
-- is inside a term, that term is selected (its end_date ≥ now and it starts before
-- any later term). When `now` is just before/between terms, the next opening term
-- is selected. When `now` is past every term, none qualifies and the function still
-- raises `semester_boundary_not_found` (so an unbounded vacate is impossible — the
-- ARCH §7.1 / phase-10 test-D guarantee is preserved). Every future occurrence of
-- the slot lies within [now, end_date], so the bounded UPDATE is unchanged.
--
-- Only the boundary SELECT changes; the vacate, the SM/SW alerts, and the return
-- shape are carried over verbatim.

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

-- rollback: restore the now-must-be-inside-a-term lookup from
-- 20260531000001_phase_10_permanent_ops.sql.
