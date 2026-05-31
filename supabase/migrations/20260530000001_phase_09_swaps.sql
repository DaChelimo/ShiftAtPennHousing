-- Migration: Phase 09 swaps.
-- Adds swap_requests, expiry, and atomic acceptance RPCs.

DO $$
BEGIN
  CREATE TYPE swap_type_enum AS ENUM ('shift_swap', 'float_swap', 'permanent_swap');
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE swap_status_enum AS ENUM ('pending', 'accepted', 'rejected', 'expired', 'voided');
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS swap_requests (
  swap_id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_type                   swap_type_enum NOT NULL,
  initiator_user_id           uuid NOT NULL REFERENCES users(user_id),
  counterparty_user_id        uuid NOT NULL REFERENCES users(user_id),
  initiator_assignment_ids    uuid[] NOT NULL,
  counterparty_assignment_ids uuid[],
  recurring_pattern           jsonb,
  status                      swap_status_enum NOT NULL DEFAULT 'pending',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  expires_at                  timestamptz NOT NULL,
  CONSTRAINT swap_requests_initiator_assignment_ids_nonempty
    CHECK (cardinality(initiator_assignment_ids) > 0),
  CONSTRAINT swap_requests_temporary_counterparty_assignment_ids_nonempty
    CHECK (
      swap_type = 'permanent_swap'
      OR (
        counterparty_assignment_ids IS NOT NULL
        AND cardinality(counterparty_assignment_ids) > 0
      )
    ),
  CONSTRAINT swap_requests_parties_distinct
    CHECK (initiator_user_id <> counterparty_user_id)
);

CREATE INDEX IF NOT EXISTS swap_requests_status_expires_at_idx
  ON swap_requests (status, expires_at);

CREATE INDEX IF NOT EXISTS swap_requests_initiator_user_id_idx
  ON swap_requests (initiator_user_id);

CREATE INDEX IF NOT EXISTS swap_requests_counterparty_user_id_idx
  ON swap_requests (counterparty_user_id);

CREATE INDEX IF NOT EXISTS swap_requests_initiator_assignment_ids_gin_idx
  ON swap_requests USING gin (initiator_assignment_ids);

CREATE INDEX IF NOT EXISTS swap_requests_counterparty_assignment_ids_gin_idx
  ON swap_requests USING gin (counterparty_assignment_ids);

CREATE OR REPLACE FUNCTION enforce_swap_request_assignment_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missing_assignment_id uuid;
BEGIN
  SELECT candidate.assignment_id
    INTO v_missing_assignment_id
  FROM unnest(NEW.initiator_assignment_ids) AS candidate(assignment_id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM shift_block_assignments sba
    WHERE sba.assignment_id = candidate.assignment_id
  )
  LIMIT 1;

  IF v_missing_assignment_id IS NOT NULL THEN
    RAISE EXCEPTION 'initiator assignment id % does not exist', v_missing_assignment_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.counterparty_assignment_ids IS NOT NULL THEN
    SELECT candidate.assignment_id
      INTO v_missing_assignment_id
    FROM unnest(NEW.counterparty_assignment_ids) AS candidate(assignment_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM shift_block_assignments sba
      WHERE sba.assignment_id = candidate.assignment_id
    )
    LIMIT 1;

    IF v_missing_assignment_id IS NOT NULL THEN
      RAISE EXCEPTION 'counterparty assignment id % does not exist', v_missing_assignment_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS swap_requests_enforce_assignment_ids ON swap_requests;
CREATE TRIGGER swap_requests_enforce_assignment_ids
  BEFORE INSERT OR UPDATE OF initiator_assignment_ids, counterparty_assignment_ids ON swap_requests
  FOR EACH ROW
  EXECUTE FUNCTION enforce_swap_request_assignment_ids();

ALTER TABLE swap_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service-role bypass" ON swap_requests;
CREATE POLICY "service-role bypass" ON swap_requests
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "users can select own swap requests" ON swap_requests;
CREATE POLICY "users can select own swap requests" ON swap_requests
  FOR SELECT
  TO authenticated
  USING (initiator_user_id = auth.uid() OR counterparty_user_id = auth.uid());

DROP POLICY IF EXISTS "builders can select house-related swap requests" ON swap_requests;
CREATE POLICY "builders can select house-related swap requests" ON swap_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM unnest(
        initiator_assignment_ids || COALESCE(counterparty_assignment_ids, ARRAY[]::uuid[])
      ) AS related(assignment_id)
      JOIN shift_block_assignments sba
        ON sba.assignment_id = related.assignment_id
      JOIN shift_blocks sb
        ON sb.block_id = sba.block_id
      WHERE user_can_build_schedule(auth.uid(), sb.house_id)
    )
  );

