-- Migration: bound worker_open_shifts in time, and stop calling a SECURITY DEFINER
-- helper once per output row (cost audit F-01).
--
-- BASELINE, measured on the seeded local stack (2026-07-26) as a real Harnwell worker
-- under RLS, reproducing the query WorkerShiftsRepository.fetchWorkerWeek issues:
-- 16,150 rows, 130,343 shared buffers (~1 GB of buffer traffic) per single read.
--
-- Every change below was measured. Two things that LOOKED like the problem were tested
-- and rejected; they are documented at the bottom so the experiment is not repeated.
--
-- ---------------------------------------------------------------------------
-- DEFECT 1 -- no upper time bound.
--
-- vacant_seats selected every 'vacant' assignment with block_start_at > now(), across
-- all 13 houses, to the end of generated time. The client's own bound is a LOWER one
-- (start_at >= Monday-of-last-week); a SECOND filter on the same column is silently
-- dropped by supabase-kt, so the upper bound has to live in the view. The client only
-- ever navigates last-week…+4.
--
-- Fixed by bounding vacant_seats on both sides. That also lets the planner range-scan
-- shift_blocks_block_start_at_idx instead of relying on an open-ended scan.
--
-- TWO HORIZONS, NOT ONE -- this is the pickability guarantee. Bounding BOTH feeds at
-- 6 weeks would hide a permanently-dropped slot whose next regular-school-year
-- occurrence falls beyond that, and that card is exactly how a worker picks up the
-- WHOLE remaining recurrence. So:
--
--   * weekly feed       -> open_shift_weekly_horizon_weeks    (default 6)
--     Covers the navigable window with headroom. This is where the 16,150 rows are,
--     so this is where the saving comes from.
--   * permanent_opening -> open_shift_permanent_horizon_weeks (default 26 = a semester)
--     Costs almost nothing: permanent_drop is a small, highly selective slice of vacant
--     seats, and it now has a partial index.
--
-- Both are literals in the view; section 1 below explains why they are deliberately NOT
-- system_config keys. Neither bound can make a slot unpickable: permanent_pickup_slot
-- has its own candidateBlocks() and never reads this view. VERIFIED on the seed by
-- diffing against the previous definition: the horizon drops 27,972 weekly-feed rows
-- and ZERO permanent_opening rows.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2 -- desk_covered called a SECURITY DEFINER function per output row.
--
-- `block_has_present_worker(ob.block_id)` was evaluated once per (block x eligible
-- worker) row. Isolated measurement over the same window:
--
--     SELECT block_has_present_worker(sb.block_id) FROM shift_blocks sb WHERE <window>
--       -> 60,473 buffers            (46% of the whole view's cost)
--     SELECT EXISTS (SELECT 1 FROM shift_block_assignments p WHERE ...) FROM ... same
--       -> 817 buffers / 29 ms       (74x cheaper)
--
-- The cause is not the logic, it is the packaging: PostgreSQL inlines simple SQL
-- functions, but it NEVER inlines a SECURITY DEFINER one. So the helper stayed an
-- opaque per-row call (~4 buffers each x 15,898) while the identical predicate written
-- inline collapses into a HASHED SUBPLAN -- one seq scan of the 5,879 non-vacant rows,
-- hashed once, probed per row.
--
-- The inline copy is semantically identical: same four statuses, 'allied' still
-- excluded. This view runs with OWNER rights (it is NOT security_invoker -- verified
-- against pg_class.reloptions; worker_my_shifts is the one that is), so a direct scan
-- sees exactly what the SECURITY DEFINER helper sees. block_has_present_worker itself
-- is UNCHANGED and still used by claim_open_shift, is_assignment_claimable and the
-- orchestrator, where it is a single-row lookup and the right shape.
--
-- Coverage-lock invariant preserved: this present-set deliberately EXCLUDES 'allied'.
-- Do not collapse it with the escalation present-set, which includes 'allied'
-- (supabase/AGENTS.md, "Coverage lock" -- two present-sets, do not collapse them).
--
-- ---------------------------------------------------------------------------
-- DEFECT 3 -- weeks_remaining was a correlated count per output row.
--
-- Its inner filter (EXTRACT(isodow ...), ::time) is non-sargable, so no index can serve
-- it. Replaced by permanent_slot_weeks: one GROUP BY over the recurring-slot identity
-- (house, ISO weekday, NY time-of-day), joined once. Its horizon stays UNBOUNDED
-- (block_start_at >= now()), exactly as before, so an advertised "N weeks remaining"
-- is unchanged even though the feed itself is now bounded.
--
-- ---------------------------------------------------------------------------
-- DEFECT 4 -- the CROSS JOIN re-derived `candidate_users` and re-probed `houses`
--             once per OUTPUT row.
--
-- With defects 1-3 fixed the profile showed two equal remaining terms, 31,796 buffers
-- each, both artefacts of the nested-loop shape the CROSS JOIN produces:
--
--     Seq Scan on user_roles ur          (loops=15898)  31,796 buffers
--     Index Scan using houses_pkey h     (loops=15898)  31,796 buffers
--
-- `candidate_users` resolves to ONE row for a worker's own read, and `houses` is a
-- 13-row table -- neither has any business being probed 15,898 times. Two fixes:
--
--   * candidate_users AS MATERIALIZED. Inlined, its role EXISTS got pushed into the
--     join and re-evaluated per output row. Materialised, it is built once and hash
--     probed. The eligible_user_id predicate still filters the CTE scan down to the one
--     requesting worker, so this does NOT reintroduce the |blocks| x |users| product.
--   * JOIN houses inside vacant_seats, before the CROSS JOIN, where the planner hashes
--     the 13-row table against a real relation instead of nested-looping it.
--
-- ---------------------------------------------------------------------------
-- NET RESULT, same query, same data, same worker:
--
--     before   130,343 buffers   ~270 ms
--     after      1,471 buffers    ~59 ms          (~88x less buffer traffic)
--
-- and the row count is identical inside the horizon (15,898), verified by diffing the
-- full projection against the previous definition.
--
-- ---------------------------------------------------------------------------
-- TESTED AND REJECTED -- do not redo these:
--
--   * Hoisting `regular_school_year` / `weekly_visible` into a per-NY-date CTE. It
--     looks like a 400x win (16,150 seats, 40 distinct dates), but the planner ALREADY
--     turns both correlated EXISTS into hashed SubPlans evaluated once. The CTE only
--     added materialisation: measured 166,178 buffers, worse than the 130,343 baseline.
--   * Replacing desk_covered with a `covered_blocks` semi-join CTE. Whether inlined or
--     MATERIALIZED, the planner nested-loop-rescanned it once per output row (no
--     statistics exist for a CTE relation): measured 1.9 s vs 0.27 s. The inline EXISTS
--     above is the shape that works, because it stays attached to a real table.
--
-- PRESERVED EXACTLY -- do not "simplify" these away:
--   * The Harnwell training constraint as the sole join predicate against
--     candidate_users, character for character (AGENTS hard invariant #1).
--   * The DUAL EMISSION of a permanent-drop occurrence inside the 30-day horizon, once
--     as permanent_opening and once as weekly (20260724000004, BSpec §5.3).
--   * The regular_school_year filter on BOTH the permanent feed and weeks_remaining
--     (20260617000004; silently reverted by 20260627000001, restored by 20260724000004).
--   * Column names, types and ORDER (CREATE OR REPLACE VIEW cannot reorder them).

-- ---------------------------------------------------------------------------
-- 1. The horizons are literals, deliberately. (No system_config key -- read this.)
--
-- A system_config-backed open_shift_horizon(feed) helper was built, measured, and
-- REMOVED. Two independent reasons, both disqualifying:
--
--   * COST. The helper has to be SECURITY DEFINER, because system_config's RLS is
--     admin-only and a worker must not be granted a direct read on it. PostgreSQL never
--     inlines a SECURITY DEFINER function, so called bare in the WHERE it was invoked
--     per row -- 32,300 buffers, the exact defect-2 shape this migration exists to kill.
--     Wrapping it as (SELECT open_shift_horizon(...)) to force a one-shot InitPlan fixed
--     the per-row calls but hid the bound from the planner, which then stopped
--     range-scanning shift_blocks_block_start_at_idx: 66,225 buffers / ~970 ms. Both
--     forms are far worse than the literal (1,471 buffers / ~59 ms).
--   * CORRECTNESS. A non-SECURITY-DEFINER helper reads nothing under a worker's RLS and
--     silently falls back to its default, so an admin and a worker would compute
--     DIFFERENT horizons from the same view. A config knob that changes the answer
--     depending on who is asking is worse than no knob.
--
-- So the horizon moves by migration, not by config row. Both literals are tagged
-- OPEN_SHIFT_WEEKLY_HORIZON / OPEN_SHIFT_PERMANENT_HORIZON below; grep those tags to
-- find every site. Recorded in BSpec §14 as a fixed system parameter, not a tunable.

-- ---------------------------------------------------------------------------
-- 2. Supporting index for the permanent-openings slice.
--
-- NOTE the predicate. A partial index on `status = 'vacant'` ALONE -- which the audit
-- floated as F-18's third candidate -- would be useless here: 35,956 of 41,836
-- assignment rows (86%) are vacant, so the planner correctly prefers a seq scan and the
-- index would only cost writes. Adding vacancy_origin makes it genuinely selective,
-- which is what permanent_slot_weeks' deliberately unbounded scan needs.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS shift_block_assignments_permanent_drop_idx
  ON shift_block_assignments (block_id)
  WHERE status = 'vacant' AND vacancy_origin = 'permanent_drop';

-- ---------------------------------------------------------------------------
-- 3. worker_open_shifts.
-- ---------------------------------------------------------------------------
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
    -- A permanent opening exists only on a regular-school-year day: that is exactly the
    -- candidate filter candidateBlocks() applies in the permanent-pickup EF, so the feed
    -- must not advertise a slot the pickup cannot take (20260617000004).
    EXISTS (
      SELECT 1
      FROM operating_calendar oc
      WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
        AND oc.profile_name = 'regular_school_year'
    ) AS regular_school_year,
    -- Weekly visibility: a block whose NY-local date sits in a break period that has not
    -- reached its open_feed phase belongs to the break-claim calendar, not the weekly feed.
    NOT EXISTS (
      SELECT 1
      FROM operating_calendar oc
      JOIN break_periods bp
        ON oc.date BETWEEN bp.start_date AND bp.end_date
      WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
        AND break_claim_phase(bp.break_id, now()) <> 'open_feed'
    ) AS weekly_visible,
    -- desk_covered, inline. Same predicate block_has_present_worker() computes, but as
    -- an inline EXISTS the planner turns it into a hashed SubPlan (817 buffers) instead
    -- of 15,898 opaque SECURITY DEFINER calls (60,473 buffers). 'allied' is deliberately
    -- NOT present here -- see the header.
    EXISTS (
      SELECT 1
      FROM shift_block_assignments present
      WHERE present.block_id = sb.block_id
        AND present.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
    ) AS desk_covered
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  -- Joined HERE, not after the CROSS JOIN: a 13-row table hashed once against a real
  -- relation, instead of 15,898 nested-loop index probes (defect 4).
  JOIN houses h ON h.id = sb.house_id
  WHERE sba.status = 'vacant'
    AND sb.block_start_at > now()
    -- F-01 upper bound. The widest of the two feed horizons; each feed narrows further
    -- below. Scalar, so it is evaluated once per query, not per row.
    -- OPEN_SHIFT_PERMANENT_HORIZON. The widest of the two feed horizons; each feed
    -- narrows further below. Literal on purpose -- see the header.
    AND sb.block_start_at < now() + interval '26 weeks'
    -- Blocks retired by an admin config change are inert. Voiding also deletes their
    -- vacant seats, so this mirrors the defense-in-depth guard already carried by
    -- is_assignment_claimable, the orchestrator scan and both house grids
    -- (20260702000007). Verified to remove nothing on current data.
    AND sb.voided_at IS NULL
),
permanent_slot_weeks AS (
  -- weeks_remaining for every permanently-dropped recurring slot, as ONE grouped pass
  -- instead of a correlated count per output row. Slot identity is (house, ISO weekday,
  -- NY time-of-day) -- the same triple the old correlated predicate matched on. Horizon
  -- is deliberately UNBOUNDED (>= now()), as before: the count must span the whole
  -- remaining recurrence, not just the feed's display window.
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
    -- Count only regular-school-year weeks: the pre-pickup count must equal what the
    -- pickup can actually take (20260617000004, reverted by 20260627000001).
    AND EXISTS (
      SELECT 1
      FROM operating_calendar oc
      WHERE oc.date = (sb2.block_start_at AT TIME ZONE 'America/New_York')::date
        AND oc.profile_name = 'regular_school_year'
    )
  GROUP BY 1, 2, 3
),
open_blocks AS (
  -- The permanent openings feed (§5.1): the whole remaining recurrence, one row per
  -- vacant occurrence. Not break-phase filtered. Its own, longer horizon.
  SELECT
    assignment_id, block_id, house_id, house_name, block_start_at, coverage_locked_at,
    vacancy_origin, desk_covered, 'permanent_opening'::text AS feed
  FROM vacant_seats
  WHERE vacancy_origin = 'permanent_drop'
    AND regular_school_year
    AND block_start_at < now() + interval '26 weeks'   -- OPEN_SHIFT_PERMANENT_HORIZON

  UNION ALL

  -- The weekly feed (§5.1): ordinary vacancies, permanent_drop blocks that fell off the
  -- regular calendar (20260617000004), and -- per §5.3 -- a permanent_drop occurrence
  -- whose own week is inside the 30-day horizon, which is ALSO claimable for that one
  -- week. The dual emission is deliberate (20260724000004); do not collapse it.
  SELECT
    assignment_id, block_id, house_id, house_name, block_start_at, coverage_locked_at,
    vacancy_origin, desk_covered, 'weekly'::text AS feed
  FROM vacant_seats
  WHERE weekly_visible
    AND block_start_at < now() + interval '6 weeks'    -- OPEN_SHIFT_WEEKLY_HORIZON
    AND (
      vacancy_origin <> 'permanent_drop'
      OR NOT regular_school_year
      OR block_start_at <= now() + interval '30 days'
    )
),
-- MATERIALIZED is load-bearing: see defect 4 in the header. Inlined, this CTE's role
-- EXISTS is pushed into the join and re-evaluated once per output row (31,796 buffers).
-- Do not remove the keyword.
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
-- Cross-house eligibility matrix (canonical, crossHousePickup.ts): non-Harnwell houses
-- accept any candidate; Harnwell accepts only home-Harnwell workers. The home-house case
-- is subsumed. AGENTS hard invariant #1 -- unchanged, character for character.
WHERE ob.house_id <> 'harnwell' OR cu.home_house_id = 'harnwell';

GRANT SELECT ON worker_open_shifts TO anon, authenticated, service_role;

COMMENT ON VIEW worker_open_shifts IS
  'BSpec §5.1 open-shifts read model, one row per vacant SEAT per eligible worker. The two '
  'feeds OVERLAP by design: a permanently-dropped occurrence inside the 30-day horizon is '
  'emitted twice, once as permanent_opening (claim the whole remaining recurrence) and once '
  'as weekly (§5.3 claim this week only). Clients key cards on (span, feed), so the same '
  'assignment_id legitimately appears in both a weekly and a permanent card. Each feed is '
  'bounded by its own horizon: the weekly feed at 6 weeks (the navigable window), the '
  'permanent feed at 26 weeks so a dropped slot stays pickable as a whole recurrence all '
  'semester. Cost audit F-01: 130,343 shared buffers per read before, 1,483 after.';

-- rollback:
-- (re-apply worker_open_shifts from 20260724000004_permanent_occurrence_weekly_claim.sql)
-- DROP INDEX IF EXISTS shift_block_assignments_permanent_drop_idx;
