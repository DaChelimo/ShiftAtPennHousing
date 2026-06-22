-- Publish = stamp the recurring WEEKLY PATTERN across the whole period (BSpec §4.3).
--
-- The schedule builder edits only the period's FIRST week, so its
-- draft_block_assignments ARE the recurring weekly template: each drafted block's
-- NY (isodow, time-of-day) + the drafted user(s). Publishing now maps that template
-- onto EVERY week of the period — same worker, same weekday, same NY wall-clock time
-- (DST-safe: keyed on NY isodow + time-of-day, not UTC).
--
-- Previously the loop matched drafts by block_id, so only the drafted (week-1) blocks
-- were staffed and weeks 2..N came out fully vacant. This rewrite keys the per-block
-- assignment on the (dow, tod) PATTERN instead. (Supersedes the loop in
-- 20260528000010_batch_a3_publish_per_house.sql.)
--
-- DATA MODEL (unchanged): the block generator (20260527000004) pre-creates exactly
-- required_headcount 'vacant'/'never_assigned' rows per block. Publish CONVERTS the
-- first N of them to 'scheduled' for the N pattern users, and leaves the remainder
-- vacant — never changing a block's row count in the common case. The excess-insert /
-- normalize branches remain for robustness (blocks generated without pre-created
-- seats, or a headcount that differs from the pre-created count).

