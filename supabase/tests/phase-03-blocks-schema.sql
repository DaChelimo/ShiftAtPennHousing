-- pgTAP schema tests for Phase 03: Block Model
-- Spec sources: ARCHITECTURE §1.6, §1.7, §3.2, §3.3
-- Run with: supabase test db
--
-- These tests describe the shape of the block layer that phase-03
-- migrations MUST satisfy. They are TDD-first: written before any
-- phase-03 migration exists. They assert observable schema only;
-- mechanism (CHECK vs trigger) is the implementer's choice.

BEGIN;

SELECT plan(83);

-- ============================================================
-- 1. Tables exist
-- ============================================================

SELECT has_table('public', 'shift_blocks',            'shift_blocks table exists');
SELECT has_table('public', 'shift_block_assignments', 'shift_block_assignments table exists');

-- ============================================================
-- 2. Enums exist with the spec-mandated labels (§3.3)
-- ============================================================

SELECT has_type('public', 'shift_status_enum',   'shift_status_enum type exists');
SELECT has_type('public', 'vacancy_origin_enum', 'vacancy_origin_enum type exists');

SELECT enum_has_labels(
  'public', 'shift_status_enum',
  ARRAY[
    'scheduled', 'claimed', 'floated_in', 'floated_out',
    'pending_float_in', 'pending_float_out', 'allied', 'vacant'
  ],
  'shift_status_enum has all 8 labels from ARCH §3.3'
);

SELECT enum_has_labels(
  'public', 'vacancy_origin_enum',
  ARRAY[
    'none', 'temporary_drop', 'permanent_drop',
    'never_assigned', 'expired_claim', 'displaced_decliner'
  ],
  'vacancy_origin_enum has all 6 labels from ARCH §3.3'
);

-- ============================================================
-- 3. shift_blocks column shape (ARCH §3.2 Approach A)
-- ============================================================

SELECT has_column('public', 'shift_blocks', 'block_id',           'shift_blocks.block_id exists');
SELECT has_column('public', 'shift_blocks', 'house_id',           'shift_blocks.house_id exists');
SELECT has_column('public', 'shift_blocks', 'block_start_at',     'shift_blocks.block_start_at exists');
SELECT has_column('public', 'shift_blocks', 'required_headcount', 'shift_blocks.required_headcount exists');

SELECT col_type_is('public', 'shift_blocks', 'block_id',           'uuid',
                   'shift_blocks.block_id is uuid');
SELECT col_type_is('public', 'shift_blocks', 'house_id',           'text',
                   'shift_blocks.house_id is text (matches houses.id)');
SELECT col_type_is('public', 'shift_blocks', 'block_start_at',     'timestamp with time zone',
                   'shift_blocks.block_start_at is timestamptz (ARCH §1.6)');
SELECT col_type_is('public', 'shift_blocks', 'required_headcount', 'integer',
                   'shift_blocks.required_headcount is integer');

SELECT col_is_pk    ('public', 'shift_blocks', 'block_id',           'block_id is primary key');
SELECT col_not_null ('public', 'shift_blocks', 'house_id',           'house_id is NOT NULL');
SELECT col_not_null ('public', 'shift_blocks', 'block_start_at',     'block_start_at is NOT NULL');
SELECT col_not_null ('public', 'shift_blocks', 'required_headcount', 'required_headcount is NOT NULL');

-- ============================================================
-- 4. shift_block_assignments column shape (ARCH §3.2)
-- ============================================================

SELECT has_column('public', 'shift_block_assignments', 'assignment_id',         'assignment_id exists');
SELECT has_column('public', 'shift_block_assignments', 'block_id',              'block_id exists');
SELECT has_column('public', 'shift_block_assignments', 'user_id',               'user_id exists');
SELECT has_column('public', 'shift_block_assignments', 'status',                'status exists');
SELECT has_column('public', 'shift_block_assignments', 'vacancy_origin',        'vacancy_origin exists');
SELECT has_column('public', 'shift_block_assignments', 'is_float',              'is_float exists');
SELECT has_column('public', 'shift_block_assignments', 'is_cross_house_pickup', 'is_cross_house_pickup exists');
SELECT has_column('public', 'shift_block_assignments', 'source_house_id',       'source_house_id exists');
SELECT has_column('public', 'shift_block_assignments', 'parent_float_id',       'parent_float_id exists');

