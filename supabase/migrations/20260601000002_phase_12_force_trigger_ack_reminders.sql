-- Migration: Phase 12 follow-up — force-triggered floats must also snapshot the
-- ack-reminder cadence (BSpec §7.1).
--
-- AUDIT FINDING (resolved here). BSpec §7.1 states the escalating ack reminders
-- fire when a float is assigned "whether through automated lookup or
-- force-trigger." The automated path (process_float_lookup_assignment, last
-- defined in 20260528000022_batch_f3) snapshotted the cadence onto scheduled
-- notification rows; the force-trigger sibling (force_trigger_float,
-- 20260529000001) created only the immediate float_assigned notification and NO
-- reminder rows. A force-triggered worker therefore received the "you've been
-- assigned" push but none of the 6h/2h/1h/30m/5m nudges the spec mandates.
--
-- Fix: extract the F3 cadence-snapshot block into ONE shared helper
-- (snapshot_float_ack_reminders) and call it from BOTH assignment paths, so the
-- two paths can never diverge on cadence semantics again. Behaviour of the
-- automated path is unchanged (same offsets, same `t > p_now` skip-past filter);
-- the force-trigger path gains the identical snapshot.
--
-- Cadence semantics (BSpec §7.1, ARCHITECTURE §2.8) — unchanged, restated for
-- clarity since the original was the source of an audit ambiguity:
--   * 1h / 30m / 5m before the T-10m ack deadline are MANDATORY and always
--     created; they are not configurable.
--   * 6h / 2h are per-house configurable. A NULL offset means the SYSTEM DEFAULT
--     (-6h / -2h before the deadline), NOT suppression. Suppression is the
--     separate "disabled" state, modelled by reminder_6h_enabled /
--     reminder_2h_enabled = false. null offset != suppressed.
--   * Any reminder already at-or-before the assignment instant (`t > p_now`) is
--     skipped (a float assigned inside the 6h window simply starts from the next
--     future offset).

-- ------------------------------------------------------------------
-- Shared helper: snapshot the ack-reminder cadence for a just-created float.
-- Reads ack_cadence_config ONCE and writes the resolved absolute instants onto
-- ack_reminder notification rows. The delivery scheduler reads these snapshotted
-- scheduled_for instants and never re-queries ack_cadence_config (ARCH §2.8).
-- Returns the number of reminder rows created (testability).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION snapshot_float_ack_reminders(
  p_worker_id uuid,
  p_destination_assignment_ids uuid[],
  p_destination_house_id text,
  p_float_id uuid,
  p_now timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ack_deadline timestamptz;
  v_cfg          ack_cadence_config%ROWTYPE;
  v_reminders    timestamptz[];
  v_inserted     integer := 0;
BEGIN
  -- Ack deadline = T-10m before the EARLIEST destination block start
  -- (BSpec §7.1; all reminder offsets are measured from this deadline).
  SELECT min(sb.block_start_at) - interval '10 minutes'
    INTO v_ack_deadline
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(p_destination_assignment_ids);

  IF v_ack_deadline IS NULL THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_cfg FROM ack_cadence_config WHERE house_id = p_destination_house_id;

  -- Mandatory 1h / 30m / 5m — always present, never configurable.
  v_reminders := ARRAY[
    v_ack_deadline - interval '1 hour',
    v_ack_deadline - interval '30 minutes',
    v_ack_deadline - interval '5 minutes'
  ];

  -- Configurable 6h / 2h. enabled flag governs PRESENCE; a NULL offset falls back
  -- to the system default (-6h / -2h). (See header note: null != suppressed.)
  IF COALESCE(v_cfg.reminder_6h_enabled, true) THEN
    v_reminders := v_reminders || (v_ack_deadline + COALESCE(v_cfg.reminder_6h_offset, interval '-6 hours'));
  END IF;
  IF COALESCE(v_cfg.reminder_2h_enabled, true) THEN
    v_reminders := v_reminders || (v_ack_deadline + COALESCE(v_cfg.reminder_2h_offset, interval '-2 hours'));
  END IF;

  WITH inserted AS (
    INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
    SELECT p_worker_id, 'ack_reminder'::notification_type, t,
           jsonb_build_object('kind', 'float_ack_reminder', 'float_id', p_float_id,
                              'ack_deadline', v_ack_deadline)
    FROM unnest(v_reminders) AS t
    WHERE t > p_now
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION snapshot_float_ack_reminders(uuid, uuid[], text, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION snapshot_float_ack_reminders(uuid, uuid[], text, uuid, timestamptz) TO service_role;

-- ------------------------------------------------------------------
-- Automated float-lookup path: re-create process_float_lookup_assignment
-- (last defined in 20260528000022_batch_f3) with the inline cadence block
-- replaced by a call to the shared helper. Behaviour is identical.
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
-- Force-trigger path: re-create force_trigger_float (20260529000001) with the
-- ack-reminder cadence snapshot appended after the personal_shift notification.
-- Everything else is byte-for-byte the original.
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
  v_src_block_id          uuid;
  v_required              integer;
  v_remaining             integer;
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

  -- 4. Source-side gap (§6.6 #5): materialise a vacant 'temporary_drop' row when
  --    the source falls below required_headcount after the float-out.
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
        v_src_block_id, NULL, 'vacant', 'temporary_drop', false, NULL, v_float_id
      );
    END IF;
  END LOOP;

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

  -- 7. Ack-reminder cadence snapshot (BSpec §7.1 — reminders fire for floats
  --    assigned "whether through automated lookup or force-trigger"). Shared with
  --    process_float_lookup_assignment so the two paths stay in lock-step.
  PERFORM snapshot_float_ack_reminders(
    p_worker_id, p_destination_assignment_ids, p_destination_house_id, v_float_id, p_now
  );

  RETURN jsonb_build_object('assigned', true, 'float_id', v_float_id);
END;
$$;

REVOKE ALL ON FUNCTION force_trigger_float(uuid, uuid, text, uuid[], uuid[], text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION force_trigger_float(uuid, uuid, text, uuid[], uuid[], text, timestamptz, integer) TO service_role;

-- rollback:
-- (Restore the prior bodies from 20260528000022_batch_f3_ack_snapshot.sql and
--  20260529000001_phase_08_force_trigger_rpc.sql, then:)
-- DROP FUNCTION IF EXISTS snapshot_float_ack_reminders(uuid, uuid[], text, uuid, timestamptz);
