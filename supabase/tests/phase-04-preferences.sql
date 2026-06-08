-- pgTAP behavioral tests for Phase 04: Preferences and Period Targets
-- Spec sources: BEHAVIORAL_SPECIFICATION §4.1, §4.2;
--               ARCHITECTURE §2.10 (scheduling_periods),
--                            §3.6 (preferences, period_targets),
--                            §3.9 (draft_block_assignments).
-- Run with: supabase test db
--
-- TDD-first: these tests describe the shape and behavior the phase-04
-- migrations MUST satisfy. They assert observable schema and behavior
-- only; mechanism (CHECK vs trigger vs constraint) is the implementer's
-- choice unless explicitly named.

BEGIN;

SELECT plan(79);

-- ============================================================
-- 0. Setup fixtures
-- ============================================================

-- Seed auth.users rows so users.user_id FK can resolve.
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('a0000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p04-sw-alice@test.local'),
  ('a0000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p04-sw-bob@test.local'),
  ('a0000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p04-sm-carol@test.local')
ON CONFLICT (id) DO NOTHING;

-- Seed application users (SW × 2 + SM × 1, all Harnwell).
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('a0000001-0000-0000-0000-000000000001', 'Alice', 'alice@test.local', 'harnwell', true),
  ('a0000001-0000-0000-0000-000000000002', 'Bob',   'bob@test.local',   'harnwell', true),
  ('a0000001-0000-0000-0000-000000000003', 'Carol', 'carol@test.local', 'harnwell', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('a0000001-0000-0000-0000-000000000001', 'sw', NULL),
  ('a0000001-0000-0000-0000-000000000002', 'sw', NULL),
  ('a0000001-0000-0000-0000-000000000003', 'sm', 'harnwell');

-- Seed a scheduling_periods row whose preference_deadline is in the future
-- (open window), plus a second row whose deadline has already passed.
INSERT INTO public.scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date,
   preference_deadline, published_at)
VALUES
  ('00000000-0000-0000-0000-000000000010', 'Open Period',
   'regular_school_year', '2026-09-01', '2026-12-15',
   (now() + interval '7 days'), NULL),
  ('00000000-0000-0000-0000-000000000011', 'Closed Period',
   -- Dates deliberately outside the shared seed's periods — Spring-2026
   -- (2026-01-12..2026-05-01) AND the S1/S2 Summer-2026 e2e period
   -- (2026-06-01..2026-08-01) — to avoid the scheduling_periods_no_overlap
   -- exclusion; only the already-passed preference_deadline matters below.
   'regular_school_year', '2025-06-01', '2025-08-15',
   (now() - interval '1 day'), NULL),
  ('00000000-0000-0000-0000-000000000012', 'Null-deadline Period',
   'regular_school_year', '2027-01-15', '2027-05-15',
   NULL, NULL);

-- Seed two shift_blocks in Harnwell at different times.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('00000000-0000-0000-0000-000000000100', 'harnwell',
   '2026-09-08 10:00:00 America/New_York'::timestamptz, 2),
  ('00000000-0000-0000-0000-000000000101', 'harnwell',
   '2026-09-08 10:30:00 America/New_York'::timestamptz, 2);

-- ============================================================
-- 1. Tables exist
-- ============================================================

SELECT has_table('public', 'preferences',
                 'preferences table exists (ARCH §3.6)');
SELECT has_table('public', 'period_targets',
                 'period_targets table exists (ARCH §3.6)');
SELECT has_table('public', 'draft_block_assignments',
                 'draft_block_assignments table exists (ARCH §3.9)');

-- ============================================================
-- 2. Enums
-- ============================================================

SELECT has_type('public', 'preference_status_enum',
                'preference_status_enum type exists');

SELECT enum_has_labels(
  'public', 'preference_status_enum',
  ARRAY['preferred', 'available', 'cannot', 'none'],
  'preference_status_enum has labels {preferred, available, cannot, none} (ARCH §3.6)'
);

