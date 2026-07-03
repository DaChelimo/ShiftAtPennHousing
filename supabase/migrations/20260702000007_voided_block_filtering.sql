-- Migration: Operating Seasons — voided-block filtering (P6, sweep).
--
-- A block retired by an admin config change (shift_blocks.voided_at set by
-- apply_compiled_season) must be invisible/inert on every live path. In practice
-- the reconciler already makes voided blocks self-excluding: it DELETES their vacant
-- seats and moves occupants to `cancelled_config`, and every feed / grid / claim
-- path filters on the active statuses (vacant / scheduled / claimed / floated_in /
-- pending_float_in). So the open-shifts feeds, claim_open_shift, and the orchestrator
-- (status = 'vacant' scans) already skip them.
--
-- This migration adds EXPLICIT voided_at IS NULL guards at the surfaces where it is
-- cheap and future-proofs against a change to the voiding strategy: the two house
-- schedule grids (visible rendering) and is_assignment_claimable (server-authoritative
-- claimability). The orchestrator edge function adds the same guard to its vacant
-- scans in code (defense-in-depth).

-- ============================================================
-- 1. is_assignment_claimable — a voided block is never claimable.
-- ============================================================
CREATE OR REPLACE FUNCTION is_assignment_claimable(
  p_assignment_id uuid,
  p_as_of timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM shift_block_assignments sba
    JOIN shift_blocks sb USING (block_id)
    WHERE sba.assignment_id = p_assignment_id
      AND sba.status = 'vacant'
      AND sb.voided_at IS NULL
      AND sb.block_start_at > p_as_of
      AND sb.coverage_locked_at IS NULL
      AND (
        sb.block_start_at > p_as_of + interval '2 hours'
        OR block_has_present_worker(sb.block_id)
      )
  );
$$;

-- ============================================================
-- 2. house_schedule_grid (home-house, security_invoker) — hide voided blocks.
-- ============================================================
CREATE OR REPLACE VIEW house_schedule_grid
WITH (security_invoker = true) AS
SELECT
  sb.house_id,
  h.name                                              AS house_name,
  h.desk_phone                                        AS desk_phone,
  sba.assignment_id::text                             AS id,
  sb.block_start_at                                   AS start_at,
  sb.block_start_at + interval '30 minutes'           AS end_at,
  sba.status::text                                    AS status,
  COALESCE(sba.is_float, false)                       AS is_float,
  COALESCE(sba.is_cross_house_pickup, false)          AS is_cross_house_pickup,
  sba.user_id                                         AS user_id,
  d.name                                              AS worker_name,
  d.phone                                             AS worker_phone,
  sb.block_id                                         AS block_id,
  sb.required_headcount                               AS required_headcount
FROM shift_block_assignments sba
JOIN shift_blocks sb USING (block_id)
JOIN houses h ON h.id = sb.house_id
LEFT JOIN worker_directory d ON d.user_id = sba.user_id
WHERE sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in', 'vacant')
  AND sb.voided_at IS NULL;

REVOKE ALL ON house_schedule_grid FROM PUBLIC, anon, authenticated;
GRANT SELECT ON house_schedule_grid TO authenticated, service_role;

-- ============================================================
-- 3. house_schedule_grid_any (cross-house, owner-rights) — hide voided blocks.
-- ============================================================
CREATE OR REPLACE VIEW house_schedule_grid_any AS
SELECT
  sb.house_id,
  h.name                                              AS house_name,
  h.desk_phone                                        AS desk_phone,
  sba.assignment_id::text                             AS id,
  sb.block_start_at                                   AS start_at,
  sb.block_start_at + interval '30 minutes'           AS end_at,
  sba.status::text                                    AS status,
  COALESCE(sba.is_float, false)                       AS is_float,
  COALESCE(sba.is_cross_house_pickup, false)          AS is_cross_house_pickup,
  sba.user_id                                         AS user_id,
  d.name                                              AS worker_name,
  d.phone                                             AS worker_phone
FROM shift_block_assignments sba
JOIN shift_blocks sb USING (block_id)
JOIN houses h ON h.id = sb.house_id
LEFT JOIN worker_directory d ON d.user_id = sba.user_id
WHERE sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in', 'vacant')
  AND sb.voided_at IS NULL;

REVOKE ALL ON house_schedule_grid_any FROM PUBLIC, anon, authenticated;
GRANT SELECT ON house_schedule_grid_any TO authenticated, service_role;

-- rollback: restore the pre-voided_at definitions from 20260615000001 /
-- 20260623000003 / 20260627000001.
