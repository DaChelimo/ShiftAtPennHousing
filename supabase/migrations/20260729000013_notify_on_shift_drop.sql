-- Migration: notify workers the INSTANT a shift is dropped.
--
-- THE GAP (found 2026-07-29 by running a real drop end to end). `drop_shift`
-- vacated the seat and returned. It wrote no notification of any kind. The only
-- "a shift opened up" a worker could ever receive was the escalation chain's
-- `broadcast` step, which fires at T-3h before the shift AND only when the desk
-- would otherwise be EMPTY (the coverage floor, AGENTS [Coverage]).
--
-- So on a multi-staffed desk the notification fired NEVER. Verified live: Purity
-- dropped a Harnwell 19:00 seat, her co-worker Andrew was still on the block, the
-- orchestrator ticked past T-3h, and not one step fired. The seat simply appeared
-- in the open-shifts feed and waited to be noticed. A shift dropped a week out
-- sat silent for six days.
--
-- THE RULE (stakeholder decision 2026-07-29):
--
--   * Dropping a shift notifies OTHER workers immediately, at any distance from
--     the shift, regardless of whether the desk still has coverage. A vacant seat
--     is claimable whether or not the desk is empty (BSpec §5.4), so the coverage
--     floor governs ESCALATION only and must not gate this.
--   * Your OWN house is mandatory. `open_shifts_home_house` is not consulted for
--     a drop: it stays the switch for the T-3h `broadcast` reminder only.
--   * OTHER houses are opt-in, via the existing `open_shifts_other_houses`
--     preference (20260728000001), unchanged and still default-off.
--   * The T-3h `broadcast` is untouched and still fires. The two are different
--     statements ("someone gave this up" vs "this is still uncovered with 3 hours
--     to go"), so a worker may hear about one seat twice, by design.
--
-- Both drop paths are covered: the single-occurrence `drop_shift` and the
-- recurring `permanent_drop_slot`. Float-out seat reopening and admin removal are
-- deliberately NOT wired here (scoped out 2026-07-29); they still rely on the
-- feed plus the T-3h broadcast.

-- ---------------------------------------------------------------------------
-- 1. The shared recipient resolver.
-- ---------------------------------------------------------------------------
-- ONE notification per drop, not one per block. A worker dropping a 4-hour shift
-- vacates 8 rows; 8 pushes for one event is how a mandatory channel gets muted at
-- the OS level, which would silently break the float ack notifications that share
-- it. The span is collapsed into a single row carrying its start and end.
--
-- The eligibility matrix is copied from `process_broadcast_step`
-- (20260728000001) on purpose and must stay in step with it and with
-- `worker_open_shifts`: active, holds sw/sm/hm, is not a bm, and hard invariant
-- #1 (only home-Harnwell workers ever hear about a Harnwell seat). Telling
-- someone about a seat they are barred from claiming is worse than silence.
CREATE OR REPLACE FUNCTION notify_shift_opened(
  p_house_id      text,
  p_block_id      uuid,
  p_start_at      timestamptz,
  p_end_at        timestamptz,
  p_actor_user_id uuid,
  p_now           timestamptz,
  p_recurring     boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_house_name text;
  v_count      integer;
  v_title      text;
  v_body       text;
  v_when       text;
BEGIN
  SELECT name INTO v_house_name FROM houses WHERE id = p_house_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- No em/en dashes: this is surfaced copy (AGENTS conventions).
  IF p_recurring THEN
    v_title := 'A weekly shift just opened up';
    v_when  := 'every '
      || trim(to_char(p_start_at AT TIME ZONE 'America/New_York', 'Day'))
      || ', '
      || to_char(p_start_at AT TIME ZONE 'America/New_York', 'HH24:MI')
      || ' to '
      || to_char(p_end_at AT TIME ZONE 'America/New_York', 'HH24:MI')
      || ', for the rest of the semester';
  ELSE
    v_title := 'A shift just opened up';
    v_when  := 'on '
      || to_char(p_start_at AT TIME ZONE 'America/New_York', 'Dy, Mon FMDD')
      || ', '
      || to_char(p_start_at AT TIME ZONE 'America/New_York', 'HH24:MI')
      || ' to '
      || to_char(p_end_at AT TIME ZONE 'America/New_York', 'HH24:MI');
  END IF;

  v_body := v_house_name || ' needs cover ' || v_when || '. Open the app to claim it.';

  WITH inserted AS (
    INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
    SELECT
      u.user_id,
      'shift_opened'::notification_type,
      p_now,
      jsonb_build_object(
        'kind',           'open_shift',
        'block_id',       p_block_id,
        'house_id',       p_house_id,
        'block_start_at', p_start_at,
        'block_end_at',   p_end_at,
        'recurring',      p_recurring,
        'home_house',     (u.home_house_id = p_house_id),
        'title',          v_title,
        'body',           v_body
      )
    FROM users u
    WHERE u.is_active = true
      -- The dropper already knows. Notifying them is the wart the T-3h broadcast
      -- still has (it has no actor to exclude); do not reproduce it here.
      AND (p_actor_user_id IS NULL OR u.user_id <> p_actor_user_id)
      AND EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = u.user_id AND ur.role IN ('sw', 'sm', 'hm')
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = u.user_id AND ur.role = 'bm'
      )
      -- Hard invariant #1, enforced at every notification point.
      AND (p_house_id <> 'harnwell' OR u.home_house_id = 'harnwell')
      -- Own house is MANDATORY and short-circuits the preference lookup. Other
      -- houses fall through to `wants_open_shift_notification`, which for a
      -- non-home house returns `open_shifts_other_houses` (default false).
      AND (
        u.home_house_id = p_house_id
        OR wants_open_shift_notification(u.user_id, p_house_id)
      )
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM inserted;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION notify_shift_opened(text, uuid, timestamptz, timestamptz, uuid, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notify_shift_opened(text, uuid, timestamptz, timestamptz, uuid, timestamptz, boolean)
  TO service_role;

COMMENT ON FUNCTION notify_shift_opened(text, uuid, timestamptz, timestamptz, uuid, timestamptz, boolean) IS
  'BSpec §5.3 / §10.1 -- emit ONE `shift_opened` notification per dropped span. '
  'Own house is mandatory; other houses honour `open_shifts_other_houses`. '
  'Excludes the dropper. Mirrors worker_open_shifts eligibility, including the '
  'Harnwell training invariant. Called by drop_shift and permanent_drop_slot, '
  'which are themselves SECURITY DEFINER, so no client holds EXECUTE.';

-- ---------------------------------------------------------------------------
-- 2. drop_shift fires it.
-- ---------------------------------------------------------------------------
-- Body carried over VERBATIM from 20260726000009_seat_write_compare_and_swap.sql
-- (the concurrency-audit F1 definition: seat lock, then compare-and-swap vacate),
-- verified against the live catalog definition before editing. The ONLY additions
-- are the span/house lookup and the notify call after the vacate succeeds.
-- Nothing in the locking or validation path moved.
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
  v_house_id text;
  v_min_block_id uuid;
  v_locked boolean;
BEGIN
  IF p_assignment_ids IS NULL OR array_length(p_assignment_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty_drop';
  END IF;

  -- Concurrency (audit F1). Lock the named seats BEFORE the ownership check.
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

  -- F-05-005: cannot drop a block that starts before the current 30-minute boundary.
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

  -- Vacate: reset the FULL non-home column set.
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
    AND user_id = p_user_id
    AND status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in',
                   'floated_out', 'pending_float_out');

  GET DIAGNOSTICS v_vacated_count = ROW_COUNT;

  IF v_vacated_count <> array_length(p_assignment_ids, 1) THEN
    RAISE EXCEPTION 'drop_not_owned';
  END IF;

  -- NEW (2026-07-29): tell everyone who could claim it, right now.
  --
  -- Placed after the CAS so a losing racer, which raises above and rolls the
  -- transaction back, cannot emit a notification for a seat it did not vacate.
  --
  -- `coverage_locked_at` is the one suppression: a block the orchestrator has
  -- already locked (BSpec §5.5, an empty desk past its T-2h step) is NOT
  -- claimable, and the copy says "Open the app to claim it." The lock is
  -- one-way, so this cannot wrongly suppress a seat that later reopens.
  SELECT sb.house_id, sb.block_id, sb.coverage_locked_at IS NOT NULL
    INTO v_house_id, v_min_block_id, v_locked
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.assignment_id = ANY (p_assignment_ids)
  ORDER BY sb.block_start_at
  LIMIT 1;

  IF NOT COALESCE(v_locked, true) THEN
    PERFORM notify_shift_opened(
      v_house_id,
      v_min_block_id,
      v_min_start,
      v_max_start + interval '30 minutes',
      p_user_id,
      now(),
      false
    );
  END IF;

  RETURN QUERY SELECT p_assignment_ids, v_short_notice, v_direct_hmod;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. permanent_drop_slot fires it too.
-- ---------------------------------------------------------------------------
-- Body carried over VERBATIM from the LIVE catalog definition, which is
-- 20260729000003_permanent_drop_any_operating_period.sql (any operating period,
-- `op.scheduling_mode = 'sm_built'` rather than a profile-name equality) --
-- NOT the older 20260713000005. The ONLY addition is the occurrence capture and
-- the notify call.
--
-- ONE notification for the whole recurring slot, not one per occurrence: a
-- Wednesday evening slot dropped in September is ~14 occurrences, and the worker
-- wants to hear "this weekly slot is free", once. The recurring copy says so
-- explicitly, and the payload carries `recurring: true` so the clients can route
-- the tap to the permanent feed rather than a single block.
CREATE OR REPLACE FUNCTION public.permanent_drop_slot(p_dropping_user_id uuid, p_house_id text, p_day_of_week integer, p_block_start_locals text[], p_drop_initiated_at timestamp with time zone, p_operator_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_semester_end_date date;
  v_affected_count integer;
  v_first_block_id uuid;
  v_first_start timestamptz;
  v_last_start timestamptz;
BEGIN
  -- The current-or-upcoming operating period: the earliest one not yet ended, whatever
  -- its profile (a school-year term OR a compiled `s_%` season -- 20260702000006 made
  -- summer a first-class scheduling_periods row). Robust when `now` sits just before a
  -- period opens or between periods; still raises when `now` is past every period, so a
  -- drop is never unbounded (ARCH §7.1).
  SELECT end_date
    INTO v_semester_end_date
  FROM scheduling_periods
  WHERE end_date >= (p_drop_initiated_at AT TIME ZONE 'America/New_York')::date
  ORDER BY start_date
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'semester_boundary_not_found';
  END IF;

  -- NEW (2026-07-29). Capture the EARLIEST affected occurrence BEFORE the vacate,
  -- while the rows still carry the dropping worker's user_id. The filter set is
  -- an exact mirror of the UPDATE's subquery below; if that predicate changes,
  -- change this one with it or the notification will describe a different slot
  -- than the one actually vacated.
  SELECT sb.block_id, sb.block_start_at
    INTO v_first_block_id, v_first_start
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  JOIN operating_calendar oc
    ON oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
  JOIN operating_profiles op
    ON op.profile_name = oc.profile_name
  WHERE sba.user_id = p_dropping_user_id
    AND sb.house_id = p_house_id
    AND op.scheduling_mode = 'sm_built'
    AND EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York') = p_day_of_week
    AND TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI') = ANY (p_block_start_locals)
    AND sb.block_start_at > p_drop_initiated_at
    AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date <= v_semester_end_date
    AND sba.status NOT IN ('floated_out', 'pending_float_out')
  ORDER BY sb.block_start_at
  LIMIT 1;

  -- The span END comes from the latest block of that FIRST occurrence (same NY
  -- date); later occurrences repeat the same wall-clock window.
  SELECT MAX(sb.block_start_at)
    INTO v_last_start
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.user_id = p_dropping_user_id
    AND sb.house_id = p_house_id
    AND TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI') = ANY (p_block_start_locals)
    AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date
        = (v_first_start AT TIME ZONE 'America/New_York')::date;

  UPDATE shift_block_assignments sba
  SET
    user_id = NULL,
    status = 'vacant',
    vacancy_origin = 'permanent_drop'
  WHERE sba.user_id = p_dropping_user_id
    AND sba.block_id IN (
      SELECT sb.block_id
      FROM shift_blocks sb
      -- Still joined: the date must be a real OPERATING day. The profile equality that
      -- used to ride this join is gone -- v_semester_end_date already bounds the
      -- recurrence to the current period, and requiring a school-year profile vacated
      -- nothing at all inside a summer season.
      JOIN operating_calendar oc
        ON oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
      JOIN operating_profiles op
        ON op.profile_name = oc.profile_name
      WHERE sb.house_id = p_house_id
        -- Embedded-break exclusion (BSpec §8.4.1), stated by MODE rather than by
        -- profile name. A permanent drop targets a recurring SM-BUILT slot; a
        -- claim-based day (a break) has no recurring slot to drop, so its occurrence
        -- is skipped -- which is what `= 'regular_school_year'` used to achieve as a
        -- side effect. Saying it as `scheduling_mode = 'sm_built'` keeps that
        -- exclusion exactly while admitting compiled `s_%` season profiles, which are
        -- sm_built too. A season spans SEVERAL phase profiles
        -- (s_summer2026_20260601, _20260701, ...) so matching the period's own
        -- profile_name would have vacated only the first phase.
        AND op.scheduling_mode = 'sm_built'
        AND EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York') = p_day_of_week
        AND TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI') = ANY (p_block_start_locals)
        AND sb.block_start_at > p_drop_initiated_at
        AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date <= v_semester_end_date
    )
    AND sba.status NOT IN ('floated_out', 'pending_float_out');

  GET DIAGNOSTICS v_affected_count = ROW_COUNT;

  IF p_operator_user_id IS NOT NULL AND p_operator_user_id <> p_dropping_user_id THEN
    INSERT INTO notifications (recipient_user_id, type, delivered_at, scheduled_for, payload)
    VALUES (
      p_dropping_user_id,
      'sw_permanent_removal_alert'::notification_type,
      NULL,
      now(),
      jsonb_build_object(
        'operator_user_id', p_operator_user_id,
        'house_id', p_house_id,
        'day_of_week', p_day_of_week,
        'block_start_locals', p_block_start_locals,
        'semester_end_date', v_semester_end_date
      )
    );
  END IF;

  -- NEW (2026-07-29). Guarded on v_affected_count so a no-op drop stays silent.
  IF v_affected_count > 0 AND v_first_block_id IS NOT NULL THEN
    PERFORM notify_shift_opened(
      p_house_id,
      v_first_block_id,
      v_first_start,
      COALESCE(v_last_start, v_first_start) + interval '30 minutes',
      p_dropping_user_id,
      now(),
      true
    );
  END IF;

  RETURN jsonb_build_object(
    'affected_count', v_affected_count,
    'semester_end_date', v_semester_end_date
  );
END;
$function$;

-- rollback: CREATE OR REPLACE drop_shift from 20260726000009 and
-- permanent_drop_slot from 20260729000003, then DROP FUNCTION
-- notify_shift_opened(text, uuid, timestamptz, timestamptz, uuid, timestamptz, boolean).
