-- Migration: compare-and-swap + row locking on every user-facing SEAT write
-- (concurrency audit 2026-07-26, findings F1, F2, F3, F8, F10).
--
-- THE SHARED BUG. Five functions read "is this seat still free / still mine?" and then
-- wrote to it as two separate steps with no row lock in between, and in three of them
-- the write carried NO predicate at all:
--
--   drop_shift            checked ownership, then vacated `WHERE assignment_id = ANY(...)`
--   accept_swap           counted the span, then transferred `WHERE assignment_id = ANY(...)`
--   admin_assign_worker   picked a seat with an unlocked DISTINCT ON, then wrote it blind
--
-- Under READ COMMITTED two sessions both pass the check before either commits, and the
-- second write silently overwrites the first. Nothing catches it: shift_block_assignments
-- has no UNIQUE or EXCLUDE constraint (20260726000010 adds one), and
-- enforce_block_occupied_headcount only counts OCCUPIED seats -- every one of these races
-- keeps that count constant, because they are ownership swaps, not duplications. So the
-- losing side received HTTP 200 and kept a shift the server had already given away.
--
-- The functions that DO lock (claim_open_shift's seat pick, permanent_pickup_slot,
-- claim_break_blocks' seat pick, process_float_lookup_assignment, force_trigger_float)
-- are untouched here and were already correct; this brings their neighbours in line.
--
-- LOCK ORDER, fixed globally so these paths cannot deadlock each other:
--     users  ->  shift_block_assignments (ascending assignment_id)  ->  swap_requests
-- accept_swap and apply_permanent_swap previously took swap_requests FIRST, which
-- inverted against drop_shift -> void_pending_swaps_for_vacated_seat trigger ->
-- swap_requests. accept_swap now pre-reads the swap unlocked purely to learn its id
-- arrays, locks the seats, then locks and re-reads the swap row authoritatively.
--
-- F8 is a different shape and is fixed differently: the seat pick was already race-safe
-- between different workers, but a single worker's own time-conflict and hours-cap checks
-- were unlocked, so one person double-tapping could book two desks in the same block.
-- Locking the claimer's users row serialises that without any cross-worker contention.
--
-- Bodies below are the LIVE definitions with only the documented changes applied; the
-- generator asserts each anchor matched exactly once, so no unrelated logic moved.

-- -------------------------------------------------------------------------
-- F1 -- drop_shift: lock the span, then compare-and-swap the vacate.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drop_shift(p_assignment_ids uuid[], p_user_id uuid, p_as_of timestamp with time zone DEFAULT now())
 RETURNS TABLE(dropped_assignment_ids uuid[], short_notice_warning boolean, direct_hmod_notification boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_min_start timestamptz;
  v_max_start timestamptz;
  v_expected_count integer;
  v_short_notice boolean;
  v_direct_hmod boolean;
  v_now_boundary timestamptz;
  v_below_headcount boolean;
  v_vacated_count integer;
BEGIN
  IF p_assignment_ids IS NULL OR array_length(p_assignment_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty_drop';
  END IF;

  -- Concurrency (audit F1). Lock the named seats BEFORE the ownership check.
  -- Previously the ownership SELECT and the vacate UPDATE straddled an unprotected
  -- window and the UPDATE carried NO predicate at all, so a claim or a swap
  -- acceptance that landed inside that window was silently overwritten (the claimer
  -- kept a 200 OK and a phantom shift). Ordering by assignment_id keeps two
  -- concurrent multi-block drops from deadlocking each other, and taking the seat
  -- locks here -- before any swap_requests row -- matches the order the
  -- void_pending_swaps_for_vacated_seat trigger and accept_swap now use.
  PERFORM 1
  FROM shift_block_assignments
  WHERE assignment_id = ANY (p_assignment_ids)
  ORDER BY assignment_id
  FOR UPDATE;

  SELECT
    COUNT(*)::integer,
    MIN(sb.block_start_at),
    MAX(sb.block_start_at)
  INTO v_count, v_min_start, v_max_start
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.assignment_id = ANY (p_assignment_ids)
    AND sba.user_id = p_user_id
    AND sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in',
                       'floated_out', 'pending_float_out');

  IF v_count <> array_length(p_assignment_ids, 1) THEN
    RAISE EXCEPTION 'drop_not_owned';
  END IF;

  -- F-05-005: cannot drop a block that starts before the current 30-minute
  -- boundary (its time has already begun/passed — no vacating history).
  v_now_boundary := to_timestamp(floor(extract(epoch FROM p_as_of) / 1800) * 1800);
  IF v_min_start < v_now_boundary THEN
    RAISE EXCEPTION 'drop_past_block';
  END IF;

  v_expected_count := (
    EXTRACT(EPOCH FROM (v_max_start - v_min_start)) / (30 * 60)
  )::integer + 1;

  IF v_expected_count <> v_count THEN
    RAISE EXCEPTION 'drop_not_contiguous';
  END IF;

  v_short_notice := v_min_start <= p_as_of + interval '20 minutes';

  -- F-05-006: would the drop leave any affected block below required headcount?
  -- Count seats where a worker is physically present, excluding the dropped rows.
  WITH affected AS (
    SELECT DISTINCT sb.block_id, sb.required_headcount
    FROM shift_block_assignments sba
    JOIN shift_blocks sb USING (block_id)
    WHERE sba.assignment_id = ANY (p_assignment_ids)
  )
  SELECT bool_or(
    (SELECT count(*)
       FROM shift_block_assignments x
      WHERE x.block_id = affected.block_id
        AND x.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
        AND NOT (x.assignment_id = ANY (p_assignment_ids))
    ) < affected.required_headcount
  )
  INTO v_below_headcount
  FROM affected;

  v_direct_hmod := COALESCE(v_below_headcount, false)
                   AND v_min_start <= p_as_of + interval '2 hours';

  -- Vacate: reset the FULL non-home column set (is_float included) so an
  -- is_float / cross-house row does not violate source_house_required_when_non_home.
  UPDATE shift_block_assignments
  SET status = 'vacant',
      vacancy_origin = 'temporary_drop',
      user_id = NULL,
      is_float = false,
      is_cross_house_pickup = false,
      source_house_id = NULL,
      parent_float_id = NULL,
      dropped_by_user_id = p_user_id,
      dropped_at = now()
  WHERE assignment_id = ANY (p_assignment_ids)
    -- Compare-and-swap (audit F1): re-assert the ownership predicate the check above
    -- used. Defence in depth behind the row lock -- a seat that changed hands is a
    -- no-op here rather than an overwrite.
    AND user_id = p_user_id
    AND status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in',
                   'floated_out', 'pending_float_out');

  GET DIAGNOSTICS v_vacated_count = ROW_COUNT;

  -- A partially-vacated contiguous span is worse than a rejected drop, so fail the
  -- whole call (the transaction rolls back) rather than return a half-applied drop.
  IF v_vacated_count <> array_length(p_assignment_ids, 1) THEN
    RAISE EXCEPTION 'drop_not_owned';
  END IF;

  RETURN QUERY SELECT p_assignment_ids, v_short_notice, v_direct_hmod;
END;
$function$;

-- -------------------------------------------------------------------------
-- F2 -- accept_swap: seats before the swap row; CAS both transfer legs.
-- -------------------------------------------------------------------------
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
BEGIN
  -- Concurrency (audit F2). Two-phase read so seat locks are taken BEFORE the
  -- swap_requests lock. drop_shift (and the void-pending-swaps trigger it fires)
  -- takes seats-then-swap; locking swap-then-seats here was a lock-order inversion
  -- that deadlocked a drop racing an accept. The unlocked pre-read only supplies the
  -- id arrays, which are immutable after creation; the authoritative re-read below
  -- happens under FOR UPDATE and every validation runs off that.
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

      -- Compare-and-swap (audit F2): the transfer used to carry no predicate, so a
      -- competing accept or an admin reassignment that landed between the count above
      -- and this write was silently overwritten and BOTH counterparties were told the
      -- seat was theirs. The predicates make a stolen seat a no-op; the row-count
      -- assertion turns that no-op into span_invalidated instead of a false success.
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

  -- Compare-and-swap on BOTH legs (audit F2), same rationale as the handoff branch.
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
    -- Roll the whole acceptance back: a one-sided symmetric swap would leave the
    -- initiator holding both spans.
    RAISE EXCEPTION 'swap_span_invalidated_midflight';
  END IF;

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
$function$;

-- -------------------------------------------------------------------------
-- F10 -- apply_permanent_swap: seats first, and skip float-committed seats.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_permanent_swap(p_swap_id uuid, p_new_owner_user_id uuid, p_affected_assignment_ids uuid[], p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_swap swap_requests%ROWTYPE;
  v_transferred_count integer;
BEGIN
  -- Concurrency (audit F10). Seats before the swap row, matching accept_swap and the
  -- drop/void-trigger path, so the three cannot deadlock. The affected ids arrive as
  -- a parameter, so no pre-read is needed here.
  PERFORM 1
  FROM shift_block_assignments
  WHERE assignment_id = ANY (COALESCE(p_affected_assignment_ids, ARRAY[]::uuid[]))
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
    -- Audit F10: the ownership predicate alone let a seat mid-float through, because
    -- pending_float_out / floated_out RETAIN user_id. Transferring one rewrote the
    -- owner while float_assignments still named the old worker, and the float's
    -- decline / no-ack reconciliation then restored that old worker -- silently
    -- reversing the accepted swap for that week. Mirror permanent_drop_slot and act
    -- only on cleanly-held seats.
    AND target.status IN ('scheduled', 'claimed')
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
$function$;

-- -------------------------------------------------------------------------
-- F3 -- admin_assign_worker: LATERAL LIMIT 1 FOR UPDATE seat pick, both scopes.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_assign_worker(p_operator_user_id uuid, p_block_ids uuid[], p_user_id uuid, p_scope text, p_override_advisories boolean, p_now timestamp with time zone, p_incumbent_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_block_house_id text;
  v_distinct_houses integer;
  v_worker record;
  v_cap record;
  v_target_block_ids uuid[];
  v_day_of_week integer;
  v_block_start_locals text[];
  v_incumbent_user_id uuid;
  v_has_started boolean;
  v_has_float boolean;
  v_has_unassignable boolean;
  v_has_cannot boolean;
  v_advisories jsonb := '[]'::jsonb;
  v_assigned_count integer := 0;
BEGIN
  IF p_block_ids IS NULL OR array_length(p_block_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty_block_set';
  END IF;

  IF p_scope NOT IN ('this_week', 'permanent') THEN
    RAISE EXCEPTION 'invalid_scope';
  END IF;

  -- The clicked seats must all belong to ONE house (the per-house calendar).
  SELECT COUNT(DISTINCT sb.house_id), MIN(sb.house_id)
    INTO v_distinct_houses, v_block_house_id
  FROM shift_blocks sb
  WHERE sb.block_id = ANY (p_block_ids);

  IF v_distinct_houses IS NULL OR v_distinct_houses = 0 THEN
    RAISE EXCEPTION 'block_not_found';
  END IF;
  IF v_distinct_houses <> 1 THEN
    RAISE EXCEPTION 'cross_house_not_supported';
  END IF;

  -- Authz (D7): operator holds sm/hm/bm scoped to the block's house.
  IF NOT user_can_build_schedule(p_operator_user_id, v_block_house_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Target worker.
  SELECT user_id, home_house_id, is_active
    INTO v_worker
  FROM users
  WHERE user_id = p_user_id;

  IF NOT FOUND OR v_worker.is_active = false THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  -- Same-house override only (S1 OUT — cross-house = pickup/float semantics).
  IF v_worker.home_house_id <> v_block_house_id THEN
    RAISE EXCEPTION 'cross_house_not_supported';
  END IF;

  -- Resolve the seat set for the scope.
  IF p_scope = 'this_week' THEN
    v_target_block_ids := p_block_ids;
  ELSE
    -- permanent (D5): derive the slot (house, NY-DOW, NY local time-of-day) from
    -- the clicked blocks; act on every occurrence with block_start_at > now,
    -- <= semester end_date, profile_name='regular_school_year'.
    SELECT
      EXTRACT(DOW FROM MIN(sb.block_start_at) AT TIME ZONE 'America/New_York')::integer,
      array_agg(DISTINCT TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI'))
      INTO v_day_of_week, v_block_start_locals
    FROM shift_blocks sb
    WHERE sb.block_id = ANY (p_block_ids);

    SELECT array_agg(sb.block_id)
      INTO v_target_block_ids
    FROM shift_blocks sb
    JOIN scheduling_periods sp
      ON (sb.block_start_at AT TIME ZONE 'America/New_York')::date
         BETWEEN sp.start_date AND sp.end_date
     AND sp.profile_name = 'regular_school_year'
    JOIN operating_calendar oc
      ON oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
     AND oc.profile_name = 'regular_school_year'
    WHERE sb.house_id = v_block_house_id
      AND EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York') = v_day_of_week
      AND TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI') = ANY (v_block_start_locals)
      AND sb.block_start_at > p_now;

    IF v_target_block_ids IS NULL THEN
      RAISE EXCEPTION 'block_started'; -- no future in-semester occurrences remain
    END IF;
  END IF;

  -- ---- Hard-block evaluation over the clicked occurrence's seats ----------
  -- These per-seat checks apply to the THIS_WEEK target seat. For PERMANENT the
  -- clicked block is only the slot descriptor (D5): the current/started occurrence
  -- is expected and simply skipped, future occurrences are filtered into
  -- v_target_block_ids (+ permanent_pickup_slot/permanent_drop_slot only touch
  -- vacant/permanent_drop and skip floats), and the no-future-occurrence case
  -- already raised block_started above.
  IF p_scope = 'this_week' THEN

  -- block_started: any clicked seat at/after its start (D1 — edits never run after start).
  SELECT bool_or(sb.block_start_at <= p_now)
    INTO v_has_started
  FROM shift_blocks sb
  WHERE sb.block_id = ANY (p_block_ids);
  IF COALESCE(v_has_started, false) THEN
    RAISE EXCEPTION 'block_started';
  END IF;

  -- float_committed: any clicked seat in a float-committed status (S1 OUT).
  SELECT bool_or(sba.status IN ('floated_in', 'floated_out', 'pending_float_in', 'pending_float_out'))
    INTO v_has_float
  FROM shift_block_assignments sba
  WHERE sba.block_id = ANY (p_block_ids);
  IF COALESCE(v_has_float, false) THEN
    RAISE EXCEPTION 'float_committed';
  END IF;

  -- When REPLACE targets a specific incumbent, every clicked block must actually
  -- hold a removable (scheduled / claimed) seat for that worker — otherwise the
  -- operator is acting on a stale card.
  IF p_incumbent_user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM (SELECT DISTINCT sb.block_id FROM shift_blocks sb WHERE sb.block_id = ANY (p_block_ids)) clicked
      WHERE NOT EXISTS (
        SELECT 1
        FROM shift_block_assignments sba
        WHERE sba.block_id = clicked.block_id
          AND sba.user_id = p_incumbent_user_id
          AND sba.status IN ('scheduled', 'claimed')
      )
    ) THEN
      RAISE EXCEPTION 'not_occupied_by_worker';
    END IF;
  ELSE
    -- seat_not_assignable: every clicked seat must be fillable (vacant) or a
    -- reassignable occupied non-float seat (scheduled / claimed). A block with no
    -- assignable seat (e.g. fully allied, or no vacant/occupied-non-float row) blocks.
    SELECT bool_or(blk.assignable_seats = 0)
      INTO v_has_unassignable
    FROM (
      SELECT
        sb.block_id,
        COUNT(*) FILTER (
          WHERE sba.status IN ('vacant', 'scheduled', 'claimed')
        ) AS assignable_seats
      FROM shift_blocks sb
      LEFT JOIN shift_block_assignments sba ON sba.block_id = sb.block_id
      WHERE sb.block_id = ANY (p_block_ids)
      GROUP BY sb.block_id
    ) blk;
    IF COALESCE(v_has_unassignable, false) THEN
      RAISE EXCEPTION 'seat_not_assignable';
    END IF;
  END IF;

  END IF; -- this_week per-clicked-seat checks

  -- hard cap (D2/D9): absolute, NOT overridable even with p_override_advisories.
  SELECT * INTO v_cap FROM admin_override_cap_assessment(p_user_id, v_target_block_ids);
  IF v_cap.over_hard THEN
    RAISE EXCEPTION 'hard_cap_exceeded';
  END IF;

  -- ---- Soft advisories (overridable via 2-step confirm) -------------------
  -- cannot: the worker marked 'cannot' on a clicked block in the current period.
  SELECT bool_or(true)
    INTO v_has_cannot
  FROM preferences pref
  JOIN scheduling_periods sp ON sp.period_id = pref.period_id
  JOIN shift_blocks sb ON sb.block_id = pref.block_id
  WHERE pref.user_id = p_user_id
    AND pref.block_id = ANY (p_block_ids)
    AND pref.status = 'cannot'
    AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN sp.start_date AND sp.end_date;
  IF COALESCE(v_has_cannot, false) THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'cannot'));
  END IF;

  -- opted_out: period_targets.opted_out for the worker in the clicked occurrence's period.
  IF EXISTS (
    SELECT 1
    FROM period_targets pt
    JOIN scheduling_periods sp ON sp.period_id = pt.period_id
    JOIN shift_blocks sb ON sb.block_id = ANY (p_block_ids)
    WHERE pt.user_id = p_user_id
      AND pt.opted_out = true
      AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN sp.start_date AND sp.end_date
  ) THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'opted_out'));
  END IF;

  -- soft_cap.
  IF v_cap.over_soft THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'soft_cap'));
  END IF;

  -- over_target: projected hours beyond the worker's submitted target.
  IF EXISTS (
    SELECT 1
    FROM period_targets pt
    JOIN scheduling_periods sp ON sp.period_id = pt.period_id
    JOIN shift_blocks sb ON sb.block_id = ANY (p_block_ids)
    WHERE pt.user_id = p_user_id
      AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN sp.start_date AND sp.end_date
      AND (
        (
          SELECT COUNT(*)::numeric * 0.5
          FROM shift_block_assignments ex
          JOIN shift_blocks exb USING (block_id)
          WHERE ex.user_id = p_user_id
            AND ex.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
            AND date_trunc('week', exb.block_start_at AT TIME ZONE 'America/New_York')::date
                = date_trunc('week', sb.block_start_at AT TIME ZONE 'America/New_York')::date
            AND NOT (ex.block_id = ANY (p_block_ids))
        )
        + (array_length(p_block_ids, 1)::numeric * 0.5)
      ) > pt.target_hours
  ) THEN
    v_advisories := v_advisories || jsonb_build_array(jsonb_build_object('kind', 'over_target'));
  END IF;

  -- Soft-confirm gate: advisories present + flag not set ⇒ NO write, signal confirm.
  IF jsonb_array_length(v_advisories) > 0 AND p_override_advisories = false THEN
    RETURN jsonb_build_object('needs_confirm', true, 'advisories', v_advisories);
  END IF;

  -- ---- Write -------------------------------------------------------------
  IF p_scope = 'this_week' THEN
    -- Fill each seat with one row per block. When an incumbent is named (REPLACE),
    -- overwrite THAT worker's seat; otherwise prefer a vacant seat, else the first
    -- reassignable occupied non-float seat.
    -- Concurrency (audit F3). The seat pick used to be an UNLOCKED DISTINCT ON and
    -- the UPDATE re-checked nothing, so two admins assigning different workers to the
    -- same block both selected the same lowest assignment_id and the second silently
    -- overwrote the first -- while both were told assigned_count = 1. The same window
    -- let an admin write land on top of a worker's just-committed claim, leaving the
    -- worker with a 200 OK and a seat that is no longer theirs.
    --
    -- DISTINCT ON cannot carry a lock ("FOR UPDATE is not allowed with DISTINCT
    -- clause"), so this is the LATERAL LIMIT 1 pattern already used by
    -- permanent_pickup_slot (20260724000005) and claim_open_shift.
    --
    -- SKIP LOCKED, not plain FOR UPDATE. Plain FOR UPDATE does NOT fix the two-admin
    -- collision: the blocked session wakes, re-checks the row, finds it now 'claimed'
    -- (still inside this predicate, because reassigning an occupied seat is exactly
    -- what admin override is for) and overwrites the other admin's worker anyway.
    -- SKIP LOCKED makes the second admin step over the seat the first is holding and
    -- take the block's OTHER free seat, so on a multi-staff desk both assignments land.
    -- When there is genuinely no seat left, `chosen` comes up short and the assertion
    -- below raises seat_not_assignable, which is the honest answer: the admin lost the
    -- race and must look again, rather than silently erasing whoever won it.
    WITH candidate_blocks AS MATERIALIZED (
      SELECT DISTINCT sb.block_id
      FROM shift_blocks sb
      WHERE sb.block_id = ANY (v_target_block_ids)
    ),
    chosen AS MATERIALIZED (
      SELECT seat.assignment_id
      FROM candidate_blocks cb
      CROSS JOIN LATERAL (
        SELECT a.assignment_id
        FROM shift_block_assignments a
        WHERE a.block_id = cb.block_id
          AND (
            (p_incumbent_user_id IS NOT NULL
               AND a.user_id = p_incumbent_user_id
               AND a.status IN ('scheduled', 'claimed'))
            OR
            (p_incumbent_user_id IS NULL
               AND a.status IN ('vacant', 'scheduled', 'claimed'))
          )
        ORDER BY
          CASE WHEN a.status = 'vacant' THEN 0 ELSE 1 END,
          a.assignment_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ) seat
    )
    UPDATE shift_block_assignments sba
    SET status = 'claimed',
        user_id = p_user_id,
        vacancy_origin = 'none',
        is_float = false,
        is_cross_house_pickup = false,
        source_house_id = NULL,
        parent_float_id = NULL
    FROM chosen
    WHERE sba.assignment_id = chosen.assignment_id
      -- Re-assert under the lock. A seat that became float-committed between the
      -- float_committed hard-block check and this write drops out here instead of
      -- being overwritten (S1 OUT: admin override never touches a float seat).
      AND sba.status IN ('vacant', 'scheduled', 'claimed');

    GET DIAGNOSTICS v_assigned_count = ROW_COUNT;

    -- Every clicked block passed seat_not_assignable / not_occupied_by_worker above.
    -- A shortfall here means a competing write took a seat under us; surface it with
    -- the existing vocabulary rather than reporting a partial success as a success.
    IF v_assigned_count <> (
      SELECT count(DISTINCT sb.block_id)
      FROM shift_blocks sb
      WHERE sb.block_id = ANY (v_target_block_ids)
    ) THEN
      RAISE EXCEPTION 'seat_not_assignable';
    END IF;
  ELSE
    -- permanent: if the clicked occurrence is occupied, permanently drop the
    -- incumbent first (vacates future occurrences → permanent_drop, writes the
    -- people alerts), then pick up the slot for the new worker. Prefer the named
    -- incumbent (REPLACE); else detect the occupied seat.
    IF p_incumbent_user_id IS NOT NULL THEN
      v_incumbent_user_id := p_incumbent_user_id;
    ELSE
      SELECT sba.user_id
        INTO v_incumbent_user_id
      FROM shift_block_assignments sba
      WHERE sba.block_id = ANY (p_block_ids)
        AND sba.user_id IS NOT NULL
        AND sba.status IN ('scheduled', 'claimed')
      LIMIT 1;
    END IF;

    IF v_incumbent_user_id IS NOT NULL AND v_incumbent_user_id <> p_user_id THEN
      PERFORM permanent_drop_slot(
        v_incumbent_user_id,
        v_block_house_id,
        v_day_of_week,
        v_block_start_locals,
        p_now,
        p_operator_user_id
      );
    END IF;

    -- Fill every future in-semester occurrence that currently has a vacant seat.
    -- Bug fix: this used to delegate to permanent_pickup_slot, whose WHERE clause
    -- requires vacancy_origin = 'permanent_drop' (the worker permanent-pickup feed
    -- semantics, §8.4.3). That silently assigned ZERO seats when the future
    -- occurrences were plain 'never_assigned' opens (a generated open shift that
    -- was never permanently dropped) — exactly the common admin action of placing
    -- a worker on a recurring open slot. Admin override (D5) fills ANY vacant seat
    -- on the future occurrences, regardless of vacancy_origin. permanent_drop seats
    -- (e.g. those just vacated by the incumbent permanent_drop_slot above) are a
    -- subset of 'vacant' and are still covered. Harnwell training is enforced
    -- earlier via the same-house guard (worker.home_house_id = block house).
    -- Same LATERAL LIMIT 1 FOR UPDATE treatment as the this_week branch (audit F3).
    -- SKIP LOCKED here, not plain FOR UPDATE: the permanent branch spans an entire
    -- semester of occurrences, and partial success is already its contract (it fills
    -- whatever future weeks are vacant), so stepping over a seat another writer holds
    -- is correct and blocking on it would serialise a long multi-week write behind an
    -- unrelated single-block claim.
    WITH candidate_blocks AS MATERIALIZED (
      SELECT DISTINCT sba.block_id
      FROM shift_block_assignments sba
      WHERE sba.block_id = ANY (v_target_block_ids)
        AND sba.status = 'vacant'
    ),
    chosen AS MATERIALIZED (
      SELECT seat.assignment_id
      FROM candidate_blocks cb
      CROSS JOIN LATERAL (
        SELECT a.assignment_id
        FROM shift_block_assignments a
        WHERE a.block_id = cb.block_id
          AND a.status = 'vacant'
        ORDER BY
          CASE WHEN a.vacancy_origin = 'permanent_drop' THEN 0 ELSE 1 END,
          a.assignment_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ) seat
    )
    UPDATE shift_block_assignments sba
    SET status = 'claimed',
        user_id = p_user_id,
        vacancy_origin = 'none',
        is_float = false,
        is_cross_house_pickup = false,
        source_house_id = NULL,
        parent_float_id = NULL
    FROM chosen
    WHERE sba.assignment_id = chosen.assignment_id
      AND sba.status = 'vacant';

    GET DIAGNOSTICS v_assigned_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'needs_confirm', false,
    'assigned_count', COALESCE(v_assigned_count, 0),
    'scope', p_scope,
    'advisories', v_advisories
  );