-- ============================================================
-- 3. preferences column shape (ARCH §3.6)
-- ============================================================

SELECT has_column('public', 'preferences', 'user_id',   'preferences.user_id exists');
SELECT has_column('public', 'preferences', 'block_id',  'preferences.block_id exists');
SELECT has_column('public', 'preferences', 'period_id', 'preferences.period_id exists');
SELECT has_column('public', 'preferences', 'status',    'preferences.status exists');

SELECT col_type_is('public', 'preferences', 'user_id',   'uuid',
                   'preferences.user_id is uuid');
SELECT col_type_is('public', 'preferences', 'block_id',  'uuid',
                   'preferences.block_id is uuid');
SELECT col_type_is('public', 'preferences', 'period_id', 'uuid',
                   'preferences.period_id is uuid');
SELECT col_type_is('public', 'preferences', 'status',    'preference_status_enum',
                   'preferences.status uses preference_status_enum');

SELECT col_not_null('public', 'preferences', 'user_id',   'preferences.user_id NOT NULL');
SELECT col_not_null('public', 'preferences', 'block_id',  'preferences.block_id NOT NULL');
SELECT col_not_null('public', 'preferences', 'period_id', 'preferences.period_id NOT NULL');
SELECT col_not_null('public', 'preferences', 'status',    'preferences.status NOT NULL');

-- Composite PK on (user_id, block_id, period_id). One preference per
-- (worker, block, period) — same worker re-submitting overwrites or
-- updates, never duplicates.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.preferences'::regclass
      AND contype = 'p'
      AND ARRAY(
        SELECT attname::text FROM pg_attribute
        WHERE attrelid = conrelid AND attnum = ANY(conkey)
      ) <@ ARRAY['user_id','block_id','period_id']
      AND ARRAY['user_id','block_id','period_id'] <@ ARRAY(
        SELECT attname::text FROM pg_attribute
        WHERE attrelid = conrelid AND attnum = ANY(conkey)
      )
  ),
  'preferences has composite PK on (user_id, block_id, period_id)'
);

-- ============================================================
-- 4. period_targets column shape (ARCH §3.6)
-- ============================================================

SELECT has_column('public', 'period_targets', 'user_id',      'period_targets.user_id exists');
SELECT has_column('public', 'period_targets', 'period_id',    'period_targets.period_id exists');
SELECT has_column('public', 'period_targets', 'target_hours', 'period_targets.target_hours exists');
SELECT has_column('public', 'period_targets', 'opted_out',    'period_targets.opted_out exists');

SELECT col_type_is('public', 'period_targets', 'user_id',      'uuid',
                   'period_targets.user_id is uuid');
SELECT col_type_is('public', 'period_targets', 'period_id',    'uuid',
                   'period_targets.period_id is uuid');
SELECT col_type_is('public', 'period_targets', 'target_hours', 'integer',
                   'period_targets.target_hours is integer');
SELECT col_type_is('public', 'period_targets', 'opted_out',    'boolean',
                   'period_targets.opted_out is boolean');

SELECT col_not_null('public', 'period_targets', 'user_id',
                    'period_targets.user_id NOT NULL');
SELECT col_not_null('public', 'period_targets', 'period_id',
                    'period_targets.period_id NOT NULL');
SELECT col_not_null('public', 'period_targets', 'opted_out',
                    'period_targets.opted_out NOT NULL');

-- Composite PK on (user_id, period_id) — one target row per worker per period.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.period_targets'::regclass
      AND contype = 'p'
      AND ARRAY(
        SELECT attname::text FROM pg_attribute
        WHERE attrelid = conrelid AND attnum = ANY(conkey)
      ) <@ ARRAY['user_id','period_id']
      AND ARRAY['user_id','period_id'] <@ ARRAY(
        SELECT attname::text FROM pg_attribute
        WHERE attrelid = conrelid AND attnum = ANY(conkey)
      )
  ),
  'period_targets has composite PK on (user_id, period_id)'
);

