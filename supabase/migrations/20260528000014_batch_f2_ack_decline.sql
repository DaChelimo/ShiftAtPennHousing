-- Batch F (F2): acknowledge_float + decline_float RPCs (F-07-007, D-4).
-- Phase-8 force-trigger needs an accept/decline path; only the no-ack path
-- existed. Both are SECURITY DEFINER, service-role-only, with a defense-in-depth
-- identity check (auth.uid() is NULL under service_role).
--
--  acknowledge_float: pending -> acknowledged; pending_float_in -> floated_in,
--                     pending_float_out -> floated_out; sets acknowledged_at.
--  decline_float:     pending -> declined; destination blocks reopen as vacant
--                     (temporary_drop), the decliner is excluded for the gap
--                     window (reason 'declined'), force-trigger pre-marks roll
--                     back, and source-side rows are reconciled exactly as in
--                     process_no_ack_float. Unlike no-ack it does NOT fire
--                     hmod_notify_allied or apply a lookahead gate: a decline
--                     can land well before the float start, so the orchestrator
--                     re-evaluates the escalation chain on its next tick
--                     (BSpec §6.6 #7).
--
-- Also lock down the 3-arg resolve_hm_for_user created in 20260528000012
-- (a fresh function defaults to PUBLIC execute).
REVOKE ALL ON FUNCTION resolve_hm_for_user(uuid, timestamptz, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_hm_for_user(uuid, timestamptz, date) TO service_role;

-- ============================================================
-- acknowledge_float
-- ============================================================
CREATE OR REPLACE FUNCTION acknowledge_float(
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
  v_float float_assignments%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'cannot acknowledge a float for another user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_float
  FROM float_assignments
  WHERE float_id = p_float_id
    AND user_id  = p_user_id
    AND status   = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('acknowledged', false, 'reason', 'not_pending');
  END IF;

  UPDATE shift_block_assignments
  SET status = 'floated_in'
  WHERE assignment_id = ANY(v_float.destination_assignment_ids)
    AND status = 'pending_float_in';

  UPDATE shift_block_assignments
  SET status = 'floated_out'
  WHERE assignment_id = ANY(v_float.source_assignment_ids)
    AND status = 'pending_float_out';

  UPDATE float_assignments
  SET status          = 'acknowledged',
      acknowledged_at = p_now
  WHERE float_id = p_float_id;

  RETURN jsonb_build_object('acknowledged', true, 'float_id', p_float_id);
END;
$$;

-- ============================================================
-- decline_float
-- ============================================================
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
  v_gap_rows_total        integer;
  v_gap_rows_still_vacant integer;
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

  -- 5. Source-side reconciliation (mirrors process_no_ack_float).
  IF v_float.initiated_by = 'force_triggered' THEN
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
  ELSE
    -- Automated float: restore the floater to their home (source) seat.
    UPDATE shift_block_assignments
    SET user_id = v_float.user_id, status = 'scheduled', vacancy_origin = 'none',
        is_float = false, source_house_id = NULL, parent_float_id = NULL
    WHERE assignment_id = ANY(v_float.source_assignment_ids);
  END IF;

  RETURN jsonb_build_object('declined', true, 'float_id', p_float_id);
END;
$$;

REVOKE ALL ON FUNCTION acknowledge_float(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acknowledge_float(uuid, uuid, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION decline_float(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decline_float(uuid, uuid, timestamptz) TO service_role;
