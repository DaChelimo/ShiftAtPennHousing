-- Migration: revoke anon SELECT on worker_open_shifts. AGAIN.
--
-- FOURTH occurrence of one regression. 20260711000005_revoke_anon_worker_reads.sql removed
-- anon's SELECT because worker_open_shifts is an OWNER-RIGHTS view (no security_invoker), so
-- RLS on the underlying tables does NOT apply to it: whoever can SELECT the view sees every
-- row it returns. Two later migrations recreated the view and copied the original GRANT
-- block verbatim, silently restoring anon:
--
--   20260724000004_permanent_occurrence_weekly_claim.sql:196
--   20260726000001_open_shifts_horizon_bound.sql:324    <- the one in effect
--
-- This was not theoretical. Confirmed against the live staging project on 2026-07-27:
--
--   curl 'https://<ref>.supabase.co/rest/v1/worker_open_shifts?select=*&limit=1' \
--        -H 'apikey: <ANON KEY>'
--   -> 200, returning a real worker's user_id, house and shift window
--
-- The anon key is public by design and ships inside the mobile app, so this exposed real
-- staff identifiers and the full open-shift board to anyone on the internet.
-- worker_my_shifts / worker_pending_floats / worker_recent_floats correctly returned
-- 42501 permission denied, which is the shape all four must have.
--
-- WHY IT KEEPS COMING BACK: CREATE OR REPLACE VIEW does not reset privileges, but these
-- migrations DROP and recreate the view, which does. The GRANT line then gets copied along
-- with the view body. scripts/hooks/anon-grant-guard.js was written to catch exactly this
-- but is not committed or registered in .claude/settings.json, so it never ran.
--
-- Any future migration that recreates worker_open_shifts MUST grant only
-- `authenticated, service_role`. Never add anon back.

REVOKE ALL ON worker_open_shifts FROM anon, PUBLIC;

-- Re-assert the intended posture on all four worker views, so this migration is a single
-- authoritative statement of it rather than a patch to one view.
REVOKE ALL ON worker_my_shifts      FROM anon, PUBLIC;
REVOKE ALL ON worker_pending_floats FROM anon, PUBLIC;
REVOKE ALL ON worker_recent_floats  FROM anon, PUBLIC;

GRANT SELECT ON worker_open_shifts    TO authenticated, service_role;
GRANT SELECT ON worker_my_shifts      TO authenticated, service_role;
GRANT SELECT ON worker_pending_floats TO authenticated, service_role;
GRANT SELECT ON worker_recent_floats  TO authenticated, service_role;

-- rollback:
-- (deliberately none: restoring anon SELECT on an owner-rights worker view is the bug.)
