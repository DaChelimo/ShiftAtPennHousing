-- One-sided handoff (BEH §8.5), part 2: relax the span constraints for 'handoff' and
-- teach accept_swap the one-way transfer. Comparisons to the new enum value use
-- `swap_type::text` so this is safe whether or not the migrations share a transaction.

-- 1) Span constraints. A handoff has EXACTLY ONE non-empty span (give-only → initiator
--    span set, counterparty empty/null; take-only → counterparty span set, initiator
--    empty). So both legacy "nonempty" CHECKs must exempt handoff, plus a new XOR CHECK.
ALTER TABLE swap_requests
  DROP CONSTRAINT IF EXISTS swap_requests_initiator_assignment_ids_nonempty,
  DROP CONSTRAINT IF EXISTS swap_requests_temporary_counterparty_assignment_ids_nonempty;

ALTER TABLE swap_requests
  ADD CONSTRAINT swap_requests_initiator_assignment_ids_nonempty
    CHECK (cardinality(initiator_assignment_ids) > 0 OR swap_type::text = 'handoff'),
  ADD CONSTRAINT swap_requests_temporary_counterparty_assignment_ids_nonempty
    CHECK (
      swap_type::text IN ('permanent_swap', 'handoff')
      OR (counterparty_assignment_ids IS NOT NULL AND cardinality(counterparty_assignment_ids) > 0)
    ),
  ADD CONSTRAINT swap_requests_handoff_exactly_one_side
    CHECK (
      swap_type::text <> 'handoff'
      OR (
        (cardinality(initiator_assignment_ids) > 0)
          <> (cardinality(COALESCE(counterparty_assignment_ids, '{}'::uuid[])) > 0)
      )
    );

-- 2) accept_swap: a 'handoff' branch that does a ONE-WAY transfer of the single
--    non-empty span to its receiver, then accepts. ALWAYS cap-exempt (BEH §8.5) — a
--    directed mutual-consent handoff re-attributes hours with no cap re-check, like a
--    float. The counterparty is always the accepting party (it is their shift being
--    taken, or their incoming shift being handed to them). Same FOR UPDATE +
--    pending/expiry/ownership/eligibility backstops as the symmetric path.
CREATE OR REPLACE FUNCTION accept_swap(
  p_swap_id uuid,
  p_accepting_user_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_swap swap_requests%ROWTYPE;
  v_initiator_count integer;
  v_counterparty_count integer;
  v_reason text;
BEGIN
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

  -- §8.5 one-sided handoff: transfer the single non-empty span one way.
  IF v_swap.swap_type::text = 'handoff' THEN
    DECLARE
      v_give boolean := COALESCE(cardinality(v_swap.counterparty_assignment_ids), 0) = 0;
      v_span uuid[] := CASE WHEN v_give THEN v_swap.initiator_assignment_ids ELSE v_swap.counterparty_assignment_ids END;
      v_owner uuid := CASE WHEN v_give THEN v_swap.initiator_user_id ELSE v_swap.counterparty_user_id END;
      v_receiver uuid := CASE WHEN v_give THEN v_swap.counterparty_user_id ELSE v_swap.initiator_user_id END;
      v_span_count integer;
    BEGIN
      -- The span must still be owned by its owner and in a swappable state (same
      -- invalidation backstop as the symmetric path; the seat-vacated trigger also
      -- voids proactively).
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

      -- Receiver eligibility (Harnwell training / float direction) for the transferred
      -- span — swap_acceptance_ineligibility_reason maps each non-empty side to its
      -- receiver, so it covers handoff unchanged.
      v_reason := swap_acceptance_ineligibility_reason(p_swap_id);
      IF v_reason IS NOT NULL THEN
        RETURN jsonb_build_object('accepted', false, 'reason', v_reason);
      END IF;

      UPDATE shift_block_assignments
      SET user_id = v_receiver
      WHERE assignment_id = ANY (v_span);

      UPDATE swap_requests SET status = 'accepted' WHERE swap_id = p_swap_id;
      RETURN jsonb_build_object('accepted', true);
    END;
  END IF;

  -- §8.1/§8.2 invalidation backstop (symmetric swaps): every seat on both sides must
  -- still be owned + swappable.
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
  WHERE assignment_id = ANY (v_swap.initiator_assignment_ids);

  UPDATE shift_block_assignments
  SET user_id = v_swap.initiator_user_id
  WHERE assignment_id = ANY (v_swap.counterparty_assignment_ids);

  IF v_swap.swap_type = 'float_swap' THEN
    UPDATE float_assignments fa
    SET user_id = (
      SELECT sba.user_id
      FROM shift_block_assignments sba
      WHERE sba.assignment_id = ANY (fa.destination_assignment_ids)
      ORDER BY sba.assignment_id
      LIMIT 1
    )
    WHERE fa.destination_assignment_ids && (
      v_swap.initiator_assignment_ids || COALESCE(v_swap.counterparty_assignment_ids, ARRAY[]::uuid[])
    );

    WITH corrected_float_seats AS (
      SELECT DISTINCT
        sba.assignment_id,
        sba.user_id AS corrected_floater_user_id,
        sb.house_id AS destination_house_id
      FROM shift_block_assignments sba
      JOIN shift_blocks sb
        ON sb.block_id = sba.block_id
      WHERE sba.assignment_id = ANY (
          v_swap.initiator_assignment_ids || COALESCE(v_swap.counterparty_assignment_ids, ARRAY[]::uuid[])
        )
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
$$;
