-- Migration: editing a manager-directed float (workstream C; docs/harnwell-pilot/PLAN.md).
--
-- manager_edit_float() takes the DESIRED FINAL range and diffs it against the float's
-- current destination blocks server-side, per the plan: "A client sending 'the new
-- range' rather than 'the delta' cannot desynchronise from concurrent claims."
--
-- Destination block <-> source (Harnwell) block correspondence is by TIME, not array
-- position: a float relocates a worker for a given 30-minute slot from Harnwell to the
-- destination house at the SAME block_start_at. That is more robust than assuming the
-- two id arrays are index-aligned (true by construction today, but time-matching needs
-- no such assumption).
--
-- Shrink/cancel reconciliation mirrors reconcile_float_source_release's existing
-- pattern (decline/no-ack): if the vacated Harnwell seat is still open, the floater
-- returns to it; if a third worker claimed it in the meantime, the claimer keeps it
-- (decision 8) and the floater's original row goes to vacant/displaced_decliner so it
-- stays visible as an open seat rather than disappearing. Cancel is shrink-to-zero.

-- retire_manual_float_blocks: UNCONDITIONAL delete of manual_float blocks, used only by
-- the edit path (shrink/cancel intentionally end a float mid-shift, so an occupied
-- destination block IS the thing being retired). ON DELETE CASCADE on
-- shift_block_assignments.block_id removes the seat with it -- no separate cleanup.
CREATE OR REPLACE FUNCTION retire_manual_float_blocks(p_block_ids uuid[])
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
    AND origin = 'manual_float';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION retire_manual_float_blocks(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retire_manual_float_blocks(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION manager_edit_float(
  p_initiator_user_id uuid,
  p_float_id           uuid,
  p_new_range_start    timestamptz DEFAULT NULL,
  p_new_range_end      timestamptz DEFAULT NULL,
  p_now                timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_float               float_assignments%ROWTYPE;
  v_dest_house_id       text;
  v_desired_starts      timestamptz[];
  v_add_starts          timestamptz[];
  v_remove_starts       timestamptz[];
  v_keep_destination_ids uuid[] := ARRAY[]::uuid[];
  v_keep_source_ids      uuid[] := ARRAY[]::uuid[];
  v_new_destination_ids  uuid[];
  v_new_source_ids       uuid[];
  v_lost_hours_count     integer := 0;
  v_gap_assignment_id    uuid;
  v_gap_status           shift_status_enum;
  v_harnwell_block_id    uuid;
  v_dest_block_id        uuid;
  v_start                timestamptz;
  v_floater_source_id     uuid;
  v_floater_dest_id       uuid;
  v_final_status          text;
  v_ack_status            shift_status_enum;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_initiator_user_id THEN
    RAISE EXCEPTION 'cannot edit a float on another manager''s behalf'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_float FROM float_assignments WHERE float_id = p_float_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('edited', false, 'reason', 'not_found');
  END IF;

  IF v_float.initiated_by <> 'force_triggered' THEN
    RAISE EXCEPTION 'only a manager-directed float can be edited this way';
  END IF;

  IF v_float.status NOT IN ('pending', 'acknowledged') THEN
    RETURN jsonb_build_object('edited', false, 'reason', 'float_not_live');
  END IF;

  SELECT (array_agg(sb.house_id))[1]
    INTO v_dest_house_id
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids);

  IF NOT user_can_build_schedule(p_initiator_user_id, 'harnwell') THEN
    RAISE EXCEPTION 'not authorized to edit this float'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_ack_status := CASE WHEN v_float.status = 'acknowledged' THEN 'floated_in' ELSE 'pending_float_in' END;

  IF p_new_range_start IS NULL OR p_new_range_end IS NULL OR p_new_range_end <= p_new_range_start THEN
    v_desired_starts := ARRAY[]::timestamptz[]; -- cancel: shrink to zero
  ELSE
    SELECT array_agg(gs ORDER BY gs)
      INTO v_desired_starts
    FROM generate_series(p_new_range_start, p_new_range_end - interval '30 minutes', interval '30 minutes') AS gs;
  END IF;

  -- Diff against the float's CURRENT destination blocks (by time).
  SELECT array_agg(sb.block_start_at)
    INTO v_add_starts
  FROM unnest(COALESCE(v_desired_starts, ARRAY[]::timestamptz[])) AS gs(block_start_at)
  WHERE NOT EXISTS (
    SELECT 1
    FROM shift_block_assignments sba
    JOIN shift_blocks sb ON sb.block_id = sba.block_id
    WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids)
      AND sb.block_start_at = gs.block_start_at
  );

  SELECT array_agg(sb.block_start_at)
    INTO v_remove_starts
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids)
    AND NOT (sb.block_start_at = ANY(COALESCE(v_desired_starts, ARRAY[]::timestamptz[])));

  -- ---- EXTEND: mint the additional destination seats, reopen the corresponding
  -- Harnwell seats (which fires notify_shift_opened for exactly the newly freed
  -- blocks, per F's span-collapsing behaviour), append to the float's arrays.
  IF COALESCE(cardinality(v_add_starts), 0) > 0 THEN
    SELECT array_agg(sba.assignment_id ORDER BY sb.block_start_at)
      INTO v_new_source_ids
    FROM shift_block_assignments sba
    JOIN shift_blocks sb ON sb.block_id = sba.block_id
    WHERE sba.user_id = v_float.user_id
      AND sb.house_id = 'harnwell'
      AND sb.block_start_at = ANY(v_add_starts)
      AND sba.status IN ('scheduled', 'claimed');

    IF COALESCE(cardinality(v_new_source_ids), 0) <> cardinality(v_add_starts) THEN
      RAISE EXCEPTION 'worker does not hold every block in the extended range at Harnwell';
    END IF;

    v_new_destination_ids := mint_manual_float_blocks(v_dest_house_id, v_add_starts);

    UPDATE shift_block_assignments
    SET user_id = v_float.user_id, status = v_ack_status, vacancy_origin = 'none',
        is_float = true, source_house_id = 'harnwell', parent_float_id = p_float_id
    WHERE assignment_id = ANY(v_new_destination_ids);

    UPDATE shift_block_assignments
    SET status = CASE WHEN v_float.status = 'acknowledged' THEN 'floated_out' ELSE 'pending_float_out' END,
        vacancy_origin = 'none', is_float = false, source_house_id = NULL, parent_float_id = p_float_id
    WHERE assignment_id = ANY(v_new_source_ids);

    -- F: fires notify_shift_opened for exactly these newly-freed Harnwell blocks.
    PERFORM reopen_float_source_seats(v_new_source_ids, p_float_id);
  END IF;

  -- ---- SHRINK / CANCEL: for each removed block, claim-wins reconciliation on the
  -- Harnwell side, then retire the now-empty destination block.
  IF COALESCE(cardinality(v_remove_starts), 0) > 0 THEN
    FOREACH v_start IN ARRAY v_remove_starts LOOP
      SELECT sba.assignment_id, sb.block_id
        INTO v_floater_dest_id, v_dest_block_id
      FROM shift_block_assignments sba
      JOIN shift_blocks sb ON sb.block_id = sba.block_id
      WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids)
        AND sb.block_start_at = v_start;

      SELECT sba.assignment_id, sb.block_id
        INTO v_floater_source_id, v_harnwell_block_id
      FROM shift_block_assignments sba
      JOIN shift_blocks sb ON sb.block_id = sba.block_id
      WHERE sba.assignment_id = ANY(v_float.source_assignment_ids)
        AND sb.house_id = 'harnwell'
        AND sb.block_start_at = v_start;

      -- The gap seat reopen_float_source_seats may have created at this block, for
      -- this float, distinct from the floater's own (now pending_float_out) row.
      SELECT assignment_id, status
        INTO v_gap_assignment_id, v_gap_status
      FROM shift_block_assignments
      WHERE block_id = v_harnwell_block_id
        AND parent_float_id = p_float_id
        AND assignment_id <> v_floater_source_id
      LIMIT 1
      FOR UPDATE;

      IF v_floater_source_id IS NOT NULL THEN
        IF v_gap_assignment_id IS NULL OR v_gap_status = 'vacant' THEN
          -- Decision 8, no-conflict branch: the seat is still open, the worker
          -- returns to it. Mirrors reconcile_float_source_release's own convention
          -- of resuming as 'scheduled' -- the original scheduled/claimed distinction
          -- is not preserved by force_trigger_float either.
          UPDATE shift_block_assignments
          SET status = 'scheduled', vacancy_origin = 'none', is_float = false,
              source_house_id = NULL, parent_float_id = NULL
          WHERE assignment_id = v_floater_source_id;

          IF v_gap_assignment_id IS NOT NULL THEN
            DELETE FROM shift_block_assignments WHERE assignment_id = v_gap_assignment_id;
          END IF;
        ELSE
          -- Decision 8, conflict branch: the claimer keeps the seat. The floater's
          -- original row goes vacant/displaced (visible again for pickup) rather than
          -- being silently deleted, and loses those hours.
          UPDATE shift_block_assignments
          SET user_id = NULL, status = 'vacant', vacancy_origin = 'displaced_decliner',
              is_float = false, source_house_id = NULL, parent_float_id = NULL
          WHERE assignment_id = v_floater_source_id;
          v_lost_hours_count := v_lost_hours_count + 1;
        END IF;
      END IF;

      IF v_dest_block_id IS NOT NULL THEN
        PERFORM retire_manual_float_blocks(ARRAY[v_dest_block_id]);
      END IF;
    END LOOP;
  END IF;

  -- The float's live remaining span, for the array update below.
  SELECT array_agg(sba.assignment_id ORDER BY sb.block_start_at)
    INTO v_keep_destination_ids
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids)
    AND sb.block_start_at = ANY(COALESCE(v_desired_starts, ARRAY[]::timestamptz[]));

  SELECT array_agg(sba.assignment_id ORDER BY sb.block_start_at)
    INTO v_keep_source_ids
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.source_assignment_ids)
    AND sb.house_id = 'harnwell'
    AND sb.block_start_at = ANY(COALESCE(v_desired_starts, ARRAY[]::timestamptz[]));

  v_keep_destination_ids := COALESCE(v_keep_destination_ids, ARRAY[]::uuid[]) || COALESCE(v_new_destination_ids, ARRAY[]::uuid[]);
  v_keep_source_ids := COALESCE(v_keep_source_ids, ARRAY[]::uuid[]) || COALESCE(v_new_source_ids, ARRAY[]::uuid[]);

  IF cardinality(v_keep_destination_ids) = 0 THEN
    -- Cancel. float_assignments requires nonempty arrays (CHECK constraint), so the
    -- arrays are left as the float's last live span -- a historical record, exactly
    -- like decline_float and process_no_ack_float leave theirs. status is the only
    -- thing that changes, and every downstream read already keys liveness off status.
    UPDATE float_assignments SET status = 'voided' WHERE float_id = p_float_id;
    v_final_status := 'voided';
  ELSE
    UPDATE float_assignments
    SET destination_assignment_ids = v_keep_destination_ids,
        source_assignment_ids      = v_keep_source_ids
    WHERE float_id = p_float_id;
    v_final_status := v_float.status::text;
  END IF;

  -- Decision 8: the worker must be told hours vanished, or they silently disappear
  -- from their calendar. One notification per edit call, span-collapsed.
  IF v_lost_hours_count > 0 THEN
    INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
    VALUES (
      v_float.user_id, 'personal_shift', p_now,
      jsonb_build_object(
        'kind', 'float_shrunk_hours_lost', 'float_id', p_float_id,
        'blocks_lost', v_lost_hours_count
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'edited', true,
    'float_id', p_float_id,
    'status', v_final_status,
    'blocks_added', COALESCE(cardinality(v_add_starts), 0),
    'blocks_removed', COALESCE(cardinality(v_remove_starts), 0),
    'blocks_lost_to_claim', v_lost_hours_count
  );
END;
$$;

REVOKE ALL ON FUNCTION manager_edit_float(uuid, uuid, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION manager_edit_float(uuid, uuid, timestamptz, timestamptz, timestamptz)
  TO authenticated, service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS manager_edit_float(uuid, uuid, timestamptz, timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS retire_manual_float_blocks(uuid[]);
