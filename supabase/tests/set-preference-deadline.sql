-- pgTAP: set_preference_deadline RPC (T2-5 / BSpec §4.2, §13; design §6.11)
-- The SM (and HM/BM per §13) sets the preference-submission deadline; SW may not.
-- The RPC takes p_actor_user_id explicitly (no auth.uid()), so we call it as the
-- test role passing different actor ids. Far-future periods avoid the seed's
-- scheduling_periods_no_overlap exclusion. Run with: supabase test db

BEGIN;

SELECT plan(12);

-- ============================================================
-- Fixtures
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('d5000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't2-5-sm@test.local'),
  ('d5000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't2-5-sw@test.local'),
  ('d5000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't2-5-admin@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('d5000000-0000-0000-0000-000000000001', 'Mgr', 't2-5-sm@test.local', 'harnwell', true),
  ('d5000000-0000-0000-0000-000000000002', 'Wkr', 't2-5-sw@test.local', 'harnwell', true),
  ('d5000000-0000-0000-0000-000000000003', 'Adm', 't2-5-admin@test.local', 'harnwell', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('d5000000-0000-0000-0000-000000000001', 'sm', 'harnwell'),
  ('d5000000-0000-0000-0000-000000000002', 'sw', NULL),
  ('d5000000-0000-0000-0000-000000000003', 'admin', NULL);

-- Open (unpublished) period far in the future, and a published one (no overlap
-- with each other or the seed).
INSERT INTO public.scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date,
   preference_deadline, published_at)
VALUES
  ('d5000000-0000-0000-0000-000000000010', 'T2-5 Open',
   'regular_school_year', '2030-09-01', '2030-12-15',
   (now() + interval '7 days'), NULL),
  ('d5000000-0000-0000-0000-000000000011', 'T2-5 Published',
   'regular_school_year', '2030-01-15', '2030-05-15',
   (now() - interval '1 day'), now());

-- ============================================================
-- Tests
-- ============================================================

-- 1. The function exists.
SELECT has_function('set_preference_deadline', 'set_preference_deadline RPC exists');

-- 2. SM sets the deadline → RPC returns the new value.
SELECT is(
  (SELECT preference_deadline
     FROM set_preference_deadline(
       'd5000000-0000-0000-0000-000000000001'::uuid,
       'd5000000-0000-0000-0000-000000000010'::uuid,
       '2030-08-25 17:00:00 America/New_York'::timestamptz)),
  '2030-08-25 17:00:00 America/New_York'::timestamptz,
  'SM set: RPC returns the new deadline'
);

-- 3. The UPDATE is persisted on the row.
SELECT is(
  (SELECT preference_deadline FROM scheduling_periods
    WHERE period_id = 'd5000000-0000-0000-0000-000000000010'),
  '2030-08-25 17:00:00 America/New_York'::timestamptz,
  'SM set: scheduling_periods.preference_deadline persisted'
);

-- 4. SW is rejected (insufficient_privilege / 42501).
SELECT throws_ok(
  $$ SELECT set_preference_deadline(
       'd5000000-0000-0000-0000-000000000002'::uuid,
       'd5000000-0000-0000-0000-000000000010'::uuid,
       '2030-08-20 12:00:00 America/New_York'::timestamptz) $$,
  '42501',
  NULL,
  'SW may not set the preference deadline'
);

-- 5. NULL deadline rejected (check_violation / 23514).
SELECT throws_ok(
  $$ SELECT set_preference_deadline(
       'd5000000-0000-0000-0000-000000000001'::uuid,
       'd5000000-0000-0000-0000-000000000010'::uuid,
       NULL) $$,
  '23514',
  NULL,
  'NULL deadline is rejected'
);

-- 6. Unknown period rejected (no_data_found / P0002).
SELECT throws_ok(
  $$ SELECT set_preference_deadline(
       'd5000000-0000-0000-0000-000000000001'::uuid,
       'd5000000-0000-0000-0000-0000000000ff'::uuid,
       '2030-08-20 12:00:00 America/New_York'::timestamptz) $$,
  'P0002',
  NULL,
  'Unknown scheduling period is rejected'
);

-- 7. Already-published period is locked (check_violation / 23514).
SELECT throws_ok(
  $$ SELECT set_preference_deadline(
       'd5000000-0000-0000-0000-000000000001'::uuid,
       'd5000000-0000-0000-0000-000000000011'::uuid,
       '2030-01-10 12:00:00 America/New_York'::timestamptz) $$,
  '23514',
  NULL,
  'Published period deadline is locked'
);

-- 8. Deadline after the period start is rejected (23514).
SELECT throws_ok(
  $$ SELECT set_preference_deadline(
       'd5000000-0000-0000-0000-000000000001'::uuid,
       'd5000000-0000-0000-0000-000000000010'::uuid,
       '2030-10-01 12:00:00 America/New_York'::timestamptz) $$,
  '23514',
  NULL,
  'Deadline after period start is rejected'
);

-- 9. Boundary: deadline exactly at the period start (NY midnight) is allowed.
SELECT is(
  (SELECT preference_deadline
     FROM set_preference_deadline(
       'd5000000-0000-0000-0000-000000000001'::uuid,
       'd5000000-0000-0000-0000-000000000010'::uuid,
       '2030-09-01 00:00:00 America/New_York'::timestamptz)),
  '2030-09-01 00:00:00 America/New_York'::timestamptz,
  'Deadline at period start (NY midnight) is allowed'
);

-- 10. The top-level admin role may set the deadline (§18). Any house — admin is
-- scope-less and periods are global.
SELECT is(
  (SELECT preference_deadline
     FROM set_preference_deadline(
       'd5000000-0000-0000-0000-000000000003'::uuid,
       'd5000000-0000-0000-0000-000000000010'::uuid,
       '2030-08-20 17:00:00 America/New_York'::timestamptz)),
  '2030-08-20 17:00:00 America/New_York'::timestamptz,
  'Admin may set the preference deadline'
);

-- 11. Admin set is persisted.
SELECT is(
  (SELECT preference_deadline FROM scheduling_periods
    WHERE period_id = 'd5000000-0000-0000-0000-000000000010'),
  '2030-08-20 17:00:00 America/New_York'::timestamptz,
  'Admin set: scheduling_periods.preference_deadline persisted'
);

-- 12. The season authoring table carries an admin-authored preference deadline.
SELECT has_column(
  'operating_seasons', 'preference_deadline',
  'operating_seasons has a preference_deadline authoring column'
);

SELECT * FROM finish();
ROLLBACK;
