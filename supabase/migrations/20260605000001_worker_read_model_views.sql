-- Migration: worker read-model views
-- Backs the KMP worker app's WorkerShiftsRepository, which reads two PostgREST
-- relations: worker_my_shifts (client filters by user_id) and worker_open_shifts
-- (client filters by eligible_user_id). See
-- apps/mobile/docs/worker-read-model/TEST_PLAN.md for the authoritative contract.
--
-- Design decisions (do not revisit; see TEST_PLAN §0):
--   * One row per 30-minute block (no contiguous-run merging).
--   * dropped_still_open is not derivable from the schema -> always false.
--   * Predicates reuse the canonical cross-house matrix (crossHousePickup.ts)
--     and the feed/break-phase rules (weekly_open_shifts_feed).
--   * The views expose the key id columns (user_id, eligible_user_id) but do NOT
--     self-filter by them -- the client applies the WHERE.

-- ---------------------------------------------------------------------------
-- worker_my_shifts: the authenticated worker's own assigned blocks.
--
-- security_invoker = true so the existing per-worker RLS on
-- shift_block_assignments ("users can select own assignments") scopes rows to
-- the authenticated worker (TEST_PLAN §3.1 Security).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW worker_my_shifts
WITH (security_invoker = true) AS
SELECT
  sba.user_id                                         AS user_id,
  sba.assignment_id::text                             AS id,
  sb.house_id                                         AS house_id,
  h.name                                              AS house_name,
  sb.block_start_at                                   AS start_at,
  sb.block_start_at + interval '30 minutes'           AS end_at,
  CASE
    WHEN sba.status IN ('floated_in', 'pending_float_in') THEN 'float_out'
    WHEN sba.status = 'claimed'                           THEN 'temp_pickup'
    WHEN sba.status = 'scheduled'                         THEN 'scheduled'
    ELSE 'scheduled'
  END                                                 AS kind,
  COALESCE(sba.is_cross_house_pickup, false)
    OR (COALESCE(sba.is_float, false) AND sba.source_house_id IS NOT NULL)
                                                      AS cross_house,
  sba.status IN ('pending_float_in', 'pending_float_out')
                                                      AS pending,
  EXISTS (
    SELECT 1
    FROM operating_calendar oc
    JOIN break_periods bp
      ON oc.date BETWEEN bp.start_date AND bp.end_date
     AND oc.profile_name = bp.profile_name
    WHERE oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
  )                                                   AS break_shift,
  false                                               AS dropped_still_open
FROM shift_block_assignments sba
JOIN shift_blocks sb USING (block_id)
JOIN houses h ON h.id = sb.house_id
WHERE sba.user_id IS NOT NULL
  AND sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in');

-- ---------------------------------------------------------------------------
-- worker_open_shifts: open (vacant, future) blocks crossed with the workers
-- eligible to claim them.
--
-- Runs OWNER-SIDE (no security_invoker): cross-house vacant rows would be
-- hidden by per-worker RLS otherwise. The client's eligible_user_id filter is
-- the scoping (TEST_PLAN §3.3 Security).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW worker_open_shifts AS
WITH open_blocks AS (
  SELECT
    sba.assignment_id,
    sb.block_id,
    sb.house_id,
    sb.block_start_at,
    sba.vacancy_origin,
    CASE
      WHEN sba.vacancy_origin = 'permanent_drop' THEN 'permanent_opening'
      ELSE 'weekly'
    END AS feed
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.status = 'vacant'
    AND sb.block_start_at > now()
    -- Weekly rows: exclude blocks whose NY-local date is in a break period not
    -- in its open_feed phase. Permanent openings are not break-phase filtered.
    AND (
      sba.vacancy_origin = 'permanent_drop'
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

GRANT SELECT ON worker_my_shifts  TO anon, authenticated, service_role;
GRANT SELECT ON worker_open_shifts TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reference-table read access for the authenticated worker.
-- worker_my_shifts runs security_invoker, so the worker must be able to SELECT
-- the structural/reference rows it inner-joins (houses, shift_blocks). Those
-- tables otherwise expose only a service_role bypass, which collapses the join
-- to zero rows for a logged-in worker. House names + block time-slots are
-- non-sensitive reference data; the worker's own assignment rows stay scoped by
-- the existing per-worker RLS on shift_block_assignments. (Idempotent.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS houses_authenticated_read ON houses;
CREATE POLICY houses_authenticated_read ON houses
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS shift_blocks_authenticated_read ON shift_blocks;
CREATE POLICY shift_blocks_authenticated_read ON shift_blocks
  FOR SELECT TO authenticated USING (true);

-- rollback:
-- DROP POLICY IF EXISTS shift_blocks_authenticated_read ON shift_blocks;
-- DROP POLICY IF EXISTS houses_authenticated_read ON houses;
-- DROP VIEW IF EXISTS worker_open_shifts;
-- DROP VIEW IF EXISTS worker_my_shifts;
