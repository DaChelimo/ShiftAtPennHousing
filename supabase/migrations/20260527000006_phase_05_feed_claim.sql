-- Migration: Phase 05 open shifts feed and claiming.

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
  ORDER BY sb.block_start_at, sba.assignment_id;
$$;

CREATE OR REPLACE FUNCTION weekly_feed_for_house(
  p_house_id text,
  p_calling_user_id uuid,
  p_as_of timestamptz DEFAULT now()
)
RETURNS SETOF shift_block_assignments
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH caller AS (
    SELECT home_house_id
    FROM users
    WHERE user_id = p_calling_user_id
      AND is_active = true
  )
  SELECT feed.*
  FROM caller
  CROSS JOIN LATERAL weekly_open_shifts_feed(p_house_id, p_as_of) AS feed
  JOIN shift_blocks sb USING (block_id)
  WHERE (
    sb.house_id = caller.home_house_id
    OR (
      sb.house_id <> caller.home_house_id
      AND NOT (sb.house_id = 'harnwell' AND caller.home_house_id <> 'harnwell')
    )
  );
$$;

CREATE OR REPLACE FUNCTION is_assignment_claimable(
  p_assignment_id uuid,
  p_as_of timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM shift_block_assignments sba
    JOIN shift_blocks sb USING (block_id)
    WHERE sba.assignment_id = p_assignment_id
      AND sba.status = 'vacant'
      AND sb.block_start_at > p_as_of + interval '2 hours'
  );
$$;

