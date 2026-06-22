-- Migration: the permanent-openings feed must mirror the permanent-pickup
-- candidate filter (regular_school_year days only).
--
-- Bug: worker_open_shifts surfaced (and counted) EVERY vacant permanent_drop
-- block, with no break-day / semester filter. But both permanent_drop_slot and
-- the permanent-pickup Edge Function only ever touch regular_school_year days.
-- A permanent_drop block sitting on a break day (or otherwise off the regular
-- calendar) therefore showed in the permanent feed but was invisible to the
-- pickup -- it could never be picked up and never left the feed, stranding as a
-- phantom "N weeks remaining" card (BEH §8.4.3 intends the slot to leave the
-- permanent feed after any pickup; a non-pickable occurrence breaks that).
--
-- Fix: a block is a 'permanent_opening' ONLY when its NY-local date is a
-- regular_school_year day -- exactly the rule candidateBlocks() in the
-- permanent-pickup EF applies. Break-week occurrences are handled by the
-- break-claim pathway (open_break_claim_calendar), not the permanent feed.
-- weeks_remaining counts the same regular-school-year set, so the pre-pickup
-- count equals what is actually permanently pickable.
--
-- A non-regular vacant permanent_drop block now falls through to the WEEKLY
-- branch instead: hidden while its break period is pre_open/claim_window, and
-- surfaced as an ordinary weekly opening once the break reaches open_feed phase.

CREATE OR REPLACE VIEW worker_open_shifts AS
WITH open_blocks AS (
  SELECT
    sba.assignment_id,
    sb.block_id,
    sb.house_id,
    sb.block_start_at,
    sba.vacancy_origin,
    CASE
      WHEN sba.vacancy_origin = 'permanent_drop'
        AND EXISTS (
          SELECT 1
          FROM operating_calendar oc
          WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
            AND oc.profile_name = 'regular_school_year'
        )
      THEN 'permanent_opening'
      ELSE 'weekly'
    END AS feed
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.status = 'vacant'
    AND sb.block_start_at > now()
    AND (
      -- Permanent openings: regular-school-year days only (mirrors the
      -- permanent-pickup candidate filter). A permanent_drop block off the
      -- regular calendar is NOT a permanent opening.
      (
        sba.vacancy_origin = 'permanent_drop'
        AND EXISTS (
          SELECT 1
          FROM operating_calendar oc
          WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
            AND oc.profile_name = 'regular_school_year'
        )
      )
      -- Weekly rows (incl. any permanent_drop block that fell off the regular
      -- calendar): exclude blocks whose NY-local date is in a break period not
      -- yet in its open_feed phase.
      OR NOT EXISTS (
        SELECT 1
        FROM operating_calendar oc
        JOIN break_periods bp
          ON oc.date BETWEEN bp.start_date AND bp.end_date
        WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
          AND break_claim_phase(bp.break_id, now()) <> 'open_feed'
      )
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
        -- Count only regular-school-year weeks: the pre-pickup count must equal
        -- what the pickup can actually take.
        AND EXISTS (
          SELECT 1
          FROM operating_calendar oc
          WHERE oc.date = (sb2.block_start_at AT TIME ZONE 'America/New_York')::date
            AND oc.profile_name = 'regular_school_year'
        )
    )
    ELSE NULL
  END                                         AS weeks_remaining
FROM open_blocks ob
JOIN houses h ON h.id = ob.house_id
CROSS JOIN candidate_users cu
-- Cross-house eligibility matrix (canonical, crossHousePickup.ts): non-Harnwell
-- houses accept any candidate; Harnwell accepts only home-Harnwell workers. The
-- home-house case is subsumed.
WHERE ob.house_id <> 'harnwell' OR cu.home_house_id = 'harnwell';

GRANT SELECT ON worker_open_shifts TO anon, authenticated, service_role;

-- rollback: restore the pre-filter view from 20260605000001_worker_read_model_views.sql
