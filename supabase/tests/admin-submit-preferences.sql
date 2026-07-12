-- pgTAP tests for admin_submit_preferences (on-behalf preference authoring;
-- migration 20260711000003). Exercises: authorization (sm own-house only,
-- schedule admin cross-house), unknown worker/period errors, single-worker UPSERT
-- (no cross-user wipe, unlike admin_seed_preferences), and manager deadline
-- override (past deadline reopened for the write then restored). Far-future (2099)
-- dates avoid colliding with the seeded calendar. Self-contained.

BEGIN;

SELECT plan(12);

-- ---------------------------------------------------------------------------
-- Fixtures: an SM scoped to quad (may author quad), an SM scoped to lower-quad
-- (may NOT author quad), an HM scoped to lower-quad (schedule admin, may author
-- ANY house), two quad SWs, a far-future period, and two quad blocks.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('bd000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'submitpref-sm-quad@test.local'),
  ('bd000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'submitpref-sm-lq@test.local'),
  ('bd000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'submitpref-hm-lq@test.local'),
  ('bd000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'submitpref-sw1@test.local'),
  ('bd000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'submitpref-sw2@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('bd000000-0000-0000-0000-000000000001', 'SM Quad', 'submitpref-sm-quad@test.local', 'quad', true),
  ('bd000000-0000-0000-0000-000000000002', 'SM LowerQuad', 'submitpref-sm-lq@test.local', 'lower-quad', true),
  ('bd000000-0000-0000-0000-000000000003', 'HM LowerQuad', 'submitpref-hm-lq@test.local', 'lower-quad', true),
  ('bd000000-0000-0000-0000-000000000004', 'SW One', 'submitpref-sw1@test.local', 'quad', true),
  ('bd000000-0000-0000-0000-000000000005', 'SW Two', 'submitpref-sw2@test.local', 'quad', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('bd000000-0000-0000-0000-000000000001', 'sm', 'quad'),
  ('bd000000-0000-0000-0000-000000000002', 'sm', 'lower-quad'),
  ('bd000000-0000-0000-0000-000000000003', 'hm', 'lower-quad'),
  ('bd000000-0000-0000-0000-000000000004', 'sw', NULL),
  ('bd000000-0000-0000-0000-000000000005', 'sw', NULL);

INSERT INTO public.scheduling_periods (period_id, period_name, profile_name, start_date, end_date, preference_deadline)
VALUES ('bd000000-0000-0000-0000-0000000000f0', 'Submit Period', 'regular_school_year', '2099-06-01', '2099-08-31', NULL);

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('bd000000-0000-0000-0000-0000000000b1', 'quad', '2099-06-01 18:00:00-04', 3),
  ('bd000000-0000-0000-0000-0000000000b2', 'quad', '2099-06-01 18:30:00-04', 3);

-- ---------------------------------------------------------------------------
-- 1. An SM scoped to a DIFFERENT house may not author a quad worker's prefs.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT * FROM admin_submit_preferences(
       'bd000000-0000-0000-0000-000000000002',
       'bd000000-0000-0000-0000-000000000004',
       'bd000000-0000-0000-0000-0000000000f0',
       '[]'::jsonb, 12, false) $$,
  '42501',
  'Not authorized to edit preferences for this worker',
  'an SM from another house is rejected (own-house only)');

-- ---------------------------------------------------------------------------
-- 2. Unknown target worker raises no_data_found.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT * FROM admin_submit_preferences(
       'bd000000-0000-0000-0000-000000000001',
       'bd000000-0000-0000-0000-0000000000ee',
       'bd000000-0000-0000-0000-0000000000f0',
       '[]'::jsonb, 12, false) $$,
  'P0002',
  NULL,
  'unknown target worker raises no_data_found');

-- ---------------------------------------------------------------------------
-- 3. Authorized SM, unknown period raises no_data_found.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT * FROM admin_submit_preferences(
       'bd000000-0000-0000-0000-000000000001',
       'bd000000-0000-0000-0000-000000000004',
       'bd000000-0000-0000-0000-0000000000ff',
       '[]'::jsonb, 12, false) $$,
  'P0002',
  NULL,
  'unknown period raises no_data_found');

-- ---------------------------------------------------------------------------
-- 4. SM(quad) authors SW One: preferred + cannot on the two blocks, target 16.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT preferences_upserted FROM admin_submit_preferences(
     'bd000000-0000-0000-0000-000000000001',
     'bd000000-0000-0000-0000-000000000004',
     'bd000000-0000-0000-0000-0000000000f0',
     $j$[{"block_id":"bd000000-0000-0000-0000-0000000000b1","status":"preferred"},
         {"block_id":"bd000000-0000-0000-0000-0000000000b2","status":"cannot"}]$j$::jsonb,
     16, false)),
  2, 'SM(quad) authoring SW One upserts 2 preference rows');

