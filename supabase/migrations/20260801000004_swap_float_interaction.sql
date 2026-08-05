-- Migration: swap interaction with a manager-directed float (workstream D;
-- docs/harnwell-pilot/PLAN.md).
--
-- D1. swap_acceptance_ineligibility_reason's 'block_in_pending_float' guard is scoped
-- to initiated_by = 'automated'. Under the directive model a manager float can sit
-- 'pending' indefinitely (there is no decline, no no-ack void -- see the prior
-- migration's B3), which would otherwise make it permanently unswappable. An
-- automated float still needs the same protection it always had, from a racing swap
-- while it is genuinely undecided.
--
-- D2. accept_swap's float branch is rewritten from a single blanket UPDATE (correct
-- only when EVERY destination seat of a float transfers together) to per-float
-- subset detection: a swap touching a STRICT SUBSET of a float's destination seats
-- SPLITS the float_assignments row, one per resulting owner. A swap touching the
-- WHOLE float keeps the original single-row reassignment. Source/destination
-- correspondence is resolved by TIME (matching block_start_at at Harnwell), the same
-- robust approach used for manager_edit_float, not by array index.

CREATE OR REPLACE FUNCTION swap_acceptance_ineligibility_reason(
  p_swap_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text;
BEGIN
  WITH swap AS (
    SELECT sr.*
    FROM swap_requests sr
    WHERE sr.swap_id = p_swap_id
  ),
  transferred AS (
    SELECT
      1 AS side_order,
      s.counterparty_user_id AS receiver_user_id,
      receiver.home_house_id AS receiver_home_house_id,
      sba.assignment_id,
      sb.house_id AS destination_house_id,
      sba.is_float,
      sba.status,
      sba.parent_float_id
    FROM swap s
    JOIN users receiver
      ON receiver.user_id = s.counterparty_user_id
    JOIN shift_block_assignments sba
      ON sba.assignment_id = ANY (s.initiator_assignment_ids)
    JOIN shift_blocks sb
      ON sb.block_id = sba.block_id

    UNION ALL

    SELECT
      2 AS side_order,
      s.initiator_user_id AS receiver_user_id,
      receiver.home_house_id AS receiver_home_house_id,
      sba.assignment_id,
      sb.house_id AS destination_house_id,
      sba.is_float,
      sba.status,
      sba.parent_float_id
    FROM swap s
    JOIN users receiver
      ON receiver.user_id = s.initiator_user_id
    JOIN shift_block_assignments sba
      ON s.counterparty_assignment_ids IS NOT NULL
     AND sba.assignment_id = ANY (s.counterparty_assignment_ids)
    JOIN shift_blocks sb
      ON sb.block_id = sba.block_id
  ),
  violations AS (
    SELECT
      side_order,
      assignment_id,
      CASE
        -- D1 (Harnwell pilot, 2026-08-01): only an AUTOMATED pending float blocks a
        -- swap. A manager-directed (force_triggered) float has no decline and no
        -- no-ack void, so it can sit pending indefinitely -- scoping this guard is
        -- what keeps it swappable per decision 10.
        WHEN EXISTS (
          SELECT 1
          FROM float_assignments fa
          WHERE fa.status = 'pending'
            AND fa.initiated_by = 'automated'
            AND (
              fa.float_id = transferred.parent_float_id
              OR transferred.assignment_id = ANY (fa.source_assignment_ids)
              OR transferred.assignment_id = ANY (fa.destination_assignment_ids)
            )
        )
          THEN 'block_in_pending_float'
        WHEN destination_house_id = 'harnwell'
          AND receiver_home_house_id <> 'harnwell'
          THEN 'harnwell_training_required'
        WHEN is_float = true
          AND destination_house_id <> 'harnwell'
          AND receiver_home_house_id NOT IN ('quad', 'harnwell')
          THEN 'single_staff_cannot_float'
        ELSE NULL
      END AS reason
    FROM transferred
  )
  SELECT reason
    INTO v_reason
  FROM violations
  WHERE reason IS NOT NULL
  ORDER BY side_order, assignment_id
  LIMIT 1;

  IF v_reason IS NOT NULL THEN
    RETURN v_reason;
  END IF;

  SELECT 'float_swap_requires_a_float'
    INTO v_reason
  FROM swap_requests sr
  WHERE sr.swap_id = p_swap_id
    AND sr.swap_type = 'float_swap'
    AND NOT EXISTS (
      SELECT 1
      FROM shift_block_assignments sba
      WHERE sba.assignment_id = ANY (
        sr.initiator_assignment_ids || COALESCE(sr.counterparty_assignment_ids, ARRAY[]::uuid[])
      )
        AND sba.is_float = true
    );

  RETURN v_reason;
END;
$$;

-- D2. accept_swap, float branch replaced. Everything else (concurrency structure,
-- handoff branch, symmetric-swap seat transfer, invalidation backstops) is
-- byte-identical to 20260726000009.
CREATE OR REPLACE FUNCTION public.accept_swap(p_swap_id uuid, p_accepting_user_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_swap swap_requests%ROWTYPE;
  v_initiator_count integer;
  v_counterparty_count integer;
  v_reason text;
  v_transferred integer;
  v_touched_ids uuid[];
  v_fa record;
  v_touched_destination_ids uuid[];
  v_remaining_destination_ids uuid[];
  v_remaining_source_ids uuid[];
  v_touched_source_ids uuid[];
  v_touched_owner uuid;
  v_new_float_id uuid;
  v_dest_house_id text;
BEGIN
  SELECT *
    INTO v_swap
  FROM swap_requests
  WHERE swap_id = p_swap_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'not_pending');
  END IF;

  PERFORM 1
  FROM shift_block_assignments
  WHERE assignment_id = ANY (
      COALESCE(v_swap.initiator_assignment_ids, ARRAY[]::uuid[])
      || COALESCE(v_swap.counterparty_assignment_ids, ARRAY[]::uuid[])
    )
  ORDER BY assignment_id
  FOR UPDATE;

  SELECT *
    INTO v_swap
  FROM swap_requests
  WHERE swap_id = p_swap_id
  FOR UPDATE;

  IF NOT FOUND OR v_swap.status <> 'pending' THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'not_pending');
  END IF;

  IF v_swap.expires_at <= p_now THEN
    UPDATE swap_requests
    SET status = 'expired'
    WHERE swap_id = p_swap_id;
    RETURN jsonb_build_object('accepted', false, 'reason', 'not_pending');
  END IF;

  IF v_swap.swap_type = 'permanent_swap' THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'use_apply_permanent_swap');
  END IF;

  IF p_accepting_user_id <> v_swap.counterparty_user_id THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'not_counterparty');
  END IF;

  IF v_swap.swap_type::text = 'handoff' THEN
    DECLARE
      v_give boolean := COALESCE(cardinality(v_swap.counterparty_assignment_ids), 0) = 0;
      v_span uuid[] := CASE WHEN v_give THEN v_swap.initiator_assignment_ids ELSE v_swap.counterparty_assignment_ids END;
      v_owner uuid := CASE WHEN v_give THEN v_swap.initiator_user_id ELSE v_swap.counterparty_user_id END;
      v_receiver uuid := CASE WHEN v_give THEN v_swap.counterparty_user_id ELSE v_swap.initiator_user_id END;
      v_span_count integer;
    BEGIN
      SELECT COUNT(*)::integer
        INTO v_span_count
      FROM shift_block_assignments
      WHERE assignment_id = ANY (v_span)
        AND user_id = v_owner
        AND status IN ('scheduled', 'claimed', 'floated_in');

      IF v_span_count <> cardinality(v_span) THEN
        UPDATE swap_requests SET status = 'voided' WHERE swap_id = p_swap_id;
        RETURN jsonb_build_object('accepted', false, 'reason', 'span_invalidated');
      END IF;

      v_reason := swap_acceptance_ineligibility_reason(p_swap_id);
      IF v_reason IS NOT NULL THEN
        RETURN jsonb_build_object('accepted', false, 'reason', v_reason);
      END IF;

      UPDATE shift_block_assignments
      SET user_id = v_receiver
      WHERE assignment_id = ANY (v_span)
        AND user_id = v_owner
        AND status IN ('scheduled', 'claimed', 'floated_in');

      GET DIAGNOSTICS v_transferred = ROW_COUNT;

      IF v_transferred <> cardinality(v_span) THEN
        UPDATE swap_requests SET status = 'voided' WHERE swap_id = p_swap_id;
        RETURN jsonb_build_object('accepted', false, 'reason', 'span_invalidated');
      END IF;

      UPDATE swap_requests SET status = 'accepted' WHERE swap_id = p_swap_id;
      RETURN jsonb_build_object('accepted', true);
    END;
  END IF;

  SELECT COUNT(*)::integer
    INTO v_initiator_count
  FROM shift_block_assignments
  WHERE assignment_id = ANY (v_swap.initiator_assignment_ids)
    AND user_id = v_swap.initiator_user_id
    AND status IN ('scheduled', 'claimed', 'floated_in');

  SELECT COUNT(*)::integer
    INTO v_counterparty_count
  FROM shift_block_assignments
  WHERE assignment_id = ANY (v_swap.counterparty_assignment_ids)
    AND user_id = v_swap.counterparty_user_id
    AND status IN ('scheduled', 'claimed', 'floated_in');

  IF v_initiator_count <> cardinality(v_swap.initiator_assignment_ids)
     OR v_counterparty_count <> cardinality(v_swap.counterparty_assignment_ids) THEN
    UPDATE swap_requests
    SET status = 'voided'
    WHERE swap_id = p_swap_id;
    RETURN jsonb_build_object('accepted', false, 'reason', 'span_invalidated');
  END IF;

  v_reason := swap_acceptance_ineligibility_reason(p_swap_id);
  IF v_reason IS NOT NULL THEN
    RETURN jsonb_build_object('accepted', false, 'reason', v_reason);
  END IF;

  UPDATE shift_block_assignments
  SET user_id = v_swap.counterparty_user_id
  WHERE assignment_id = ANY (v_swap.initiator_assignment_ids)
    AND user_id = v_swap.initiator_user_id
    AND status IN ('scheduled', 'claimed', 'floated_in');

  GET DIAGNOSTICS v_transferred = ROW_COUNT;

  IF v_transferred <> cardinality(v_swap.initiator_assignment_ids) THEN
    UPDATE swap_requests SET status = 'voided' WHERE swap_id = p_swap_id;
    RETURN jsonb_build_object('accepted', false, 'reason', 'span_invalidated');
  END IF;

  UPDATE shift_block_assignments
  SET user_id = v_swap.initiator_user_id
  WHERE assignment_id = ANY (v_swap.counterparty_assignment_ids)
    AND user_id = v_swap.counterparty_user_id
    AND status IN ('scheduled', 'claimed', 'floated_in');

  GET DIAGNOSTICS v_transferred = ROW_COUNT;

  IF v_transferred <> cardinality(v_swap.counterparty_assignment_ids) THEN
    RAISE EXCEPTION 'swap_span_invalidated_midflight';
  END IF;

  IF v_swap.swap_type = 'float_swap' THEN
    v_touched_ids := v_swap.initiator_assignment_ids || COALESCE(v_swap.counterparty_assignment_ids, ARRAY[]::uuid[]);

    -- D2: one pass per DISTINCT float row this swap overlaps (a swap could in
    -- principle touch seats from more than one float).
    FOR v_fa IN
      SELECT DISTINCT fa.*
      FROM float_assignments fa
      WHERE fa.destination_assignment_ids && v_touched_ids
    LOOP
      SELECT array_agg(x)
        INTO v_touched_destination_ids
      FROM unnest(v_fa.destination_assignment_ids) AS x
      WHERE x = ANY (v_touched_ids);

      IF cardinality(v_touched_destination_ids) = cardinality(v_fa.destination_assignment_ids) THEN
        -- Whole float transfers together: the existing single-row reassignment.
        UPDATE float_assignments
        SET user_id = (
          SELECT sba.user_id
          FROM shift_block_assignments sba
          WHERE sba.assignment_id = ANY (v_fa.destination_assignment_ids)
          ORDER BY sba.assignment_id
          LIMIT 1
        )
        WHERE float_id = v_fa.float_id;

        CONTINUE;
      END IF;

      -- Strict subset: split the row. Source/destination correspondence by TIME
      -- (same block_start_at, Harnwell vs the float's destination house), not by
      -- array position -- robust regardless of how the arrays were ordered.
      SELECT (array_agg(sb.house_id))[1]
        INTO v_dest_house_id
      FROM shift_block_assignments sba
      JOIN shift_blocks sb ON sb.block_id = sba.block_id
      WHERE sba.assignment_id = ANY (v_fa.destination_assignment_ids);

      SELECT array_agg(sba.assignment_id)
        INTO v_touched_source_ids
      FROM shift_block_assignments sba
      JOIN shift_blocks sb ON sb.block_id = sba.block_id
      WHERE sba.assignment_id = ANY (v_fa.source_assignment_ids)
        AND sb.block_start_at IN (
          SELECT sb2.block_start_at
          FROM shift_block_assignments sba2
          JOIN shift_blocks sb2 ON sb2.block_id = sba2.block_id
          WHERE sba2.assignment_id = ANY (v_touched_destination_ids)
        );

      SELECT array_agg(x)
        INTO v_remaining_destination_ids
      FROM unnest(v_fa.destination_assignment_ids) AS x
      WHERE NOT (x = ANY (v_touched_destination_ids));

      SELECT array_agg(x)
        INTO v_remaining_source_ids
      FROM unnest(v_fa.source_assignment_ids) AS x
      WHERE NOT (x = ANY (COALESCE(v_touched_source_ids, ARRAY[]::uuid[])));

      -- The new owner of the touched destination seats, post-transfer above. A swap
      -- batch that somehow assigns the touched subset to more than one distinct user
      -- is not something the UI constructs; take the lowest-sorting seat's owner,
      -- same convention the pre-split code used for the whole-float case.
      SELECT sba.user_id
        INTO v_touched_owner
      FROM shift_block_assignments sba
      WHERE sba.assignment_id = ANY (v_touched_destination_ids)
      ORDER BY sba.assignment_id
      LIMIT 1;

      INSERT INTO float_assignments (
        user_id, source_assignment_ids, destination_assignment_ids,
        status, initiated_by, force_triggered_by, expires_for_cleanup_at
      )
      VALUES (
        v_touched_owner, COALESCE(v_touched_source_ids, ARRAY[]::uuid[]), v_touched_destination_ids,
        'pending', v_fa.initiated_by, v_fa.force_triggered_by, v_fa.expires_for_cleanup_at
      )
      RETURNING float_id INTO v_new_float_id;

      UPDATE shift_block_assignments
      SET parent_float_id = v_new_float_id
      WHERE assignment_id = ANY (v_touched_destination_ids)
         OR assignment_id = ANY (COALESCE(v_touched_source_ids, ARRAY[]::uuid[]));

      -- The new floater's row starts unacknowledged with a fresh reminder snapshot.
      PERFORM snapshot_float_ack_reminders(
        v_touched_owner, v_touched_destination_ids, v_dest_house_id, v_new_float_id, p_now
      );

      -- The original floater's remaining row keeps whatever ack state it had.
      UPDATE float_assignments
      SET destination_assignment_ids = v_remaining_destination_ids,
          source_assignment_ids      = COALESCE(v_remaining_source_ids, ARRAY[]::uuid[])
      WHERE float_id = v_fa.float_id;
    END LOOP;

    WITH corrected_float_seats AS (
      SELECT DISTINCT
        sba.assignment_id,
        sba.user_id AS corrected_floater_user_id,
        sb.house_id AS destination_house_id
      FROM shift_block_assignments sba
      JOIN shift_blocks sb
        ON sb.block_id = sba.block_id
      WHERE sba.assignment_id = ANY (v_touched_ids)
        AND sba.is_float = true
        AND sba.user_id IS NOT NULL
    )
    INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
    SELECT
      ur.user_id,
      'swap_request'::notification_type,
      p_now,
      jsonb_build_object(
        'swap_id', p_swap_id,
        'assignment_id', cfs.assignment_id,
        'destination_house_id', cfs.destination_house_id,
        'corrected_floater_user_id', cfs.corrected_floater_user_id
      )
    FROM corrected_float_seats cfs
    JOIN user_roles ur
      ON ur.scope_house_id = cfs.destination_house_id
     AND ur.role IN ('sm', 'hm');
  END IF;

  UPDATE swap_requests
  SET status = 'accepted'
  WHERE swap_id = p_swap_id;

  RETURN jsonb_build_object('accepted', true);
END;
$function$;

-- rollback:
-- (re-apply swap_acceptance_ineligibility_reason from 20260530000001, accept_swap from
--  20260726000009)
