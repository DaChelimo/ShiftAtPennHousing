-- ============================================================================
-- Float / escalation manual-test fixtures  (run against the LOCAL Supabase only)
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f docs/float-testing/setup.sql
--
-- Establishes a deterministic, clean world for manually testing the float +
-- escalation flows (see GUIDE.md). Idempotent — re-run any time to restore the
-- source houses to a clean state. Prerequisite: the manual-test seed must be
-- loaded (pnpm db:reset:manual), which creates the 3 houses + the Fall 2026
-- period + vacant seats.
--
-- What it does:
--   * Crews QUAD with 3 fixed workers and HARNWELL with 2, scheduled contiguously
--     all day across the whole period, so a floater's run always spans any gap
--     (a rotation-per-block schedule has no contiguous run to relocate).
--   * Marks both houses published; sets the HMOD rotor for the test weeks.
--   * Silences the 11 placeholder houses (house-03..13) so the campus-wide
--     orchestrator tick does not flood them / consume the float sources.
--   * Clears any leftover floats / exclusions / float-notifications / step state
--     and resets the dev sim-clock to real time.
--
-- It does NOT touch DuBois (left as the manual-test publish); DuBois gaps are
-- created per-scenario by dropping its scheduled worker (see GUIDE.md).
-- ============================================================================
\set ON_ERROR_STOP on
\set period '''c0000000-0000-4000-8000-0000000fa112'''
\set hm_quad '''f0000000-0000-4000-8000-00000002000a'''
\set hm_harnwell '''f0000000-0000-4000-8000-00000001000a'''

BEGIN;

-- 0. real-time clock
UPDATE dev_sim_clock SET offset_seconds = 0 WHERE id;

-- 1. clear transient float state
UPDATE shift_block_assignments SET parent_float_id = NULL WHERE parent_float_id IS NOT NULL;
DELETE FROM float_assignments;
DELETE FROM float_exclusions;
DELETE FROM notifications
WHERE type IN ('hmod_urgent', 'ack_reminder', 'broadcast')
   OR (type = 'personal_shift' AND payload->>'kind' = 'float_assigned');
DELETE FROM block_step_status;
-- normalize any leftover float-in/out seats (source -> scheduled, destination -> vacant)
UPDATE shift_block_assignments
SET status = 'scheduled', vacancy_origin = 'none', is_float = false,
    is_cross_house_pickup = false, source_house_id = NULL
WHERE status IN ('pending_float_out', 'floated_out');
UPDATE shift_block_assignments
SET status = 'vacant', vacancy_origin = 'temporary_drop', user_id = NULL,
    is_float = false, is_cross_house_pickup = false, source_house_id = NULL
WHERE status IN ('pending_float_in', 'floated_in');
-- restore DuBois drops to the recurring slot owner (single-staff: no dup risk)
UPDATE shift_block_assignments a
SET status = 'scheduled', vacancy_origin = 'none',
    user_id = (
      SELECT a2.user_id FROM shift_block_assignments a2
      JOIN shift_blocks b2 ON b2.block_id = a2.block_id
      WHERE b2.house_id = 'dubois' AND a2.status = 'scheduled' AND a2.user_id IS NOT NULL
        AND extract(isodow FROM (b2.block_start_at AT TIME ZONE 'America/New_York'))
            = extract(isodow FROM (b.block_start_at AT TIME ZONE 'America/New_York'))
        AND (b2.block_start_at AT TIME ZONE 'America/New_York')::time
            = (b.block_start_at AT TIME ZONE 'America/New_York')::time
      LIMIT 1
    )
FROM shift_blocks b
WHERE b.block_id = a.block_id AND b.house_id = 'dubois'
  AND a.status = 'vacant' AND a.vacancy_origin = 'temporary_drop';

-- 2. silence placeholder houses (they have no real staff)
DELETE FROM shift_block_assignments a USING shift_blocks b
WHERE a.block_id = b.block_id AND b.house_id LIKE 'house-%';

-- 3. crew QUAD: 3 fixed @upenn SWs, scheduled all day across the period
DELETE FROM shift_block_assignments a USING shift_blocks b
WHERE a.block_id = b.block_id AND b.house_id = 'quad'
  AND (b.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN '2026-06-15' AND '2026-12-17';
INSERT INTO shift_block_assignments (block_id, user_id, status, vacancy_origin)
SELECT b.block_id, c.user_id, 'scheduled', 'none'
FROM shift_blocks b
CROSS JOIN (
  SELECT u.user_id FROM users u
  WHERE u.home_house_id = 'quad' AND u.email LIKE '%@upenn.edu'
    AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.user_id AND r.role = 'sw')
  ORDER BY u.user_id LIMIT 3
) c
WHERE b.house_id = 'quad'
  AND (b.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN '2026-06-15' AND '2026-12-17';

-- 4. crew HARNWELL: 2 fixed @upenn SWs, scheduled all day across the period
DELETE FROM shift_block_assignments a USING shift_blocks b
WHERE a.block_id = b.block_id AND b.house_id = 'harnwell'
  AND (b.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN '2026-06-15' AND '2026-12-17';
INSERT INTO shift_block_assignments (block_id, user_id, status, vacancy_origin)
SELECT b.block_id, c.user_id, 'scheduled', 'none'
FROM shift_blocks b
CROSS JOIN (
  SELECT u.user_id FROM users u
  WHERE u.home_house_id = 'harnwell' AND u.email LIKE '%@upenn.edu'
    AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.user_id AND r.role = 'sw')
  ORDER BY u.user_id LIMIT 2
) c
WHERE b.house_id = 'harnwell'
  AND (b.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN '2026-06-15' AND '2026-12-17';

-- 5. publication markers (DuBois + Quad already present from earlier publishes)
INSERT INTO period_house_publications (period_id, house_id, published_at, published_by)
SELECT :period::uuid, 'harnwell', now(), :hm_harnwell::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM period_house_publications WHERE period_id = :period::uuid AND house_id = 'harnwell'
);

-- 6. HMOD rotor for the test weeks (Friday-anchored) -> hana-quad on duty
INSERT INTO hmod_rotor (week_start_date, hmod_user_id) VALUES
  ('2026-06-19', :hm_quad::uuid),
  ('2026-06-26', :hm_quad::uuid),
  ('2026-07-03', :hm_quad::uuid)
ON CONFLICT (week_start_date) DO UPDATE SET hmod_user_id = EXCLUDED.hmod_user_id;

COMMIT;

-- Sanity: who is crewed where
SELECT 'quad crew'     AS house, string_agg(DISTINCT split_part(u.email,'@',1), ', ' ORDER BY split_part(u.email,'@',1)) AS workers
FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id JOIN users u ON u.user_id = a.user_id
WHERE b.house_id = 'quad' AND a.status = 'scheduled'
UNION ALL
SELECT 'harnwell crew', string_agg(DISTINCT split_part(u.email,'@',1), ', ' ORDER BY split_part(u.email,'@',1))
FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id JOIN users u ON u.user_id = a.user_id
WHERE b.house_id = 'harnwell' AND a.status = 'scheduled';