SELECT is(
  (SELECT count(*)::int FROM preferences
   WHERE period_id = 'bd000000-0000-0000-0000-0000000000f0'
     AND user_id = 'bd000000-0000-0000-0000-000000000004'),
  2, 'SW One has 2 preference rows on file');

SELECT is(
  (SELECT target_hours FROM period_targets
   WHERE period_id = 'bd000000-0000-0000-0000-0000000000f0'
     AND user_id = 'bd000000-0000-0000-0000-000000000004'),
  16, 'SW One target hours persisted');

-- ---------------------------------------------------------------------------
-- 5. Cross-house: HM (schedule admin) may author a quad worker despite being
--    scoped to lower-quad.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT * FROM admin_submit_preferences(
       'bd000000-0000-0000-0000-000000000003',
       'bd000000-0000-0000-0000-000000000005',
       'bd000000-0000-0000-0000-0000000000f0',
       $j$[{"block_id":"bd000000-0000-0000-0000-0000000000b1","status":"available"}]$j$::jsonb,
       8, false) $$,
  'a schedule-admin HM may author for any house (cross-house)');

SELECT is(
  (SELECT count(*)::int FROM period_targets
   WHERE period_id = 'bd000000-0000-0000-0000-0000000000f0'
     AND user_id = 'bd000000-0000-0000-0000-000000000005'),
  1, 'SW Two target row written by the cross-house HM');

-- ---------------------------------------------------------------------------
-- 6. UPSERT (not wipe): re-authoring SW One overwrites SW One's block status and
--    leaves SW Two's rows untouched (contrast admin_seed_preferences wipe).
-- ---------------------------------------------------------------------------
SELECT admin_submit_preferences(
  'bd000000-0000-0000-0000-000000000001',
  'bd000000-0000-0000-0000-000000000004',
  'bd000000-0000-0000-0000-0000000000f0',
  $j$[{"block_id":"bd000000-0000-0000-0000-0000000000b1","status":"cannot"}]$j$::jsonb,
  4, false);

SELECT is(
  (SELECT status::text FROM preferences
   WHERE period_id = 'bd000000-0000-0000-0000-0000000000f0'
     AND user_id = 'bd000000-0000-0000-0000-000000000004'
     AND block_id = 'bd000000-0000-0000-0000-0000000000b1'),
  'cannot', 'SW One block status overwritten by re-authoring');

SELECT is(
  (SELECT count(*)::int FROM period_targets
   WHERE period_id = 'bd000000-0000-0000-0000-0000000000f0'
     AND user_id = 'bd000000-0000-0000-0000-000000000005'),
  1, 'SW Two rows untouched by SW One re-authoring (single-worker upsert)');

-- ---------------------------------------------------------------------------
-- 7. Manager deadline override: with a PAST deadline the enforce trigger would
--    reject writes; the RPC reopens the window then restores the exact deadline.
-- ---------------------------------------------------------------------------
UPDATE scheduling_periods
  SET preference_deadline = '2000-01-01 00:00:00-05'
  WHERE period_id = 'bd000000-0000-0000-0000-0000000000f0';

SELECT lives_ok(
  $$ SELECT * FROM admin_submit_preferences(
       'bd000000-0000-0000-0000-000000000001',
       'bd000000-0000-0000-0000-000000000004',
       'bd000000-0000-0000-0000-0000000000f0',
       $j$[{"block_id":"bd000000-0000-0000-0000-0000000000b1","status":"preferred"}]$j$::jsonb,
       20, false) $$,
  'manager may author past the deadline (window reopened for the write)');

SELECT is(
  (SELECT preference_deadline FROM scheduling_periods
   WHERE period_id = 'bd000000-0000-0000-0000-0000000000f0'),
  '2000-01-01 00:00:00-05'::timestamptz,
  'the prior (past) deadline is restored exactly after the write');

SELECT * FROM finish();
ROLLBACK;