END;
$function$;

-- -------------------------------------------------------------------------
-- F8 -- claim_open_shift: serialise one worker's concurrent claims.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_open_shift(p_assignment_id uuid, p_user_id uuid, p_as_of timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target record;
  v_claimer record;
  v_week_start_date date;
  v_week_start_at timestamptz;
  v_week_end_at timestamptz;
  v_current_blocks integer;
  v_cap record;
  v_seat uuid;
  v_claimed_assignment_id uuid;
BEGIN
  -- The requested seat only names the BLOCK; it need not still be vacant.
  SELECT
    sba.assignment_id,
    sba.status,
    sb.block_id,
    sb.house_id,
    sb.block_start_at,
    sb.coverage_locked_at
  INTO v_target
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.assignment_id = p_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_unavailable';
  END IF;

  -- Concurrency (audit F8). Lock the CLAIMER's users row so one worker's concurrent
  -- claims serialise. The seat pick below is already race-safe between DIFFERENT
  -- workers (FOR UPDATE SKIP LOCKED), but the per-caller time-conflict and weekly-cap
  -- checks read only this worker's own rows and were unlocked: two claims fired in the
  -- same instant (a double tap, or two devices) each saw the pre-race state and both
  -- passed, double-booking the worker at two desks on the same block and overshooting
  -- the hard cap. Locking the user row costs nothing across different workers -- they
  -- never contend -- and matches the users-before-seats order fire_worker and
  -- apply_house_transfer already take, so it introduces no lock-order inversion.
  SELECT user_id, home_house_id, is_active
  INTO v_claimer
  FROM users
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_claimer.is_active = false THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  IF v_target.block_start_at <= p_as_of THEN
    RAISE EXCEPTION 'past_t2h_cutoff';
  END IF;

  -- §5.4/§5.5 coverage-conditional lock: a one-way locked block is never claimable; an
  -- unlocked block within T-2h is claimable only while a real worker is still on the desk
  -- (block_has_present_worker, allied excluded).
  IF v_target.coverage_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'past_t2h_cutoff';
  END IF;

  IF v_target.block_start_at <= p_as_of + interval '2 hours'
     AND NOT block_has_present_worker(v_target.block_id) THEN
    RAISE EXCEPTION 'past_t2h_cutoff';
  END IF;

  IF v_target.house_id = 'harnwell' AND v_claimer.home_house_id <> 'harnwell' THEN
    RAISE EXCEPTION 'cross_house_ineligible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM shift_block_assignments existing
    JOIN shift_blocks existing_block USING (block_id)
    WHERE existing.user_id = p_user_id
      AND existing.status <> 'vacant'
      AND existing.status <> 'allied'
      AND existing_block.block_start_at = v_target.block_start_at
  ) THEN
    RAISE EXCEPTION 'time_conflict';
  END IF;

  -- §9.2: calendar week (Monday 00:00 → Sunday 23:59) in America/New_York.
  v_week_start_date := date_trunc(
    'week',
    v_target.block_start_at AT TIME ZONE 'America/New_York'
  )::date;
  v_week_start_at := v_week_start_date::timestamp AT TIME ZONE 'America/New_York';
  v_week_end_at := (v_week_start_date + 7)::timestamp AT TIME ZONE 'America/New_York';

  SELECT COUNT(*)::integer
  INTO v_current_blocks
  FROM shift_block_assignments existing
  JOIN shift_blocks existing_block USING (block_id)
  WHERE existing.user_id = p_user_id
    AND existing.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
    AND existing_block.block_start_at >= v_week_start_at
    AND existing_block.block_start_at < v_week_end_at;

  SELECT *
  INTO v_cap
  FROM effective_weekly_cap(v_week_start_date, v_target.block_start_at);

  IF v_cap.cap_enforcement = 'hard'
     AND ((v_current_blocks + 1)::numeric * 0.5) > v_cap.hours_cap THEN
    RAISE EXCEPTION 'hard_cap_exceeded';
  END IF;

  -- Any still-open seat on this block. SKIP LOCKED steps over a seat a competing claim
  -- already holds, so concurrent claimers split the seats (§5.3 FCFS).
  --
  -- A permanent_drop seat is eligible only while its own week is inside the §5.1 30-day
  -- horizon -- the same condition that surfaces it as a weekly card -- and only as a LAST
  -- RESORT: draining the ordinary vacancies first keeps the permanent opening pickable as a
  -- whole recurrence for as long as the block offers any alternative seat (§8.4.3).
  SELECT a.assignment_id
  INTO v_seat
  FROM shift_block_assignments a
  WHERE a.block_id = v_target.block_id
    AND a.status = 'vacant'
    AND (
      a.vacancy_origin <> 'permanent_drop'
      OR v_target.block_start_at <= p_as_of + interval '30 days'
    )
  ORDER BY
    (a.vacancy_origin = 'permanent_drop'),
    (a.assignment_id = p_assignment_id) DESC,
    a.assignment_id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_seat IS NULL THEN
    RAISE EXCEPTION 'shift_unavailable';
  END IF;

  -- vacancy_origin = 'none' applies to THIS occurrence only. Other weeks of a permanently
  -- dropped slot keep their permanent_drop origin, so the slot stays in the permanent
  -- openings feed with weeks_remaining one lower (§5.3).
  UPDATE shift_block_assignments
  SET status = 'claimed',
      user_id = p_user_id,
      vacancy_origin = 'none',
      is_cross_house_pickup = (v_claimer.home_house_id <> v_target.house_id),
      source_house_id = CASE
        WHEN v_claimer.home_house_id <> v_target.house_id THEN v_claimer.home_house_id
        ELSE NULL
      END
  WHERE assignment_id = v_seat
    AND status = 'vacant'
  RETURNING assignment_id INTO v_claimed_assignment_id;

  IF v_claimed_assignment_id IS NULL THEN
    RAISE EXCEPTION 'shift_unavailable';
  END IF;

  RETURN v_claimed_assignment_id;
