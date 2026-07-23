-- Migration: worker contact card — email + home house on the directory and the
-- house schedule grids (BSpec §11.4 cross-worker contact).
--
-- USER RULING (2026-07-22): tapping someone's shift on the mobile House grid opens
-- their contact card, and that card must carry name / house / phone / EMAIL, with
-- one-tap call and one-tap email. Email is the address the worker signed up with
-- (`users.email`), so this WIDENS the 2026-06-12 parity T3b projection, which
-- deliberately exposed only user_id/name/phone/home_house_id/is_active.
--
-- Scope of the widening, deliberately narrow:
--   * `worker_directory` gains `email` only. It stays a single-relation,
--     SELECT-only, owner-rights view over ACTIVE users, so the same "any
--     authenticated worker may look up any active worker" ruling now covers the
--     work email alongside the phone. No auth linkage, no broadcast flag, still
--     no writes (the REVOKE below is re-asserted because CREATE OR REPLACE VIEW
--     re-runs Supabase's default grants).
--   * The two house grids gain `worker_email` plus the worker's HOME house
--     (`worker_home_house_id` / `worker_home_house_name`) so the card can say
--     which house the person belongs to. That is NOT the same as the grid's
--     existing `house_name`, which is the DESK being staffed — for a float-in
--     they differ, and that difference is exactly what the card should show.
--
-- People-admin over users/user_roles stays hm/bm-only (phase-07 pinned note): this
-- is a read projection, not a policy change. Honors invariants #5 (rows stay one
-- per 30-min seat) and #6 (timestamptz passthrough).
-- Idempotent: CREATE OR REPLACE VIEW throughout. NOTE the new columns are APPENDED
-- to each projection rather than slotted next to the fields they belong with:
-- CREATE OR REPLACE VIEW may only add columns at the END (anything else is
-- "cannot change name of view column"), and every client selects by name, so
-- appending keeps this a replace instead of a DROP + recreate of three views.

-- ---------------------------------------------------------------------------
-- 1. worker_directory — add the sign-up email.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW worker_directory AS
SELECT
  user_id,
  name,
  phone,
  home_house_id,
  is_active,
  email
FROM users
WHERE is_active;

-- LOAD-BEARING (see 20260612000001): the view is auto-updatable, so without the
-- revoke Supabase's ALTER DEFAULT PRIVILEGES would let an authenticated worker
-- UPDATE users THROUGH it, bypassing the own-row RLS.
REVOKE ALL ON worker_directory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON worker_directory TO authenticated, service_role;

COMMENT ON VIEW worker_directory IS
  'BSpec §11.4 contact lookup. FULL directory per the 2026-06-12 parity T3b '
  'ruling, widened 2026-07-22 to carry the sign-up email for the mobile contact '
  'card: any authenticated worker reads any active worker''s name / phone / email. '
  'Owner-rights (bypasses users own-row RLS) on purpose; exposes only '
  'user_id/name/phone/email/home_house_id/is_active. SELECT-only.';

-- ---------------------------------------------------------------------------
-- 2. house_schedule_grid (home-house, security_invoker) — carry the occupant's
--    email + home house alongside their name/phone. Everything else is the
--    20260702000007 definition verbatim (incl. the voided_at guard).
-- ---------------------------------------------------------------------------
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
  sb.required_headcount                               AS required_headcount,
  d.email                                             AS worker_email,
  d.home_house_id                                     AS worker_home_house_id,
  wh.name                                             AS worker_home_house_name
FROM shift_block_assignments sba
JOIN shift_blocks sb USING (block_id)
JOIN houses h ON h.id = sb.house_id
LEFT JOIN worker_directory d ON d.user_id = sba.user_id
LEFT JOIN houses wh ON wh.id = d.home_house_id
WHERE sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in', 'vacant')
  AND sb.voided_at IS NULL;

REVOKE ALL ON house_schedule_grid FROM PUBLIC, anon, authenticated;
GRANT SELECT ON house_schedule_grid TO authenticated, service_role;

COMMENT ON VIEW house_schedule_grid IS
  'BSpec §11.4 house grid, home-house scoped by the shift_block_assignments RLS '
  '(security_invoker). One row per 30-min seat (invariant #5). Carries the '
  'occupant''s contact fields (name/phone/email) and their HOME house, which '
  'differs from house_name for a float-in.';

-- ---------------------------------------------------------------------------
-- 3. house_schedule_grid_any (cross-house, owner-rights) — same projection.
-- ---------------------------------------------------------------------------
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
  d.phone                                             AS worker_phone,
  d.email                                             AS worker_email,
  d.home_house_id                                     AS worker_home_house_id,
  wh.name                                             AS worker_home_house_name
FROM shift_block_assignments sba
JOIN shift_blocks sb USING (block_id)
JOIN houses h ON h.id = sb.house_id
LEFT JOIN worker_directory d ON d.user_id = sba.user_id
LEFT JOIN houses wh ON wh.id = d.home_house_id
WHERE sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in', 'vacant')
  AND sb.voided_at IS NULL;

REVOKE ALL ON house_schedule_grid_any FROM PUBLIC, anon, authenticated;
GRANT SELECT ON house_schedule_grid_any TO authenticated, service_role;

COMMENT ON VIEW house_schedule_grid_any IS
  'BSpec §11.4 house grid for ANY house (2026-06-23 cross-house view ruling). '
  'Owner-rights, read-only. Same projection as house_schedule_grid, incl. the '
  'occupant''s email + home house for the contact card.';

-- rollback: restore the 20260612000001 worker_directory (no email) and the
-- 20260702000007 grid definitions (no worker_email / worker_home_house_*).
