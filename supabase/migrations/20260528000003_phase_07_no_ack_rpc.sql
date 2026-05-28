-- Migration: Phase 07 atomic no-ack handler RPC.
--
-- ARCH §4.4 contract: "This rollback write happens inside the same
-- transaction as the float status flip to voided and the destination
-- block status flip back to vacant."
--
-- The Phase 07 Edge Function (orchestrator-tick) originally issued these
-- writes as separate PostgREST calls, leaving partial state possible if
-- the function crashed mid-flight and breaking the atomicity guarantee in
-- ARCH §1.3 / §4.4. This migration introduces a single plpgsql function
-- that performs all writes inside one transaction:
--
--   1. Void the float assignment.
--   2. Flip destination shift_block_assignments to vacant.
--   3. Insert a float_exclusions row for the unresponsive worker.
--   4. Roll back block_step_status (broadcast, float_lookup) — only for
--      force-triggered floats per ARCH §4.5.
--   5. Source-side reconciliation per ARCH §4.5 #2-#3:
--      - Force-triggered + source-side gap still vacant: restore floater
--        to scheduled and cancel the redundant source-side vacant rows.
--      - Force-triggered + source-side gap claimed/Allied'd: displace
--        the floater (vacancy_origin = 'displaced_decliner').
--      - Automated: restore floater to scheduled (no source-side gap
--        rows exist for automated floats).
--   6. Claim hmod_notify_allied step idempotently via ON CONFLICT
--      DO NOTHING. The notification itself is fired by the Edge
--      Function after the RPC returns, so external delivery only
--      happens once the transaction has committed.
--
-- The function takes SELECT ... FOR UPDATE on the float row to
-- serialize concurrent ticks: if two ticks race on the same pending
-- float, the second one's lock waits, then sees the float is no longer
-- pending and exits via the NOT FOUND path.
--
-- Source-side gap rows convention (introduced for ARCH §4.5):
-- force-trigger creates new shift_block_assignments rows with
-- parent_float_id = float_id and status = 'vacant' when pulling the
-- floater drops the source house below required headcount. The
-- reconciliation query distinguishes those rows from the floater's own
-- source rows (pending_float_out) and from destination rows
-- (pending_float_in / vacant after step 2) by exclusion of the known
-- source_assignment_ids / destination_assignment_ids arrays. Phase 07
-- has no force-trigger endpoint yet; this code path activates when
-- Phase 08 adds it.

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
BEGIN
  SELECT *
    INTO v_float
  FROM float_assignments
  WHERE float_id = p_float_id
    AND status = 'pending'
    AND acknowledged_at IS NULL
    AND declined_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('processed', false, 'reason', 'not_pending');
  END IF;

  SELECT
    min(sb.block_start_at),
    max(sb.block_start_at) + interval '30 minutes'
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
    INTO v_first_destination_block_id,
         v_first_destination_block_start_at,
         v_destination_house_id
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids)
  ORDER BY sb.block_start_at ASC
  LIMIT 1;

  -- 1. Void the float.
  UPDATE float_assignments
  SET status      = 'voided',
      declined_at = p_now
  WHERE float_id = p_float_id;

  -- 2. Destination blocks return to vacant.
  UPDATE shift_block_assignments
  SET user_id         = NULL,
      status          = 'vacant',
      vacancy_origin  = 'displaced_decliner',
      is_float        = false,
      source_house_id = NULL,
      parent_float_id = NULL
  WHERE assignment_id = ANY(v_float.destination_assignment_ids);

  -- 3. Exclude the unresponsive worker for this gap window (BSpec §7.3).
  INSERT INTO float_exclusions (
    user_id,
    window_start_at,
    window_end_at,
    destination_house_id,
    reason
  )
  VALUES (
    v_float.user_id,
    v_float_start_at,
    v_float_end_at,
    v_destination_house_id,
    'no_acknowledgment'
  );

  -- 4. Roll back the force-trigger pre-marks so the chain re-evaluates
  --    (ARCH §4.5 "Rollback procedure"). Automated floats have nothing
  --    to roll back — their chain steps were never pre-marked.
  IF v_float.initiated_by = 'force_triggered' THEN
    UPDATE block_step_status
    SET status     = 'rolled_back',
        updated_at = p_now
    WHERE block_id IN (
      SELECT block_id
      FROM shift_block_assignments
      WHERE assignment_id = ANY(v_float.destination_assignment_ids)
    )
      AND step_name IN ('broadcast', 'float_lookup');
  END IF;

  -- 5. Source-side reconciliation (ARCH §4.5 #2-#3).
  IF v_float.initiated_by = 'force_triggered' THEN
    -- Identify source-side compensation rows: same parent_float_id as
    -- this float, but distinct from the floater's own source rows and
    -- the destination rows we already reset.
    SELECT
      count(*) FILTER (WHERE status = 'vacant'),
      count(*)
      INTO v_gap_rows_still_vacant, v_gap_rows_total
    FROM shift_block_assignments
    WHERE parent_float_id = p_float_id
      AND assignment_id != ALL(v_float.source_assignment_ids)
      AND assignment_id != ALL(v_float.destination_assignment_ids);

    IF v_gap_rows_total > 0 AND v_gap_rows_still_vacant = v_gap_rows_total THEN
      -- Source-side gap is fully vacant: restore floater + cancel the
      -- now-redundant compensation rows.
      UPDATE shift_block_assignments
      SET user_id         = v_float.user_id,
          status          = 'scheduled',
          vacancy_origin  = 'none',
          is_float        = false,
          source_house_id = NULL,
          parent_float_id = NULL
      WHERE assignment_id = ANY(v_float.source_assignment_ids);

      DELETE FROM shift_block_assignments
      WHERE parent_float_id = p_float_id
        AND status = 'vacant'
        AND assignment_id != ALL(v_float.source_assignment_ids)
        AND assignment_id != ALL(v_float.destination_assignment_ids);
    ELSE
      -- Source-side gap was claimed or Allied'd in part or whole, or no
      -- compensation rows ever existed: displace the floater. Any
      -- compensation rows still vacant remain in the standard escalation
      -- pipeline (they keep their parent_float_id, which is harmless
      -- once this float is voided).
      UPDATE shift_block_assignments
      SET user_id         = NULL,
          status          = 'vacant',
          vacancy_origin  = 'displaced_decliner',
          is_float        = false,
          source_house_id = NULL,
          parent_float_id = NULL
      WHERE assignment_id = ANY(v_float.source_assignment_ids);
    END IF;
  ELSE
    -- Automated floats: the floater's source row is the only source-side
    -- artifact; restore it to scheduled.
    UPDATE shift_block_assignments
    SET user_id         = v_float.user_id,
        status          = 'scheduled',
        vacancy_origin  = 'none',
        is_float        = false,
        source_house_id = NULL,
        parent_float_id = NULL
    WHERE assignment_id = ANY(v_float.source_assignment_ids);
  END IF;

  -- 6. Claim the hmod_notify_allied step idempotently. The Edge
  --    Function reads v_hmod_step_claimed to decide whether to send the
  --    notification (it does so only when this RPC won the claim).
  WITH inserted AS (
    INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
    VALUES (v_first_destination_block_id, 'hmod_notify_allied', 'fired', p_now, p_now)
    ON CONFLICT (block_id, step_name) DO NOTHING
    RETURNING block_id
  )
  SELECT count(*) > 0 INTO v_hmod_step_claimed FROM inserted;

  RETURN jsonb_build_object(
    'processed',         true,
    'block_id',          v_first_destination_block_id,
    'block_start_at',    v_first_destination_block_start_at,
    'house_id',          v_destination_house_id,
    'hmod_step_claimed', v_hmod_step_claimed
  );
END;
$$;

-- Service-role-only callable. Authenticated callers should never invoke
-- this directly; the cron-driven Edge Function is the sole caller.
REVOKE ALL ON FUNCTION process_no_ack_float(uuid, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_no_ack_float(uuid, timestamptz, integer) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS process_no_ack_float(uuid, timestamptz, integer);
