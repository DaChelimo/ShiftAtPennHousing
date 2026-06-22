-- Migration: admin_assign_worker — incumbent-targeted "Replace".
--
-- BSpec §4.3 (Phase-3 override). Fixes the live-calendar REASSIGN bug surfaced by
-- the panel redesign: the original admin_assign_worker (20260606000001) filled, per
-- block, the FIRST assignable seat preferring 'vacant' over an occupied one:
--
--     ORDER BY sba.block_id,
--       CASE WHEN sba.status = 'vacant' THEN 0 ELSE 1 END, ...
--
-- On a block that carries BOTH a vacant seat AND the incumbent's occupied seat
-- (any required_headcount >= 2, or an occupied seat sitting next to an open one),
-- "reassign worker A -> B" filled the VACANT seat with B and left A in place — two
-- workers on the block instead of a replacement ("it inserted someone there / weird
-- open shifts"). The seat the operator is acting on was never identified.
--
-- Fix: add p_incumbent_user_id. When provided (the panel's REPLACE action, where the
-- detail panel already knows whose card was clicked), the write targets THAT worker's
-- seat on each block instead of preferring vacant — so a replace overwrites the right
-- seat and never spawns a phantom. When NULL (filling an open shift, or a plain
-- this_week assign), behaviour is unchanged: prefer a vacant seat, else the first
-- reassignable occupied non-float seat.
--
-- This is a CREATE OR REPLACE with an added trailing parameter (NULL default), so it
-- is a NEW overload-compatible signature; the prior 6-arg signature is dropped first
-- to avoid an ambiguous overload set. All other behaviour (authz, hard blocks, soft
-- advisories, cap assessment, permanent slot mechanics) is carried over verbatim.

DROP FUNCTION IF EXISTS admin_assign_worker(uuid, uuid[], uuid, text, boolean, timestamptz);

CREATE OR REPLACE FUNCTION admin_assign_worker(
  p_operator_user_id uuid,
  p_block_ids uuid[],
  p_user_id uuid,
  p_scope text,
  p_override_advisories boolean,
  p_now timestamptz,
  p_incumbent_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_block_house_id text;
  v_distinct_houses integer;
  v_worker record;
  v_cap record;
  v_target_block_ids uuid[];
  v_day_of_week integer;
  v_block_start_locals text[];
  v_incumbent_user_id uuid;
  v_has_started boolean;
  v_has_float boolean;
  v_has_unassignable boolean;
  v_has_cannot boolean;
  v_advisories jsonb := '[]'::jsonb;
  v_assigned_count integer := 0;
BEGIN
  IF p_block_ids IS NULL OR array_length(p_block_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty_block_set';
  END IF;

  IF p_scope NOT IN ('this_week', 'permanent') THEN
    RAISE EXCEPTION 'invalid_scope';
  END IF;

  -- The clicked seats must all belong to ONE house (the per-house calendar).
  SELECT COUNT(DISTINCT sb.house_id), MIN(sb.house_id)
    INTO v_distinct_houses, v_block_house_id
  FROM shift_blocks sb
  WHERE sb.block_id = ANY (p_block_ids);

  IF v_distinct_houses IS NULL OR v_distinct_houses = 0 THEN
    RAISE EXCEPTION 'block_not_found';
  END IF;
  IF v_distinct_houses <> 1 THEN
    RAISE EXCEPTION 'cross_house_not_supported';
  END IF;

  -- Authz (D7): operator holds sm/hm/bm scoped to the block's house.
  IF NOT user_can_build_schedule(p_operator_user_id, v_block_house_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Target worker.
  SELECT user_id, home_house_id, is_active
    INTO v_worker
  FROM users
  WHERE user_id = p_user_id;

  IF NOT FOUND OR v_worker.is_active = false THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  -- Same-house override only (S1 OUT — cross-house = pickup/float semantics).
  IF v_worker.home_house_id <> v_block_house_id THEN
    RAISE EXCEPTION 'cross_house_not_supported';
  END IF;

  -- Resolve the seat set for the scope.
  IF p_scope = 'this_week' THEN
    v_target_block_ids := p_block_ids;
  ELSE
    -- permanent (D5): derive the slot (house, NY-DOW, NY local time-of-day) from
    -- the clicked blocks; act on every occurrence with block_start_at > now,
    -- <= semester end_date, profile_name='regular_school_year'.
    SELECT
      EXTRACT(DOW FROM MIN(sb.block_start_at) AT TIME ZONE 'America/New_York')::integer,
      array_agg(DISTINCT TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI'))
      INTO v_day_of_week, v_block_start_locals
    FROM shift_blocks sb
    WHERE sb.block_id = ANY (p_block_ids);

    SELECT array_agg(sb.block_id)
      INTO v_target_block_ids
    FROM shift_blocks sb
    JOIN scheduling_periods sp
      ON (sb.block_start_at AT TIME ZONE 'America/New_York')::date
         BETWEEN sp.start_date AND sp.end_date
     AND sp.profile_name = 'regular_school_year'
    JOIN operating_calendar oc
      ON oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
     AND oc.profile_name = 'regular_school_year'
    WHERE sb.house_id = v_block_house_id
      AND EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York') = v_day_of_week
      AND TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI') = ANY (v_block_start_locals)
      AND sb.block_start_at > p_now;

    IF v_target_block_ids IS NULL THEN
      RAISE EXCEPTION 'block_started'; -- no future in-semester occurrences remain
    END IF;
  END IF;

  -- ---- Hard-block evaluation over the clicked occurrence's seats ----------
  -- These per-seat checks apply to the THIS_WEEK target seat. For PERMANENT the
  -- clicked block is only the slot descriptor (D5): the current/started occurrence
  -- is expected and simply skipped, future occurrences are filtered into
  -- v_target_block_ids (+ permanent_pickup_slot/permanent_drop_slot only touch
  -- vacant/permanent_drop and skip floats), and the no-future-occurrence case
  -- already raised block_started above.
  IF p_scope = 'this_week' THEN

  -- block_started: any clicked seat at/after its start (D1 — edits never run after start).
  SELECT bool_or(sb.block_start_at <= p_now)
    INTO v_has_started
  FROM shift_blocks sb
  WHERE sb.block_id = ANY (p_block_ids);
  IF COALESCE(v_has_started, false) THEN
    RAISE EXCEPTION 'block_started';
  END IF;

  -- float_committed: any clicked seat in a float-committed status (S1 OUT).
  SELECT bool_or(sba.status IN ('floated_in', 'floated_out', 'pending_float_in', 'pending_float_out'))
    INTO v_has_float
  FROM shift_block_assignments sba
  WHERE sba.block_id = ANY (p_block_ids);
  IF COALESCE(v_has_float, false) THEN
    RAISE EXCEPTION 'float_committed';
  END IF;

  -- When REPLACE targets a specific incumbent, every clicked block must actually
  -- hold a removable (scheduled / claimed) seat for that worker — otherwise the
  -- operator is acting on a stale card.
  IF p_incumbent_user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM (SELECT DISTINCT sb.block_id FROM shift_blocks sb WHERE sb.block_id = ANY (p_block_ids)) clicked
      WHERE NOT EXISTS (
        SELECT 1
        FROM shift_block_assignments sba
        WHERE sba.block_id = clicked.block_id
          AND sba.user_id = p_incumbent_user_id
          AND sba.status IN ('scheduled', 'claimed')
      )
    ) THEN
      RAISE EXCEPTION 'not_occupied_by_worker';
    END IF;
  ELSE
    -- seat_not_assignable: every clicked seat must be fillable (vacant) or a
    -- reassignable occupied non-float seat (scheduled / claimed). A block with no
    -- assignable seat (e.g. fully allied, or no vacant/occupied-non-float row) blocks.
    SELECT bool_or(blk.assignable_seats = 0)
      INTO v_has_unassignable
    FROM (
      SELECT
        sb.block_id,
        COUNT(*) FILTER (
          WHERE sba.status IN ('vacant', 'scheduled', 'claimed')
        ) AS assignable_seats
      FROM shift_blocks sb
      LEFT JOIN shift_block_assignments sba ON sba.block_id = sb.block_id
      WHERE sb.block_id = ANY (p_block_ids)
      GROUP BY sb.block_id
    ) blk;
    IF COALESCE(v_has_unassignable, false) THEN
      RAISE EXCEPTION 'seat_not_assignable';
    END IF;
  END IF;

  END IF; -- this_week per-clicked-seat checks

  -- hard cap (D2/D9): absolute, NOT overridable even with p_override_advisories.
  SELECT * INTO v_cap FROM admin_override_cap_assessment(p_user_id, v_target_block_ids);
  IF v_cap.over_hard THEN
    RAISE EXCEPTION 'hard_cap_exceeded';
  END IF;

  -- ---- Soft advisories (overridable via 2-step confirm) -------------------
  -- cannot: the worker marked 'cannot' on a clicked block in the current period.
  SELECT bool_or(true)
    INTO v_has_cannot
  FROM preferences pref
  JOIN scheduling_periods sp ON sp.period_id = pref.period_id
  JOIN shift_blocks sb ON sb.block_id = pref.block_id
  WHERE pref.user_id = p_user_id
    AND pref.block_id = ANY (p_block_ids)
    AND pref.status = 'cannot'
    AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN sp.start_date AND sp.end_date;
  IF COALESCE(v_has_cannot, false) THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'cannot'));
  END IF;

  -- opted_out: period_targets.opted_out for the worker in the clicked occurrence's period.
  IF EXISTS (
    SELECT 1
    FROM period_targets pt
    JOIN scheduling_periods sp ON sp.period_id = pt.period_id
    JOIN shift_blocks sb ON sb.block_id = ANY (p_block_ids)
    WHERE pt.user_id = p_user_id
      AND pt.opted_out = true
      AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN sp.start_date AND sp.end_date
  ) THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'opted_out'));
  END IF;

  -- soft_cap.
  IF v_cap.over_soft THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'soft_cap'));
  END IF;

  -- over_target: projected hours beyond the worker's submitted target.
  IF EXISTS (
    SELECT 1
    FROM period_targets pt
    JOIN scheduling_periods sp ON sp.period_id = pt.period_id
    JOIN shift_blocks sb ON sb.block_id = ANY (p_block_ids)
    WHERE pt.user_id = p_user_id
      AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN sp.start_date AND sp.end_date
      AND (
        (
          SELECT COUNT(*)::numeric * 0.5
          FROM shift_block_assignments ex
          JOIN shift_blocks exb USING (block_id)
          WHERE ex.user_id = p_user_id
            AND ex.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
            AND date_trunc('week', exb.block_start_at AT TIME ZONE 'America/New_York')::date
                = date_trunc('week', sb.block_start_at AT TIME ZONE 'America/New_York')::date
            AND NOT (ex.block_id = ANY (p_block_ids))
        )
        + (array_length(p_block_ids, 1)::numeric * 0.5)
      ) > pt.target_hours
  ) THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'over_target'));
  END IF;

  -- Soft-confirm gate: advisories present + flag not set ⇒ NO write, signal confirm.
  IF jsonb_array_length(v_advisories) > 0 AND p_override_advisories = false THEN
    RETURN jsonb_build_object('needs_confirm', true, 'advisories', v_advisories);
  END IF;

  -- ---- Write -------------------------------------------------------------
  IF p_scope = 'this_week' THEN
    -- Fill each seat with one row per block. When an incumbent is named (REPLACE),
    -- overwrite THAT worker's seat; otherwise prefer a vacant seat, else the first
    -- reassignable occupied non-float seat.
    WITH chosen AS (
      SELECT DISTINCT ON (sba.block_id) sba.assignment_id, sba.block_id
      FROM shift_block_assignments sba
      WHERE sba.block_id = ANY (v_target_block_ids)
        AND (
          (p_incumbent_user_id IS NOT NULL
             AND sba.user_id = p_incumbent_user_id
             AND sba.status IN ('scheduled', 'claimed'))
          OR
          (p_incumbent_user_id IS NULL
             AND sba.status IN ('vacant', 'scheduled', 'claimed'))
        )
      ORDER BY sba.block_id,
        CASE WHEN sba.status = 'vacant' THEN 0 ELSE 1 END,
        sba.assignment_id
    )
    UPDATE shift_block_assignments sba
    SET status = 'claimed',
        user_id = p_user_id,
        vacancy_origin = 'none',
        is_float = false,
        is_cross_house_pickup = false,
        source_house_id = NULL,
        parent_float_id = NULL
    FROM chosen
    WHERE sba.assignment_id = chosen.assignment_id;

    GET DIAGNOSTICS v_assigned_count = ROW_COUNT;
  ELSE
    -- permanent: if the clicked occurrence is occupied, permanently drop the
    -- incumbent first (vacates future occurrences → permanent_drop, writes the
    -- people alerts), then pick up the slot for the new worker. Prefer the named
    -- incumbent (REPLACE); else detect the occupied seat.
    IF p_incumbent_user_id IS NOT NULL THEN
      v_incumbent_user_id := p_incumbent_user_id;
    ELSE
      SELECT sba.user_id
        INTO v_incumbent_user_id
      FROM shift_block_assignments sba
      WHERE sba.block_id = ANY (p_block_ids)
        AND sba.user_id IS NOT NULL
        AND sba.status IN ('scheduled', 'claimed')
      LIMIT 1;
    END IF;

    IF v_incumbent_user_id IS NOT NULL AND v_incumbent_user_id <> p_user_id THEN
      PERFORM permanent_drop_slot(
        v_incumbent_user_id,
        v_block_house_id,
        v_day_of_week,
        v_block_start_locals,
        p_now,
        p_operator_user_id
      );
    END IF;

    -- Fill every future in-semester occurrence now vacant (permanent_drop).
    SELECT (permanent_pickup_slot(p_user_id, v_target_block_ids) ->> 'assigned_count')::integer
      INTO v_assigned_count;
  END IF;

  RETURN jsonb_build_object(
    'needs_confirm', false,
    'assigned_count', COALESCE(v_assigned_count, 0),
    'scope', p_scope,
    'advisories', v_advisories
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_assign_worker(uuid, uuid[], uuid, text, boolean, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_assign_worker(uuid, uuid[], uuid, text, boolean, timestamptz, uuid) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS admin_assign_worker(uuid, uuid[], uuid, text, boolean, timestamptz, uuid);
-- (restore the 6-arg admin_assign_worker from 20260606000001_s1_admin_override.sql)
