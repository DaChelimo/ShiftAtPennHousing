-- =============================================================================
-- Allied-coverage notifications: record the coverage-window END in the payload.
-- =============================================================================
-- The Action inbox archives an Allied-coverage (`hmod_urgent`) alert once the
-- period for which coverage was needed has ELAPSED (BSpec §5.4 / §10.1). To decide
-- that, the read side needs the window END, not just the start.
--
-- Two creation paths emit `hmod_urgent`, with DIFFERENT span semantics:
--   * process_hmod_notify_allied_step — fired PER 30-minute block by the
--     orchestrator chain, so each notification covers exactly one block. Its end is
--     block_start_at + 30 minutes.
--   * process_no_ack_float — fired ONCE per contiguous float gap (F-07-009), so a
--     22:00–23:00 (two-block) gap emits ONE notification whose start is the first
--     block. Its true end is max(destination block_start_at) + 30 minutes, which the
--     function ALREADY computes as v_float_end_at but never stored.
--
-- This migration recreates both functions verbatim from their latest definitions
-- (process_hmod_notify_allied_step from 20260617000006 — the RSM-routing version;
-- process_no_ack_float from 20260623000002) and adds a single `block_end_at` key to
-- each payload. Additive only — no control-flow change, no signature change. Legacy rows
-- without the key fall back to start+30min on the read side. Use DURATION arithmetic
-- (`+ interval '30 minutes'`), never wall-clock, per the DST invariant.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- process_hmod_notify_allied_step — per-block chain step (verbatim from
-- 20260617000006, the RSM-routing version, + block_end_at).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_hmod_notify_allied_step(
  p_block_id uuid,
  p_house_id text,
  p_block_start_at timestamptz,
  p_now timestamptz,
  p_reason text DEFAULT 'escalation_chain'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed_count       integer;
  v_recipient_user_id   uuid;
  v_target              text;
  v_admin_id            uuid;
BEGIN
  INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
  VALUES (p_block_id, 'hmod_notify_allied', 'fired', p_now, p_now)
  ON CONFLICT (block_id, step_name) DO NOTHING;

  GET DIAGNOSTICS v_claimed_count = ROW_COUNT;

  IF v_claimed_count = 0 THEN
    UPDATE block_step_status
    SET status     = 'fired',
        fired_at   = p_now,
        updated_at = p_now
    WHERE block_id  = p_block_id
      AND step_name = 'hmod_notify_allied'
      AND status    = 'rolled_back';

    GET DIAGNOSTICS v_claimed_count = ROW_COUNT;
  END IF;

  IF v_claimed_count = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'recipient_user_id', NULL, 'target', NULL);
  END IF;

  -- BSpec §10.1: during HM working hours the in-house contact is the RSM, not the
  -- HM. The HM is only reached in their HMOD capacity (the ELSE branch). When the
  -- house has no acting RSM, fall back to the HMOD on duty.
  IF is_hm_working_time(p_now) AND is_hm_working_time(p_block_start_at) THEN
    v_recipient_user_id := resolve_rsm_for_house(p_house_id, p_now);
    v_target := 'rsm';
    IF v_recipient_user_id IS NULL THEN
      v_recipient_user_id := resolve_hmod_on_duty(p_now);
      v_target := 'hmod';
    END IF;
  ELSE
    v_recipient_user_id := resolve_hmod_on_duty(p_now);
    v_target := 'hmod';
  END IF;

  IF v_recipient_user_id IS NULL THEN
    -- C3a: fall back to the project administrator terminal.
    SELECT config_value::uuid INTO v_admin_id
    FROM system_config
    WHERE config_key = 'project_administrator_user_id';

    IF v_admin_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM users WHERE user_id = v_admin_id AND is_active) THEN
      v_recipient_user_id := v_admin_id;
      v_target := 'project_admin';
    ELSE
      -- BSpec §2.6: surface the missing terminal rather than dropping it.
      RAISE WARNING 'process_hmod_notify_allied_step: no recipient for block % (house %); set system_config.project_administrator_user_id to an active admin user_id',
        p_block_id, p_house_id;
      RETURN jsonb_build_object('claimed', true, 'recipient_user_id', NULL, 'target', v_target);
    END IF;
  END IF;

  INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
  VALUES (
    v_recipient_user_id,
    'hmod_urgent'::notification_type,
    p_now,
    jsonb_build_object(
      'target',         v_target,
      'reason',         p_reason,
      'block_id',       p_block_id,
      'house_id',       p_house_id,
      'block_start_at', p_block_start_at,
      -- A single 30-minute chain block: the coverage window ends one block later.
      'block_end_at',   p_block_start_at + interval '30 minutes'
    )
  );

  RETURN jsonb_build_object('claimed', true, 'recipient_user_id', v_recipient_user_id, 'target', v_target);
END;
$$;

REVOKE ALL ON FUNCTION process_hmod_notify_allied_step(uuid, text, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_hmod_notify_allied_step(uuid, text, timestamptz, timestamptz, text) TO service_role;

-- ---------------------------------------------------------------------------
-- process_no_ack_float — one notification per contiguous gap (verbatim from
-- 20260623000002 + block_end_at = v_float_end_at, the true gap end).
-- ---------------------------------------------------------------------------
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
          'block_start_at', v_first_destination_block_start_at,
          -- The full contiguous gap end (max destination block + 30m), so a
          -- multi-block no-ack alert archives only after the WHOLE window elapses.
          'block_end_at', v_float_end_at
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
-- Restore process_hmod_notify_allied_step from 20260617000006 and
-- process_no_ack_float from 20260623000002 (drop the block_end_at payload key).
