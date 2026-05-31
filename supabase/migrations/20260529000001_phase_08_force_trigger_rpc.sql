-- Migration: Phase 08 — force-trigger execution RPC (force_trigger_float).
--
-- Spec sources:
--   BEHAVIORAL_SPECIFICATION.md §6.6 (force-triggered float — #2 bypass,
--                                #3 floater assignment, #5 source-side gap,
--                                #8 no-takeback);
--   ARCHITECTURE.md §4.5 (force-trigger pathway: destination + source-side
--                          rows, block_step_status pre-marking),
--                   §6.3 ("Atomic: all source-side and destination-side
--                          updates happen in one transaction");
--   tests/PHASE_08/TEST_PLAN.md (the documented force_trigger_float contract).
--   AGENTS.md hard invariant #3 (no-takeback).
--
-- This is the force-trigger sibling of process_float_lookup_assignment
-- (20260528000005 / 20260528000012). The force-trigger Edge Function
-- (supabase/functions/force-trigger) runs the §6.2 validation gate
-- (packages/core validateForceTrigger) and the float lookup algorithm
-- (packages/core findFloaters), then calls this RPC ONCE PER IDENTIFIED
-- FLOATER. The whole per-floater write is one transaction (ARCH §6.3).
--
-- Differences from the automated process_float_lookup_assignment:
--   1. initiated_by = 'force_triggered', force_triggered_by = the SM/HM/BM/
--      HMOD initiator (the schema CHECK requires this pairing).
--   2. Source-side gap: when floating the worker out drops a source block
--      below its required_headcount, INSERT a vacant 'temporary_drop'
--      compensation row linked to the float (parent_float_id), so it enters
--      the open-shifts feed and decline_float's source-side reconciliation
--      (restore vs displace) can find it. The automated chain reaches the
--      source-gap rows by the standard escalation; force-trigger bypasses
--      the chain (§6.6 #2), so it materialises the source gap here.
--   3. block_step_status pre-marks: broadcast + float_lookup ->
--      'completed_via_force_trigger' per destination block (ARCH §4.5),
--      ON CONFLICT DO NOTHING. hmod_notify_allied is deliberately NOT
--      pre-marked, so the orchestrator can still fire it if the chain
--      later rolls back (decline/no-ack).
--
-- TOCTOU guard (ARCH §6.3, TEST_PLAN RPC contract step 1): each destination
-- is locked and re-verified still 'vacant' with no competing pending
-- float-in. If any check fails the function returns assigned=false and
-- writes NOTHING (the single transaction commits no rows) — mirroring the
-- automated RPC's destination re-check.

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
  -- 1a. Lock the destination rows and re-verify they are still vacant
  --     (TOCTOU). A concurrent claim between the algorithm's snapshot and
  --     this call must abort the whole force-trigger with no writes.
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

  -- 1b. No competing pending float-in may already target a destination
  --     block (a different inbound float). The destination rows themselves
  --     are 'vacant' (verified above); this guards a separate pending row
  --     on the same block.
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

  -- 1c. Lock the source rows and verify a valid pre-float state
  --     (scheduled or claimed), mirroring the automated RPC.
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

  -- 2. INSERT the float as a FORCE-TRIGGERED pending assignment. The
  --    schema CHECK enforces force_triggered => force_triggered_by NOT NULL.
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

  -- 3a. Destination rows -> pending_float_in. The destination row IS the
  --     float-in at the non-home desk: is_float = true, source_house_id
  --     stores the worker's home (= the source house).
  UPDATE shift_block_assignments
  SET user_id         = p_worker_id,
      status          = 'pending_float_in',
      vacancy_origin  = 'none',
      is_float        = true,
      source_house_id = p_source_house_id,
      parent_float_id = v_float_id
  WHERE assignment_id = ANY(p_destination_assignment_ids);

  -- 3b. Source rows -> pending_float_out. The source row IS the worker's
  --     HOME seat: is_float = false, source_house_id = NULL.
  --     parent_float_id links the row for later reconciliation.
  UPDATE shift_block_assignments
  SET status          = 'pending_float_out',
      vacancy_origin  = 'none',
      is_float        = false,
      source_house_id = NULL,
      parent_float_id = v_float_id
  WHERE assignment_id = ANY(p_source_assignment_ids);

  -- 4. Source-side gap (§6.6 #5). For each source block the worker was
  --    floated out of, if the remaining physical headcount now falls below
  --    the block's required_headcount, materialise a vacant 'temporary_drop'
  --    compensation row linked to the float so it enters the open-shifts
  --    feed. The floater's own row is already 'pending_float_out' (not
  --    counted below), so this measures coverage AFTER the float-out.
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

  -- 5. block_step_status pre-marks (ARCH §4.5). broadcast + float_lookup ->
  --    completed_via_force_trigger per destination block. hmod_notify_allied
  --    is intentionally left without a row. Idempotent via ON CONFLICT.
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

  -- 6. Personal_shift notification so the worker can acknowledge/decline
  --    (delivery is phase-12 notifications; this is the row only), mirroring the
  --    automated float-lookup assignment.
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

  RETURN jsonb_build_object('assigned', true, 'float_id', v_float_id);
END;
$$;

-- Service-role-only callable. The force-trigger Edge Function is the sole caller.
REVOKE ALL ON FUNCTION force_trigger_float(uuid, uuid, text, uuid[], uuid[], text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION force_trigger_float(uuid, uuid, text, uuid[], uuid[], text, timestamptz, integer) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS force_trigger_float(uuid, uuid, text, uuid[], uuid[], text, timestamptz, integer);