CREATE OR REPLACE FUNCTION permanent_openings_feed(
  p_house_id text,
  p_as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  house_id text,
  day_of_week integer,
  block_start_time time,
  occurrence_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sb.house_id,
    EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York')::integer AS day_of_week,
    (
      (sb.block_start_at AT TIME ZONE 'America/New_York')::time
      + (
        EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York')::integer
        * interval '1 microsecond'
      )
    )::time AS block_start_time,
    COUNT(*) AS occurrence_count
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sb.house_id = p_house_id
    AND sba.status = 'vacant'
    AND sba.vacancy_origin = 'permanent_drop'
    AND sb.block_start_at >= p_as_of
  GROUP BY
    sb.house_id,
    EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York')::integer,
    (
      (sb.block_start_at AT TIME ZONE 'America/New_York')::time
      + (
        EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York')::integer
        * interval '1 microsecond'
      )
    )::time
  ORDER BY day_of_week, block_start_time;
$$;

CREATE OR REPLACE FUNCTION effective_weekly_cap(
  p_week_start_date date,
  p_block_start_at timestamptz
)
RETURNS TABLE (
  hours_cap integer,
  cap_enforcement cap_enforcement_enum
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(wco.hours_cap, op.default_hours_cap, 20) AS hours_cap,
    COALESCE(wco.cap_enforcement, op.default_cap_enforcement, 'soft'::cap_enforcement_enum)
      AS cap_enforcement
  FROM (SELECT 1) anchor
  LEFT JOIN weekly_cap_overrides wco
    ON wco.week_start_date = p_week_start_date
  LEFT JOIN operating_calendar oc
    ON oc.date = (p_block_start_at AT TIME ZONE 'America/New_York')::date
  LEFT JOIN operating_profiles op
    ON op.profile_name = oc.profile_name;
$$;

CREATE OR REPLACE FUNCTION claim_open_shift(
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
    sba.status,
    sb.block_id,
    sb.house_id,
    sb.block_start_at
  INTO v_target
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.assignment_id = p_assignment_id;

  IF NOT FOUND OR v_target.status <> 'vacant' THEN
    RAISE EXCEPTION 'shift_unavailable';
  END IF;

  SELECT user_id, home_house_id, is_active
  INTO v_claimer
  FROM users
  WHERE user_id = p_user_id;

  IF NOT FOUND OR v_claimer.is_active = false THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  IF v_target.block_start_at <= p_as_of + interval '2 hours' THEN
    RAISE EXCEPTION 'past_t2h_cutoff';
  END IF;

  IF v_target.house_id = 'harnwell' AND v_claimer.home_house_id <> 'harnwell' THEN
    RAISE EXCEPTION 'cross_house_ineligible';
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

  v_week_start_at := p_as_of + (
    floor(EXTRACT(EPOCH FROM (v_target.block_start_at - p_as_of)) / 604800)::integer
    * interval '7 days'
  );
  v_week_end_at := v_week_start_at + interval '7 days';
  v_week_start_date := (v_week_start_at AT TIME ZONE 'America/New_York')::date;

  SELECT COUNT(*)::integer
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

  IF v_current_blocks >= 80
     OR (
       v_cap.cap_enforcement = 'hard'
       AND ((v_current_blocks + 1)::numeric * 0.5) > v_cap.hours_cap
     ) THEN
    RAISE EXCEPTION 'hard_cap_exceeded';
  END IF;

  UPDATE shift_block_assignments
  SET status = 'claimed',
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

CREATE OR REPLACE FUNCTION claim_hours_projection(
  p_assignment_id uuid,
  p_user_id uuid
)
RETURNS TABLE (
  current_hours numeric,
  projected_hours numeric,
  hours_cap integer,
  cap_enforcement cap_enforcement_enum,
  soft_cap_warning boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_block_start_at timestamptz;
  v_week_start_date date;
  v_week_start_at timestamptz;
  v_week_end_at timestamptz;
  v_current_blocks integer;
  v_cap record;
BEGIN
  SELECT sb.block_start_at
  INTO v_block_start_at
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.assignment_id = p_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_unavailable';
  END IF;

  v_week_start_date := date_trunc(
    'week',
    v_block_start_at AT TIME ZONE 'America/New_York'
  )::date;
  v_week_start_at := v_week_start_date::timestamp AT TIME ZONE 'America/New_York';
  v_week_end_at := (v_week_start_date + 7)::timestamp AT TIME ZONE 'America/New_York';

  SELECT COUNT(*)::integer
  INTO v_current_blocks
  FROM shift_block_assignments existing
  JOIN shift_blocks existing_block USING (block_id)
  WHERE existing.user_id = p_user_id
    AND existing.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
    AND existing_block.block_start_at >= v_week_start_at
    AND existing_block.block_start_at < v_week_end_at;

  SELECT *
  INTO v_cap
  FROM effective_weekly_cap(v_week_start_date, v_block_start_at);

  RETURN QUERY SELECT
    (v_current_blocks::numeric * 0.5),
    ((v_current_blocks + 1)::numeric * 0.5),
    v_cap.hours_cap,
    v_cap.cap_enforcement,
    (
      v_cap.cap_enforcement = 'soft'
      AND ((v_current_blocks + 1)::numeric * 0.5) > v_cap.hours_cap
    );
END;
$$;

CREATE OR REPLACE FUNCTION drop_shift(
  p_assignment_ids uuid[],
  p_user_id uuid,
  p_as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  dropped_assignment_ids uuid[],
  short_notice_warning boolean,
  direct_hmod_notification boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_min_start timestamptz;
  v_max_start timestamptz;
  v_expected_count integer;
  v_short_notice boolean;
  v_direct_hmod boolean;
BEGIN
  IF p_assignment_ids IS NULL OR array_length(p_assignment_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty_drop';
  END IF;

  SELECT
    COUNT(*)::integer,
    MIN(sb.block_start_at),
    MAX(sb.block_start_at)
  INTO v_count, v_min_start, v_max_start
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.assignment_id = ANY (p_assignment_ids)
    AND sba.user_id = p_user_id
    AND sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in');

  IF v_count <> array_length(p_assignment_ids, 1) THEN
    RAISE EXCEPTION 'drop_not_owned';
  END IF;

  v_expected_count := (
    EXTRACT(EPOCH FROM (v_max_start - v_min_start)) / (30 * 60)
  )::integer + 1;

  IF v_expected_count <> v_count THEN
    RAISE EXCEPTION 'drop_not_contiguous';
  END IF;

  v_short_notice := v_min_start <= p_as_of + interval '20 minutes';
  v_direct_hmod := v_min_start <= p_as_of + interval '2 hours';

  UPDATE shift_block_assignments
  SET status = 'vacant',
      vacancy_origin = 'temporary_drop',
      user_id = NULL,
      is_cross_house_pickup = false,
      source_house_id = NULL
  WHERE assignment_id = ANY (p_assignment_ids);

  RETURN QUERY SELECT p_assignment_ids, v_short_notice, v_direct_hmod;
END;
$$;
