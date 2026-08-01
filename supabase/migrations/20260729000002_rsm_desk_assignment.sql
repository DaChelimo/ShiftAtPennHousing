-- Migration: RSM can be assigned to their own house's desk in the schedule builder.
--
-- Stakeholder decision (2026-07-29): an RSM sometimes needs to sit at the desk of the
-- house they administer (Gregory and Harnwell were the driving examples, but this applies
-- to any house). They are not a capped student worker, so this is NOT the claim/pickup
-- path: it is a builder-only "add this manager as a worker option" capability, scoped to
-- their own house, and exempt from every hours check (hard cap, soft cap, over-target).
--
-- Two changes:
--   1. house_roster_as_of gains an `is_rsm` column and now also returns the house's RSM
--      (role='rsm' scoped to p_house_id), in addition to the existing sw-membership rows.
--      This is a RETURNS TABLE shape change, so the function is dropped and recreated.
--   2. admin_assign_worker: the same-house-only guard on the TARGET worker (S1 OUT) is
--      bypassed for an RSM scoped to the block's house (so it stays own-house-only by
--      construction, not "any house"), and the hard-cap / soft-cap / over-target checks
--      are skipped entirely for them. The `cannot` / `opted_out` advisories are untouched
--      (an RSM has no preference/target rows, so they never fire in practice).
--
-- Idempotent: DROP + CREATE for house_roster_as_of (return-type change), CREATE OR REPLACE
-- for admin_assign_worker (signature unchanged).

DROP FUNCTION IF EXISTS house_roster_as_of(text, date);

