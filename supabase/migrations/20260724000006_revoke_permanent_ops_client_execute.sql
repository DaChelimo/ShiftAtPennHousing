-- Close a confused-deputy hole on the phase-10 permanent-ops SECURITY DEFINER RPCs.
--
-- All three take the acting worker's uuid as a TRUSTED argument
-- (p_picking_user_id / p_dropping_user_id / dropping_user_id) and never compare
-- it to auth.uid(). Identity is verified one layer up, in the Edge Functions
-- (supabase/functions/permanent-pickup, supabase/functions/permanent-drop),
-- which authenticate the JWT and then call the RPC with a service_role client
-- (see _shared/swap-http.ts authenticate()). The RPCs are therefore only safe
-- if service_role is the ONLY role that can execute them.
--
-- It was not. 20260531000001_phase_10_permanent_ops.sql did:
--   REVOKE ALL ON FUNCTION ... FROM PUBLIC;
--   GRANT EXECUTE ON FUNCTION ... TO service_role;
-- REVOKE ... FROM PUBLIC only strips the PUBLIC pseudo-role. Supabase ships an
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public that grants EXECUTE to anon,
-- authenticated and service_role at CREATE time, and those are explicit
-- per-role grants -- revoking PUBLIC leaves them intact. So any holder of the
-- anon or authenticated key could call the RPC directly over PostgREST, skip
-- the Edge Function entirely, and assign or drop a permanently-dropped
-- recurring slot on behalf of an ARBITRARY user id.
--
-- Verified on the live local DB before this migration:
--   has_function_privilege('anon',          'permanent_pickup_slot(uuid,uuid[],uuid[])', 'EXECUTE') -> t
--   has_function_privilege('authenticated', 'permanent_pickup_slot(uuid,uuid[],uuid[])', 'EXECUTE') -> t
-- ...and the same for both permanent_drop variants.
--
-- No client calls these three. Grepping apps/web, apps/mobile and packages for
-- .rpc('permanent_...') returns only the two Edge Functions plus comments,
-- tests and generated types, so dropping the client-role grants is a no-op for
-- every real caller.
--
-- Same class of finding as the earlier confused-deputy audit on
-- apply_compiled_season / set_preference_deadline. supabase/tests/s5-permanent-ops-grants.sql
-- locks the fix in, because a future DROP + CREATE FUNCTION (as opposed to
-- CREATE OR REPLACE, which preserves grants) would silently re-apply the
-- Supabase default privileges and reopen the hole.

REVOKE EXECUTE ON FUNCTION permanent_pickup_slot(uuid, uuid[], uuid[])
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION permanent_drop_slot(uuid, text, integer, text[], timestamptz, uuid)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION permanent_drop(uuid, text, integer, text[], timestamptz)
  FROM anon, authenticated;

-- Re-assert the intended grant so this migration fully describes the end state
-- rather than depending on the phase-10 GRANT still being in force.
GRANT EXECUTE ON FUNCTION permanent_pickup_slot(uuid, uuid[], uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION permanent_drop_slot(uuid, text, integer, text[], timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION permanent_drop(uuid, text, integer, text[], timestamptz) TO service_role;
