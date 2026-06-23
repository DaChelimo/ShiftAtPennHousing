-- ===========================================================================
-- Float-out reopens the floater's vacated HOME seat — for AUTOMATED floats too.
--
-- BSpec §3.5 / §6.6 #5: when a worker floats out, the source desk treats them as
-- gone, and "the resulting source-side gap immediately enters the source house's
-- open-shifts feed where other SWs ... can claim it." Force-triggered floats
-- already materialise that gap (a vacant 'temporary_drop' row) — but the AUTOMATED
-- path (process_float_lookup_assignment) only set the source to pending_float_out
-- and created NO open row. So a worker floated by the orchestrator never surfaced
-- their vacated seat for pickup. This migration brings the automated path in line.
--
-- The gap is created at ASSIGNMENT time (when the worker is picked as floater),
-- before they acknowledge — per the product decision. Eligibility follows the normal
-- open-shifts model (cross-house allowed; Harnwell training constraint still applies).
--
-- Because the seat can now be CLAIMED while the float is still pending, the release
-- paths (decline + no-ack) must reconcile it the SAME way for both float types:
--   * vacated seat still unclaimed  -> restore the floater home, drop the gap row.
--   * seat was claimed / Allied took it -> the claimer keeps it (first-come-first-
--     served), the floater is displaced (BSpec §6.6 #7).
-- Previously only force-triggered floats did this; automated decline/no-ack restored
-- the floater UNCONDITIONALLY, which (now that automated floats open the seat) would
-- double-book the seat. Both behaviours are extracted into shared helpers so the
-- automated and force-trigger paths can never diverge again (mirrors the phase-12
-- snapshot_float_ack_reminders refactor).
--
-- Note: opening the seat does NOT auto-trigger another float. Float-source
-- eligibility leaves >= 1 worker at the source, so the reopened seat is above the
-- coverage-floor-of-one and the escalation chain (broadcast/float/Allied) does not
-- fire for it; it is a voluntary-pickup opening only.
-- ===========================================================================

-- ------------------------------------------------------------------
-- Helper 1: materialise the source-side vacant gap for a just-assigned float.
-- For each distinct source block, if the present headcount (after the floater went
-- pending_float_out) is below the block's required_headcount, INSERT one vacant
-- 'temporary_drop' row linked to the float. Idempotent within a single assignment
-- (called once per assignment). Must be called AFTER the source rows are set to
-- pending_float_out. Returns the number of gap rows created.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reopen_float_source_seats(
  p_source_assignment_ids uuid[],
  p_float_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src_block_id uuid;
  v_required     integer;
  v_remaining    integer;
  v_created      integer := 0;
BEGIN
  FOR v_src_block_id, v_required IN
    SELECT sb.block_id, sb.required_headcount
    FROM shift_block_assignments sba
    JOIN shift_blocks sb ON sb.block_id = sba.block_id
    WHERE sba.assignment_id = ANY(p_source_assignment_ids)
    GROUP BY sb.block_id, sb.required_headcount
  LOOP
    SELECT count(*)::integer
      INTO v_remaining
    FROM shift_block_assignments
    WHERE block_id = v_src_block_id
      AND status IN ('scheduled', 'claimed', 'floated_in');

    IF v_remaining < v_required THEN
      INSERT INTO shift_block_assignments (
        block_id, user_id, status, vacancy_origin, is_float, source_house_id, parent_float_id
      )
      VALUES (
        v_src_block_id, NULL, 'vacant', 'temporary_drop', false, NULL, p_float_id
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION reopen_float_source_seats(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reopen_float_source_seats(uuid[], uuid) TO service_role;

-- ------------------------------------------------------------------
-- Helper 2: reconcile the floater's source seat when a pending float is RELEASED
-- (declined or no-acked). If the source-side gap row(s) this float created are all
-- still vacant (or none exist), restore the floater home and delete the gap rows; if
-- any were claimed/Allied'd, the claimer keeps the seat and the floater is displaced
-- (vacant 'displaced_decliner'). The caller must hold the float row lock and have
-- already transitioned float_assignments.status; only the (unchanged) id arrays + the
-- floater are read here.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reconcile_float_source_release(p_float_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_float                 float_assignments%ROWTYPE;
  v_gap_rows_total        integer;
  v_gap_rows_still_vacant integer;
BEGIN
  SELECT * INTO v_float FROM float_assignments WHERE float_id = p_float_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- The source-side gap rows are the rows linked to this float that are NEITHER its
  -- source nor its destination assignments (i.e. the ones reopen_float_source_seats
  -- inserted).
  SELECT count(*) FILTER (WHERE status = 'vacant'), count(*)
    INTO v_gap_rows_still_vacant, v_gap_rows_total
  FROM (
    SELECT status FROM shift_block_assignments
    WHERE parent_float_id = p_float_id
      AND assignment_id != ALL(v_float.source_assignment_ids)
      AND assignment_id != ALL(v_float.destination_assignment_ids)
    FOR UPDATE
  ) compensation;

  IF v_gap_rows_total = 0 OR v_gap_rows_still_vacant = v_gap_rows_total THEN
    UPDATE shift_block_assignments
    SET user_id = v_float.user_id, status = 'scheduled', vacancy_origin = 'none',
        is_float = false, source_house_id = NULL, parent_float_id = NULL
    WHERE assignment_id = ANY(v_float.source_assignment_ids);

    DELETE FROM shift_block_assignments
    WHERE parent_float_id = p_float_id
      AND status = 'vacant'
      AND assignment_id != ALL(v_float.source_assignment_ids)
      AND assignment_id != ALL(v_float.destination_assignment_ids);
  ELSE
    UPDATE shift_block_assignments
    SET user_id = NULL, status = 'vacant', vacancy_origin = 'displaced_decliner',
        is_float = false, source_house_id = NULL, parent_float_id = NULL
    WHERE assignment_id = ANY(v_float.source_assignment_ids);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION reconcile_float_source_release(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconcile_float_source_release(uuid) TO service_role;

-- ------------------------------------------------------------------
-- process_float_lookup_assignment (automated path) — re-created from
-- 20260601000002 with a call to reopen_float_source_seats added after the source
-- rows go pending_float_out. Everything else is byte-for-byte the prior body.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_float_lookup_assignment(
  p_worker_id uuid,
  p_source_house_id text,
  p_source_assignment_ids uuid[],
  p_destination_assignment_ids uuid[],
  p_destination_house_id text,
  p_now timestamptz,
  p_retention_days integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_float_id              uuid;
  v_latest_block_start_at timestamptz;
  v_destination_blocks    uuid[];
  v_destinations_locked   integer;
  v_sources_locked        integer;
BEGIN
  SELECT array_agg(assignment_id), count(*)::integer
    INTO v_destination_blocks, v_destinations_locked
  FROM (
    SELECT assignment_id FROM shift_block_assignments
    WHERE assignment_id = ANY(p_destination_assignment_ids) AND status = 'vacant'
    FOR UPDATE
  ) locked;

  IF v_destinations_locked IS NULL
     OR v_destinations_locked < cardinality(p_destination_assignment_ids) THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'destination_not_vacant');
  END IF;

  SELECT count(*)::integer INTO v_sources_locked
  FROM (
    SELECT assignment_id FROM shift_block_assignments
    WHERE assignment_id = ANY(p_source_assignment_ids)
      AND status IN ('scheduled', 'claimed')
    FOR UPDATE
  ) locked_sources;

  IF v_sources_locked IS NULL
     OR v_sources_locked < cardinality(p_source_assignment_ids) THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'source_not_available');
  END IF;

  SELECT max(sb.block_start_at) INTO v_latest_block_start_at
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(p_destination_assignment_ids);

  INSERT INTO float_assignments (
    user_id, source_assignment_ids, destination_assignment_ids,
    status, initiated_by, expires_for_cleanup_at
  )
  VALUES (
    p_worker_id, p_source_assignment_ids, p_destination_assignment_ids,
    'pending', 'automated',
    v_latest_block_start_at + (p_retention_days || ' days')::interval
  )
  RETURNING float_id INTO v_float_id;

  UPDATE shift_block_assignments
  SET user_id = p_worker_id, status = 'pending_float_in', vacancy_origin = 'none',
      is_float = true, source_house_id = p_source_house_id, parent_float_id = v_float_id
  WHERE assignment_id = ANY(p_destination_assignment_ids);

  UPDATE shift_block_assignments
  SET status = 'pending_float_out', vacancy_origin = 'none',
      is_float = false, source_house_id = NULL, parent_float_id = v_float_id
  WHERE assignment_id = ANY(p_source_assignment_ids);

  -- Source-side gap (§6.6 #5): reopen the vacated home seat for pickup. Shared with
  -- force_trigger_float so automated and force-triggered floats behave identically.
  PERFORM reopen_float_source_seats(p_source_assignment_ids, v_float_id);

  INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
  VALUES (
    p_worker_id, 'personal_shift', p_now,
    jsonb_build_object(
      'kind', 'float_assigned', 'float_id', v_float_id,
      'destination_house_id', p_destination_house_id,
      'block_ids', (SELECT array_agg(block_id ORDER BY block_id)
                    FROM shift_block_assignments
                    WHERE assignment_id = ANY(p_destination_assignment_ids))
    )
  );

  -- F3: ack-reminder cadence snapshot (shared with force_trigger_float).
  PERFORM snapshot_float_ack_reminders(
    p_worker_id, p_destination_assignment_ids, p_destination_house_id, v_float_id, p_now
  );

  RETURN jsonb_build_object('assigned', true, 'float_id', v_float_id);
END;
$$;

REVOKE ALL ON FUNCTION process_float_lookup_assignment(uuid, text, uuid[], uuid[], text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_float_lookup_assignment(uuid, text, uuid[], uuid[], text, timestamptz, integer) TO service_role;

-- ------------------------------------------------------------------
-- force_trigger_float — re-created from 20260601000002 with the inline source-gap
-- loop replaced by a call to the shared reopen_float_source_seats helper. Behaviour
-- is identical (same below-required-headcount condition).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION force_trigger_float(
  p_initiator_user_id uuid,
  p_worker_id uuid,
  p_source_house_id text,
  p_source_assignment_ids uuid[],
  p_destination_assignment_ids uuid[],
  p_destination_house_id text,
  p_now timestamptz DEFAULT now(),
  p_retention_days integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_float_id              uuid;
  v_latest_block_start_at timestamptz;
  v_destinations_locked   integer;
  v_sources_locked        integer;
  v_competing_pending     integer;
BEGIN
  -- 1a. Lock the destination rows and re-verify they are still vacant (TOCTOU).
  SELECT count(*)::integer
    INTO v_destinations_locked
  FROM (
    SELECT assignment_id
    FROM shift_block_assignments
    WHERE assignment_id = ANY(p_destination_assignment_ids)
      AND status = 'vacant'
    FOR UPDATE
  ) locked_destinations;

  IF v_destinations_locked IS NULL
     OR v_destinations_locked < cardinality(p_destination_assignment_ids) THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'destination_not_vacant');
  END IF;

  -- 1b. No competing pending float-in may already target a destination block.
  SELECT count(*)::integer
    INTO v_competing_pending
  FROM shift_block_assignments
  WHERE status = 'pending_float_in'
    AND block_id IN (
      SELECT block_id
      FROM shift_block_assignments
      WHERE assignment_id = ANY(p_destination_assignment_ids)
    );

  IF v_competing_pending > 0 THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'destination_has_pending_float_in');
  END IF;

  -- 1c. Lock the source rows and verify a valid pre-float state.
  SELECT count(*)::integer
    INTO v_sources_locked
  FROM (
    SELECT assignment_id
    FROM shift_block_assignments
    WHERE assignment_id = ANY(p_source_assignment_ids)
      AND status IN ('scheduled', 'claimed')
    FOR UPDATE
  ) locked_sources;

  IF v_sources_locked IS NULL
     OR v_sources_locked < cardinality(p_source_assignment_ids) THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'source_not_available');
  END IF;

  -- Latest destination block start drives the retention boundary.
  SELECT max(sb.block_start_at)
    INTO v_latest_block_start_at
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(p_destination_assignment_ids);

  -- 2. INSERT the float as a FORCE-TRIGGERED pending assignment.
  INSERT INTO float_assignments (
    user_id,
    source_assignment_ids,
    destination_assignment_ids,
    status,
    initiated_by,
    force_triggered_by,
    expires_for_cleanup_at
  )
  VALUES (
    p_worker_id,
    p_source_assignment_ids,
    p_destination_assignment_ids,
    'pending',
    'force_triggered',
    p_initiator_user_id,
    v_latest_block_start_at + (p_retention_days || ' days')::interval
  )
  RETURNING float_id INTO v_float_id;

  -- 3a. Destination rows -> pending_float_in.
  UPDATE shift_block_assignments
  SET user_id         = p_worker_id,
      status          = 'pending_float_in',
      vacancy_origin  = 'none',
      is_float        = true,
      source_house_id = p_source_house_id,
      parent_float_id = v_float_id
  WHERE assignment_id = ANY(p_destination_assignment_ids);

  -- 3b. Source rows -> pending_float_out.
  UPDATE shift_block_assignments
  SET status          = 'pending_float_out',
      vacancy_origin  = 'none',
      is_float        = false,
      source_house_id = NULL,
      parent_float_id = v_float_id
  WHERE assignment_id = ANY(p_source_assignment_ids);

  -- 4. Source-side gap (§6.6 #5): reopen the vacated home seat for pickup. Shared
  --    with process_float_lookup_assignment (was an inline loop here).
  PERFORM reopen_float_source_seats(p_source_assignment_ids, v_float_id);

  -- 5. block_step_status pre-marks (ARCH §4.5).
  INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
  SELECT DISTINCT
    sba.block_id,
    step.name,
    'completed_via_force_trigger'::block_step_status_enum,
    p_now,
    p_now
  FROM shift_block_assignments sba
  CROSS JOIN (VALUES ('broadcast'), ('float_lookup')) AS step(name)
  WHERE sba.assignment_id = ANY(p_destination_assignment_ids)
  ON CONFLICT (block_id, step_name) DO NOTHING;

  -- 6. Personal_shift notification so the worker can acknowledge/decline.
  INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
  VALUES (
    p_worker_id,
    'personal_shift',
    p_now,
    jsonb_build_object(
      'kind',                  'float_assigned',
      'float_id',              v_float_id,
      'initiated_by',          'force_triggered',
      'force_triggered_by',    p_initiator_user_id,
      'destination_house_id',  p_destination_house_id,
      'block_ids',
        (SELECT array_agg(block_id ORDER BY block_id)
         FROM shift_block_assignments
         WHERE assignment_id = ANY(p_destination_assignment_ids))
    )
  );

  -- 7. Ack-reminder cadence snapshot (BSpec §7.1). Shared with
  --    process_float_lookup_assignment so the two paths stay in lock-step.
  PERFORM snapshot_float_ack_reminders(
    p_worker_id, p_destination_assignment_ids, p_destination_house_id, v_float_id, p_now
  );

  RETURN jsonb_build_object('assigned', true, 'float_id', v_float_id);
END;
$$;

REVOKE ALL ON FUNCTION force_trigger_float(uuid, uuid, text, uuid[], uuid[], text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION force_trigger_float(uuid, uuid, text, uuid[], uuid[], text, timestamptz, integer) TO service_role;

-- ------------------------------------------------------------------
-- decline_float — re-created from 20260528000014 with the source-side reconciliation
-- (step 5) replaced by a call to the shared reconcile_float_source_release helper, so
-- automated and force-triggered floats reconcile identically now that BOTH reopen the
-- source seat at assignment time.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION decline_float(
  p_float_id uuid,
  p_user_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_float                 float_assignments%ROWTYPE;
  v_float_start_at        timestamptz;
  v_float_end_at          timestamptz;
  v_destination_house_id  text;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'cannot decline a float for another user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_float
  FROM float_assignments
  WHERE float_id = p_float_id
    AND user_id  = p_user_id
    AND status   = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('declined', false, 'reason', 'not_pending');
  END IF;

  -- Gap window + house for the exclusion record.
  SELECT min(sb.block_start_at),
         max(sb.block_start_at) + interval '30 minutes',
         (array_agg(sb.house_id ORDER BY sb.block_start_at))[1]
    INTO v_float_start_at, v_float_end_at, v_destination_house_id
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids);

  -- 1. Mark the float declined.
  UPDATE float_assignments
  SET status      = 'declined',
      declined_at = p_now
  WHERE float_id = p_float_id;

  -- 2. Destination blocks reopen as the original gap (temporary_drop).
  UPDATE shift_block_assignments
  SET user_id         = NULL,
      status          = 'vacant',
      vacancy_origin  = 'temporary_drop',
      is_float        = false,
      source_house_id = NULL,
      parent_float_id = NULL
  WHERE assignment_id = ANY(v_float.destination_assignment_ids);

  -- 3. Exclude the decliner for this gap window (BSpec §7.3 / §6.6 #7).
  IF v_float_start_at IS NOT NULL AND v_destination_house_id IS NOT NULL THEN
    INSERT INTO float_exclusions (
      user_id, window_start_at, window_end_at, destination_house_id, reason
    )
    VALUES (
      v_float.user_id, v_float_start_at, v_float_end_at, v_destination_house_id, 'declined'
    );
  END IF;

  -- 4. Roll back force-trigger pre-marks so the chain re-evaluates.
  IF v_float.initiated_by = 'force_triggered' THEN
    UPDATE block_step_status
    SET status = 'rolled_back', updated_at = p_now
    WHERE block_id IN (
      SELECT block_id FROM shift_block_assignments
      WHERE assignment_id = ANY(v_float.destination_assignment_ids)
    )
      AND step_name IN ('broadcast', 'float_lookup');
  END IF;

  -- 5. Source-side reconciliation — restore the floater home if the vacated seat is
  --    still unclaimed, else the claimer keeps it and the floater is displaced.
  PERFORM reconcile_float_source_release(p_float_id);

  RETURN jsonb_build_object('declined', true, 'float_id', p_float_id);
END;
$$;

REVOKE ALL ON FUNCTION decline_float(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decline_float(uuid, uuid, timestamptz) TO service_role;

-- ------------------------------------------------------------------
-- process_no_ack_float — re-created from 20260617000006 with the source-side
-- reconciliation (step 5) replaced by the shared reconcile_float_source_release
-- helper. The RSM/HMOD/admin urgent-notify routing is preserved verbatim.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_no_ack_float(
  p_float_id uuid,
  p_now timestamptz,
  p_lookahead_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_float                            record;
  v_first_destination_block_id       uuid;
  v_first_destination_block_start_at timestamptz;
  v_destination_house_id             text;
  v_float_start_at                   timestamptz;
  v_float_end_at                     timestamptz;
  v_hmod_rows                        integer;
  v_recipient_user_id                uuid;
  v_recipient_target                 text;
  v_admin_id                         uuid;
BEGIN
  SELECT * INTO v_float
  FROM float_assignments
  WHERE float_id = p_float_id
    AND status = 'pending'
    AND acknowledged_at IS NULL
    AND declined_at IS NULL
    AND no_ack_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('processed', false, 'reason', 'not_pending');
  END IF;

  SELECT min(sb.block_start_at), max(sb.block_start_at) + interval '30 minutes'
    INTO v_float_start_at, v_float_end_at
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids);

  IF v_float_start_at IS NULL THEN
    RETURN jsonb_build_object('processed', false, 'reason', 'no_destination_blocks');
  END IF;

  IF v_float_start_at > p_now + (p_lookahead_minutes || ' minutes')::interval THEN
    RETURN jsonb_build_object('processed', false, 'reason', 'outside_lookahead');
  END IF;

  SELECT sba.block_id, sb.block_start_at, sb.house_id
    INTO v_first_destination_block_id, v_first_destination_block_start_at, v_destination_house_id
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids)
  ORDER BY sb.block_start_at ASC
  LIMIT 1;

  -- 1. Void the float (recorded as a no-ack, NOT a decline).
  UPDATE float_assignments
  SET status = 'voided', no_ack_at = p_now
  WHERE float_id = p_float_id;

  -- 2. Destination blocks return to vacant (the original gap re-opens).
  UPDATE shift_block_assignments
  SET user_id = NULL, status = 'vacant', vacancy_origin = 'temporary_drop',
      is_float = false, source_house_id = NULL, parent_float_id = NULL
  WHERE assignment_id = ANY(v_float.destination_assignment_ids);

  -- 3. Exclude the unresponsive worker for this gap window.
  INSERT INTO float_exclusions (user_id, window_start_at, window_end_at, destination_house_id, reason)
  VALUES (v_float.user_id, v_float_start_at, v_float_end_at, v_destination_house_id, 'no_acknowledgment');

  -- 4. Roll back force-trigger pre-marks so the chain re-evaluates.
  IF v_float.initiated_by = 'force_triggered' THEN
    UPDATE block_step_status
    SET status = 'rolled_back', updated_at = p_now
    WHERE block_id IN (
      SELECT block_id FROM shift_block_assignments
      WHERE assignment_id = ANY(v_float.destination_assignment_ids)
    )
      AND step_name IN ('broadcast', 'float_lookup');
  END IF;

  -- 5. Source-side reconciliation — restore the floater home if the vacated seat is
  --    still unclaimed, else the claimer keeps it and the floater is displaced.
  PERFORM reconcile_float_source_release(p_float_id);

  -- 6. Claim hmod_notify_allied for EVERY destination block of the gap (one
  --    contiguous float => one notification, no per-block re-fire later).
  INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
  SELECT DISTINCT sb.block_id, 'hmod_notify_allied',
         'fired'::block_step_status_enum, p_now, p_now
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids)
  ON CONFLICT (block_id, step_name) DO NOTHING;

  GET DIAGNOSTICS v_hmod_rows = ROW_COUNT;

  IF v_hmod_rows > 0 THEN
    -- BSpec §10.1: in HM hours the contact is the RSM (HM only when HMOD).
    IF is_hm_working_time(p_now) AND is_hm_working_time(v_first_destination_block_start_at) THEN
      v_recipient_user_id := resolve_rsm_for_house(v_destination_house_id, p_now);
      v_recipient_target  := 'rsm';
      IF v_recipient_user_id IS NULL THEN
        v_recipient_user_id := resolve_hmod_on_duty(p_now);
        v_recipient_target  := 'hmod';
      END IF;
    ELSE
      v_recipient_user_id := resolve_hmod_on_duty(p_now);
      v_recipient_target  := 'hmod';
    END IF;

    -- C3a: project-administrator terminal fallback.
    IF v_recipient_user_id IS NULL THEN
      SELECT config_value::uuid INTO v_admin_id FROM system_config
      WHERE config_key = 'project_administrator_user_id';
      IF v_admin_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE user_id = v_admin_id AND is_active) THEN
        v_recipient_user_id := v_admin_id;
        v_recipient_target  := 'project_admin';
      END IF;
    END IF;

    IF v_recipient_user_id IS NOT NULL THEN
      INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
      VALUES (
        v_recipient_user_id, 'hmod_urgent'::notification_type, p_now,
        jsonb_build_object(
          'target', v_recipient_target, 'reason', 'float_no_acknowledgment',
          'block_id', v_first_destination_block_id, 'house_id', v_destination_house_id,
          'block_start_at', v_first_destination_block_start_at
        )
      );
    ELSE
      -- BSpec §2.6: the project administrator is the guaranteed terminal. If
      -- nothing resolved, surface it instead of silently dropping the event.
      RAISE WARNING 'process_no_ack_float: no notification recipient for block % (house %); set system_config.project_administrator_user_id to an active admin user_id',
        v_first_destination_block_id, v_destination_house_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'processed', true,
    'block_id', v_first_destination_block_id,
    'block_start_at', v_first_destination_block_start_at,
    'house_id', v_destination_house_id,
    'hmod_step_claimed', (v_hmod_rows > 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION process_no_ack_float(uuid, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_no_ack_float(uuid, timestamptz, integer) TO service_role;

-- rollback:
-- (Restore process_float_lookup_assignment + force_trigger_float from
--  20260601000002, decline_float from 20260528000014, process_no_ack_float from
--  20260617000006, then:)
-- DROP FUNCTION IF EXISTS reopen_float_source_seats(uuid[], uuid);
-- DROP FUNCTION IF EXISTS reconcile_float_source_release(uuid);
