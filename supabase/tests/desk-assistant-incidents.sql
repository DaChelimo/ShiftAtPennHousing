-- Desk Assistant — pgTAP for incident-raw isolation (V1_SCOPE §7.2; migration
-- 20260710000003). The structural guarantee: RLS is on and the ONLY policy is the
-- service-role bypass, so no authenticated/anon client has any read path to raw
-- incidents. Asserting the policy shape (rather than attempting a role-switched read)
-- makes this runnable under raw psql as well as `supabase test db`.
--
-- Run with: supabase test db   (or: pnpm pgtap:file supabase/tests/desk-assistant-incidents.sql)

BEGIN;

SELECT plan(5);

-- RLS is enabled on the raw table.
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.kb_incidents_raw'::regclass),
  'RLS is enabled on kb_incidents_raw'
);

-- Exactly one policy exists, and it targets service_role only.
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'kb_incidents_raw'),
  1,
  'kb_incidents_raw has exactly one policy'
);

SELECT is(
  (SELECT array_agg(DISTINCT r) FROM pg_policies p, unnest(p.roles) r
     WHERE p.schemaname = 'public' AND p.tablename = 'kb_incidents_raw'),
  ARRAY['service_role']::name[],
  'the only policy role is service_role'
);

-- No policy grants to authenticated / anon / public.
SELECT is(
  (SELECT count(*)::int FROM pg_policies p, unnest(p.roles) r
     WHERE p.schemaname = 'public' AND p.tablename = 'kb_incidents_raw'
       AND r IN ('authenticated', 'anon', 'public')),
  0,
  'no authenticated / anon / public read path to raw incidents'
);

-- The raw table has no embedding column: it is structurally not indexable/retrievable.
SELECT is(
  (SELECT count(*)::int FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'kb_incidents_raw' AND column_name = 'embedding'),
  0,
  'kb_incidents_raw has no embedding column (never retrievable)'
);

SELECT * FROM finish();
ROLLBACK;