-- ============================================================
-- 5. Foreign keys
-- ============================================================

SELECT fk_ok('public', 'preferences', 'user_id',
             'public', 'users', 'user_id',
             'preferences.user_id FK to users(user_id)');
SELECT fk_ok('public', 'preferences', 'block_id',
             'public', 'shift_blocks', 'block_id',
             'preferences.block_id FK to shift_blocks(block_id)');
SELECT fk_ok('public', 'preferences', 'period_id',
             'public', 'scheduling_periods', 'period_id',
             'preferences.period_id FK to scheduling_periods(period_id)');

SELECT fk_ok('public', 'period_targets', 'user_id',
             'public', 'users', 'user_id',
             'period_targets.user_id FK to users(user_id)');
SELECT fk_ok('public', 'period_targets', 'period_id',
             'public', 'scheduling_periods', 'period_id',
             'period_targets.period_id FK to scheduling_periods(period_id)');

-- ============================================================
-- 6. RLS enabled + service-role bypass policies
-- ============================================================

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.preferences'::regclass),
  'RLS enabled on preferences'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.period_targets'::regclass),
  'RLS enabled on period_targets'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename  = 'preferences'
             AND policyname = 'service-role bypass'),
  'service-role bypass policy on preferences'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename  = 'period_targets'
             AND policyname = 'service-role bypass'),
  'service-role bypass policy on period_targets'
);

-- ============================================================
-- 7. target_hours bounds (BEH §4.1: 0 to applicable cap)
-- 7a. target_hours = 0 is permitted (a worker may want zero hours);
-- 7b. target_hours < 0 is rejected;
-- 7c. target_hours > regular_school_year cap (20) is rejected.
-- The DB enforces the floor; the upper bound is enforced against the
-- applicable cap from operating_profiles (regular_school_year: 20).
-- ============================================================

SELECT lives_ok(
  $$ INSERT INTO public.period_targets (user_id, period_id, target_hours, opted_out)
     VALUES ('a0000001-0000-0000-0000-000000000001',
             '00000000-0000-0000-0000-000000000010',
             0, false) $$,
  'target_hours = 0 is accepted (worker may want zero hours)'
);

-- Clean up for the next test.
DELETE FROM public.period_targets
 WHERE user_id = 'a0000001-0000-0000-0000-000000000001';

SELECT throws_ok(
  $$ INSERT INTO public.period_targets (user_id, period_id, target_hours, opted_out)
     VALUES ('a0000001-0000-0000-0000-000000000001',
             '00000000-0000-0000-0000-000000000010',
             -1, false) $$,
  NULL,
  NULL,
  'target_hours = -1 is rejected (must be >= 0)'
);

SELECT throws_ok(
  $$ INSERT INTO public.period_targets (user_id, period_id, target_hours, opted_out)
     VALUES ('a0000001-0000-0000-0000-000000000001',
             '00000000-0000-0000-0000-000000000010',
             21, false) $$,
  NULL,
  NULL,
  'target_hours > regular_school_year cap (20) is rejected'
);

-- A target equal to the cap is acceptable.
SELECT lives_ok(
  $$ INSERT INTO public.period_targets (user_id, period_id, target_hours, opted_out)
     VALUES ('a0000001-0000-0000-0000-000000000001',
             '00000000-0000-0000-0000-000000000010',
             20, false) $$,
  'target_hours = 20 (exact regular_school_year cap) is accepted'
);

-- ============================================================
-- 8. opted_out default and shape
-- BEH §4.1: a worker clicking "no hours" produces opted_out=true.
-- ============================================================

SELECT col_default_is(
  'public', 'period_targets', 'opted_out',
  'false',
  'opted_out defaults to false (clicking no-hours flips to true)'
);

-- ============================================================
-- 9. Preference deadline enforcement (BEH §4.2)
-- After preference_deadline has passed, INSERT/UPDATE/DELETE on
-- preferences and period_targets for that period MUST be rejected.
-- The window-open period must accept normal writes; the closed
-- period must reject them.
-- ============================================================

