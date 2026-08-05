-- Migration: manager-directed float (workstreams B, F; docs/harnwell-pilot/PLAN.md).
--
-- B1. Destination blocks are materialised on demand. shift_blocks.origin distinguishes a
-- normally-generated block from one minted purely to host a manager float, so nothing
-- downstream (season reconciliation, escalation, open-shifts) mistakes it for a staffed
-- block. mint_manual_float_blocks() is the single place that creates or reuses one.
--
-- B2. manager_float_worker() is the entry point: validate the initiator, mint the
-- destination seats, then hand off to force_trigger_float() for everything else
-- (source validation, seat reopen, ack-reminder snapshot, notification) so that logic
-- is not duplicated. Runs as one transaction: any failure raises, which rolls back the
-- mint alongside it.
--
-- B3. Directive semantics: a manager float has no decline path and no no-ack void/
-- Allied fallback. Both process_no_ack_float's discovery query and decline_float are
-- scoped to initiated_by = 'automated' so a force_triggered (manager) float is simply
-- never selected for either. The 6h/2h ack reminders are untouched -- they still fire
-- via the unmodified snapshot_float_ack_reminders() call inside force_trigger_float.
--
-- F. notify_shift_opened is called from reopen_float_source_seats, once per float
-- (span-collapsing), for the Harnwell seat a float frees up.

-- ---------------------------------------------------------------------------
-- B1. shift_blocks.origin
-- ---------------------------------------------------------------------------

ALTER TABLE shift_blocks
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'generated'
    CHECK (origin IN ('generated', 'manual_float'));

COMMENT ON COLUMN shift_blocks.origin IS
  'generated: produced by the normal calendar/season block generator. manual_float: '
  'minted on demand by mint_manual_float_blocks() to host a manager-directed float '
  'destination seat (docs/harnwell-pilot/PLAN.md workstream B1). A manual_float block '
  'always carries required_headcount = 1 satisfied by the single float seat, so it is '
  'never vacant and never enters escalation or the open-shifts feed. Season reconcile '
  '(reconcile_config_blocks) and publish must skip these blocks.';

