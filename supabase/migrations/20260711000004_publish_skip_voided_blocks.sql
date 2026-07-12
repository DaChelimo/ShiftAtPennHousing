-- Migration: publish_schedule must skip VOIDED blocks (docs/dev-tooling PLAN Feature C0).
--
-- Pre-existing bug, newly exercised by the dev-seeding "Publish open houses" button:
-- publish_schedule (20260614000002) iterated EVERY block of the house in the period with
-- no voided_at guard. A block voided by a season re-apply (house window closed or
-- downsized: its vacant seats deleted, occupants cancelled, shift_blocks.voided_at set)
-- would still be processed:
--   * step 2 (excess insert) INSERTs fresh 'scheduled' rows onto it, and
--   * step 3 (normalize) re-inserts 'vacant'/'never_assigned' seats,
-- resurrecting the voided block and breaking the "voided blocks are self-excluding on
-- every read path" invariant (20260702000007). Separately, the closing "all houses
-- published" aggregation counted fully-voided houses, so scheduling_periods.published_at
-- could never flip once a house was closed mid-season.
--
-- Fix: add `voided_at IS NULL` to (a) the main block loop, (b) the period-houses
-- aggregation, and (c) the template-week anchor + pattern subqueries (so a voided
-- first-week block cannot inject a phantom pattern user into a live later-week block).
-- All guards are no-ops when nothing is voided, so the common path is unchanged.
-- Body is otherwise byte-identical to 20260614000002.

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

  -- The template week = the week of the EARLIEST drafted (non-voided) block for this
  -- house. NULL ⇒ no drafts.
  SELECT min((pb.block_start_at AT TIME ZONE 'America/New_York')::date)
  INTO v_template_start
  FROM draft_block_assignments d
  JOIN shift_blocks pb ON pb.block_id = d.block_id
  WHERE d.period_id = p_period_id AND pb.house_id = p_house_id
    AND pb.voided_at IS NULL;

  FOR v_block IN
    SELECT b.block_id, b.required_headcount,
           extract(isodow FROM (b.block_start_at AT TIME ZONE 'America/New_York'))::int AS dow,
           (b.block_start_at AT TIME ZONE 'America/New_York')::time                     AS tod
    FROM shift_blocks b
    WHERE b.house_id = p_house_id
      AND b.voided_at IS NULL
      AND (b.block_start_at AT TIME ZONE 'America/New_York')::date
          BETWEEN v_period.start_date AND v_period.end_date
  LOOP
    -- The template users for THIS block's weekly slot (NY weekday + time-of-day),
    -- sourced from the period's FIRST WEEK only, non-voided blocks.
    SELECT count(*) INTO v_pat_count
    FROM draft_block_assignments d
    JOIN shift_blocks pb ON pb.block_id = d.block_id
    WHERE d.period_id = p_period_id
      AND pb.house_id = p_house_id
      AND pb.voided_at IS NULL
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
          AND pb.voided_at IS NULL
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
          AND pb.voided_at IS NULL
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

  -- Flip the period-wide flag once every house with LIVE (non-voided) blocks in the
  -- period is published. A fully-voided house no longer counts (else published_at could
  -- never flip after a mid-season house close).
  SELECT NOT EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT b.house_id
      FROM shift_blocks b
      WHERE b.voided_at IS NULL
        AND (b.block_start_at AT TIME ZONE 'America/New_York')::date
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

-- rollback:
-- (restore the 20260614000002 body of publish_schedule to drop the voided_at guards)
