-- Migration: coverage-lock and float writes stop trusting stale snapshots
-- (concurrency audit 2026-07-26, findings F4, F5, F6).
--
-- F4 -- THE ONE-WAY LOCK WAS STAMPED ON DESKS THAT WERE NO LONGER EMPTY.
-- orchestrator-tick reads desk_covered ONCE per tick (orchestrator_vacant_seats), then
-- walks the rows making per-block round trips; the last block in a large window is
-- processed seconds after that snapshot. lock_block_coverage was then called
-- unconditionally, in its own transaction, and consulted NOTHING -- it trusted a boolean
-- read seconds earlier by a different transaction.
--
-- So an SM staffing an empty desk at T-2h (admin_assign_worker is gated on block_started,
-- NOT on T-2h) raced the tick and lost: the desk got its ONE-WAY coverage lock anyway,
-- permanently un-picking every remaining vacant seat on a desk that now had a real worker
-- on it -- precisely the bug 20260627000001 was written to eliminate, reintroduced
-- through the snapshot gap rather than through the predicate. Same window, same tick:
-- a worker was floated out of their home house, or paid Allied coverage was secured, for
-- a desk that was already staffed. Neither is automatically revocable -- invariant #3
-- (no-takeback) forbids it -- so both need a manual SM/HM override to unwind.
--
-- The fix keeps the decision where the data is: lock_block_coverage now evaluates
-- coverage ITSELF, under a row lock on the block's seats, and returns whether the desk
-- is still empty. The orchestrator asks instead of asserting, and skips the securing step
-- when the answer is no. §5.5 is unchanged: the lock is still stamped exactly when a
-- securing step fires on an empty desk, still one-way, still never at broadcast.
--
-- The guard uses the ESCALATION present-set (INCLUDING 'allied'), not
-- block_has_present_worker, which excludes it. AGENTS.md is explicit that the two
-- present-sets must not be collapsed: escalation counts Allied as present (stop
-- escalating a desk Allied already covers), while the pickup lock does not (a
-- secured-Allied window stays locked and is never reopened to pickup). So this adds a
-- SECOND helper rather than widening the existing one.
--
-- F5 / F6 -- see the inline comments on the two float writers below.

-- ---------------------------------------------------------------------------
-- 1. The escalation present-set as a callable predicate.
--    Mirrors orchestrator_vacant_seats.desk_covered and PRESENT_STATUSES in
--    supabase/functions/orchestrator-tick/floatLookup.ts. Deliberately SEPARATE from
--    block_has_present_worker, which must keep excluding 'allied' for claimability.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION block_has_escalation_coverage(p_block_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM shift_block_assignments
    WHERE block_id = p_block_id
      AND status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in', 'allied')
  );
$$;

