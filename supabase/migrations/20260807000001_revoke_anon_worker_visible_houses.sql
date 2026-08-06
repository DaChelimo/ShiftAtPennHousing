-- Migration: revoke anon SELECT on worker_visible_houses.
--
-- Audit finding F2 (2026-08-07): worker_visible_houses was created (20260712000001) with
-- only a GRANT to authenticated/service_role, never an explicit REVOKE FROM anon -- unlike
-- its sibling worker_* views (worker_open_shifts, worker_my_shifts, worker_pending_floats,
-- worker_recent_floats), which all got the anon revoke in 20260727000003. Because this view
-- never had the anon grant explicitly revoked, and CREATE OR REPLACE VIEW preserves existing
-- privileges, Supabase's default at-CREATE anon grant has stood the whole time -- confirmed
-- live via information_schema.role_table_grants and by querying the view directly.
--
-- This view is documented as worker-facing only ("never reaches the cross-house switcher"
-- per 20260725000001's own comment); anon should not be able to read house names,
-- desk_phone, or the staggered-launch state.

REVOKE ALL ON worker_visible_houses FROM anon, PUBLIC;
GRANT SELECT ON worker_visible_houses TO authenticated, service_role;

-- Any future CREATE OR REPLACE VIEW worker_visible_houses MUST NOT add a GRANT block that
-- includes anon, and should re-run this REVOKE if the object is dropped and recreated
-- (a DROP VIEW loses grants; CREATE OR REPLACE VIEW does not).

-- rollback:
-- GRANT SELECT ON worker_visible_houses TO anon, authenticated, service_role;
