-- Migration: grant table DML on the knowledge-base tables (kb_documents,
-- kb_chunks, kb_intake).
--
-- BUG (pre-existing, surfaced 2026-07-21 while verifying the KB intake admin UI):
-- same root cause as 20260713000002_desk_assistant_table_grants.sql -- these
-- tables ship RLS policies but were never granted the underlying table
-- privileges. This project's Postgres hands new public tables only
-- REFERENCES/TRIGGER/TRUNCATE to anon/authenticated/service_role by default, so
-- RLS policies here were inert: every service_role read (loadIntakeQueue,
-- loadIntakeDetail, approveIntake) and every authenticated read failed with
-- "permission denied for table kb_intake" -- silently, since the admin UI
-- swallows the query error into an empty/zeroed queue rather than surfacing it.
--
-- Fix: grant exactly what each role's RLS policies already intend (least
-- privilege), mirroring the da_* migration's pattern.

GRANT SELECT, INSERT, UPDATE, DELETE ON kb_documents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_chunks    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON kb_intake    TO service_role;

-- authenticated: mirror the existing RLS policies (all further row-scoped by RLS).
--   kb_documents -> SELECT ("scoped read")
--   kb_chunks    -> SELECT ("scoped read")
--   kb_intake    -> SELECT + INSERT + UPDATE ("kb admin read/insert/update"; no
--     delete policy exists, so no DELETE grant)
GRANT SELECT              ON kb_documents TO authenticated;
GRANT SELECT              ON kb_chunks    TO authenticated;
GRANT SELECT, INSERT, UPDATE ON kb_intake TO authenticated;

-- rollback:
-- REVOKE SELECT, INSERT, UPDATE, DELETE ON kb_documents, kb_chunks, kb_intake FROM service_role;
-- REVOKE SELECT ON kb_documents, kb_chunks FROM authenticated;
-- REVOKE SELECT, INSERT, UPDATE ON kb_intake FROM authenticated;
