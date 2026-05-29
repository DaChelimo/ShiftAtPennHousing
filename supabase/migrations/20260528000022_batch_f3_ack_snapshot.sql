-- Batch F (F3): snapshot the ack-reminder cadence when a float is assigned
-- (F-07-008, D-4 "build snapshot now"). Full reminder *delivery* is deferred to
-- Phase 12; this writes the scheduled ack_reminder notification rows.
--
-- Ack deadline = T-10m before float start (BSpec §7.1, body-canonical per D-8).
-- Reminders: configurable per-house 6h/2h (ack_cadence_config; each may be
-- disabled; NULL offset = system default of -6h/-2h before the deadline) plus
-- mandatory 1h/30m/5m. Any reminder already past-due at assignment time is
-- skipped. Offsets follow the escalation-chain sign convention (negative =
-- before the anchor).
--
-- Re-creates process_float_lookup_assignment (last defined in 20260528000012)
-- with the snapshot block appended.

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
  v_ack_deadline          timestamptz;
  v_cfg                   ack_cadence_config%ROWTYPE;
  v_reminders             timestamptz[];
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

  -- F3: ack-reminder cadence snapshot.
  SELECT min(sb.block_start_at) - interval '10 minutes'
    INTO v_ack_deadline
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(p_destination_assignment_ids);

  SELECT * INTO v_cfg FROM ack_cadence_config WHERE house_id = p_destination_house_id;

  v_reminders := ARRAY[
    v_ack_deadline - interval '1 hour',
    v_ack_deadline - interval '30 minutes',
    v_ack_deadline - interval '5 minutes'
  ];
  IF COALESCE(v_cfg.reminder_6h_enabled, true) THEN
    v_reminders := v_reminders || (v_ack_deadline + COALESCE(v_cfg.reminder_6h_offset, interval '-6 hours'));
  END IF;
  IF COALESCE(v_cfg.reminder_2h_enabled, true) THEN
    v_reminders := v_reminders || (v_ack_deadline + COALESCE(v_cfg.reminder_2h_offset, interval '-2 hours'));
  END IF;

  INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
  SELECT p_worker_id, 'ack_reminder'::notification_type, t,
         jsonb_build_object('kind', 'float_ack_reminder', 'float_id', v_float_id,
                            'ack_deadline', v_ack_deadline)
  FROM unnest(v_reminders) AS t
  WHERE t > p_now;

  RETURN jsonb_build_object('assigned', true, 'float_id', v_float_id);
END;
$$;

REVOKE ALL ON FUNCTION process_float_lookup_assignment(uuid, text, uuid[], uuid[], text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_float_lookup_assignment(uuid, text, uuid[], uuid[], text, timestamptz, integer) TO service_role;
