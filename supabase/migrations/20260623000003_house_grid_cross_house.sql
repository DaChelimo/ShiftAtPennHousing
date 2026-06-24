-- Migration: cross-house schedule grid for the worker app's House tab.
--
-- USER RULING (2026-06-23): a worker (student) may VIEW any house's schedule
-- from the mobile House tab — defaulting to their own home house, but free to
-- switch to any other house and read its week grid (who staffs each block + the
-- vacant gaps) plus the desk phone. Read-only: this changes VISIBILITY only; no
-- write path is opened (assignment writes stay gated by the existing per-house
-- shift_block_assignments policies + the hard invariants).
--
-- Mirrors the worker_directory pattern (2026-06-12 ruling): an owner-rights VIEW
-- that bypasses the per-caller shift_block_assignments SELECT RLS, exposing ONLY
-- the same safe columns the home-house house_schedule_grid already exposes. Worker
-- name/phone are already a full cross-house directory (worker_directory), so this
-- adds no contact exposure beyond who-is-on-which-block + vacant gaps.
--
-- The existing security_invoker `house_schedule_grid` is UNCHANGED on purpose: the
-- swap calendar and break calendar read it and MUST stay scoped to the caller's
-- home house. Only the House tab reads this cross-house view.
--
-- Honors invariants: block atomicity (#5 — one row per 30-min seat) and timezone
-- (#6 — timestamptz passthrough). Idempotent: CREATE OR REPLACE VIEW.

-- ---------------------------------------------------------------------------
-- house_schedule_grid_any — the §11.4 grid for ANY house, readable by any
-- authenticated worker. Owner-rights (NO security_invoker) so it bypasses the
-- home-house shift_block_assignments RLS. Same projection as house_schedule_grid.
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
  d.phone                                             AS worker_phone
FROM shift_block_assignments sba
JOIN shift_blocks sb USING (block_id)
JOIN houses h ON h.id = sb.house_id
LEFT JOIN worker_directory d ON d.user_id = sba.user_id
WHERE sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in', 'vacant');

-- Join view (not auto-updatable), but keep the grant surface explicit and minimal:
-- SELECT-only for authenticated; nothing for anon. Owner-rights is the whole point —
-- a worker reads every house's grid through it, scoped by the app, not RLS.
REVOKE ALL ON house_schedule_grid_any FROM PUBLIC, anon, authenticated;
GRANT SELECT ON house_schedule_grid_any TO authenticated, service_role;

COMMENT ON VIEW house_schedule_grid_any IS
  'BSpec §11.4 house schedule grid for ANY house (2026-06-23 ruling: workers may '
  'view other houses read-only from the mobile House tab). Owner-rights — bypasses '
  'the per-caller shift_block_assignments home-house RLS; same safe projection as '
  'house_schedule_grid (worker name/phone via worker_directory + desk phone). '
  'Present seats + vacant gaps. SELECT-only. Read visibility only — no write path.';

-- rollback:
-- DROP VIEW IF EXISTS house_schedule_grid_any;