-- Window-open period: insert succeeds.
SELECT lives_ok(
  $$ INSERT INTO public.preferences (user_id, block_id, period_id, status)
     VALUES ('a0000001-0000-0000-0000-000000000002',
             '00000000-0000-0000-0000-000000000100',
             '00000000-0000-0000-0000-000000000010',
             'preferred') $$,
  'preference insert succeeds when preference_deadline is in the future'
);

-- Same worker may update before the deadline.
SELECT lives_ok(
  $$ UPDATE public.preferences
        SET status = 'available'
      WHERE user_id   = 'a0000001-0000-0000-0000-000000000002'
        AND block_id  = '00000000-0000-0000-0000-000000000100'
        AND period_id = '00000000-0000-0000-0000-000000000010' $$,
  'preference UPDATE succeeds when preference_deadline is in the future'
);

-- Closed period: insert rejected.
SELECT throws_ok(
  $$ INSERT INTO public.preferences (user_id, block_id, period_id, status)
     VALUES ('a0000001-0000-0000-0000-000000000002',
             '00000000-0000-0000-0000-000000000100',
             '00000000-0000-0000-0000-000000000011',
             'preferred') $$,
  NULL,
  NULL,
  'preference INSERT rejected for period whose preference_deadline has passed'
);

-- period_targets writes also rejected after deadline.
SELECT throws_ok(
  $$ INSERT INTO public.period_targets (user_id, period_id, target_hours, opted_out)
     VALUES ('a0000001-0000-0000-0000-000000000002',
             '00000000-0000-0000-0000-000000000011',
             10, false) $$,
  NULL,
  NULL,
  'period_targets INSERT rejected for period whose preference_deadline has passed'
);

-- Null preference_deadline behaves as "window not yet open" — the SM
-- has not opened submission. The deadline guard's intent is to lock
-- AFTER deadline, so a null deadline does NOT block writes; this matches
-- ARCH §2.10 ("Null until the SM sets it") and BEH §4.2 (no reminders
-- fire when deadline is null, but preferences are not pre-emptively
-- locked).
SELECT lives_ok(
  $$ INSERT INTO public.preferences (user_id, block_id, period_id, status)
     VALUES ('a0000001-0000-0000-0000-000000000001',
             '00000000-0000-0000-0000-000000000100',
             '00000000-0000-0000-0000-000000000012',
             'preferred') $$,
  'preference INSERT succeeds when preference_deadline IS NULL (window not yet set)'
);

-- ============================================================
-- 10. Re-submission after opt-out (BEH §4.1)
-- A worker who clicked "no hours" (opted_out=true) may still submit
-- preferences before the deadline — they remain claim-eligible during
-- the period and may change their mind.
-- ============================================================

-- Bob opts out for the open period.
INSERT INTO public.period_targets (user_id, period_id, target_hours, opted_out)
VALUES ('a0000001-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000010',
        0, true);

-- Submitting preferences afterwards is still allowed before deadline.
SELECT lives_ok(
  $$ INSERT INTO public.preferences (user_id, block_id, period_id, status)
     VALUES ('a0000001-0000-0000-0000-000000000002',
             '00000000-0000-0000-0000-000000000101',
             '00000000-0000-0000-0000-000000000010',
             'preferred') $$,
  'opted-out worker may still submit preferences before deadline (BEH §4.1)'
);

-- And may flip opted_out back to false.
SELECT lives_ok(
  $$ UPDATE public.period_targets
        SET opted_out = false, target_hours = 15
      WHERE user_id   = 'a0000001-0000-0000-0000-000000000002'
        AND period_id = '00000000-0000-0000-0000-000000000010' $$,
  'opted-out worker may flip opted_out=false before deadline'
);

