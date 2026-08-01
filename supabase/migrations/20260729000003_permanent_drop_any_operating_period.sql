-- Migration: permanent drop is bounded by the CURRENT OPERATING PERIOD, whatever its
-- profile -- not specifically by a `regular_school_year` term.
--
-- THE BUG. A worker holding a recurring summer slot could not permanently drop it. The
-- drop was refused outright with `semester_boundary_not_found`, and the worker app
-- rendered that as "That date falls outside the current semester." for a date sitting
-- squarely INSIDE the current period. Reproduced on the seeded local stack (2026-07-29,
-- Summer 2026 = 2026-06-01..2026-08-20), Harnwell worker liseche1 dropping their
-- recurring Sunday 05:30-08:00 slot:
--
--     SELECT permanent_drop_slot(<liseche1>, 'harnwell', 0,
--            ARRAY['05:30','06:00','06:30','07:00','07:30'], now(), <liseche1>);
--     ERROR:  semester_boundary_not_found
--
-- The seats stayed `scheduled`, so the shift was released to nobody: it did not reach
-- the open feed, and no other worker at the house could pick it up. A temporary drop of
-- the same five seats succeeded, which is what isolates this to the permanent path.
--
-- ROOT CAUSE -- superseded assumption, two places. permanent_drop_slot was written when
-- `scheduling_periods` held only SM-built school-year terms, so it hardcoded
-- `profile_name = 'regular_school_year'` both when resolving the boundary and when
-- selecting the occurrences to vacate. The operating-seasons work (20260702000006)
-- WIDENED `scheduling_periods.profile_name` to admit compiled `s_%` season profiles,
-- because summer is SM-built and needs a period row of its own. Summer 2026 duly has
-- one (`s_summer2026_20260601`). permanent_drop_slot was never updated to match, so for
-- every non-school-year period:
--
--   * the boundary lookup found no row and raised, and
--   * even had it not raised, the occurrence filter `oc.profile_name =
--     'regular_school_year'` would have matched zero blocks and vacated nothing.
--
-- The boundary lookup drops its profile restriction outright. The occurrence filter is
-- RESTATED rather than deleted: it becomes `operating_profiles.scheduling_mode =
-- 'sm_built'`. That preserves the embedded-break exclusion BSpec §8.4.1 requires (a
-- break day is claim_based and has no recurring slot to drop) -- which is the thing the
-- old profile equality was really buying -- while admitting compiled season profiles.
-- Deleting the filter instead of restating it regresses
-- `phase-10-bulk-ops.sql` test 14, which is how this was caught.
--
-- The recurrence is now bounded by the end_date of the
-- current-or-upcoming scheduling period regardless of profile, which is what
-- BEHAVIORAL_SPECIFICATION.md §5.1 already states ("The operating profile ends. New
-- profiles are scheduled fresh; permanent drops do not carry over") -- the code was the
-- thing out of step, not the spec. ARCHITECTURE.md §2.10 and §7.1 are corrected in the
-- same commit; both still described the pre-20260702000006 world.
--
-- WHAT IS DELIBERATELY *NOT* CHANGED. The `regular_school_year` filters on the
-- permanent-openings FEED (worker_open_shifts) and on permanent-pickup's
-- candidateBlocks() stay exactly as they are. That pair is the 20260617000004 symmetry
-- rule -- the feed must not advertise a recurrence the pickup cannot take -- and the two
-- still agree with each other after this change. The consequence is intended and
-- coherent: a permanently-dropped SUMMER slot releases each future occurrence into the
-- WEEKLY feed (worker_open_shifts already emits a permanent_drop seat on a non-school-
-- year day through its `OR NOT regular_school_year` clause, which exists for precisely
-- this case), where it is claimable week by week. Whether a summer recurrence should
-- additionally be pickable as a WHOLE recurrence is a product decision that would have
-- to move the feed and the pickup EF together; it is not smuggled in here.
--
-- The "no period covers this date at all" guard is UNCHANGED and still raises: a drop
-- must never proceed unbounded (ARCH §7.1). Only the profile restriction is lifted.
--
-- Body below is the LIVE definition with those two lines changed and nothing else.

CREATE OR REPLACE FUNCTION public.permanent_drop_slot(p_dropping_user_id uuid, p_house_id text, p_day_of_week integer, p_block_start_locals text[], p_drop_initiated_at timestamp with time zone, p_operator_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_semester_end_date date;
  v_affected_count integer;
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

  RETURN jsonb_build_object(
    'affected_count', v_affected_count,
    'semester_end_date', v_semester_end_date
  );
END;
$function$;

COMMENT ON FUNCTION public.permanent_drop_slot(uuid, text, integer, text[], timestamptz, uuid) IS
  'BSpec §8.4 permanent drop. Vacates every future occurrence of a recurring slot up to the '
  'end of the current-or-upcoming scheduling period, whatever that period''s profile '
  '(school-year term or compiled s_% season). Raises semester_boundary_not_found only when '
  'NO period covers or follows the drop date, so a drop is never unbounded (ARCH §7.1).';

-- rollback:
-- Re-apply permanent_drop_slot from 20260713000005_drop_sm_permanent_drop_notification.sql
-- (restores the `profile_name = 'regular_school_year'` restriction on both the boundary
-- lookup and the occurrence filter, and with it the summer-drop failure).