-- mint_manual_float_blocks: mint or reuse the vacant destination seat for each
-- requested block_start_at at a house, in order. UNIQUE(house_id, block_start_at)
-- means minting is INSERT ... ON CONFLICT DO NOTHING; a block that already exists
-- (e.g. an earlier call for the same float, or an extend) is reused rather than
-- re-minted, and its single vacant seat is reused rather than duplicated.
CREATE OR REPLACE FUNCTION mint_manual_float_blocks(
  p_house_id text,
  p_block_starts timestamptz[]
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_block_start   timestamptz;
  v_block_id      uuid;
  v_block_origin  text;
  v_assignment_id uuid;
  v_result        uuid[] := ARRAY[]::uuid[];
BEGIN
  FOREACH v_block_start IN ARRAY p_block_starts LOOP
    INSERT INTO shift_blocks (house_id, block_start_at, required_headcount, origin)
    VALUES (p_house_id, v_block_start, 1, 'manual_float')
    ON CONFLICT (house_id, block_start_at) DO NOTHING;

    SELECT block_id, origin
      INTO v_block_id, v_block_origin
    FROM shift_blocks
    WHERE house_id = p_house_id AND block_start_at = v_block_start;

    IF v_block_origin <> 'manual_float' THEN
      RAISE EXCEPTION
        'block % at % is a real staffed block, not a pilot float destination',
        p_house_id, v_block_start
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT assignment_id
      INTO v_assignment_id
    FROM shift_block_assignments
    WHERE block_id = v_block_id AND status = 'vacant'
    LIMIT 1;

    IF v_assignment_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM shift_block_assignments WHERE block_id = v_block_id) THEN
        RAISE EXCEPTION
          'manual float destination block % is already occupied', v_block_id
          USING ERRCODE = 'check_violation';
      END IF;

      INSERT INTO shift_block_assignments (block_id, status, vacancy_origin)
      VALUES (v_block_id, 'vacant', 'never_assigned')
      RETURNING assignment_id INTO v_assignment_id;
    END IF;

    v_result := v_result || v_assignment_id;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION mint_manual_float_blocks(text, timestamptz[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mint_manual_float_blocks(text, timestamptz[]) TO service_role;

-- delete_manual_float_blocks: the inverse, used by shrink/cancel (workstream C). Only
-- ever deletes a block that is manual_float AND has no remaining occupant -- callers
-- are expected to have already vacated/relocated the seat.
CREATE OR REPLACE FUNCTION delete_manual_float_blocks(p_block_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM shift_blocks
  WHERE block_id = ANY(p_block_ids)
    AND origin = 'manual_float'
    AND NOT EXISTS (
      SELECT 1 FROM shift_block_assignments sba
      WHERE sba.block_id = shift_blocks.block_id
        AND sba.status <> 'vacant'
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION delete_manual_float_blocks(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_manual_float_blocks(uuid[]) TO service_role;

-- ---------------------------------------------------------------------------
-- B1 risk closed: season reconcile must skip manual_float blocks. Re-CREATE OR REPLACE
-- with a single added predicate; everything else is byte-identical to
-- 20260709000004_break_compiler_apply.sql.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reconcile_config_blocks(p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now               timestamptz := app_now();
  v_gen                record;
  v_blk                record;
  v_target              integer;
  v_current             integer;
  c_blocks_generated    integer := 0;
  c_blocks_voided       integer := 0;
  c_blocks_headcount_up integer := 0;
  c_workers_cancelled   integer := 0;
BEGIN
  SELECT * INTO v_gen FROM generate_blocks_for_range(p_start, p_end);
  c_blocks_generated := COALESCE(v_gen.blocks_inserted, 0);

  FOR v_blk IN
    SELECT sb.block_id, sb.house_id, sb.block_start_at, sb.required_headcount, sb.voided_at
    FROM shift_blocks sb
    WHERE sb.block_start_at > v_now
      AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN p_start AND p_end
      -- Harnwell pilot (workstream B1): a manually-minted float destination is not
      -- subject to season reconciliation. It has no staffing_patterns row (its house
      -- is dark), so season_target_headcount would read 0 and void it out from under
      -- an in-progress float. It is created and retired only by the manager-float
      -- RPCs, never by the season compiler.
      AND sb.origin = 'generated'
  LOOP
    v_target := season_target_headcount(v_blk.house_id, v_blk.block_start_at);

    IF v_target = 0 THEN
      IF v_blk.voided_at IS NULL THEN
        SELECT count(*)::integer INTO v_current
        FROM shift_block_assignments
        WHERE block_id = v_blk.block_id
          AND status NOT IN ('vacant', 'cancelled_config');

        IF v_current > 0 THEN
          c_workers_cancelled := c_workers_cancelled + v_current;
        END IF;

        UPDATE shift_block_assignments
        SET status = 'cancelled_config'
        WHERE block_id = v_blk.block_id
          AND status NOT IN ('vacant', 'cancelled_config');

        DELETE FROM shift_block_assignments
        WHERE block_id = v_blk.block_id
          AND status = 'vacant';

        UPDATE shift_blocks SET voided_at = v_now WHERE block_id = v_blk.block_id;
        c_blocks_voided := c_blocks_voided + 1;
      END IF;
    ELSIF v_target > v_blk.required_headcount THEN
      UPDATE shift_blocks SET required_headcount = v_target WHERE block_id = v_blk.block_id;

      INSERT INTO shift_block_assignments (block_id, status, vacancy_origin)
      SELECT v_blk.block_id, 'vacant', 'never_assigned'
      FROM generate_series(1, v_target - v_blk.required_headcount);

      c_blocks_headcount_up := c_blocks_headcount_up + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'blocks_generated', c_blocks_generated,
    'blocks_voided', c_blocks_voided,
    'blocks_headcount_increased', c_blocks_headcount_up,
    'workers_cancelled', c_workers_cancelled
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- B2. manager_float_worker
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION manager_float_worker(
  p_initiator_user_id  uuid,
  p_worker_id          uuid,
  p_destination_house_id text,
  p_range_start        timestamptz,
  p_range_end          timestamptz,
  p_now                timestamptz DEFAULT now(),
  p_retention_days     integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_block_starts               timestamptz[];
  v_destination_assignment_ids uuid[];
  v_source_assignment_ids      uuid[];
  v_result                     jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_initiator_user_id THEN
    RAISE EXCEPTION 'cannot float a worker on another manager''s behalf'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- B4: same gate as the schedule builder and calendar override editor.
  IF NOT user_can_build_schedule(p_initiator_user_id, 'harnwell') THEN
    RAISE EXCEPTION 'not authorized to float a Harnwell worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Harnwell is never a float destination (AGENTS "Float direction rules", hardcoded,
  -- never trusted from a client-supplied house id).
  IF p_destination_house_id = 'harnwell' THEN
    RAISE EXCEPTION 'harnwell can never be a manager-float destination'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM houses WHERE id = p_destination_house_id) THEN
    RAISE EXCEPTION 'unknown destination house %', p_destination_house_id;
  END IF;

  -- Hard invariant #1 in the outbound direction: only a home-Harnwell worker may be
  -- manager-floated in this pilot (the pilot has no other house's workers on the app).
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE user_id = p_worker_id AND home_house_id = 'harnwell'
  ) THEN
    RAISE EXCEPTION 'only a home-Harnwell worker may be manager-floated in the pilot';
  END IF;

  IF p_range_end <= p_range_start THEN
    RAISE EXCEPTION 'float range must be non-empty';
  END IF;

  SELECT array_agg(gs ORDER BY gs)
    INTO v_block_starts
  FROM generate_series(p_range_start, p_range_end - interval '30 minutes', interval '30 minutes') AS gs;

  -- Source side: the worker must already hold every one of these Harnwell blocks.
  -- manager_float_worker floats an existing shift; it does not create one.
  SELECT array_agg(sba.assignment_id ORDER BY sb.block_start_at)
    INTO v_source_assignment_ids
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.user_id = p_worker_id
    AND sb.house_id = 'harnwell'
    AND sb.block_start_at = ANY(v_block_starts)
    AND sba.status IN ('scheduled', 'claimed');

  IF COALESCE(cardinality(v_source_assignment_ids), 0) <> cardinality(v_block_starts) THEN
    RAISE EXCEPTION 'worker does not hold every block in the requested range at Harnwell';
  END IF;

  -- B1: mint the destination seats.
  v_destination_assignment_ids := mint_manual_float_blocks(p_destination_house_id, v_block_starts);

  -- B2: everything else -- TOCTOU-guarded validation, seat writes, source-seat reopen
  -- (F), ack-reminder snapshot, personal notification -- is force_trigger_float's
  -- existing, unmodified body. initiated_by = 'force_triggered' /
  -- force_triggered_by = the acting manager falls out of that call for free.
  v_result := force_trigger_float(
    p_initiator_user_id, p_worker_id, 'harnwell',
    v_source_assignment_ids, v_destination_assignment_ids, p_destination_house_id,
    p_now, p_retention_days
  );

  IF (v_result ->> 'assigned') IS DISTINCT FROM 'true' THEN
    -- Raising rolls back the mint alongside the failed float, per B2 "one transaction."
    RAISE EXCEPTION 'manager float failed: %', COALESCE(v_result ->> 'reason', 'unknown');
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION manager_float_worker(uuid, uuid, text, timestamptz, timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION manager_float_worker(uuid, uuid, text, timestamptz, timestamptz, timestamptz, integer)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- B3. Directive semantics -- no decline, no no-ack void, no Allied fallback for a
-- manager-directed (force_triggered) float. Automated floats are untouched: both
-- guards below scope to initiated_by = 'automated', which is exactly what an
-- automated float always is.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pending_floats_due_for_no_ack(
  p_now timestamptz,
  p_lookahead_minutes integer
)
RETURNS TABLE (
  float_id uuid,
  earliest_destination_start timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fa.float_id,
    min(sb.block_start_at) AS earliest_destination_start
  FROM float_assignments fa
  JOIN shift_block_assignments sba
    ON sba.assignment_id = ANY (fa.destination_assignment_ids)
  JOIN shift_blocks sb
    ON sb.block_id = sba.block_id
  WHERE fa.status = 'pending'
    AND fa.acknowledged_at IS NULL
    AND fa.declined_at IS NULL
    -- Harnwell pilot B3: a manager-directed float is a directive, not a proposal --
    -- it has no no-ack void and no terminal Allied escalation (procuring Allied would
    -- pull in the other houses' RSMs, exactly the cross-house coordination the pilot
    -- exists to avoid). Automated floats are unaffected.
    AND fa.initiated_by = 'automated'
  GROUP BY fa.float_id
  HAVING min(sb.block_start_at) <= p_now + make_interval(mins => p_lookahead_minutes);
$$;

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

  -- Harnwell pilot B3: a manager float is a directive. Acknowledgement is a read
  -- receipt, not consent -- there is no decline path.
  IF v_float.initiated_by = 'force_triggered' THEN
    RETURN jsonb_build_object('declined', false, 'reason', 'directive_cannot_be_declined');
  END IF;

  SELECT min(sb.block_start_at),
         max(sb.block_start_at) + interval '30 minutes',
         (array_agg(sb.house_id ORDER BY sb.block_start_at))[1]
    INTO v_float_start_at, v_float_end_at, v_destination_house_id
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids);

  UPDATE float_assignments
  SET status      = 'declined',
      declined_at = p_now
  WHERE float_id = p_float_id;

  UPDATE shift_block_assignments
  SET user_id         = NULL,
      status          = 'vacant',
      vacancy_origin  = 'temporary_drop',
      is_float        = false,
      source_house_id = NULL,
      parent_float_id = NULL
  WHERE assignment_id = ANY(v_float.destination_assignment_ids);

  IF v_float_start_at IS NOT NULL AND v_destination_house_id IS NOT NULL THEN
    INSERT INTO float_exclusions (
      user_id, window_start_at, window_end_at, destination_house_id, reason
    )
    VALUES (
      v_float.user_id, v_float_start_at, v_float_end_at, v_destination_house_id, 'declined'
    );
  END IF;

  IF v_float.initiated_by = 'force_triggered' THEN
    UPDATE block_step_status
    SET status = 'rolled_back', updated_at = p_now
    WHERE block_id IN (
      SELECT block_id FROM shift_block_assignments
      WHERE assignment_id = ANY(v_float.destination_assignment_ids)
    )
      AND step_name IN ('broadcast', 'float_lookup');
  END IF;

  PERFORM reconcile_float_source_release(p_float_id);

  RETURN jsonb_build_object('declined', true, 'float_id', p_float_id);
END;
$$;

REVOKE ALL ON FUNCTION decline_float(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decline_float(uuid, uuid, timestamptz) TO service_role;

COMMENT ON FUNCTION process_no_ack_float(uuid, timestamptz, integer) IS
  'Voids an unacknowledged float and escalates to Allied. As of the Harnwell pilot '
  '(2026-08-01) the discovery query pending_floats_due_for_no_ack scopes candidates to '
  'initiated_by = ''automated'', so a manager-directed float is never discovered here. '
  'This body is otherwise unchanged; it is not itself re-scoped because a direct call '
  'with a force_triggered float''s id is inert in practice (never produced by the only '
  'caller, processNoAckFloats) and keeping the body identical to its prior versions '
  'avoids duplicating the whole no-ack/reconciliation logic a second time.';

-- ---------------------------------------------------------------------------
-- F. Notification on the freed Harnwell seat. reopen_float_source_seats already runs
-- once per float (not per block); call notify_shift_opened exactly when it actually
-- created a reopened gap seat, span-collapsed across the whole float.
-- ---------------------------------------------------------------------------

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
  v_src_block_id   uuid;
  v_required       integer;
  v_remaining      integer;
  v_created        integer := 0;
  v_new_assignment uuid;
  v_reopened_block_ids uuid[] := ARRAY[]::uuid[];
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
      )
      RETURNING assignment_id INTO v_new_assignment;
      v_created := v_created + 1;
      v_reopened_block_ids := v_reopened_block_ids || v_src_block_id;
    END IF;
  END LOOP;

  -- F (decision 6): "a shift opened" push for the freed Harnwell seat(s), once per
  -- float rather than once per block -- matches drop_shift's own span-collapsing call
  -- site. notify_shift_opened already resolves recipients correctly, including hard
  -- invariant #1 (only home-Harnwell workers hear about a Harnwell seat), since the
  -- reopened blocks are always at Harnwell (the float's own source house).
  IF cardinality(v_reopened_block_ids) > 0 THEN
    DECLARE
      v_house_id  text;
      v_min_start timestamptz;
      v_max_start timestamptz;
      v_min_block uuid;
      v_locked    boolean;
    BEGIN
      SELECT sb.house_id, min(sb.block_start_at), max(sb.block_start_at)
        INTO v_house_id, v_min_start, v_max_start
      FROM shift_blocks sb
      WHERE sb.block_id = ANY(v_reopened_block_ids);

      SELECT sb.block_id, sb.coverage_locked_at IS NOT NULL
        INTO v_min_block, v_locked
      FROM shift_blocks sb
      WHERE sb.block_id = ANY(v_reopened_block_ids)
      ORDER BY sb.block_start_at
      LIMIT 1;

      IF NOT COALESCE(v_locked, true) THEN
        PERFORM notify_shift_opened(
          v_house_id, v_min_block, v_min_start, v_max_start + interval '30 minutes',
          NULL, now(), false
        );
      END IF;
    END;
  END IF;

  RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION reopen_float_source_seats(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reopen_float_source_seats(uuid[], uuid) TO service_role;

-- rollback:
-- (re-apply reopen_float_source_seats, decline_float, pending_floats_due_for_no_ack,
--  reconcile_config_blocks from their prior migrations; DROP FUNCTION
--  manager_float_worker, delete_manual_float_blocks, mint_manual_float_blocks;
--  ALTER TABLE shift_blocks DROP COLUMN origin.)
