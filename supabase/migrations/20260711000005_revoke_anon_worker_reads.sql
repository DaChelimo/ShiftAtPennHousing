-- Migration: revoke the anon SELECT grant on the worker read-model views.
--
-- Security follow-through (2026-07-07 audit, HIGH). The worker portal now serves these
-- views over the web to authenticated Student Workers; nothing anonymous should read them.
--
-- worker_open_shifts is the material risk: it is an OWNER-RIGHTS view (no security_invoker),
-- so it bypasses shift_block_assignments RLS entirely. Its original grant (20260605000001,
-- re-applied verbatim by 20260617000004 and 20260627000001) handed SELECT to `anon`, which
-- let an UNAUTHENTICATED caller enumerate every open seat across every house (cross-joined
-- against the eligibility matrix). Revoking anon closes that.
--
-- The other three (worker_my_shifts, worker_pending_floats are security_invoker;
-- worker_recent_floats is owner-rights but self-scopes with auth.uid()) return nothing to an
-- anonymous caller anyway, but the anon grant is surface with no purpose. Revoke it too as
-- defense in depth. authenticated + service_role keep their access; the app is unaffected.
--
-- Supabase's ALTER DEFAULT PRIVILEGES hands anon ALL privileges on every new public
-- object (not just SELECT), so revoke ALL from anon (and PUBLIC) on these views — the same
-- hardening worker_directory / house_schedule_grid_any already apply. The views are not
-- auto-updatable (joins/aggregates), so the write privileges were inert, but leaving them
-- is needless surface. authenticated + service_role keep their SELECT; the app is
-- unaffected. Idempotent (REVOKE is a no-op if already revoked). Reversible (see rollback).

REVOKE ALL ON worker_open_shifts FROM anon, PUBLIC;
REVOKE ALL ON worker_my_shifts FROM anon, PUBLIC;
REVOKE ALL ON worker_pending_floats FROM anon, PUBLIC;
REVOKE ALL ON worker_recent_floats FROM anon, PUBLIC;

-- rollback:
-- GRANT SELECT ON worker_open_shifts, worker_my_shifts, worker_pending_floats,
--   worker_recent_floats TO anon;
