-- Migration: Harnwell-only pilot scoping (workstream A, docs/harnwell-pilot/PLAN.md).
--
-- WHY. With one live house, automated float lookup can only ever find nothing (there is
-- nobody to source from), and the open-shifts feed has no business advertising a dark
-- house's seats. Per the plan, neither cut-down gets its own flag: both derive from the
-- live-house set that already exists (house_is_live / is_staggered_launch_enabled,
-- 20260712000001). Launching a second house restores both behaviours with no config edit.
--
-- A1: count_live_houses(), consumed by orchestrator-tick's floatLookupStep (TS) to
-- short-circuit to the 'no_float' result (which still routes on to hmod_notify_allied,
-- broadcast, and the T-2h coverage lock unchanged) when fewer than two houses can source.
--
-- A2: worker_open_shifts gains a house_is_live() filter in the vacant_seats CTE, matching
-- the style already used by orchestrator_vacant_seats (20260726000003) and
-- worker_visible_houses (20260712000001).

-- 1. count_live_houses(): how many houses are currently effectively live. Mirrors
--    house_is_live's own gate-off behavior (every house counts as live when the staggered
--    launch switch is off), so this returns 13 in every existing dev/test environment and
--    the whole suite is unchanged until the switch is turned on.
CREATE OR REPLACE FUNCTION count_live_houses()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
    FROM houses h
   WHERE house_is_live(h.id);
$$;

REVOKE ALL ON FUNCTION count_live_houses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION count_live_houses() TO authenticated, service_role;

-- 2. worker_open_shifts: add the live-house filter. View body is otherwise byte-identical
-- to 20260729000011; only the WHERE clause of vacant_seats changes (new AND line).
--
-- NO GRANT BLOCK BELOW, deliberately -- CREATE OR REPLACE VIEW preserves existing
-- privileges. Re-adding the GRANT to anon has regressed this view three times already
-- (see AGENTS.md "anon grant regresses on every view migration").
CREATE OR REPLACE VIEW worker_open_shifts AS
WITH vacant_seats AS (
  SELECT
    sba.assignment_id,
    sb.block_id,
    sb.house_id,
    h.name AS house_name,
    sb.block_start_at,
    sb.coverage_locked_at,
    sba.vacancy_origin,
    EXISTS (
      SELECT 1
      FROM operating_calendar oc
      JOIN operating_profiles op ON op.profile_name = oc.profile_name
      WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
        AND op.scheduling_mode = 'sm_built'
    ) AS schedule_built,
    NOT EXISTS (
      SELECT 1
      FROM operating_calendar oc
      JOIN break_periods bp
        ON oc.date BETWEEN bp.start_date AND bp.end_date
      WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
        AND break_claim_phase(bp.break_id, now()) <> 'open_feed'
    ) AS weekly_visible,
    EXISTS (
      SELECT 1
      FROM shift_block_assignments present
      WHERE present.block_id = sb.block_id
        AND present.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
    ) AS desk_covered
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  JOIN houses h ON h.id = sb.house_id
  WHERE sba.status = 'vacant'
    AND sb.block_start_at > now()
    AND sb.block_start_at < now() + interval '26 weeks'
    AND sb.voided_at IS NULL
    -- A2 (Harnwell pilot, 2026-08-01): a dark house's seats are never advertised.
    -- Launching a house (house_is_live) is what widens this feed, not a separate flag.
    AND house_is_live(sb.house_id)
),
permanent_slot_weeks AS (
  SELECT
    sb2.house_id,
    EXTRACT(ISODOW FROM (sb2.block_start_at AT TIME ZONE 'America/New_York')) AS ny_dow,
    (sb2.block_start_at AT TIME ZONE 'America/New_York')::time               AS ny_time,
    count(*)::integer                                                        AS weeks_remaining
  FROM shift_block_assignments sba2
  JOIN shift_blocks sb2 USING (block_id)
  WHERE sba2.status = 'vacant'
    AND sba2.vacancy_origin = 'permanent_drop'
    AND sb2.block_start_at >= now()
    AND EXISTS (
      SELECT 1
      FROM operating_calendar oc
      JOIN operating_profiles op ON op.profile_name = oc.profile_name
      WHERE oc.date = (sb2.block_start_at AT TIME ZONE 'America/New_York')::date
        AND op.scheduling_mode = 'sm_built'
    )
  GROUP BY 1, 2, 3
),
open_blocks AS (
  SELECT
    assignment_id, block_id, house_id, house_name, block_start_at, coverage_locked_at,
    vacancy_origin, desk_covered, 'permanent_opening'::text AS feed
  FROM vacant_seats
  WHERE vacancy_origin = 'permanent_drop'
    AND schedule_built
    AND block_start_at < now() + interval '26 weeks'   -- OPEN_SHIFT_PERMANENT_HORIZON

  UNION ALL

  SELECT
    assignment_id, block_id, house_id, house_name, block_start_at, coverage_locked_at,
    vacancy_origin, desk_covered, 'weekly'::text AS feed
  FROM vacant_seats
  WHERE weekly_visible
    AND block_start_at < now() + interval '6 weeks'    -- OPEN_SHIFT_WEEKLY_HORIZON
    AND (
      vacancy_origin <> 'permanent_drop'
      OR NOT schedule_built
      OR block_start_at <= now() + interval '30 days'
    )
),
candidate_users AS MATERIALIZED (
  SELECT u.user_id, u.home_house_id
  FROM users u
  WHERE u.is_active = true
    AND EXISTS (
      SELECT 1
      FROM user_roles ur
      WHERE ur.user_id = u.user_id
        AND ur.role IN ('sw', 'sm', 'hm')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM user_roles ur
      WHERE ur.user_id = u.user_id
        AND ur.role = 'bm'
    )
)
SELECT
  cu.user_id                                  AS eligible_user_id,
  ob.assignment_id::text                      AS id,
  ob.house_id                                 AS house_id,
  ob.house_name                               AS house_name,
  ob.block_start_at                           AS start_at,
  ob.block_start_at + interval '30 minutes'   AS end_at,
  ob.feed                                     AS feed,
  (ob.house_id = cu.home_house_id)            AS home_house,
  CASE WHEN ob.feed = 'permanent_opening' THEN psw.weeks_remaining ELSE NULL END
                                              AS weeks_remaining,
  (ob.coverage_locked_at IS NOT NULL)         AS coverage_locked,
  ob.desk_covered                             AS desk_covered