CREATE FUNCTION house_roster_as_of(
  p_house_id text,
  p_as_of    date
)
RETURNS TABLE (user_id uuid, name text, is_rsm boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    combined.user_id,
    combined.name,
    bool_or(combined.is_rsm) AS is_rsm
  FROM (
    SELECT u.user_id, u.name, false AS is_rsm
    FROM users u
    JOIN user_roles r ON r.user_id = u.user_id AND r.role = 'sw'
    WHERE u.is_active
      AND membership_house_for_date(u.user_id, p_as_of) = p_house_id

    UNION ALL

    SELECT u.user_id, u.name, true AS is_rsm
    FROM users u
    JOIN user_roles r ON r.user_id = u.user_id AND r.role = 'rsm' AND r.scope_house_id = p_house_id
    WHERE u.is_active
  ) combined
  GROUP BY combined.user_id, combined.name
  ORDER BY combined.name;
$$;

GRANT EXECUTE ON FUNCTION house_roster_as_of(text, date) TO authenticated, service_role;

-- MERGE NOTE (2026-07-29). This migration and 20260729000001_admin_override_past_edit
-- both redefine admin_assign_worker, and this one applies SECOND. Its body was
-- originally cut from 20260726000009 (pre-override), so applying it as written silently
-- reinstated the `block_started` hard block the override had just removed and reverted
-- the 'no_future_occurrences' rename. The body below is now the OVERRIDE's body with the
-- RSM deltas applied on top, so both 2026-07-29 decisions survive:
--   * past/started this_week seats stay editable (no block_started check), and
--   * an RSM scoped to the block's house bypasses the same-house guard and every
--     hours check (hard cap, soft cap, over_target).
-- Verified by diffing the merged body against BOTH parents: vs. the override it differs
-- only by the RSM hunks; vs. this migration's original body it differs only by the
-- override hunks.

CREATE OR REPLACE FUNCTION public.admin_assign_worker(p_operator_user_id uuid, p_block_ids uuid[], p_user_id uuid, p_scope text, p_override_advisories boolean, p_now timestamp with time zone, p_incumbent_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_block_house_id text;
  v_distinct_houses integer;
  v_worker record;
  v_is_rsm boolean;
  v_over_hard boolean := false;
  v_over_soft boolean := false;
  v_target_block_ids uuid[];
  v_day_of_week integer;
  v_block_start_locals text[];
  v_incumbent_user_id uuid;
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

  -- Authz (D7): operator holds sm/hm/bm/rsm/admin scoped to the block's house.
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

  -- 2026-07-29: is the target worker the RSM of THIS house? Computed from the rsm-role
  -- scope, not home_house_id, so it stays own-house-only even if the two ever drift.
  SELECT EXISTS (
    SELECT 1 FROM user_roles r
    WHERE r.user_id = p_user_id AND r.role = 'rsm' AND r.scope_house_id = v_block_house_id
  ) INTO v_is_rsm;

  -- Same-house override only (S1 OUT — cross-house = pickup/float semantics). An RSM
  -- assigned to their OWN house's desk is exempt from this (see v_is_rsm above).
  IF NOT v_is_rsm AND v_worker.home_house_id <> v_block_house_id THEN
    RAISE EXCEPTION 'cross_house_not_supported';
  END IF;

  -- Resolve the seat set for the scope.
  IF p_scope = 'this_week' THEN
    v_target_block_ids := p_block_ids;
  ELSE
    -- permanent (D5): derive the slot (house, NY-DOW, NY local time-of-day) from
    -- the clicked blocks; act on every occurrence with block_start_at > now,
    -- <= semester end_date, profile_name='regular_school_year'. This is
    -- inherently forward-looking (a recurring pattern edit), independent of the
    -- this_week past-edit change below.
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
      RAISE EXCEPTION 'no_future_occurrences'; -- renamed from 'block_started' 2026-07-29
    END IF;
  END IF;

  -- ---- Hard-block evaluation over the clicked occurrence's seats ----------
  -- These per-seat checks apply to the THIS_WEEK target seat. For PERMANENT the
  -- clicked block is only the slot descriptor (D5): the current/started occurrence
  -- is expected and simply skipped, future occurrences are filtered into
  -- v_target_block_ids (+ permanent_pickup_slot/permanent_drop_slot only touch
  -- vacant/permanent_drop and skip floats), and the no-future-occurrence case
  -- already raised no_future_occurrences above.
  IF p_scope = 'this_week' THEN

  -- block_started removed 2026-07-29: a this_week seat of ANY age (past or
  -- future) is now editable by an authorized schedule admin. Only the operator
  -- authz gate above (user_can_build_schedule) still applies; a worker who is
  -- not sm/hm/bm/rsm/admin can never reach this function.

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

  -- hard cap (D2/D9): absolute, NOT overridable even with p_override_advisories. An
  -- RSM sitting at their own house's desk is exempt from every hours check (2026-07-29):
  -- they are salaried admin, not a capped student worker, and this is not the
  -- claim/pickup path that hours caps otherwise gate.
  IF NOT v_is_rsm THEN
    SELECT over_hard, over_soft INTO v_over_hard, v_over_soft
    FROM admin_override_cap_assessment(p_user_id, v_target_block_ids);
    IF v_over_hard THEN
      RAISE EXCEPTION 'hard_cap_exceeded';
    END IF;
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
  IF v_over_soft THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'soft_cap'));
  END IF;

  -- over_target: projected hours beyond the worker's submitted target. Skipped for the
  -- RSM exemption (2026-07-29): not applicable to a worker who never submits a target.
  IF NOT v_is_rsm AND EXISTS (
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
    -- Concurrency (audit F3). The seat pick used to be an UNLOCKED DISTINCT ON and
    -- the UPDATE re-checked nothing, so two admins assigning different workers to the
    -- same block both selected the same lowest assignment_id and the second silently
    -- overwrote the first -- while both were told assigned_count = 1. The same window
    -- let an admin write land on top of a worker's just-committed claim, leaving the
    -- worker with a 200 OK and a seat that is no longer theirs.
    --
    -- DISTINCT ON cannot carry a lock ("FOR UPDATE is not allowed with DISTINCT
    -- clause"), so this is the LATERAL LIMIT 1 pattern already used by
    -- permanent_pickup_slot (20260724000005) and claim_open_shift.
    --
    -- SKIP LOCKED, not plain FOR UPDATE. Plain FOR UPDATE does NOT fix the two-admin
    -- collision: the blocked session wakes, re-checks the row, finds it now 'claimed'
    -- (still inside this predicate, because reassigning an occupied seat is exactly
    -- what admin override is for) and overwrites the other admin's worker anyway.
    -- SKIP LOCKED makes the second admin step over the seat the first is holding and
    -- take the block's OTHER free seat, so on a multi-staff desk both assignments land.
    -- When there is genuinely no seat left, `chosen` comes up short and the assertion
    -- below raises seat_not_assignable, which is the honest answer: the admin lost the
    -- race and must look again, rather than silently erasing whoever won it.
    WITH candidate_blocks AS MATERIALIZED (
      SELECT DISTINCT sb.block_id
      FROM shift_blocks sb
      WHERE sb.block_id = ANY (v_target_block_ids)
    ),
    chosen AS MATERIALIZED (
      SELECT seat.assignment_id
      FROM candidate_blocks cb
      CROSS JOIN LATERAL (
        SELECT a.assignment_id
        FROM shift_block_assignments a
        WHERE a.block_id = cb.block_id
          AND (
            (p_incumbent_user_id IS NOT NULL
               AND a.user_id = p_incumbent_user_id
               AND a.status IN ('scheduled', 'claimed'))
            OR
            (p_incumbent_user_id IS NULL
               AND a.status IN ('vacant', 'scheduled', 'claimed'))
          )
        ORDER BY
          CASE WHEN a.status = 'vacant' THEN 0 ELSE 1 END,
          a.assignment_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ) seat
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
    WHERE sba.assignment_id = chosen.assignment_id
      -- Re-assert under the lock. A seat that became float-committed between the
      -- float_committed hard-block check and this write drops out here instead of
      -- being overwritten (S1 OUT: admin override never touches a float seat).
      AND sba.status IN ('vacant', 'scheduled', 'claimed');

    GET DIAGNOSTICS v_assigned_count = ROW_COUNT;

    -- Every clicked block passed seat_not_assignable / not_occupied_by_worker above.
    -- A shortfall here means a competing write took a seat under us; surface it with
    -- the existing vocabulary rather than reporting a partial success as a success.
    IF v_assigned_count <> (
      SELECT count(DISTINCT sb.block_id)
      FROM shift_blocks sb
      WHERE sb.block_id = ANY (v_target_block_ids)
    ) THEN
      RAISE EXCEPTION 'seat_not_assignable';
    END IF;
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

    -- Fill every future in-semester occurrence that currently has a vacant seat.
    -- Bug fix: this used to delegate to permanent_pickup_slot, whose WHERE clause
    -- requires vacancy_origin = 'permanent_drop' (the worker permanent-pickup feed
    -- semantics, §8.4.3). That silently assigned ZERO seats when the future
    -- occurrences were plain 'never_assigned' opens (a generated open shift that
    -- was never permanently dropped) — exactly the common admin action of placing
    -- a worker on a recurring open slot. Admin override (D5) fills ANY vacant seat
    -- on the future occurrences, regardless of vacancy_origin. permanent_drop seats
    -- (e.g. those just vacated by the incumbent permanent_drop_slot above) are a
    -- subset of 'vacant' and are still covered. Harnwell training is enforced
    -- earlier via the same-house guard (worker.home_house_id = block house).
    -- Same LATERAL LIMIT 1 FOR UPDATE treatment as the this_week branch (audit F3).
    -- SKIP LOCKED here, not plain FOR UPDATE: the permanent branch spans an entire
    -- semester of occurrences, and partial success is already its contract (it fills
    -- whatever future weeks are vacant), so stepping over a seat another writer holds
    -- is correct and blocking on it would serialise a long multi-week write behind an
    -- unrelated single-block claim.
    WITH candidate_blocks AS MATERIALIZED (
      SELECT DISTINCT sba.block_id
      FROM shift_block_assignments sba
      WHERE sba.block_id = ANY (v_target_block_ids)
        AND sba.status = 'vacant'
    ),
    chosen AS MATERIALIZED (
      SELECT seat.assignment_id
      FROM candidate_blocks cb
      CROSS JOIN LATERAL (
        SELECT a.assignment_id
        FROM shift_block_assignments a
        WHERE a.block_id = cb.block_id
          AND a.status = 'vacant'
        ORDER BY
          CASE WHEN a.vacancy_origin = 'permanent_drop' THEN 0 ELSE 1 END,
          a.assignment_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ) seat
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
    WHERE sba.assignment_id = chosen.assignment_id
      AND sba.status = 'vacant';

    GET DIAGNOSTICS v_assigned_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'needs_confirm', false,
    'assigned_count', COALESCE(v_assigned_count, 0),
    'scope', p_scope,
    'advisories', v_advisories
  );
END;
$function$;

REVOKE ALL ON FUNCTION admin_assign_worker(uuid, uuid[], uuid, text, boolean, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_assign_worker(uuid, uuid[], uuid, text, boolean, timestamptz, uuid) TO service_role;

-- rollback:
-- Restore house_roster_as_of from 20260719000001_house_transfers.sql (2-column shape).
-- Restore admin_assign_worker from 20260726000009_seat_write_compare_and_swap.sql.
