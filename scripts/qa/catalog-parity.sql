-- Catalog parity probe. READ ONLY.
--
-- Grants and RLS are authoritative in the RUNNING catalog, not in the migrations. The
-- 2026-07-26 ship-check pass proved why: worker_open_shifts was readable by `anon` in
-- the live catalog because two later migrations re-applied a GRANT that 20260711000001
-- had deliberately revoked.
--
-- Run this against the remote project and against local, then diff. EVERY DIFFERENCE IS
-- A FINDING: it means the migrations and the deployed reality disagree, and one of them
-- is lying to the next person who reads it.
--
-- Deliberately narrow: privilege bits and RLS status only. No user data, no row counts,
-- so it is a few KB over the wire and carries nothing sensitive.

SELECT 'table' AS kind,
       c.relname AS obj,
       has_table_privilege('anon', c.oid, 'SELECT')::text AS anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT')::text AS auth_select,
       has_table_privilege('anon', c.oid, 'INSERT')::text AS anon_insert,
       c.relrowsecurity::text AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm')

UNION ALL

SELECT 'function',
       p.oid::regprocedure::text,
       has_function_privilege('anon', p.oid, 'EXECUTE')::text,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')::text,
       CASE p.prosecdef WHEN true THEN 'definer' ELSE 'invoker' END,
       COALESCE(array_to_string(p.proconfig, ','), '')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'

UNION ALL

SELECT 'policy',
       schemaname || '.' || tablename || '.' || policyname,
       cmd,
       COALESCE(array_to_string(roles, ','), ''),
       COALESCE(qual, ''),
       COALESCE(with_check, '')
FROM pg_policies
WHERE schemaname = 'public'

ORDER BY 1, 2;