FROM open_blocks ob
LEFT JOIN permanent_slot_weeks psw
  ON ob.feed = 'permanent_opening'
 AND psw.house_id = ob.house_id
 AND psw.ny_dow = EXTRACT(ISODOW FROM (ob.block_start_at AT TIME ZONE 'America/New_York'))
 AND psw.ny_time = (ob.block_start_at AT TIME ZONE 'America/New_York')::time
CROSS JOIN candidate_users cu
WHERE ob.house_id <> 'harnwell' OR cu.home_house_id = 'harnwell';

COMMENT ON VIEW worker_open_shifts IS
  'BSpec §5.1 open-shifts read model, one row per vacant SEAT per eligible worker. The two '
  'feeds OVERLAP by design: a permanently-dropped occurrence inside the 30-day horizon is '
  'emitted twice, once as permanent_opening (claim the whole remaining recurrence) and once '
  'as weekly (§5.3 claim this week only). Clients key cards on (span, feed), so the same '
  'assignment_id legitimately appears in both a weekly and a permanent card. Each feed is '
  'bounded by its own horizon: the weekly feed at 6 weeks (the navigable window), the '
  'permanent feed at 26 weeks. A permanent opening exists on any SCHEDULE-BUILT day '
  '(operating_profiles.scheduling_mode = ''sm_built''), so summer seasons are in scope as of '
  '2026-07-29; claim-based break days are not, because they carry no recurring slot. As of '
  '2026-08-01 the feed is also scoped to live houses (house_is_live); a dark house''s seats '
  'never appear regardless of feed.';

-- rollback:
-- (re-apply worker_open_shifts from 20260729000011_permanent_pickup_any_operating_period.sql)
-- DROP FUNCTION IF EXISTS count_live_houses();
