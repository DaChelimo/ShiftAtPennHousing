-- Migration: T3b-1 — cross-worker contact directory + house desk phone + house
-- schedule grid read model (BSpec §11.4; parity track T3b).
--
-- USER RULING (2026-06-12, parity T3b RLS decision): cross-worker contact is a
-- FULL DIRECTORY — any authenticated worker may read any active worker's name +
-- phone. Implemented as a dedicated owner-rights VIEW, NOT a USING(true) SELECT
-- policy on users: people-admin over users/user_roles stays hm/bm-only (phase-07
-- pinned note — do not collapse the helpers), and the directory exposes ONLY
-- user_id / name / phone / home_house_id / is_active (no email, no broadcast flag,
-- no auth linkage).
--
-- Honors invariants: block atomicity (#5 — grid rows are the per-block assignment
-- rows) and timezone (#6 — timestamptz passthrough).
-- Idempotent: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE VIEW.

-- ---------------------------------------------------------------------------
-- 1. houses.desk_phone — the desk's phone number (§11.4 "call the desk").
--    Nullable; real numbers are deploy data (placeholder houses ship none).
-- ---------------------------------------------------------------------------
ALTER TABLE houses ADD COLUMN IF NOT EXISTS desk_phone text;

COMMENT ON COLUMN houses.desk_phone IS
  'BSpec §11.4: the house desk''s phone, surfaced on the worker house grid / '
  'contact sheet. Deploy data — null until configured.';

-- ---------------------------------------------------------------------------
-- 2. worker_directory — the full contact directory (active workers only).
--    Owner-rights view (security_invoker NOT set) so it bypasses the own-row
--    users RLS BY DESIGN per the user ruling. SELECT-only is granted: the view
--    is technically auto-updatable (single relation), so granting only SELECT
--    is what keeps writes through it impossible for authenticated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW worker_directory AS
SELECT
  user_id,
  name,
  phone,
  home_house_id,
  is_active
FROM users
WHERE is_active;

-- LOAD-BEARING: Supabase's ALTER DEFAULT PRIVILEGES grants ALL on new public
-- objects to anon/authenticated — and this view is auto-updatable, so without
-- the revoke an authenticated worker could UPDATE users THROUGH the owner-rights
-- view, bypassing the own-row RLS entirely (caught by pgTAP t3b-directory-grid
-- test #10/#12 on the first run). SELECT-only, and nothing for anon.
REVOKE ALL ON worker_directory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON worker_directory TO authenticated, service_role;

COMMENT ON VIEW worker_directory IS
  'BSpec §11.4 contact lookup. FULL directory per the 2026-06-12 parity T3b '
  'ruling: any authenticated worker reads any active worker''s name + phone. '
  'Owner-rights (bypasses users own-row RLS) on purpose; exposes only '
  'user_id/name/phone/home_house_id/is_active. SELECT-only.';

-- ---------------------------------------------------------------------------
-- 3. house_schedule_grid — who staffs each 30-min block (§11.4 house grid).
--    security_invoker: the existing shift_block_assignments SELECT policies
--    (own / HOME-HOUSE / house-admin) scope the rows, so a plain worker sees
--    exactly their own house's grid and nothing of other houses. Names/phones
--    come via the (owner-rights) directory; the desk phone rides along.
--    Present seats (scheduled/claimed/floated_in/pending_float_in — the same
--    set drop_shift counts as physically present) plus vacant gaps.
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
  d.phone                                             AS worker_phone
FROM shift_block_assignments sba
JOIN shift_blocks sb USING (block_id)
JOIN houses h ON h.id = sb.house_id
LEFT JOIN worker_directory d ON d.user_id = sba.user_id
WHERE sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in', 'vacant');

-- Join view (not auto-updatable), but keep the grant surface explicit anyway.
REVOKE ALL ON house_schedule_grid FROM PUBLIC, anon, authenticated;
GRANT SELECT ON house_schedule_grid TO authenticated, service_role;

COMMENT ON VIEW house_schedule_grid IS
  'BSpec §11.4 house schedule grid: per-30-min-block staffing of a house with '
  'worker name/phone (via worker_directory) + the desk phone. security_invoker — '
  'the shift_block_assignments RLS (own/home-house/admin) scopes which houses a '
  'caller can see. Present seats + vacant gaps.';

-- rollback:
-- DROP VIEW IF EXISTS house_schedule_grid;
-- DROP VIEW IF EXISTS worker_directory;
-- ALTER TABLE houses DROP COLUMN IF EXISTS desk_phone;