REVOKE ALL ON FUNCTION block_has_escalation_coverage(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION block_has_escalation_coverage(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION block_has_escalation_coverage(uuid) TO service_role;

COMMENT ON FUNCTION block_has_escalation_coverage(uuid) IS
  'BSpec §5.4 coverage floor: is anything holding this desk, INCLUDING paid Allied '
  'cover? This is the ESCALATION present-set. Do NOT use it for claimability -- that is '
  'block_has_present_worker, which excludes ''allied'' on purpose (§5.5: a '
  'secured-Allied window stays locked and is never reopened to pickup).';

-- ---------------------------------------------------------------------------
-- 2. lock_block_coverage: atomic check-and-lock, and it now ANSWERS.
--    Return type changes void -> boolean, so this is a DROP + CREATE.
--      true  = desk is still empty; the caller should proceed with securing.
--      false = someone is on the desk; the caller must abort the step.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS lock_block_coverage(uuid, timestamptz);

CREATE FUNCTION lock_block_coverage(
  p_block_id uuid,
  p_as_of timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_covered boolean;
BEGIN
  -- Lock the block's seats first. Without this the presence test below and the stamp
  -- that follows are two statements with two snapshots, and a claim / admin assignment
  -- / swap acceptance committing between them is invisible -- which is the whole bug.
  -- Locking the SEATS (not the shift_blocks row) is what actually serialises against
  -- those writers, since they mutate seats and never touch shift_blocks.
  PERFORM 1
  FROM shift_block_assignments
  WHERE block_id = p_block_id
  ORDER BY assignment_id
  FOR UPDATE;

  v_covered := block_has_escalation_coverage(p_block_id);

  IF v_covered THEN
    -- The desk got staffed between the orchestrator's scan and this call. Do NOT stamp
    -- the one-way lock, and tell the caller to stand down.
    RETURN false;
  END IF;

  -- Empty desk at a securing step: stamp the one-way marker (§5.5). Still idempotent --
  -- re-firing keeps the original lock time - and still never called from broadcast.
  UPDATE shift_blocks
  SET coverage_locked_at = p_as_of
  WHERE block_id = p_block_id
    AND coverage_locked_at IS NULL;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION lock_block_coverage(uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION lock_block_coverage(uuid, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION lock_block_coverage(uuid, timestamptz) TO service_role;

COMMENT ON FUNCTION lock_block_coverage(uuid, timestamptz) IS
  'BSpec §5.4/§5.5 one-way coverage lock, now an atomic check-and-lock (audit F4). '
  'Locks the block''s seats, re-evaluates the ESCALATION present-set, and stamps '
  'coverage_locked_at only if the desk is genuinely empty. Returns false when the desk '
  'was staffed between the orchestrator''s scan and this call, which means the caller '
  'must ABORT its securing step: firing it would float a worker or buy Allied hours for '
  'a covered desk, neither of which no-takeback (#3) lets an automated system undo.';

-- -------------------------------------------------------------------------
-- 3. process_float_lookup_assignment: ordered lock, competing-float and
--    source-floor guards (F5, F6).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_float_lookup_assignment(p_worker_id uuid, p_source_house_id text, p_source_assignment_ids uuid[], p_destination_assignment_ids uuid[], p_destination_house_id text, p_now timestamp with time zone, p_retention_days integer DEFAULT 14)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_float_id              uuid;
  v_latest_block_start_at timestamptz;
  v_destination_blocks    uuid[];
  v_destinations_locked   integer;
  v_sources_locked        integer;
  v_competing_pending     integer;
  v_starved_sources       integer;
BEGIN
  -- ===================================================================
  -- Concurrency prelude (audit F5 + F6). Lock EVERY seat on EVERY block this call
  -- touches -- destination blocks AND source blocks -- in one statement ordered by
  -- assignment_id.
  --
  -- Why all seats and not just the named ones: the two guards below are BLOCK-level
  -- questions ("is another float already inbound to this desk?", "will this source desk
  -- still have someone on it?"). Locking only the named rows leaves their siblings free
  -- to change underneath, which is exactly how both guards were being defeated.
  --
  -- Why one ordered statement: the original code locked destinations, then sources, in
  -- call order. Two floats whose destination and source sets overlap in opposite
  -- directions could each hold what the other wanted. A single ascending-assignment_id
  -- acquisition removes that cycle.
  -- ===================================================================
  PERFORM 1
  FROM shift_block_assignments
  WHERE block_id IN (
      SELECT block_id
      FROM shift_block_assignments
      WHERE assignment_id = ANY (
          COALESCE(p_destination_assignment_ids, ARRAY[]::uuid[])
          || COALESCE(p_source_assignment_ids, ARRAY[]::uuid[])
        )
    )
  ORDER BY assignment_id
  FOR UPDATE;

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

  -- Audit F5: no competing float may already be inbound to a destination BLOCK.
  -- force_trigger_float always had this guard but ran it as an UNLOCKED count, so the
  -- automated path's uncommitted pending_float_in was invisible and both floats
  -- committed -- two workers pulled out of their home houses to cover one desk that
  -- needed one, neither revocable, because invariant #3 (no-takeback) forbids an
  -- automated system from undoing either. process_float_lookup_assignment never had the
  -- guard at all; it does now, so the check is symmetric no matter which path runs
  -- first. Both read under the prelude lock above.
  SELECT count(*)::integer
    INTO v_competing_pending
  FROM shift_block_assignments
  WHERE status = 'pending_float_in'
    AND NOT (assignment_id = ANY (COALESCE(p_destination_assignment_ids, ARRAY[]::uuid[])))
    AND block_id IN (
      SELECT block_id
      FROM shift_block_assignments
      WHERE assignment_id = ANY (COALESCE(p_destination_assignment_ids, ARRAY[]::uuid[]))
    );

  IF v_competing_pending > 0 THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'destination_has_pending_float_in');
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

  -- Audit F6: hard invariant #2 -- a source desk NEVER drops below one present worker --
  -- enforced at the WRITE POINT, which is what AGENTS.md requires ("enforce in code at
  -- every assignment write point, not only in config tables"). Until now it lived only
  -- in the pure TypeScript algorithm (sourceHasFloor) and the orchestrator's
  -- sourceCanSpare pre-filter, both reading an unlocked snapshot. Two floats pulling
  -- from the same 2-worker desk therefore each saw "2 present, can spare 1" and both
  -- committed, emptying the source desk outright -- which then escalated as its own
  -- empty desk and cascaded further floats.
  --
  -- Evaluated under the prelude lock, counting who remains AFTER this call takes its
  -- sources. Note it counts the pickup-lock present-set (real workers only): 'allied'
  -- is paid external cover, not a worker who can hold the desk, so it must not satisfy
  -- the floor.
  SELECT count(*)::integer
    INTO v_starved_sources
  FROM (
    SELECT DISTINCT block_id
    FROM shift_block_assignments
    WHERE assignment_id = ANY (COALESCE(p_source_assignment_ids, ARRAY[]::uuid[]))
  ) src
  WHERE NOT EXISTS (
    SELECT 1
    FROM shift_block_assignments remaining
    WHERE remaining.block_id = src.block_id
      AND remaining.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
      AND NOT (remaining.assignment_id = ANY (COALESCE(p_source_assignment_ids, ARRAY[]::uuid[])))
  );

  IF v_starved_sources > 0 THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'source_floor_violated');
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
$function$;

-- -------------------------------------------------------------------------
-- 4. force_trigger_float: the same three, so manual and automated floats
--    cannot defeat each other's guards (F5, F6).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.force_trigger_float(p_initiator_user_id uuid, p_worker_id uuid, p_source_house_id text, p_source_assignment_ids uuid[], p_destination_assignment_ids uuid[], p_destination_house_id text, p_now timestamp with time zone DEFAULT now(), p_retention_days integer DEFAULT 14)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_float_id              uuid;
  v_latest_block_start_at timestamptz;
  v_destinations_locked   integer;
  v_sources_locked        integer;
  v_competing_pending     integer;
  v_starved_sources       integer;
BEGIN
  -- ===================================================================
  -- Concurrency prelude (audit F5 + F6). Lock EVERY seat on EVERY block this call
  -- touches -- destination blocks AND source blocks -- in one statement ordered by
  -- assignment_id.
  --
  -- Why all seats and not just the named ones: the two guards below are BLOCK-level
  -- questions ("is another float already inbound to this desk?", "will this source desk
  -- still have someone on it?"). Locking only the named rows leaves their siblings free
  -- to change underneath, which is exactly how both guards were being defeated.
  --
  -- Why one ordered statement: the original code locked destinations, then sources, in
  -- call order. Two floats whose destination and source sets overlap in opposite
  -- directions could each hold what the other wanted. A single ascending-assignment_id
  -- acquisition removes that cycle.
  -- ===================================================================
  PERFORM 1
  FROM shift_block_assignments
  WHERE block_id IN (
      SELECT block_id
      FROM shift_block_assignments
      WHERE assignment_id = ANY (
          COALESCE(p_destination_assignment_ids, ARRAY[]::uuid[])
          || COALESCE(p_source_assignment_ids, ARRAY[]::uuid[])
        )
    )
  ORDER BY assignment_id
  FOR UPDATE;

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
  -- Audit F5: no competing float may already be inbound to a destination BLOCK.
  -- force_trigger_float always had this guard but ran it as an UNLOCKED count, so the
  -- automated path's uncommitted pending_float_in was invisible and both floats
  -- committed -- two workers pulled out of their home houses to cover one desk that
  -- needed one, neither revocable, because invariant #3 (no-takeback) forbids an
  -- automated system from undoing either. process_float_lookup_assignment never had the
  -- guard at all; it does now, so the check is symmetric no matter which path runs
  -- first. Both read under the prelude lock above.
  SELECT count(*)::integer
    INTO v_competing_pending
  FROM shift_block_assignments
  WHERE status = 'pending_float_in'
    AND NOT (assignment_id = ANY (COALESCE(p_destination_assignment_ids, ARRAY[]::uuid[])))
    AND block_id IN (
      SELECT block_id
      FROM shift_block_assignments
      WHERE assignment_id = ANY (COALESCE(p_destination_assignment_ids, ARRAY[]::uuid[]))
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

  -- Audit F6: hard invariant #2 -- a source desk NEVER drops below one present worker --
  -- enforced at the WRITE POINT, which is what AGENTS.md requires ("enforce in code at
  -- every assignment write point, not only in config tables"). Until now it lived only
  -- in the pure TypeScript algorithm (sourceHasFloor) and the orchestrator's
  -- sourceCanSpare pre-filter, both reading an unlocked snapshot. Two floats pulling
  -- from the same 2-worker desk therefore each saw "2 present, can spare 1" and both
  -- committed, emptying the source desk outright -- which then escalated as its own
  -- empty desk and cascaded further floats.
  --
  -- Evaluated under the prelude lock, counting who remains AFTER this call takes its
  -- sources. Note it counts the pickup-lock present-set (real workers only): 'allied'
  -- is paid external cover, not a worker who can hold the desk, so it must not satisfy
  -- the floor.
  SELECT count(*)::integer
    INTO v_starved_sources
  FROM (
    SELECT DISTINCT block_id
    FROM shift_block_assignments
    WHERE assignment_id = ANY (COALESCE(p_source_assignment_ids, ARRAY[]::uuid[]))
  ) src
  WHERE NOT EXISTS (
    SELECT 1
    FROM shift_block_assignments remaining
    WHERE remaining.block_id = src.block_id
      AND remaining.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
      AND NOT (remaining.assignment_id = ANY (COALESCE(p_source_assignment_ids, ARRAY[]::uuid[])))
  );

  IF v_starved_sources > 0 THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'source_floor_violated');
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
$function$;


-- rollback:
-- DROP FUNCTION IF EXISTS lock_block_coverage(uuid, timestamptz);
-- CREATE FUNCTION lock_block_coverage(uuid, timestamptz) RETURNS void ... (20260627000001)
-- DROP FUNCTION IF EXISTS block_has_escalation_coverage(uuid);
-- (restore process_float_lookup_assignment + force_trigger_float from 20260623000002)
