-- Migration: Phase 07 atomic float-lookup assignment RPC — audit fixes B-2 and C-3.
--
-- Spec sources:
--   ARCHITECTURE §1.3 ("Every operation touching multiple tables ...
--                       executes atomically. The system uses database
--                       transactions; partial state is never observable."),
--                §3.2 (shift_block_assignments column semantics:
--                       is_float = "true if this assignment is a float-in";
--                       source_house_id populated "whenever the worker
--                       is at a non-home desk"),
--                §4.2 ("Step: float_lookup ... Invoke the float lookup
--                       algorithm ... If floaters are assigned, the
--                       affected blocks transition appropriately."),
--                §9.5 ("Float assignment (automated): insert
--                       float_assignments row, update source-side and
--                       destination-side shift_block_assignments, all
--                       in one transaction.");
--   BEHAVIORAL_SPECIFICATION §6 (float lookup algorithm output —
--                                 one or more float_assignments rows).
--
-- Audit findings addressed:
--
-- B-2 — `floatLookupStep()` in orchestrator-tick/index.ts executed the
--   four writes
--     1. INSERT INTO float_assignments
--     2. UPDATE destination shift_block_assignments → pending_float_in
--     3. UPDATE source shift_block_assignments → pending_float_out
--     4. INSERT INTO notifications (personal_shift)
--   as four sequential PostgREST round-trips with NO transaction
--   boundary. A crash between any two left partial state — the most
--   damaging being (1)+(2) committed but (3) failing, which leaves the
--   worker with a pending_float_in destination AND a still-scheduled
--   home seat (double-booked). ARCH §9.5 explicitly requires one
--   transaction. This RPC consolidates the four writes into a single
--   plpgsql function.
--
--   The RPC also re-validates the destination is still vacant under
--   the row lock; if a concurrent claim has filled the destination
--   between the algorithm's snapshot and this call, the assignment
--   aborts cleanly with `assigned=false` and writes nothing.
--
-- C-3 — The source-side UPDATE previously set
--     is_float        = true,
--     source_house_id = <worker home>
--   on the floater's home seat. Per ARCH §3.2 `is_float = true` means
--   "this assignment IS a float-IN" (i.e., the destination), and
--   `source_house_id` records the worker's home WHEN the worker is at
--   a non-home desk. The source row is the worker's home seat — neither
--   field applies. This RPC sets `is_float = false` and
--   `source_house_id = NULL` on the source row. `parent_float_id` is
--   still set so the no-ack and acknowledge handlers can find the row
--   for reconciliation.

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
BEGIN
  -- Lock the destination assignments and verify they are still vacant.
  -- We need both the count (to detect a concurrent claim) and the
  -- block_ids (for the notification payload).
  SELECT array_agg(assignment_id), count(*)::integer
    INTO v_destination_blocks, v_destinations_locked
  FROM (
    SELECT assignment_id
    FROM shift_block_assignments
    WHERE assignment_id = ANY(p_destination_assignment_ids)
      AND status = 'vacant'
    FOR UPDATE
  ) locked;

  IF v_destinations_locked IS NULL
     OR v_destinations_locked < cardinality(p_destination_assignment_ids) THEN
    -- At least one destination is no longer vacant (concurrent claim,
    -- prior assignment, etc.). Abort with no writes. The caller's
    -- algorithm will re-snapshot on the next tick.
    RETURN jsonb_build_object(
      'assigned', false,
      'reason',   'destination_not_vacant'
    );
  END IF;

  -- Lock the source assignments under the same transaction. We don't
  -- have a strict status filter here because the source rows might be
  -- 'scheduled' (normal case) or 'claimed' (the worker picked up a
  -- shift at their home house and is being floated out of it). Both
  -- are valid pre-float states.
  PERFORM 1
    FROM shift_block_assignments
   WHERE assignment_id = ANY(p_source_assignment_ids)
     AND status IN ('scheduled', 'claimed')
   FOR UPDATE;

  -- Latest destination block start drives the retention boundary.
  SELECT max(sb.block_start_at)
    INTO v_latest_block_start_at
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(p_destination_assignment_ids);

  -- 1. INSERT INTO float_assignments
  INSERT INTO float_assignments (
    user_id,
    source_assignment_ids,
    destination_assignment_ids,
    status,
    initiated_by,
    expires_for_cleanup_at
  )
  VALUES (
    p_worker_id,
    p_source_assignment_ids,
    p_destination_assignment_ids,
    'pending',
    'automated',
    v_latest_block_start_at + (p_retention_days || ' days')::interval
  )
  RETURNING float_id INTO v_float_id;

  -- 2. UPDATE destination → pending_float_in. The destination row IS
  --    the float-in at the non-home desk: is_float = true, and
  --    source_house_id stores the worker's home (= the source house).
  UPDATE shift_block_assignments
  SET user_id         = p_worker_id,
      status          = 'pending_float_in',
      vacancy_origin  = 'none',
      is_float        = true,
      source_house_id = p_source_house_id,
      parent_float_id = v_float_id
  WHERE assignment_id = ANY(p_destination_assignment_ids);

  -- 3. UPDATE source → pending_float_out. C-3: the source row IS the
  --    worker's HOME seat. is_float must be false, source_house_id
  --    must be NULL. parent_float_id links the row to the float for
  --    later reconciliation (no-ack / acknowledge handlers).
  UPDATE shift_block_assignments
  SET status          = 'pending_float_out',
      vacancy_origin  = 'none',
      is_float        = false,
      source_house_id = NULL,
      parent_float_id = v_float_id
  WHERE assignment_id = ANY(p_source_assignment_ids);

  -- 4. INSERT personal_shift notification telling the worker about
  --    their pending float.
  INSERT INTO notifications (
    recipient_user_id,
    type,
    scheduled_for,
    payload
  )
  VALUES (
    p_worker_id,
    'personal_shift',
    p_now,
    jsonb_build_object(
      'kind',                  'float_assigned',
      'float_id',              v_float_id,
      'destination_house_id',  p_destination_house_id,
      'block_ids',
        (SELECT array_agg(block_id ORDER BY block_id)
         FROM shift_block_assignments
         WHERE assignment_id = ANY(p_destination_assignment_ids))
    )
  );

  RETURN jsonb_build_object(
    'assigned', true,
    'float_id', v_float_id
  );
END;
$$;

-- Service-role-only callable. The Edge Function is the sole caller.
REVOKE ALL ON FUNCTION process_float_lookup_assignment(uuid, text, uuid[], uuid[], text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_float_lookup_assignment(uuid, text, uuid[], uuid[], text, timestamptz, integer) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS process_float_lookup_assignment(uuid, text, uuid[], uuid[], text, timestamptz, integer);