CREATE OR REPLACE FUNCTION publish_schedule(
  p_period_id    uuid,
  p_published_by uuid,
  p_house_id     text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period          scheduling_periods%ROWTYPE;
  v_block           record;
  v_pat_count       integer;
  v_vac_count       integer;
  v_matched         integer;
  v_remaining_vac   integer;
  v_desired_vac     integer;
  v_row             integer;
  v_scheduled_count integer := 0;
  v_all_published   boolean;
  v_template_start  date;
BEGIN
  SELECT * INTO v_period FROM scheduling_periods WHERE period_id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'scheduling period % not found', p_period_id USING ERRCODE = 'no_data_found';
  END IF;

  IF p_published_by IS NULL OR NOT user_can_build_schedule(p_published_by, p_house_id) THEN
    RAISE EXCEPTION 'publisher % is not authorized to build schedule for house %',
      p_published_by, p_house_id USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM period_house_publications
             WHERE period_id = p_period_id AND house_id = p_house_id) THEN
    RAISE EXCEPTION 'house % already published for period %', p_house_id, p_period_id
      USING ERRCODE = 'unique_violation';
  END IF;

  -- The template week = the week of the EARLIEST drafted block for this house. The
  -- builder only drafts one week; anchoring the template window here (rather than to
  -- the period start) keeps publish correct even if that week isn't the period's
  -- first 7 days, and bounds the pattern to a single week so a slot drafted in
  -- several weeks can't count as several users against one block. NULL ⇒ no drafts.
  SELECT min((pb.block_start_at AT TIME ZONE 'America/New_York')::date)
  INTO v_template_start
  FROM draft_block_assignments d
  JOIN shift_blocks pb ON pb.block_id = d.block_id
  WHERE d.period_id = p_period_id AND pb.house_id = p_house_id;

  FOR v_block IN
    SELECT b.block_id, b.required_headcount,
           extract(isodow FROM (b.block_start_at AT TIME ZONE 'America/New_York'))::int AS dow,
           (b.block_start_at AT TIME ZONE 'America/New_York')::time                     AS tod
    FROM shift_blocks b
    WHERE b.house_id = p_house_id
      AND (b.block_start_at AT TIME ZONE 'America/New_York')::date
          BETWEEN v_period.start_date AND v_period.end_date
  LOOP
    -- The template users for THIS block's weekly slot (NY weekday + time-of-day),
    -- ordered stably so the count and the upsert agree on row_number(). The template
    -- is sourced from the period's FIRST WEEK only — that is the week the builder
    -- edits, and scoping here makes publish robust to drafts existing in other weeks
    -- (a slot drafted in N weeks must not count as N users against one block).
    SELECT count(*) INTO v_pat_count
    FROM draft_block_assignments d
    JOIN shift_blocks pb ON pb.block_id = d.block_id
    WHERE d.period_id = p_period_id
      AND pb.house_id = p_house_id
      AND (pb.block_start_at AT TIME ZONE 'America/New_York')::date < v_template_start + 7
      AND extract(isodow FROM (pb.block_start_at AT TIME ZONE 'America/New_York'))::int = v_block.dow
      AND (pb.block_start_at AT TIME ZONE 'America/New_York')::time = v_block.tod;

    SELECT count(*) INTO v_vac_count
    FROM shift_block_assignments
    WHERE block_id = v_block.block_id
      AND status = 'vacant' AND vacancy_origin = 'never_assigned';

    IF v_pat_count > v_block.required_headcount THEN
      RAISE EXCEPTION 'recurring slot (dow %, %) over-assigned: % pattern users > headcount %',
        v_block.dow, v_block.tod, v_pat_count, v_block.required_headcount
        USING ERRCODE = 'check_violation';
    END IF;

    v_matched := LEAST(v_pat_count, v_vac_count);

    -- 1. Convert the first v_matched pre-created vacant seats to scheduled.
    IF v_matched > 0 THEN
      WITH pat AS (
        SELECT d.user_id, row_number() OVER (ORDER BY d.draft_assignment_id) AS rn
        FROM draft_block_assignments d
        JOIN shift_blocks pb ON pb.block_id = d.block_id
        WHERE d.period_id = p_period_id
          AND pb.house_id = p_house_id
          AND (pb.block_start_at AT TIME ZONE 'America/New_York')::date < v_template_start + 7
          AND extract(isodow FROM (pb.block_start_at AT TIME ZONE 'America/New_York'))::int = v_block.dow
          AND (pb.block_start_at AT TIME ZONE 'America/New_York')::time = v_block.tod
      ),
      vac AS (
        SELECT assignment_id, row_number() OVER (ORDER BY assignment_id) AS rn
        FROM shift_block_assignments
        WHERE block_id = v_block.block_id
          AND status = 'vacant' AND vacancy_origin = 'never_assigned'
      )
      UPDATE shift_block_assignments a
      SET status = 'scheduled', user_id = p.user_id, vacancy_origin = 'none',
          is_float = false, is_cross_house_pickup = false, source_house_id = NULL
      FROM pat p JOIN vac v ON v.rn = p.rn
      WHERE a.assignment_id = v.assignment_id AND p.rn <= v_matched;
      GET DIAGNOSTICS v_row = ROW_COUNT;
      v_scheduled_count := v_scheduled_count + v_row;
    END IF;

    -- 2. Pattern users beyond the available vacant seats → insert scheduled rows.
    IF v_pat_count > v_matched THEN
      INSERT INTO shift_block_assignments (block_id, user_id, status, vacancy_origin)
      SELECT v_block.block_id, p.user_id, 'scheduled', 'none'
      FROM (
        SELECT d.user_id, row_number() OVER (ORDER BY d.draft_assignment_id) AS rn
        FROM draft_block_assignments d
        JOIN shift_blocks pb ON pb.block_id = d.block_id
        WHERE d.period_id = p_period_id
          AND pb.house_id = p_house_id
          AND (pb.block_start_at AT TIME ZONE 'America/New_York')::date < v_template_start + 7
          AND extract(isodow FROM (pb.block_start_at AT TIME ZONE 'America/New_York'))::int = v_block.dow
          AND (pb.block_start_at AT TIME ZONE 'America/New_York')::time = v_block.tod
      ) p
      WHERE p.rn > v_matched;
      GET DIAGNOSTICS v_row = ROW_COUNT;
      v_scheduled_count := v_scheduled_count + v_row;
    END IF;

    -- 3. Normalize remaining vacant rows to (headcount - pattern users).
    v_remaining_vac := v_vac_count - v_matched;
    v_desired_vac   := v_block.required_headcount - v_pat_count;

    IF v_remaining_vac > v_desired_vac THEN
      DELETE FROM shift_block_assignments
      WHERE assignment_id IN (
        SELECT assignment_id FROM shift_block_assignments
        WHERE block_id = v_block.block_id
          AND status = 'vacant' AND vacancy_origin = 'never_assigned'
        ORDER BY assignment_id
        LIMIT (v_remaining_vac - v_desired_vac)
      );
    ELSIF v_remaining_vac < v_desired_vac THEN
      INSERT INTO shift_block_assignments (block_id, status, vacancy_origin)
      SELECT v_block.block_id, 'vacant', 'never_assigned'
      FROM generate_series(1, v_desired_vac - v_remaining_vac);
    END IF;
  END LOOP;

  DELETE FROM draft_block_assignments
  WHERE period_id = p_period_id
    AND block_id IN (SELECT block_id FROM shift_blocks WHERE house_id = p_house_id);

  INSERT INTO period_house_publications (period_id, house_id, published_by)
  VALUES (p_period_id, p_house_id, p_published_by);

  -- Flip the period-wide flag once every house with blocks in the period is published.
  SELECT NOT EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT b.house_id
      FROM shift_blocks b
      WHERE (b.block_start_at AT TIME ZONE 'America/New_York')::date
            BETWEEN v_period.start_date AND v_period.end_date
    ) period_houses
    WHERE NOT EXISTS (
      SELECT 1 FROM period_house_publications p
      WHERE p.period_id = p_period_id AND p.house_id = period_houses.house_id
    )
  ) INTO v_all_published;

  IF v_all_published AND v_period.published_at IS NULL THEN
    UPDATE scheduling_periods SET published_at = now() WHERE period_id = p_period_id;
  END IF;

  RETURN v_scheduled_count;
END;
$$;

REVOKE ALL ON FUNCTION publish_schedule(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publish_schedule(uuid, uuid, text) TO service_role;
