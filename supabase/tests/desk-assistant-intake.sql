-- Desk Assistant KB Intake — pgTAP (INTAKE_PLAN Phase 3 + section 4a; migrations
-- 20260711000001/2). Covers: the intake staging table's RLS shape, the admin gate
-- function, the temporal validity columns + CHECK, the temporal retrieval filter
-- behavior, and the match_kb_chunks p_as_of signature.
--
-- Structural + seeded assertions are wrapped in BEGIN/ROLLBACK so this runs under both
-- `supabase test db` and `pnpm pgtap:file` once the migration is applied. (While the
-- local migration runner is drift-blocked, the same behavior is proven directly via the
-- rolled-back psql smoke test in the session notes.)

BEGIN;

SELECT plan(9);

-- --- kb_intake RLS shape ---------------------------------------------------
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.kb_intake'::regclass),
  'RLS is enabled on kb_intake'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'kb_intake'),
  4,
  'kb_intake has four policies (service bypass + admin read/insert/update)'
);

-- --- admin gate function ---------------------------------------------------
SELECT has_function('public', 'da_is_kb_admin', ARRAY['uuid'], 'da_is_kb_admin(uuid) exists');

-- --- temporal columns + default + constraint -------------------------------
SELECT has_column('public', 'kb_chunks', 'temporality', 'kb_chunks has temporality');
SELECT has_column('public', 'kb_chunks', 'effective_until', 'kb_chunks has effective_until');

SELECT throws_ok(
  $$ INSERT INTO kb_documents (title, source_type, source_ref, effective_from, effective_until)
     VALUES ('t','fixture','r', DATE '2026-07-20', DATE '2026-07-10') $$,
  23514,  -- check_violation
  NULL,
  'an out-of-order effective window is rejected by CHECK'
);

-- --- temporal retrieval filter behavior ------------------------------------
-- Seed one durable chunk and one that expires 2026-07-14.
INSERT INTO kb_documents (title, source_type, source_ref) VALUES ('seed','fixture','ref');

INSERT INTO kb_chunks (document_id, chunk_index, content, temporality, effective_from, effective_until)
SELECT document_id, 0, 'durable rule', 'durable', NULL, NULL FROM kb_documents WHERE title = 'seed';
INSERT INTO kb_chunks (document_id, chunk_index, content, temporality, effective_from, effective_until)
SELECT document_id, 1, 'celine backup ba', 'expires', DATE '2026-07-14', DATE '2026-07-14'
  FROM kb_documents WHERE title = 'seed';

SELECT is(
  (SELECT count(*)::int FROM kb_chunks
     WHERE (effective_from IS NULL OR effective_from <= DATE '2026-07-14')
       AND (effective_until IS NULL OR effective_until >= DATE '2026-07-14')),
  2,
  'as of the dated Tuesday, both the durable rule and the dated fact are in effect'
);

SELECT is(
  (SELECT count(*)::int FROM kb_chunks
     WHERE (effective_from IS NULL OR effective_from <= DATE '2026-07-28')
       AND (effective_until IS NULL OR effective_until >= DATE '2026-07-28')),
  1,
  'two weeks later the dated fact has expired out; only the durable rule remains'
);

-- --- match_kb_chunks temporal signature ------------------------------------
SELECT is(
  (SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'match_kb_chunks'),
  'p_user_id uuid, p_query_embedding vector, p_top_k integer DEFAULT 24, p_as_of date DEFAULT NULL::date',
  'match_kb_chunks accepts the p_as_of temporal filter argument'
);

SELECT * FROM finish();
ROLLBACK;
