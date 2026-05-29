-- Batch A (part 2 of 2) — A3: per-house publish + publish/generate
-- reconciliation (F-04-001/008, D-2 Option A, D-3 per-house).
--
-- Changes:
--  * Adds user_can_build_schedule(user, house) [sm/hm/bm] — pulled forward
--    from D9 so per-house publish authorization does not depend on the
--    (about-to-be-narrowed) user_has_house_admin_role.
--  * Adds period_house_publications to track per-house publish state; the
--    period-wide scheduling_periods.published_at flips only once every house
--    with blocks in the period has been published (preserves existing
--    period-level consumers: reminder gating, calendar visibility).
--  * Replaces the publish_schedule(uuid) / (uuid,uuid) overloads and
--    publish_schedule_impl with a single per-house, authorized
--    publish_schedule(p_period_id, p_published_by, p_house_id) that UPSERTs
--    drafts onto the generator's vacant/never_assigned seats (D-2 Option A),
--    dropping the "pre-existing assignments" guard that made
--    generate -> draft -> publish always fail.

-- ============================================================
-- user_can_build_schedule (sm/hm/bm). D9 also (re)creates this.
-- ============================================================
CREATE OR REPLACE FUNCTION user_can_build_schedule(check_user_id uuid, check_house_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = check_user_id
      AND role IN ('sm', 'hm', 'bm')
      AND scope_house_id = check_house_id
  );
$$;

-- ============================================================
-- period_house_publications — per-house publish ledger.
-- ============================================================
CREATE TABLE period_house_publications (
  period_id    uuid        NOT NULL REFERENCES scheduling_periods (period_id) ON DELETE CASCADE,
  house_id     text        NOT NULL REFERENCES houses (id),
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid        REFERENCES users (user_id),
  PRIMARY KEY (period_id, house_id)
);

ALTER TABLE period_house_publications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON period_house_publications
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated can select publications" ON period_house_publications
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- Replace the old publish surface.
-- ============================================================
DROP FUNCTION IF EXISTS publish_schedule(uuid);
DROP FUNCTION IF EXISTS publish_schedule(uuid, uuid);
DROP FUNCTION IF EXISTS publish_schedule_impl(uuid, uuid);

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
  v_draft_count     integer;
  v_vac_count       integer;
  v_matched         integer;
  v_remaining_vac   integer;
  v_desired_vac     integer;
  v_row             integer;
  v_scheduled_count integer := 0;
  v_all_published   boolean;
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

  FOR v_block IN
    SELECT b.block_id, b.required_headcount
    FROM shift_blocks b
    WHERE b.house_id = p_house_id
      AND (b.block_start_at AT TIME ZONE 'America/New_York')::date
          BETWEEN v_period.start_date AND v_period.end_date
  LOOP
    SELECT count(*) INTO v_draft_count
    FROM draft_block_assignments
    WHERE period_id = p_period_id AND block_id = v_block.block_id;

    SELECT count(*) INTO v_vac_count
    FROM shift_block_assignments
    WHERE block_id = v_block.block_id
      AND status = 'vacant' AND vacancy_origin = 'never_assigned';

    IF v_draft_count > v_block.required_headcount THEN
      RAISE EXCEPTION 'block % over-assigned: % drafts > required_headcount %',
        v_block.block_id, v_draft_count, v_block.required_headcount
        USING ERRCODE = 'check_violation';
    END IF;

    v_matched := LEAST(v_draft_count, v_vac_count);

    -- 1. UPSERT the first v_matched drafts onto the first v_matched vacant seats.
    IF v_matched > 0 THEN
      WITH drafts AS (
        SELECT user_id, row_number() OVER (ORDER BY draft_assignment_id) AS rn
        FROM draft_block_assignments
        WHERE period_id = p_period_id AND block_id = v_block.block_id
      ),
      vac AS (
        SELECT assignment_id, row_number() OVER (ORDER BY assignment_id) AS rn
        FROM shift_block_assignments
        WHERE block_id = v_block.block_id
          AND status = 'vacant' AND vacancy_origin = 'never_assigned'
      )
      UPDATE shift_block_assignments a
      SET status = 'scheduled', user_id = d.user_id, vacancy_origin = 'none',
          is_float = false, is_cross_house_pickup = false, source_house_id = NULL
      FROM drafts d
      JOIN vac v ON v.rn = d.rn
      WHERE a.assignment_id = v.assignment_id AND d.rn <= v_matched;
      GET DIAGNOSTICS v_row = ROW_COUNT;
      v_scheduled_count := v_scheduled_count + v_row;
    END IF;

    -- 2. Drafts beyond the available vacant seats → insert scheduled rows.
    IF v_draft_count > v_matched THEN
      INSERT INTO shift_block_assignments (block_id, user_id, status, vacancy_origin)
      SELECT v_block.block_id, d.user_id, 'scheduled', 'none'
      FROM (
        SELECT user_id, row_number() OVER (ORDER BY draft_assignment_id) AS rn
        FROM draft_block_assignments
        WHERE period_id = p_period_id AND block_id = v_block.block_id
      ) d
      WHERE d.rn > v_matched;
      GET DIAGNOSTICS v_row = ROW_COUNT;
      v_scheduled_count := v_scheduled_count + v_row;
    END IF;

    -- 3. Normalize remaining vacant rows to (headcount - drafts).
    v_remaining_vac := v_vac_count - v_matched;
    v_desired_vac   := v_block.required_headcount - v_draft_count;

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
REVOKE ALL ON FUNCTION user_can_build_schedule(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_can_build_schedule(uuid, text) TO authenticated, service_role;