-- ============================================================
-- 11. Cross-period isolation (BEH §4.1, ARCH §3.6)
-- Preferences and targets for a prior period are not affected by
-- creating a new period or by writes to a different period.
-- ============================================================

-- Insert a snapshot count for the open period.
DO $$
DECLARE
  v_count_before bigint;
BEGIN
  SELECT count(*) INTO v_count_before
    FROM public.preferences
   WHERE period_id = '00000000-0000-0000-0000-000000000010';
  PERFORM set_config('test.phase04.open_prefs_before', v_count_before::text, true);
END $$;

-- Insert a brand-new period and immediately write a preference for it.
INSERT INTO public.scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date,
   preference_deadline)
VALUES
  ('00000000-0000-0000-0000-000000000013', 'Future Period',
   'regular_school_year', '2027-09-01', '2027-12-15',
   (now() + interval '30 days'));

INSERT INTO public.preferences (user_id, block_id, period_id, status)
VALUES
  ('a0000001-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000100',
   '00000000-0000-0000-0000-000000000013',
   'cannot');

SELECT is(
  (SELECT count(*) FROM public.preferences
    WHERE period_id = '00000000-0000-0000-0000-000000000010')::integer,
  current_setting('test.phase04.open_prefs_before')::integer,
  'creating a new period leaves prior period preferences unchanged'
);

-- ============================================================
-- 12. Preference for non-existent block is rejected (FK)
-- ============================================================

SELECT throws_ok(
  $$ INSERT INTO public.preferences (user_id, block_id, period_id, status)
     VALUES ('a0000001-0000-0000-0000-000000000001',
             '00000000-0000-0000-0000-0000000000ff',
             '00000000-0000-0000-0000-000000000010',
             'preferred') $$,
  NULL,
  NULL,
  'preference for non-existent block_id is rejected (FK violation)'
);

-- ============================================================
-- 13. draft_block_assignments shape (ARCH §3.9)
-- ============================================================

SELECT has_column('public', 'draft_block_assignments', 'draft_assignment_id',
                  'draft_assignment_id exists');
SELECT has_column('public', 'draft_block_assignments', 'period_id', 'period_id exists');
SELECT has_column('public', 'draft_block_assignments', 'block_id',  'block_id exists');
SELECT has_column('public', 'draft_block_assignments', 'user_id',   'user_id exists');
SELECT has_column('public', 'draft_block_assignments', 'created_at','created_at exists');
SELECT has_column('public', 'draft_block_assignments', 'created_by','created_by exists');

SELECT col_type_is('public', 'draft_block_assignments', 'draft_assignment_id',
                   'uuid', 'draft_assignment_id is uuid');
SELECT col_type_is('public', 'draft_block_assignments', 'period_id',
                   'uuid', 'period_id is uuid');
SELECT col_type_is('public', 'draft_block_assignments', 'block_id',
                   'uuid', 'block_id is uuid');
SELECT col_type_is('public', 'draft_block_assignments', 'user_id',
                   'uuid', 'user_id is uuid');
SELECT col_type_is('public', 'draft_block_assignments', 'created_at',
                   'timestamp with time zone',
                   'created_at is timestamptz (ARCH §1.6 — no naive timestamps)');
SELECT col_type_is('public', 'draft_block_assignments', 'created_by',
                   'uuid', 'created_by is uuid');

SELECT col_is_pk('public', 'draft_block_assignments', 'draft_assignment_id',
                 'draft_assignment_id is primary key');

-- A draft row has no status column — every row is tentative-scheduled
-- (ARCH §3.9). The presence of a status column would mean the draft
-- shares an enum surface with the live table and risk leakage.
SELECT hasnt_column('public', 'draft_block_assignments', 'status',
                    'draft_block_assignments has NO status column (ARCH §3.9)');

-- FKs to scheduling_periods, shift_blocks, users (×2 for user_id + created_by).
SELECT fk_ok('public', 'draft_block_assignments', 'period_id',
             'public', 'scheduling_periods', 'period_id',
             'draft.period_id FK to scheduling_periods');
