-- Batch F (F4): no-ack refinements.
--   F-07-010 — record a no-ack as no_ack_at, not declined_at (a no-ack is not a
--              decline). Adds the column and switches process_no_ack_float to it.
--   F-07-009 — mark hmod_notify_allied 'fired' for EVERY destination block of
--              the gap (one contiguous float), so a multi-block destination
--              emits exactly one HMOD notification and no later tick re-fires the
--              step for the other blocks.

ALTER TABLE float_assignments ADD COLUMN IF NOT EXISTS no_ack_at timestamptz;

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
  v_gap_rows_total                   integer;
  v_gap_rows_still_vacant            integer;
  v_hmod_step_claimed                boolean;
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

  -- 5. Source-side reconciliation.
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
    UPDATE shift_block_assignments
    SET user_id = v_float.user_id, status = 'scheduled', vacancy_origin = 'none',
        is_float = false, source_house_id = NULL, parent_float_id = NULL
    WHERE assignment_id = ANY(v_float.source_assignment_ids);
  END IF;

  -- 6. Claim hmod_notify_allied for EVERY destination block of the gap (one
  --    contiguous float => one notification, no per-block re-fire later).
  INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
  SELECT DISTINCT sb.block_id, 'hmod_notify_allied',
         'fired'::block_step_status_enum, p_now, p_now
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids)
  ON CONFLICT (block_id, step_name) DO NOTHING;

  GET DIAGNOSTICS v_hmod_step_claimed = ROW_COUNT;

  IF v_hmod_step_claimed THEN
    IF is_hm_working_time(p_now) AND is_hm_working_time(v_first_destination_block_start_at) THEN
      v_recipient_user_id := resolve_hm_for_house(v_destination_house_id, p_now);
      v_recipient_target  := 'hm';
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
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'processed', true,
    'block_id', v_first_destination_block_id,
    'block_start_at', v_first_destination_block_start_at,
    'house_id', v_destination_house_id,
    'hmod_step_claimed', v_hmod_step_claimed
  );
END;
$$;

REVOKE ALL ON FUNCTION process_no_ack_float(uuid, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_no_ack_float(uuid, timestamptz, integer) TO service_role;
