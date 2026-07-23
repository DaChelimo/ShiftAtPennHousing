-- Migration: grant table DML on the Desk Assistant tables (da_*).
--
-- BUG (pre-existing, surfaced 2026-07-13): the da_* tables (created by
-- 20260710000001 / 20260710000005) ship RLS policies but were never granted the
-- underlying table privileges. In this project's Postgres, the role default
-- privileges hand new public tables only REFERENCES/TRIGGER/TRUNCATE to
-- anon/authenticated/service_role (verified: a fresh scratch table gets exactly
-- that trio, no SELECT/INSERT/UPDATE/DELETE) -- older feature tables got their DML
-- from an explicit grant the da_* tables missed. RLS policies are inert without the
-- table grant, so EVERY authenticated read AND every service_role write failed with
-- "permission denied for table da_conversations". The da-* Edge Functions run as
-- service_role (see _shared/swap-http.ts authenticate()), so da-ask could not even
-- insert its conversation row -> the assistant returned conversation_create_failed.
-- This stayed hidden until the local edge runtime began serving the da-* functions.
--
-- Fix: grant exactly what each role's RLS policies already intend (least privilege).
--   * service_role: full DML on all four tables (it is the bypass-RLS role the EFs
--     use to read/insert/update). Matches the "service-role bypass" ALL policies.
--   * authenticated: only what its per-table policies allow (own-row scoped by RLS).
-- anon is intentionally left with no DML (nothing anonymous touches these).
--
-- Idempotent (GRANT re-applies cleanly). Reversible (see rollback).

-- The Edge Functions (service_role) own all writes across the assistant surface.
GRANT SELECT, INSERT, UPDATE, DELETE ON da_conversations  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON da_messages       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON da_page_drafts    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON da_page_deliveries TO service_role;

-- authenticated: mirror the existing RLS policies (all further row-scoped by RLS).
--   da_conversations  -> SELECT + INSERT ("own conversations" / "own conversations insert")
--   da_messages       -> SELECT ("own messages")
--   da_page_drafts    -> ALL   (author-scoped ALL policy)
--   da_page_deliveries-> SELECT + UPDATE (recipient-scoped)
GRANT SELECT, INSERT              ON da_conversations   TO authenticated;
GRANT SELECT                      ON da_messages        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON da_page_drafts TO authenticated;
GRANT SELECT, UPDATE              ON da_page_deliveries TO authenticated;

-- rollback:
-- REVOKE SELECT, INSERT, UPDATE, DELETE ON da_conversations, da_messages,
--   da_page_drafts, da_page_deliveries FROM service_role;
-- REVOKE SELECT, INSERT ON da_conversations FROM authenticated;
-- REVOKE SELECT ON da_messages FROM authenticated;
-- REVOKE SELECT, INSERT, UPDATE, DELETE ON da_page_drafts FROM authenticated;
-- REVOKE SELECT, UPDATE ON da_page_deliveries FROM authenticated;