SELECT col_type_is('public', 'shift_block_assignments', 'assignment_id',         'uuid',
                   'assignment_id is uuid');
SELECT col_type_is('public', 'shift_block_assignments', 'block_id',              'uuid',
                   'block_id is uuid (FK to shift_blocks)');
SELECT col_type_is('public', 'shift_block_assignments', 'user_id',               'uuid',
                   'user_id is uuid (FK to users; NULL for vacant/allied)');
SELECT col_type_is('public', 'shift_block_assignments', 'status',                'shift_status_enum',
                   'status uses shift_status_enum');
SELECT col_type_is('public', 'shift_block_assignments', 'vacancy_origin',        'vacancy_origin_enum',
                   'vacancy_origin uses vacancy_origin_enum');
SELECT col_type_is('public', 'shift_block_assignments', 'is_float',              'boolean',
                   'is_float is boolean');
SELECT col_type_is('public', 'shift_block_assignments', 'is_cross_house_pickup', 'boolean',
                   'is_cross_house_pickup is boolean');

SELECT col_is_pk   ('public', 'shift_block_assignments', 'assignment_id',
                    'assignment_id is primary key');
SELECT col_not_null('public', 'shift_block_assignments', 'block_id',
                    'block_id is NOT NULL');
SELECT col_not_null('public', 'shift_block_assignments', 'status',
                    'status is NOT NULL');
SELECT col_not_null('public', 'shift_block_assignments', 'vacancy_origin',
                    'vacancy_origin is NOT NULL (default none for non-vacant)');
SELECT col_not_null('public', 'shift_block_assignments', 'is_float',
                    'is_float is NOT NULL');
SELECT col_not_null('public', 'shift_block_assignments', 'is_cross_house_pickup',
                    'is_cross_house_pickup is NOT NULL');

-- user_id MUST be nullable (vacant rows have user_id IS NULL; allied has user_id IS NULL)
SELECT ok(
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shift_block_assignments'
      AND column_name = 'user_id') = 'YES',
  'user_id is nullable (vacant and allied rows have user_id IS NULL)'
);

-- source_house_id is nullable (set only when worker is at a non-home desk)
SELECT ok(
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shift_block_assignments'
      AND column_name = 'source_house_id') = 'YES',
  'source_house_id is nullable (set only for is_float or is_cross_house_pickup)'
);

-- parent_float_id is nullable (set only when is_float=true)
SELECT ok(
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shift_block_assignments'
      AND column_name = 'parent_float_id') = 'YES',
  'parent_float_id is nullable (set only when is_float)'
);

-- source_house_id CHECK constraint (ARCH §3.2): populated whenever the
-- worker is at a non-home desk, i.e. (is_float OR is_cross_house_pickup)
-- ⇒ source_house_id IS NOT NULL. The constraint is exercised here with
-- a minimal block fixture; the two assignment inserts run against it.

DO $$
DECLARE
  v_block_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
  VALUES (v_block_id, 'harnwell',
          '2026-02-06 10:00:00 America/New_York'::timestamptz, 2);
  PERFORM set_config('test.phase03.src_block_id', v_block_id::text, true);
END $$;

