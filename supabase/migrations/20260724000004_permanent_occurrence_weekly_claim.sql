-- Migration: a permanently-dropped occurrence inside the 30-day horizon is also a WEEKLY
-- opening, and is temporarily claimable for that one week (BSpec §5.1, §5.3, §8.4.3).
--
-- BUG (spec-vs-code divergence found 2026-07-24). BSpec states in four places that the two
-- feeds OVERLAP on a permanently-dropped slot's near-term occurrences:
--   §5.1  "A permanently-dropped recurring slot's next occurrence enters the 30-day horizon
--          (each weekly occurrence surfaces here as it approaches)."
--   §5.1  "A permanently-dropped slot's individual weekly occurrences still surface in the
--          weekly feed as they cross the 30-day horizon ... The permanent openings feed
--          exists in parallel so that workers can claim the entire remaining recurrence in
--          one action rather than picking it up week-by-week."
--   §5.3  "A worker may also temporarily claim a single occurrence of a permanently-dropped
--          slot that has surfaced in the weekly feed ... The permanent ownership of the slot
--          is unchanged."
--   §8.4.3 step 2: entering through the weekly feed offers "pick up this week only" OR
--          "pick up permanently"; entering through the permanent feed offers only the latter.
--
-- The original phase-05 SQL layer implements that overlap correctly: weekly_open_shifts_feed
-- (20260527000006) filters on status = 'vacant' + the 30-day horizon and does NOT exclude
-- permanent_drop, while permanent_openings_feed groups the permanent_drop ones. Both feeds
-- return the same near-term occurrence, exactly as specified.
--
-- The exclusivity was introduced only in the client-facing read model. worker_open_shifts
-- (20260605000001) partitioned the two feeds with an EXCLUSIVE CASE:
--     CASE WHEN vacancy_origin = 'permanent_drop' THEN 'permanent_opening' ELSE 'weekly' END
-- even though that migration's own header claims its "Predicates reuse ... the feed/break-
-- phase rules (weekly_open_shifts_feed)" -- which it then contradicts. No rationale for the
-- exclusivity is recorded in any migration. Since every client reads the view and nothing
-- outside pgTAP calls weekly_open_shifts_feed, the spec's temporary occurrence claim became
-- unreachable: a permanent_drop seat never rendered as a weekly card, so there was no
-- surface from which to claim one week of it.
--
-- COST OF THE DIVERGENCE. Escalation is block-scoped and ignores vacancy_origin, so a
-- permanently-dropped Tuesday slot with 11 weeks left that nobody wants to OWN generated 11
-- weeks of empty-desk escalations ending in paid Allied coverage, while students who would
-- happily take a single week had no way to claim one.
--
-- FIX (two parts).
--
-- 1. worker_open_shifts emits a permanent_drop occurrence TWICE while it is inside the
--    30-day horizon: once as its permanent_opening row (the whole-recurrence pickup) and
--    once as a weekly row (this week only). The client merge key already includes `feed`
--    (openShiftMergeKey / Coalesce.kt), so the two rows coalesce into two distinct cards --
--    which is precisely the §8.4.3 step 1 surface pair. Outside the horizon the occurrence
--    is permanent-only, as before.
--
-- 2. claim_open_shift may now land on a permanent_drop seat, but only as a FALLBACK. It is
--    unambiguously the temporary path (permanent pickup goes through permanent_pickup_slot /
--    the permanent-pickup Edge Function), so any call to it is a §5.3 temporary claim. The
--    seat pick drains ordinary weekly vacancies FIRST and takes a permanent_drop seat only
--    when the block has no other open seat. That keeps a permanent opening permanently
--    pickable for as long as the block offers any alternative, while still making the §5.3
--    single-occurrence claim reachable. A permanent_drop seat is eligible only while its own
--    week is inside the 30-day horizon -- the same condition that put it in the weekly feed.
--
--    When a weekly claim does consume a permanent_drop seat, the seat becomes
--    status = 'claimed', vacancy_origin = 'none' for that week only. Every OTHER week of the
--    slot stays vacant/permanent_drop, so the slot remains in the permanent openings feed
--    with weeks_remaining decremented by one -- exactly §5.3's "permanent ownership of the
--    slot is unchanged; other future weeks still need a permanent picker".
--
-- ALSO FIXED HERE: 20260627000001 silently reverted 20260617000004. Being the later
-- migration, its CREATE OR REPLACE VIEW dropped the profile_name = 'regular_school_year'
-- filter from BOTH the feed CASE and the weeks_remaining subquery, re-introducing the
-- phantom "N weeks remaining" card that 20260617000004 fixed (a permanent_drop block off the
-- regular calendar showed in the permanent feed but was invisible to the permanent-pickup
-- candidate filter, so it could never be picked up and never left the feed). Both filters
-- are restored below.