END;
$function$;

-- -------------------------------------------------------------------------
-- F8 -- claim_break_blocks: same user-row lock as claim_open_shift.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_break_blocks(p_block_ids uuid[], p_user_id uuid, p_as_of timestamp with time zone)
 RETURNS TABLE(claimed_block_id uuid, claimed_assignment_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claimer        record;
  v_block          record;
  v_break_id       uuid;
  v_week_start_date date;
  v_week_start_at  timestamptz;
  v_week_end_at    timestamptz;
  v_current_blocks integer;
  v_cap            record;
  v_seat           uuid;
BEGIN
  -- Concurrency (audit F8). Lock the CLAIMER's users row so one worker's concurrent
  -- claims serialise. The seat pick below is already race-safe between DIFFERENT
  -- workers (FOR UPDATE SKIP LOCKED), but the per-caller time-conflict and weekly-cap
  -- checks read only this worker's own rows and were unlocked: two claims fired in the
  -- same instant (a double tap, or two devices) each saw the pre-race state and both
  -- passed, double-booking the worker at two desks on the same block and overshooting
  -- the hard cap. Locking the user row costs nothing across different workers -- they
  -- never contend -- and matches the users-before-seats order fire_worker and
  -- apply_house_transfer already take, so it introduces no lock-order inversion.
  SELECT user_id, home_house_id, is_active
    INTO v_claimer
  FROM users
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_claimer.is_active = false THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  FOR v_block IN
    SELECT sb.block_id AS bid, sb.house_id, sb.block_start_at
    FROM shift_blocks sb
    WHERE sb.block_id = ANY (p_block_ids)
    ORDER BY sb.block_start_at, sb.block_id
  LOOP
    -- Resolve the break covering this block's NY date; skip non-break blocks.
    SELECT bp.break_id
      INTO v_break_id
    FROM operating_calendar oc
    JOIN break_periods bp
      ON oc.date BETWEEN bp.start_date AND bp.end_date
     AND oc.profile_name = bp.profile_name
    WHERE oc.date = (v_block.block_start_at AT TIME ZONE 'America/New_York')::date;

    CONTINUE WHEN v_break_id IS NULL;

    -- Round 1 only: claiming is gated to the claim window (pre_open + open_feed skip).
    CONTINUE WHEN break_claim_phase(v_break_id, p_as_of) <> 'claim_window';

    -- Harnwell training (#1): a non-Harnwell worker can never staff Harnwell.
    CONTINUE WHEN v_block.house_id = 'harnwell' AND v_claimer.home_house_id <> 'harnwell';

    -- Time-conflict: the caller already covers a seat at this block start.
    CONTINUE WHEN EXISTS (
      SELECT 1
      FROM shift_block_assignments existing
      JOIN shift_blocks eb USING (block_id)
      WHERE existing.user_id = p_user_id
        AND existing.status NOT IN ('vacant', 'allied')
        AND eb.block_start_at = v_block.block_start_at
    );

    -- Weekly hard-cap re-check (#4). Incremental: COUNT sees rows already claimed in
    -- this loop, so the drag trims the tail once the worker hits 40h that week.
    v_week_start_date := date_trunc(
      'week', v_block.block_start_at AT TIME ZONE 'America/New_York'
    )::date;
    v_week_start_at := v_week_start_date::timestamp AT TIME ZONE 'America/New_York';
    v_week_end_at := (v_week_start_date + 7)::timestamp AT TIME ZONE 'America/New_York';

    SELECT count(*)::integer
      INTO v_current_blocks
    FROM shift_block_assignments existing
    JOIN shift_blocks eb USING (block_id)
    WHERE existing.user_id = p_user_id
      AND existing.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
      AND eb.block_start_at >= v_week_start_at
      AND eb.block_start_at < v_week_end_at;

    SELECT *
      INTO v_cap
    FROM effective_weekly_cap(v_week_start_date, v_block.block_start_at);

    IF v_cap.cap_enforcement = 'hard'
       AND ((v_current_blocks + 1)::numeric * 0.5) > v_cap.hours_cap THEN
      CONTINUE;  -- cap reached for this week — trim the rest of the drag
    END IF;

    -- Pick one still-vacant seat on this block (lane-agnostic). SKIP LOCKED makes
    -- concurrent callers split the seats rather than collide (true FCFS).
    SELECT a.assignment_id
      INTO v_seat
    FROM shift_block_assignments a
    WHERE a.block_id = v_block.bid
      AND a.status = 'vacant'
    ORDER BY a.assignment_id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    CONTINUE WHEN v_seat IS NULL;  -- block already full (FCFS lost) — trimmed away

    UPDATE shift_block_assignments
    SET status = 'claimed',
        user_id = p_user_id,
        vacancy_origin = 'none',
        is_cross_house_pickup = (v_claimer.home_house_id <> v_block.house_id),
        source_house_id = CASE
          WHEN v_claimer.home_house_id <> v_block.house_id THEN v_claimer.home_house_id
          ELSE NULL
        END
    WHERE assignment_id = v_seat
      AND status = 'vacant';

    IF FOUND THEN
      claimed_block_id := v_block.bid;
      claimed_assignment_id := v_seat;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;


-- rollback:
-- (re-apply drop_shift from 20260623000005, accept_swap from 20260617000002,
--  apply_permanent_swap from 20260530000001, admin_assign_worker from
--  20260622000001, claim_open_shift from 20260724000004, and claim_break_blocks
--  from 20260615000001 -- i.e. the same bodies without the locks and predicates)