CREATE OR REPLACE FUNCTION expire_pending_swaps(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired integer;
BEGIN
  UPDATE swap_requests
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at <= p_now;

  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END;
$$;

-- §8.1/§8.2 proactive invalidation. When a seat referenced by a PENDING swap is
-- dropped (-> vacant) or floated out from under its owner (-> pending_float_out
-- / floated_out) by ANY write path — temporary/permanent drop, automated or
-- force-triggered float, no-ack void, decline-displace — the pending swap is
-- silently voided. The Phase 5/7/8 float/drop RPCs predate swap_requests and
-- never voided touching swaps; a single trigger on the shared seat table covers
-- them all (current and future), with accept_swap's span-check as the backstop.
--
-- Keyed on a status TRANSITION into a "seat no longer cleanly owned" state, so
-- accept_swap's / apply_permanent_swap's own user_id-only transfer (status
-- unchanged) never self-voids the swap being accepted. 'floated_in' is
-- deliberately excluded: it is the legitimate active-float state a float swap
-- (§8.2) is built on, and a swap seat can only reach pending_float_in/floated_in
-- by first passing through vacant (which already voids the swap here).
CREATE OR REPLACE FUNCTION void_pending_swaps_for_vacated_seat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('vacant', 'pending_float_out', 'floated_out') THEN
    UPDATE swap_requests
    SET status = 'voided'
    WHERE status = 'pending'
      AND (
        initiator_assignment_ids @> ARRAY[NEW.assignment_id]
        OR COALESCE(counterparty_assignment_ids, ARRAY[]::uuid[]) @> ARRAY[NEW.assignment_id]
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shift_block_assignments_void_pending_swaps ON shift_block_assignments;
CREATE TRIGGER shift_block_assignments_void_pending_swaps
  AFTER UPDATE OF status ON shift_block_assignments
  FOR EACH ROW
  EXECUTE FUNCTION void_pending_swaps_for_vacated_seat();

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
        WHEN status IN ('pending_float_in', 'pending_float_out')
          OR EXISTS (
            SELECT 1
            FROM float_assignments fa
            WHERE fa.status = 'pending'
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

  -- §8.1/§8.2 invalidation backstop: a span is still acceptable only if every
  -- seat is in a swappable-OWNED state ('scheduled', 'claimed', or an active
  -- 'floated_in' for float swaps). A seat that was dropped (-> vacant) or
  -- floated out from under its owner (-> pending_float_out / floated_out) before
  -- acceptance fails this count and silently voids the swap. (The
  -- shift_block_assignments trigger normally voids such a swap proactively the
  -- moment the seat changes; this is the defense-in-depth re-check at accept.)
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

CREATE OR REPLACE FUNCTION apply_permanent_swap(
  p_swap_id uuid,
  p_new_owner_user_id uuid,
  p_affected_assignment_ids uuid[],
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_swap swap_requests%ROWTYPE;
  v_transferred_count integer;
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

  IF v_swap.swap_type <> 'permanent_swap' THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'not_permanent_swap');
  END IF;

  IF p_new_owner_user_id <> v_swap.counterparty_user_id THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'not_counterparty');
  END IF;

  -- §8.3: permanent swaps apply ONLY to regular_school_year (SM-built) slots.
  -- Short/winter break shifts are claim-based and individually owned, so they
  -- have no recurring relationship to swap. Any affected assignment whose
  -- operating date is not regular_school_year is silently skipped here — the
  -- acceptance-time backstop that mirrors the `user_id = initiator` ownership
  -- predicate and the create-swap pre-creation guard. A block with no
  -- operating_calendar mapping fails the EXISTS check and is likewise skipped.
  UPDATE shift_block_assignments AS target
  SET user_id = p_new_owner_user_id
  WHERE target.assignment_id = ANY (p_affected_assignment_ids)
    AND target.user_id = v_swap.initiator_user_id
    AND EXISTS (
      SELECT 1
      FROM shift_blocks sb
      JOIN operating_calendar oc
        ON oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
      WHERE sb.block_id = target.block_id
        AND oc.profile_name = 'regular_school_year'
    );

  GET DIAGNOSTICS v_transferred_count = ROW_COUNT;

  UPDATE swap_requests
  SET status = 'accepted'
  WHERE swap_id = p_swap_id;

  RETURN jsonb_build_object(
    'accepted', true,
    'transferred_count', v_transferred_count
  );
END;
$$;

-- Pre-creation guard helper for permanent swaps (BSpec §8.3). Returns the subset
-- of the given assignments whose operating date is NOT regular_school_year —
-- i.e. claim-based short/winter break shifts that cannot be permanently swapped
-- (workers use a temporary shift swap for those). An empty result means every
-- assignment is permanently swappable. Assignments that do not exist, or whose
-- date has no operating_calendar mapping, are reported as outside (fail-closed),
-- so create-swap rejects a permanent_swap it cannot confirm is regular-year.
CREATE OR REPLACE FUNCTION assignments_outside_regular_school_year(
  p_assignment_ids uuid[]
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(candidate.assignment_id ORDER BY candidate.assignment_id),
    ARRAY[]::uuid[]
  )
  FROM unnest(p_assignment_ids) AS candidate(assignment_id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM shift_block_assignments sba
    JOIN shift_blocks sb
      ON sb.block_id = sba.block_id
    JOIN operating_calendar oc
      ON oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
    WHERE sba.assignment_id = candidate.assignment_id
      AND oc.profile_name = 'regular_school_year'
  );
$$;

GRANT EXECUTE ON FUNCTION expire_pending_swaps(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION accept_swap(uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION apply_permanent_swap(uuid, uuid, uuid[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION assignments_outside_regular_school_year(uuid[]) TO service_role;

DO $do$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    IF to_regprocedure('cron.unschedule(text)') IS NOT NULL THEN
      BEGIN
        PERFORM cron.unschedule('swap-expiry');
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END IF;

    PERFORM cron.schedule(
      'swap-expiry',
      '* * * * *',
      $$UPDATE swap_requests SET status='expired' WHERE status='pending' AND expires_at <= now()$$
    );
  END IF;
EXCEPTION
  WHEN invalid_schema_name OR undefined_function THEN
    NULL;
END;
$do$;
