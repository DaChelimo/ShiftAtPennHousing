-- Permanent-ops RPC grants: pgTAP for the confused-deputy fix in
-- 20260724000006_revoke_permanent_ops_client_execute.sql.
--
-- permanent_pickup_slot / permanent_drop_slot / permanent_drop are SECURITY
-- DEFINER and take the acting worker's uuid as a TRUSTED argument with no
-- auth.uid() comparison. Identity is checked one layer up in the permanent-pickup
-- / permanent-drop Edge Functions, which call these with a service_role client.
-- That is only sound while service_role is the sole role holding EXECUTE.
--
-- The phase-10 migration tried to enforce that with `REVOKE ALL ... FROM PUBLIC`,
-- which strips only the PUBLIC pseudo-role and leaves the explicit anon /
-- authenticated grants that Supabase's ALTER DEFAULT PRIVILEGES applied at CREATE
-- time. Asserting only `has_function_privilege('public', ...) = false` -- the
-- pattern used in s4-fire-worker.sql and t2-6-hire-worker.sql -- passes happily
-- while anon and authenticated still hold EXECUTE, which is exactly how this
-- went unnoticed. These cases name anon and authenticated explicitly.
--
-- This also guards regressions: CREATE OR REPLACE preserves grants, but a future
-- DROP FUNCTION + CREATE FUNCTION would re-trigger the Supabase default
-- privileges and silently reopen the hole.
--
-- Run with: supabase test db   (or: pnpm pgtap:file supabase/tests/s5-permanent-ops-grants.sql)

BEGIN;

SELECT plan(12);

-- ============================================================
-- permanent_pickup_slot(uuid, uuid[], uuid[])
-- ============================================================
SELECT is(
  has_function_privilege('authenticated', 'public.permanent_pickup_slot(uuid,uuid[],uuid[])', 'EXECUTE'),
  false,
  'permanent_pickup_slot: authenticated has no EXECUTE'
);

SELECT is(
  has_function_privilege('anon', 'public.permanent_pickup_slot(uuid,uuid[],uuid[])', 'EXECUTE'),
  false,
  'permanent_pickup_slot: anon has no EXECUTE'
);

SELECT is(
  has_function_privilege('public', 'public.permanent_pickup_slot(uuid,uuid[],uuid[])', 'EXECUTE'),
  false,
  'permanent_pickup_slot: PUBLIC has no EXECUTE'
);

SELECT is(
  has_function_privilege('service_role', 'public.permanent_pickup_slot(uuid,uuid[],uuid[])', 'EXECUTE'),
  true,
  'permanent_pickup_slot: service_role retains EXECUTE (Edge Function caller)'
);

-- ============================================================
-- permanent_drop_slot(uuid, text, integer, text[], timestamptz, uuid)
-- ============================================================
SELECT is(
  has_function_privilege('authenticated', 'public.permanent_drop_slot(uuid,text,integer,text[],timestamptz,uuid)', 'EXECUTE'),
  false,
  'permanent_drop_slot: authenticated has no EXECUTE'
);

SELECT is(
  has_function_privilege('anon', 'public.permanent_drop_slot(uuid,text,integer,text[],timestamptz,uuid)', 'EXECUTE'),
  false,
  'permanent_drop_slot: anon has no EXECUTE'
);

SELECT is(
  has_function_privilege('public', 'public.permanent_drop_slot(uuid,text,integer,text[],timestamptz,uuid)', 'EXECUTE'),
  false,
  'permanent_drop_slot: PUBLIC has no EXECUTE'
);

SELECT is(
  has_function_privilege('service_role', 'public.permanent_drop_slot(uuid,text,integer,text[],timestamptz,uuid)', 'EXECUTE'),
  true,
  'permanent_drop_slot: service_role retains EXECUTE (Edge Function caller)'
);

-- ============================================================
-- permanent_drop(uuid, text, integer, text[], timestamptz)
-- ============================================================
SELECT is(
  has_function_privilege('authenticated', 'public.permanent_drop(uuid,text,integer,text[],timestamptz)', 'EXECUTE'),
  false,
  'permanent_drop: authenticated has no EXECUTE'
);

SELECT is(
  has_function_privilege('anon', 'public.permanent_drop(uuid,text,integer,text[],timestamptz)', 'EXECUTE'),
  false,
  'permanent_drop: anon has no EXECUTE'
);

SELECT is(
  has_function_privilege('public', 'public.permanent_drop(uuid,text,integer,text[],timestamptz)', 'EXECUTE'),
  false,
  'permanent_drop: PUBLIC has no EXECUTE'
);

SELECT is(
  has_function_privilege('service_role', 'public.permanent_drop(uuid,text,integer,text[],timestamptz)', 'EXECUTE'),
  true,
  'permanent_drop: service_role retains EXECUTE'
);

SELECT * FROM finish();
ROLLBACK;