-- A floater for the accepted is_float row (a filled float-in seat carries a
-- user_id per the sba_user_id_matches_status invariant).
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('a3000003-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','p03-floater@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES ('a3000003-0000-0000-0000-000000000001','P03 Floater','p03-floater@test.local','harnwell',true);

SELECT throws_ok(
  format(
    $sql$ INSERT INTO public.shift_block_assignments
            (assignment_id, block_id, user_id, status, vacancy_origin,
             is_float, is_cross_house_pickup, source_house_id)
          VALUES (gen_random_uuid(), %L, NULL, 'pending_float_in', 'none',
                  true, false, NULL) $sql$,
    current_setting('test.phase03.src_block_id')
  ),
  NULL,
  NULL,
  'is_float = true with source_house_id NULL is rejected (CHECK constraint)'
);

SELECT lives_ok(
  format(
    $sql$ INSERT INTO public.shift_block_assignments
            (assignment_id, block_id, user_id, status, vacancy_origin,
             is_float, is_cross_house_pickup, source_house_id)
          VALUES (gen_random_uuid(), %L,
                  'a3000003-0000-0000-0000-000000000001', 'pending_float_in', 'none',
                  true, false, 'harnwell') $sql$,
    current_setting('test.phase03.src_block_id')
  ),
  'is_float = true with valid source_house_id is accepted'
);

-- ============================================================
-- 5. Foreign keys
-- ============================================================

SELECT fk_ok('public', 'shift_blocks', 'house_id',
             'public', 'houses', 'id',
             'shift_blocks.house_id FK to houses(id)');

SELECT fk_ok('public', 'shift_block_assignments', 'block_id',
             'public', 'shift_blocks', 'block_id',
             'shift_block_assignments.block_id FK to shift_blocks(block_id)');

SELECT fk_ok('public', 'shift_block_assignments', 'user_id',
             'public', 'users', 'user_id',
             'shift_block_assignments.user_id FK to users(user_id)');

SELECT fk_ok('public', 'shift_block_assignments', 'source_house_id',
             'public', 'houses', 'id',
             'shift_block_assignments.source_house_id FK to houses(id)');

-- ============================================================
-- 6. RLS enabled + service-role bypass policies
-- ============================================================

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.shift_blocks'::regclass),
  'RLS enabled on shift_blocks'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.shift_block_assignments'::regclass),
  'RLS enabled on shift_block_assignments'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename  = 'shift_blocks'
             AND policyname = 'service-role bypass'),
  'service-role bypass policy on shift_blocks'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename  = 'shift_block_assignments'
             AND policyname = 'service-role bypass'),
  'service-role bypass policy on shift_block_assignments'
);

-- BEH §11.2: workers must see their own float-out and cross-house-pickup
-- assignments on their personal calendar even though those rows attach
-- to non-home-house blocks. The home-house policy alone does not cover
-- this, so a separate "users can select own assignments" policy is required.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename  = 'shift_block_assignments'
             AND policyname = 'users can select own assignments'),
  'users can select own assignments policy on shift_block_assignments (BEH §11.2)'
);

-- ============================================================
-- 7. block_start_at on 30-minute boundaries
-- ARCH §1.7 — atomic unit is a 30-minute block starting on the half-hour.
-- The schema MUST reject inserts whose block_start_at is not aligned.
-- ============================================================

-- Aligned insert succeeds.
SELECT lives_ok(
  $$ INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
     VALUES (
       gen_random_uuid(),
       'harnwell',
       '2026-02-02 14:30:00 America/New_York'::timestamptz,
       2
     ) $$,
  '30-min-aligned block_start_at insert succeeds (HH:30)'
);

SELECT lives_ok(
  $$ INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
     VALUES (
       gen_random_uuid(),
       'harnwell',
       '2026-02-02 15:00:00 America/New_York'::timestamptz,
       2
     ) $$,
  '30-min-aligned block_start_at insert succeeds (HH:00)'
);

-- Misaligned inserts are rejected.
SELECT throws_ok(
  $$ INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
     VALUES (
       gen_random_uuid(),
       'harnwell',
       '2026-02-02 14:15:00 America/New_York'::timestamptz,
       2
     ) $$,
  NULL,
  NULL,
  'block_start_at not on 30-min boundary (HH:15) is rejected'
);

SELECT throws_ok(
  $$ INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
     VALUES (
       gen_random_uuid(),
       'harnwell',
       '2026-02-02 14:31:00 America/New_York'::timestamptz,
       2
     ) $$,
  NULL,
  NULL,
  'block_start_at with non-zero seconds offset (HH:31) is rejected'
);

