-- Migration: S4 — Fire a worker (fire_worker orchestrating RPC).
--
-- Spec sources:
--   BEHAVIORAL_SPECIFICATION.md §4.5 (firing — the authoritative multi-step
--     contract: in-progress vacate→escalate; recurring→permanent drop;
--     non-recurring→vacate; floats voided + re-lookup excluding the worker;
--     deactivate. "Mechanically equivalent to a permanent drop applied across
--     every shift the worker owns, plus deactivation.");
--   §5.4 (escalation chain: T-3h broadcast → T-2h float lookup → HMOD/Allied);
--   §5.5 (drop-while-floating: destination re-lookup skipping broadcast);
--   §6.1/§6.4/§6.6 (float eligibility + the is_active gate; no-takeback —
--     WAIVED for firing, the sanctioned manual HR event; force-trigger's
--     "skip broadcast → straight to float lookup" sibling pattern);
--   §8.1/§8.4 (swaps + permanent drop/pickup — the reuse mechanics);
--   AGENTS.md hard invariants (Harnwell training; float direction; no-takeback
--     waived for firing; cap-not-on-float; 30-min blocks; NY tz).
--
-- One SECURITY DEFINER RPC the web/EF surface calls via the service client.
-- It unwinds EVERY obligation of a fired worker in ONE transaction (atomic:
-- any reused step that raises rolls the whole fire back — no half-fired state).
--
-- The real work (§4.5): flipping is_active=false handles ALL future exclusion
-- for free (every claim / float-lookup / broadcast path already gates on
-- is_active=true). So fire_worker only handles (1) already-scheduled unwinding,
-- (2) the in-progress urgency branch, (3) voiding already-committed floats +
-- swaps (the no-takeback waiver), and (4) is_active=false. No "fired-worker"
-- vacancy state exists — recurring seats become permanent_drop vacancies,
-- non-recurring become temporary_drop vacancies (the existing feeds).
--
-- Reuse (do NOT reimplement):
--   permanent_drop_slot (20260531000001) — future in-semester recurring drop
--     (→ permanent_drop, skips floated_out/pending_float_out, writes the SM
--     people alert). Called once per (house, NY-DOW) slot with that slot's
--     distinct NY HH24:MI locals, p_operator_user_id := p_initiator. It resolves
--     the semester from p_drop_initiated_at (= p_now) and JOINs operating_calendar
--     for regular_school_year; if it raises (semester_boundary_not_found) we let
--     it propagate so the whole fire rolls back.
--   decline_float (20260528000014) — the float-void / seat-reconciliation
--     pattern, generalized here to pending AND acknowledged, keyed on user_id
--     (the worker need not call), status → 'voided'.
--   drop_shift (20260528000020) — the vacate write shape (vacant /
--     temporary_drop, clear cross-house/source fields). Its drop_past_block
--     guard rejects an already-started block, so we vacate the in-progress seat
--     DIRECTLY (do not call drop_shift for it).
--   void_pending_swaps_for_vacated_seat trigger (20260530000001) — fires as
--     seats transition to vacant/floated_out/pending_float_out. fire_worker runs
--     its explicit by-user swap void FIRST (before any seat is vacated) so the
--     reported swaps_voided count is accurate; the trigger then finds those rows
--     already 'voided' (it only matches status='pending') and no-ops.
--   prevent_hm_bm_broadcast_subscription trigger (20260527000003) — the
--     is_active=false UPDATE auto-clears broadcast_subscribed (no check_violation).
--
-- Counting statuses for "headcount present" = scheduled / claimed / floated_in /
-- pending_float_in (mirror drop_shift). block_step_status PK is
-- (block_id, step_name); step_name literals broadcast / float_lookup /
-- hmod_notify_allied; status enum fired / completed_via_force_trigger /
-- rolled_back. float_assignments.status is the enum float_status_enum.

CREATE OR REPLACE FUNCTION fire_worker(
  p_initiator uuid,
  p_user_id   uuid,
  p_now       timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_victim                users%ROWTYPE;
  v_float                 float_assignments%ROWTYPE;
  v_in_progress           shift_block_assignments%ROWTYPE;
  v_in_progress_block_id  uuid;
  v_required              integer;
  v_present               integer;
  v_in_progress_escalated boolean := false;
  v_floats_voided         integer := 0;
  v_recurring_dropped     integer := 0;
  v_non_recurring_vacated integer := 0;
  v_swaps_voided          integer := 0;
  v_slot                  record;
BEGIN
  -- ============================================================
  -- ① authz + worker-exists + idempotency
  -- ============================================================
  SELECT * INTO v_victim
  FROM users
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker_not_found';
  END IF;

  -- People-admin is HM/BM-only (§2.3/§2.6) — the people-admin helper, NOT the
  -- schedule-builder helper. The initiator must administer the worker's home house.
  IF NOT user_has_house_admin_role(p_initiator, v_victim.home_house_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Idempotent no-op: an already-inactive worker has nothing to unwind. Touch
  -- nothing, return the no-op shape (a re-fire never double-drops).
  IF v_victim.is_active = false THEN
    RETURN jsonb_build_object(
      'fired', false,
      'already_inactive', true,
      'in_progress_escalated', false,
      'recurring_seats_dropped', 0,
      'non_recurring_vacated', 0,
      'floats_voided', 0,
      'swaps_voided', 0
    );
  END IF;

  -- ============================================================
  -- ② void the worker's pending swaps — keyed on the worker (initiator OR
  --    counterparty), BEFORE any seat is vacated.
  --
  --    This must run first: the void_pending_swaps_for_vacated_seat trigger
  --    (20260530000001) fires as seats transition to vacant/floated_out/
  --    pending_float_out in the later steps, and would void the worker's
  --    touching swaps before an end-of-function by-seat sweep could count them
  --    — leaving ROW_COUNT at 0. Every swap touching a seat the fire vacates
  --    necessarily has the worker as initiator or counterparty, so this by-user
  --    void is complete; the trigger later finds these rows already 'voided'
  --    (it only matches status='pending') and no-ops. The no-takeback waiver
  --    (§4.5) — firing is the sanctioned manual HR event.
  -- ============================================================
  UPDATE swap_requests
  SET status = 'voided'
  WHERE status = 'pending'
    AND (initiator_user_id = p_user_id OR counterparty_user_id = p_user_id);

  GET DIAGNOSTICS v_swaps_voided = ROW_COUNT;

  -- ============================================================
  -- ③ void the worker's pending|acknowledged floats
  --    (mirror decline_float, generalized to acknowledged too, keyed on user_id)
  -- ============================================================
  FOR v_float IN
    SELECT *
    FROM float_assignments
    WHERE user_id = p_user_id
      AND status IN ('pending', 'acknowledged')
    FOR UPDATE
  LOOP
    -- 2a. Mark the float voided (the no-takeback waiver, §4.5).
    UPDATE float_assignments
    SET status = 'voided'::float_status_enum
    WHERE float_id = v_float.float_id;

    -- 2b. Reopen each DESTINATION seat as the original gap (vacant / temporary_drop)
    --     so it re-enters lookup. Covers both pending_float_in and the
    --     acknowledged floated_in state.
    UPDATE shift_block_assignments
    SET user_id         = NULL,
        status          = 'vacant',
        vacancy_origin  = 'temporary_drop',
        is_float        = false,
        source_house_id = NULL,
        parent_float_id = NULL
    WHERE assignment_id = ANY(v_float.destination_assignment_ids);

    -- 2c. Roll the destination block's broadcast/float_lookup premarks to
    --     'rolled_back' so the chain re-evaluates (mirror decline_float step 4).
    --     Done for every voided float (the destination must re-escalate
    --     regardless of how the float was initiated; the firing voids it).
    UPDATE block_step_status
    SET status = 'rolled_back', updated_at = p_now
    WHERE block_id IN (
      SELECT block_id FROM shift_block_assignments
      WHERE assignment_id = ANY(v_float.destination_assignment_ids)
    )
      AND step_name IN ('broadcast', 'float_lookup');

    -- 2d. Restore each SOURCE seat to the worker as 'scheduled' (covers both
    --     pending_float_out and the acknowledged floated_out state), then clean
    --     up any force-trigger compensation rows linked to this float. The
    --     restored source seats are picked up by step ⑤'s recurring enumeration
    --     and permanently dropped there.
    UPDATE shift_block_assignments
    SET user_id         = v_float.user_id,
        status          = 'scheduled',
        vacancy_origin  = 'none',
        is_float        = false,
        source_house_id = NULL,
        parent_float_id = NULL
    WHERE assignment_id = ANY(v_float.source_assignment_ids);

    -- Force-trigger materialises a vacant 'temporary_drop' compensation row per
    -- source block that fell below headcount, linked via parent_float_id. With
    -- the source restored, that compensation row is the duplicate gap and is
    -- removed (mirror decline_float's restore branch). No-op for automated floats
    -- (none exist).
    DELETE FROM shift_block_assignments
    WHERE parent_float_id = v_float.float_id
      AND status = 'vacant'
      AND assignment_id != ALL(v_float.source_assignment_ids)
      AND assignment_id != ALL(v_float.destination_assignment_ids);

    v_floats_voided := v_floats_voided + 1;
  END LOOP;

  -- ============================================================
  -- ④ in-progress block (block_start_at ≤ now < +30min): vacate directly
  -- ============================================================
  SELECT sba.*
    INTO v_in_progress
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.user_id = p_user_id
    AND sba.status IN ('scheduled', 'claimed')
    AND sb.block_start_at <= p_now
    AND p_now < sb.block_start_at + interval '30 minutes'
  ORDER BY sb.block_start_at
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_in_progress_block_id := v_in_progress.block_id;

    -- Vacate the in-progress seat directly (drop_shift's drop_past_block guard
    -- rejects a started block). Mirror drop_shift's vacate write.
    UPDATE shift_block_assignments
    SET status          = 'vacant',
        vacancy_origin  = 'temporary_drop',
        user_id         = NULL,
        is_cross_house_pickup = false,
        source_house_id = NULL,
        parent_float_id = NULL
    WHERE assignment_id = v_in_progress.assignment_id;

    -- If the desk now falls below required headcount, the gap enters float
    -- escalation immediately — SKIPPING the T-3h broadcast and going directly to
    -- float lookup (§4.5 / §6.6 force-trigger pattern). The orchestrator never
    -- escalates an already-started block, so fire_worker records it: a
    -- float_lookup 'fired' step row and NO broadcast row. The RPC does not run
    -- the lookup itself (that is the TS orchestrator algorithm).
    SELECT sb.required_headcount
      INTO v_required
    FROM shift_blocks sb
    WHERE sb.block_id = v_in_progress_block_id;

    SELECT count(*)::integer
      INTO v_present
    FROM shift_block_assignments
    WHERE block_id = v_in_progress_block_id
      AND status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in');

    IF v_present < v_required THEN
      INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
      VALUES (v_in_progress_block_id, 'float_lookup', 'fired'::block_step_status_enum, p_now, p_now)
      ON CONFLICT (block_id, step_name) DO NOTHING;

      v_in_progress_escalated := true;
    END IF;
  END IF;

  -- ============================================================
  -- ⑤ recurring drop: every distinct (house, NY-DOW) among the worker's FUTURE
  --    scheduled seats — now including the just-restored float sources.
  --    permanent_drop_slot once per slot. Let any raise propagate (atomic).
  -- ============================================================
  FOR v_slot IN
    SELECT
      sb.house_id AS house_id,
      EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York')::int AS day_of_week,
      array_agg(DISTINCT TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI')) AS locals
    FROM shift_block_assignments sba
    JOIN shift_blocks sb ON sb.block_id = sba.block_id
    WHERE sba.user_id = p_user_id
      AND sba.status = 'scheduled'
      AND sb.block_start_at > p_now
    GROUP BY
      sb.house_id,
      EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York')::int
  LOOP
    v_recurring_dropped := v_recurring_dropped
      + COALESCE(
          (permanent_drop_slot(
            p_user_id,
            v_slot.house_id,
            v_slot.day_of_week,
            v_slot.locals,
            p_now,
            p_initiator
          ) ->> 'affected_count')::integer,
          0
        );
  END LOOP;

  -- ============================================================
  -- ⑥ non-recurring vacate: the worker's FUTURE claimed seats → vacant /
  --    temporary_drop (weekly feed, NOT permanent).
  -- ============================================================
  UPDATE shift_block_assignments sba
  SET status          = 'vacant',
      vacancy_origin  = 'temporary_drop',
      user_id         = NULL,
      is_cross_house_pickup = false,
      source_house_id = NULL,
      parent_float_id = NULL
  FROM shift_blocks sb
  WHERE sba.block_id = sb.block_id
    AND sba.user_id = p_user_id
    AND sba.status = 'claimed'
    AND sb.block_start_at > p_now;

  GET DIAGNOSTICS v_non_recurring_vacated = ROW_COUNT;

  -- ============================================================
  -- ⑦ deactivate (the prevent_hm_bm_broadcast_subscription BEFORE trigger
  --    auto-clears broadcast_subscribed).
  -- ============================================================
  UPDATE users
  SET is_active = false
  WHERE user_id = p_user_id;

  -- ============================================================
  -- ⑧ return the success counts
  -- ============================================================
  RETURN jsonb_build_object(
    'fired', true,
    'already_inactive', false,
    'in_progress_escalated', v_in_progress_escalated,
    'recurring_seats_dropped', v_recurring_dropped,
    'non_recurring_vacated', v_non_recurring_vacated,
    'floats_voided', v_floats_voided,
    'swaps_voided', v_swaps_voided
  );
END;
$$;

REVOKE ALL ON FUNCTION fire_worker(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fire_worker(uuid, uuid, timestamptz) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS fire_worker(uuid, uuid, timestamptz);