-- ---------------------------------------------------------------------------
-- 1. worker_open_shifts: the two feeds overlap on near-term permanent openings.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW worker_open_shifts AS
WITH vacant_seats AS (
  SELECT
    sba.assignment_id,
    sb.block_id,
    sb.house_id,
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
    ) AS weekly_visible
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.status = 'vacant'
    AND sb.block_start_at > now()
),
open_blocks AS (
  -- The permanent openings feed (§5.1): the whole remaining recurrence, one row per vacant
  -- occurrence. Not break-phase filtered.
  SELECT
    assignment_id, block_id, house_id, block_start_at, coverage_locked_at,
    vacancy_origin, 'permanent_opening'::text AS feed
  FROM vacant_seats
  WHERE vacancy_origin = 'permanent_drop'
    AND regular_school_year

  UNION ALL

  -- The weekly feed (§5.1): ordinary vacancies, permanent_drop blocks that fell off the
  -- regular calendar (20260617000004), and -- per §5.3 -- a permanent_drop occurrence whose
  -- own week is inside the 30-day horizon, which is ALSO claimable for that one week.
  SELECT
    assignment_id, block_id, house_id, block_start_at, coverage_locked_at,
    vacancy_origin, 'weekly'::text AS feed
  FROM vacant_seats
  WHERE weekly_visible
    AND (
      vacancy_origin <> 'permanent_drop'
      OR NOT regular_school_year
      OR block_start_at <= now() + interval '30 days'
    )
),
candidate_users AS (
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
  h.name                                      AS house_name,
  ob.block_start_at                           AS start_at,
  ob.block_start_at + interval '30 minutes'   AS end_at,
  ob.feed                                     AS feed,
  (ob.house_id = cu.home_house_id)            AS home_house,
  CASE
    WHEN ob.feed = 'permanent_opening' THEN (
      SELECT count(*)::integer
      FROM shift_block_assignments sba2
      JOIN shift_blocks sb2 USING (block_id)
      WHERE sba2.status = 'vacant'
        AND sba2.vacancy_origin = 'permanent_drop'
        AND sb2.house_id = ob.house_id
        AND sb2.block_start_at >= now()
        AND EXTRACT(
              ISODOW FROM (sb2.block_start_at AT TIME ZONE 'America/New_York')
            )
            = EXTRACT(
              ISODOW FROM (ob.block_start_at AT TIME ZONE 'America/New_York')
            )
        AND (sb2.block_start_at AT TIME ZONE 'America/New_York')::time
            = (ob.block_start_at AT TIME ZONE 'America/New_York')::time
        -- Count only regular-school-year weeks: the pre-pickup count must equal what the
        -- pickup can actually take (20260617000004, reverted by 20260627000001).
        AND EXISTS (
          SELECT 1
          FROM operating_calendar oc
          WHERE oc.date = (sb2.block_start_at AT TIME ZONE 'America/New_York')::date
            AND oc.profile_name = 'regular_school_year'
        )
    )
    ELSE NULL
  END                                         AS weeks_remaining,
  (ob.coverage_locked_at IS NOT NULL)         AS coverage_locked,
  block_has_present_worker(ob.block_id)       AS desk_covered
FROM open_blocks ob
JOIN houses h ON h.id = ob.house_id
CROSS JOIN candidate_users cu
-- Cross-house eligibility matrix (canonical, crossHousePickup.ts): non-Harnwell houses
-- accept any candidate; Harnwell accepts only home-Harnwell workers. The home-house case is
-- subsumed.
WHERE ob.house_id <> 'harnwell' OR cu.home_house_id = 'harnwell';

GRANT SELECT ON worker_open_shifts TO anon, authenticated, service_role;

COMMENT ON VIEW worker_open_shifts IS
  'BSpec §5.1 open-shifts read model, one row per vacant SEAT per eligible worker. The two '
  'feeds OVERLAP by design: a permanently-dropped occurrence inside the 30-day horizon is '
  'emitted twice, once as permanent_opening (claim the whole remaining recurrence) and once '
  'as weekly (§5.3 claim this week only). Clients key cards on (span, feed), so the same '
  'assignment_id legitimately appears in both a weekly and a permanent card.';

-- ---------------------------------------------------------------------------
-- 2. claim_open_shift: ordinary seats first, permanent_drop seats as fallback.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_open_shift(
  p_assignment_id uuid,
  p_user_id uuid,
  p_as_of timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT user_id, home_house_id, is_active
  INTO v_claimer
  FROM users
  WHERE user_id = p_user_id;

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
$$;

COMMENT ON FUNCTION claim_open_shift(uuid, uuid, timestamptz) IS
  'BSpec §5.3 temporary claim (the permanent path is permanent_pickup_slot). The '
  'assignment_id names the BLOCK; the RPC claims any still-open seat on it (FOR UPDATE SKIP '
  'LOCKED = FCFS), so concurrent claimers on a multi-staff desk split the open seats instead '
  'of colliding on the coalesced card''s representative lane. Ordinary vacancies are drained '
  'before a permanent_drop seat, and a permanent_drop seat is eligible only inside the §5.1 '
  '30-day horizon; taking one is the §5.3 single-occurrence claim and leaves every other '
  'week of the slot in the permanent openings feed. Guards: active user, coverage-conditional '
  'T-2h lock (§5.4/§5.5), Harnwell training (#1), per-block time conflict, weekly hard cap '
  '(§9.2). Returns the assignment_id actually claimed, which may differ from the one '
  'requested. Raises shift_unavailable when the block has no open seat left.';

-- rollback:
-- (re-apply worker_open_shifts and claim_open_shift from
--  20260724000003_claim_open_shift_seat_agnostic.sql + 20260627000001)