SELECT throws_ok(
  $$ INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
     VALUES (
       gen_random_uuid(),
       'harnwell',
       '2026-02-02 14:30:15 America/New_York'::timestamptz,
       2
     ) $$,
  NULL,
  NULL,
  'block_start_at with non-zero seconds is rejected'
);

-- ============================================================
-- 8. required_headcount must be positive (ARCH §3.3 staffing pattern)
-- ============================================================

SELECT throws_ok(
  $$ INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
     VALUES (
       gen_random_uuid(),
       'harnwell',
       '2026-02-03 08:00:00 America/New_York'::timestamptz,
       0
     ) $$,
  NULL,
  NULL,
  'required_headcount = 0 is rejected (zero-headcount blocks must not exist)'
);

SELECT throws_ok(
  $$ INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
     VALUES (
       gen_random_uuid(),
       'harnwell',
       '2026-02-03 08:30:00 America/New_York'::timestamptz,
       -1
     ) $$,
  NULL,
  NULL,
  'required_headcount = -1 is rejected'
);

-- ============================================================
-- 9. No duplicate (house_id, block_start_at) — one block per slot per house
-- ============================================================

SELECT lives_ok(
  $$ INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
     VALUES (
       gen_random_uuid(),
       'quad',
       '2026-02-04 09:00:00 America/New_York'::timestamptz,
       3
     ) $$,
  'first (house, block_start_at) insert succeeds'
);

SELECT throws_ok(
  $$ INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
     VALUES (
       gen_random_uuid(),
       'quad',
       '2026-02-04 09:00:00 America/New_York'::timestamptz,
       3
     ) $$,
  NULL,
  NULL,
  'duplicate (house_id, block_start_at) is rejected'
);

-- A different house at the same instant is allowed.
SELECT lives_ok(
  $$ INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
     VALUES (
       gen_random_uuid(),
       'harnwell',
       '2026-02-04 09:00:00 America/New_York'::timestamptz,
       2
     ) $$,
  'same block_start_at at a different house is allowed'
);

-- ============================================================
-- 10. status / vacancy_origin invariants on shift_block_assignments
-- ARCH §3.3: "Non-vacant rows must have vacancy_origin='none'."
-- ============================================================

-- Seed one block to attach assignments to.
DO $$
DECLARE
  v_block_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
  VALUES (v_block_id, 'harnwell',
          '2026-02-05 10:00:00 America/New_York'::timestamptz, 2);
  PERFORM set_config('test.phase03.block_id', v_block_id::text, true);
END $$;

-- A vacant row with vacancy_origin = 'never_assigned' is allowed.
SELECT lives_ok(
  format(
    $sql$ INSERT INTO public.shift_block_assignments
            (assignment_id, block_id, user_id, status, vacancy_origin,
             is_float, is_cross_house_pickup)
          VALUES (gen_random_uuid(), %L, NULL, 'vacant', 'never_assigned', false, false) $sql$,
    current_setting('test.phase03.block_id')
  ),
  'vacant + never_assigned is a valid assignment row'
);

-- A scheduled row with vacancy_origin != 'none' is rejected.
SELECT throws_ok(
  format(
    $sql$ INSERT INTO public.shift_block_assignments
            (assignment_id, block_id, user_id, status, vacancy_origin,
             is_float, is_cross_house_pickup)
          VALUES (gen_random_uuid(), %L, NULL, 'scheduled', 'temporary_drop',
                  false, false) $sql$,
    current_setting('test.phase03.block_id')
  ),
  NULL,
  NULL,
  'non-vacant status with non-none vacancy_origin is rejected'
);

-- A vacant row with vacancy_origin = 'none' is rejected (inverse direction).
SELECT throws_ok(
  format(
    $sql$ INSERT INTO public.shift_block_assignments
            (assignment_id, block_id, user_id, status, vacancy_origin,
             is_float, is_cross_house_pickup)
          VALUES (gen_random_uuid(), %L, NULL, 'vacant', 'none',
                  false, false) $sql$,
    current_setting('test.phase03.block_id')
  ),
  NULL,
  NULL,
  'vacant status with vacancy_origin = none is rejected (must carry an origin)'
);