SELECT fk_ok('public', 'draft_block_assignments', 'block_id',
             'public', 'shift_blocks', 'block_id',
             'draft.block_id FK to shift_blocks');
SELECT fk_ok('public', 'draft_block_assignments', 'user_id',
             'public', 'users', 'user_id',
             'draft.user_id FK to users');
SELECT fk_ok('public', 'draft_block_assignments', 'created_by',
             'public', 'users', 'user_id',
             'draft.created_by FK to users');

-- ============================================================
-- 14. draft uniqueness — same worker cannot be drafted twice
-- to the same block within the same period
-- ============================================================

-- First insert succeeds.
SELECT lives_ok(
  $$ INSERT INTO public.draft_block_assignments
       (period_id, block_id, user_id, created_by)
     VALUES (
       '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-000000000100',
       'a0000001-0000-0000-0000-000000000001',
       'a0000001-0000-0000-0000-000000000003'
     ) $$,
  'first draft assignment (period, block, worker) is accepted'
);

-- Duplicate (same period, block, user) is rejected.
SELECT throws_ok(
  $$ INSERT INTO public.draft_block_assignments
       (period_id, block_id, user_id, created_by)
     VALUES (
       '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-000000000100',
       'a0000001-0000-0000-0000-000000000001',
       'a0000001-0000-0000-0000-000000000003'
     ) $$,
  NULL,
  NULL,
  'duplicate draft (same period, block, user) is rejected (cannot double-book a worker in the same seat)'
);

-- Different worker on the same block in the same period is allowed
-- (multi-headcount blocks legitimately carry multiple draft rows).
SELECT lives_ok(
  $$ INSERT INTO public.draft_block_assignments
       (period_id, block_id, user_id, created_by)
     VALUES (
       '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-000000000100',
       'a0000001-0000-0000-0000-000000000002',
       'a0000001-0000-0000-0000-000000000003'
     ) $$,
  'a second worker on the same block_id is allowed (multi-headcount blocks)'
);

-- ============================================================
-- 15. RLS on draft_block_assignments
-- Service-role bypass exists; workers must NOT be able to read drafts
-- (visibility is restricted to SM/HM/BM of the house — ARCH §3.9).
-- ============================================================

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.draft_block_assignments'::regclass),
  'RLS enabled on draft_block_assignments'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename  = 'draft_block_assignments'
             AND policyname = 'service-role bypass'),
  'service-role bypass policy on draft_block_assignments'
);

-- There MUST be no policy granting authenticated workers SELECT
-- on draft_block_assignments based on user_id = auth.uid(). The draft
-- is invisible to workers entirely (ARCH §3.9).
SELECT is(
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'draft_block_assignments'
      AND 'authenticated' = ANY(roles)
      AND cmd IN ('SELECT', 'ALL')
      AND COALESCE(qual, '') ILIKE '%auth.uid%user_id%')::integer,
  0,
  'no authenticated-by-user_id SELECT policy on draft_block_assignments (workers MUST NOT see drafts)'
);

-- A house-admin SELECT policy must exist so SMs/HMs/BMs of the house
-- can read the draft (ARCH §3.9 "schedule-builder UI scoped to SMs/HMs/BMs").
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'draft_block_assignments'
       AND cmd IN ('SELECT', 'ALL')
       AND 'authenticated' = ANY(roles)
       AND policyname <> 'service-role bypass'
  ),
  'house-admin SELECT policy exists on draft_block_assignments (SMs/HMs/BMs can read draft)'
);

-- ============================================================
-- 16. No plain timestamp columns in phase-04 tables
-- (ARCH §1.6 — every timestamp is timestamptz)
-- ============================================================

SELECT is(
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('preferences', 'period_targets',
                         'draft_block_assignments')
      AND data_type = 'timestamp without time zone')::integer,
  0,
  'no plain timestamp (non-tz) columns in phase-04 tables'
);

SELECT finish();
ROLLBACK;
