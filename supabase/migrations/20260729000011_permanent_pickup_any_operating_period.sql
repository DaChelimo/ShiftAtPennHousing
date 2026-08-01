-- Migration: permanent PICKUP works in any schedule-built operating period, not only a
-- regular school year (stakeholder decision 2026-07-29).
--
-- WHY. A summer season runs ~10 weeks of recurring slots. With the permanent feed and
-- the pickup EF both gated on `profile_name = 'regular_school_year'`, a worker who
-- wanted a summer slot for the whole season had to claim it week by week, nine separate
-- times, and a worker who wanted to hand one over could not offer it as a recurrence at
-- all. Permanent drop was fixed for seasons in 20260729000003; this is the other half,
-- so give and take are symmetric: if a slot can be permanently dropped, it can be
-- permanently picked up.
--
-- WHAT CHANGES HERE. Two predicates in worker_open_shifts, both of which asked "is this
-- a regular-school-year day?" and now ask "is this a SCHEDULE-BUILT day?":
--
--   * vacant_seats.regular_school_year -> vacant_seats.schedule_built, which gates the
--     permanent_opening feed (and, negated, the weekly feed's dual emission), and
--   * the identical predicate inside permanent_slot_weeks, which computes the advertised
--     "N weeks remaining".
--
-- Those two MUST stay identical: the first decides what is advertised, the second says
-- how much of it there is, and they are read together on one card.
--
-- MODE, NOT NAME. `operating_profiles.scheduling_mode = 'sm_built'` rather than a list
-- of profile names, for two reasons. A season is compiled into SEVERAL phase profiles
-- (s_summer2026_20260601, s_summer2026_20260701, ...), so no single name identifies it.
-- And the exclusion the old equality actually bought was claim-based BREAK days, which
-- have no recurring slot to pick up; `sm_built` keeps exactly that exclusion. This is
-- the same predicate 20260729000003 used for permanent drop, deliberately.
--
-- THE SYMMETRY RULE STILL HOLDS (20260617000004): the feed must never advertise a
-- recurrence the pickup cannot take. The permanent-pickup Edge Function's
-- candidateBlocks() and semesterEndDate() are widened in the SAME commit to the same
-- `sm_built` rule and the same current-or-upcoming-period boundary. Changing either side
-- alone reintroduces exactly the mismatch that rule exists to prevent.
--
-- NO GRANT BLOCK BELOW, deliberately. CREATE OR REPLACE VIEW preserves existing
-- privileges, and copying the original `GRANT SELECT ... TO anon, ...` line is what
-- re-granted anon read on this view three times already (20260711000005,
-- 20260727000003, and the guard hook that now blocks it).
--
-- View body is the 20260726000001 definition with only those two predicates changed;
-- every cost-audit structure (the MATERIALIZED hint, the inline desk_covered EXISTS,
-- the two horizons) is untouched.

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
    -- A permanent opening exists on any SCHEDULE-BUILT operating day: that is exactly
    -- the candidate filter candidateBlocks() applies in the permanent-pickup EF, so the
    -- feed must not advertise a slot the pickup cannot take (20260617000004).
    -- WIDENED 2026-07-29 from a school-year profile equality to the profile's MODE, so a
    -- summer season's recurring slots are permanently pickable too. A claim-based day (a
    -- break) still has no recurring slot and stays excluded, which is the exclusion the
    -- old profile equality was really buying. Mode, not name: a season spans several
    -- phase profiles (s_summer2026_20260601, _20260701, ...).
    EXISTS (
      SELECT 1
      FROM operating_calendar oc
      JOIN operating_profiles op ON op.profile_name = oc.profile_name
      WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
        AND op.scheduling_mode = 'sm_built'
    ) AS schedule_built,
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
    -- Count only SCHEDULE-BUILT weeks: the pre-pickup count must equal what the pickup
    -- can actually take (20260617000004, reverted by 20260627000001). Same widening as
    -- above; these two predicates must stay identical or the advertised
    -- "N weeks remaining" stops matching the recurrence the pickup will hand over.
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
  -- The permanent openings feed (§5.1): the whole remaining recurrence, one row per
  -- vacant occurrence. Not break-phase filtered. Its own, longer horizon.
  SELECT
    assignment_id, block_id, house_id, house_name, block_start_at, coverage_locked_at,
    vacancy_origin, desk_covered, 'permanent_opening'::text AS feed
  FROM vacant_seats
  WHERE vacancy_origin = 'permanent_drop'
    AND schedule_built
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
      OR NOT schedule_built
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

COMMENT ON VIEW worker_open_shifts IS
  'BSpec §5.1 open-shifts read model, one row per vacant SEAT per eligible worker. The two '
  'feeds OVERLAP by design: a permanently-dropped occurrence inside the 30-day horizon is '
  'emitted twice, once as permanent_opening (claim the whole remaining recurrence) and once '
  'as weekly (§5.3 claim this week only). Clients key cards on (span, feed), so the same '
  'assignment_id legitimately appears in both a weekly and a permanent card. Each feed is '
  'bounded by its own horizon: the weekly feed at 6 weeks (the navigable window), the '
  'permanent feed at 26 weeks. A permanent opening exists on any SCHEDULE-BUILT day '
  '(operating_profiles.scheduling_mode = ''sm_built''), so summer seasons are in scope as of '
  '2026-07-29; claim-based break days are not, because they carry no recurring slot.';

-- rollback:
-- (re-apply worker_open_shifts from 20260726000001_open_shifts_horizon_bound.sql, which
--  restores the regular_school_year gate and with it the summer pickup gap. Do NOT copy
--  that file's GRANT line to anon when doing so.)