-- ============================================================
-- 11. is_float and is_cross_house_pickup are mutually exclusive (ARCH §3.2)
-- ============================================================

SELECT throws_ok(
  format(
    $sql$ INSERT INTO public.shift_block_assignments
            (assignment_id, block_id, user_id, status, vacancy_origin,
             is_float, is_cross_house_pickup, source_house_id)
          VALUES (gen_random_uuid(), %L, NULL, 'vacant', 'never_assigned',
                  true, true, 'quad') $sql$,
    current_setting('test.phase03.block_id')
  ),
  NULL,
  NULL,
  'is_float = true AND is_cross_house_pickup = true is rejected (mutually exclusive)'
);

-- ============================================================
-- 12. Default flag values
-- ============================================================

SELECT col_default_is('public', 'shift_block_assignments', 'is_float',
                      'false',
                      'is_float defaults to false');

SELECT col_default_is('public', 'shift_block_assignments', 'is_cross_house_pickup',
                      'false',
                      'is_cross_house_pickup defaults to false');

-- ============================================================
-- 13. block_step_status side table (ARCH §4.1)
-- A phase-03 deliverable per the orchestrator's step-firing tracker.
-- Schema needs to exist now so phase-07 has something to write to.
--
-- The status column uses a named enum block_step_status_enum with
-- values (fired, completed_via_force_trigger, rolled_back). The type
-- exists in phase-03; the value-semantics (when each value is written)
-- are an orchestrator concern verified in phase-07.
-- ============================================================

SELECT has_table('public', 'block_step_status',
                 'block_step_status table exists');
SELECT has_column('public', 'block_step_status', 'block_id',  'block_id col exists');
SELECT has_column('public', 'block_step_status', 'step_name', 'step_name col exists');
SELECT has_column('public', 'block_step_status', 'status',    'status col exists');
SELECT has_column('public', 'block_step_status', 'fired_at',  'fired_at col exists');
SELECT has_column('public', 'block_step_status', 'updated_at','updated_at col exists');

SELECT fk_ok('public', 'block_step_status', 'block_id',
             'public', 'shift_blocks', 'block_id',
             'block_step_status.block_id FK to shift_blocks(block_id)');

SELECT col_type_is('public', 'block_step_status', 'fired_at',
                   'timestamp with time zone',
                   'fired_at is timestamptz');
SELECT col_type_is('public', 'block_step_status', 'updated_at',
                   'timestamp with time zone',
                   'updated_at is timestamptz');

SELECT has_type('public', 'block_step_status_enum',
                'block_step_status_enum type exists');
SELECT col_type_is('public', 'block_step_status', 'status',
                   'block_step_status_enum',
                   'status column uses block_step_status_enum');

-- Composite PK over (block_id, step_name)
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.block_step_status'::regclass
      AND contype = 'p'
      AND ARRAY(
        SELECT attname::text FROM pg_attribute
        WHERE attrelid = conrelid AND attnum = ANY(conkey)
      ) <@ ARRAY['block_id','step_name']
      AND ARRAY['block_id','step_name'] <@ ARRAY(
        SELECT attname::text FROM pg_attribute
        WHERE attrelid = conrelid AND attnum = ANY(conkey)
      )
  ),
  'block_step_status has composite PK on (block_id, step_name)'
);

-- ============================================================
-- 14. All timestamps in new tables are timestamptz
-- (ARCH §1.6 — no plain timestamp columns anywhere)
-- ============================================================

SELECT is(
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('shift_blocks', 'shift_block_assignments', 'block_step_status')
      AND data_type   = 'timestamp without time zone')::integer,
  0,
  'No plain timestamp (non-tz) columns in phase-03 tables'
);

SELECT finish();
ROLLBACK;
