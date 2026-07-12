-- Desk Assistant — pgTAP for page-draft + delivery RLS shape (V1_SCOPE §4.3;
-- migrations 20260710000005/000006). Structural assertions over pg_policies (runnable
-- under raw psql), pinning: author controls own drafts, recipient reads a sent page,
-- recipient (only) responds to their delivery, no anon path.
--
-- Run with: supabase test db   (or: pnpm pgtap:file supabase/tests/desk-assistant-pages.sql)

BEGIN;

SELECT plan(10);

-- da_page_drafts -----------------------------------------------------------
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.da_page_drafts'::regclass),
  'RLS enabled on da_page_drafts'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'da_page_drafts' AND cmd = 'ALL'
       AND qual LIKE '%author_user_id%' AND qual LIKE '%auth.uid()%'
  ),
  'author manages own drafts (ALL gated on author_user_id = auth.uid())'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'da_page_drafts' AND cmd = 'SELECT'
       AND qual LIKE '%resolved_recipient_user_id%' AND qual LIKE '%sent%'
  ),
  'recipient reads a page only once sent'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies p, unnest(p.roles) r
     WHERE p.tablename = 'da_page_drafts' AND r IN ('anon', 'public')),
  0,
  'no anon/public policy on da_page_drafts'
);

-- da_page_deliveries -------------------------------------------------------
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.da_page_deliveries'::regclass),
  'RLS enabled on da_page_deliveries'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'da_page_deliveries' AND cmd = 'UPDATE'
       AND qual LIKE '%recipient_user_id%' AND with_check LIKE '%recipient_user_id%'
  ),
  'only the recipient can respond to (update) their delivery'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'da_page_deliveries' AND cmd = 'SELECT'
       AND qual LIKE '%author_user_id%'
  ),
  'page author can read the delivery status of their page'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies p, unnest(p.roles) r
     WHERE p.tablename = 'da_page_deliveries' AND r IN ('anon', 'public')),
  0,
  'no anon/public policy on da_page_deliveries'
);

-- severity is fixed to critical; only the two adapters are allowed.
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_schema = 'public' AND check_clause LIKE '%severity%critical%'
  ),
  'delivery severity is constrained to critical'
);

SELECT ok(
  (SELECT count(*)::int FROM information_schema.columns
     WHERE table_name = 'da_page_deliveries' AND column_name = 'next_reminder_at') = 1,
  'delivery tracks next_reminder_at for the re-notification sweep'
);

SELECT * FROM finish();
ROLLBACK;
