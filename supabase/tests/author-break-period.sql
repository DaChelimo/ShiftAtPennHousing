-- pgTAP tests for author_break_period / remove_break_period (migration 20260709000001).
-- Exercises: admin-only gate, create declares the range, edit-shrink un-declares the
-- dropped tail, remove restores + deletes. Far-future (2099) dates avoid colliding
-- with the seeded operating calendar. Self-contained.

BEGIN;

SELECT plan(12);

-- Admin + non-admin (sw) fixtures.
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('ab000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'brk-admin@test.local'),
  ('ab000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'brk-sw@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('ab000000-0000-0000-0000-000000000001', 'Ada Admin', 'brk-admin@test.local', 'quad', true),
  ('ab000000-0000-0000-0000-000000000002', 'Sam Worker', 'brk-sw@test.local', 'quad', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('ab000000-0000-0000-0000-000000000001', 'admin', NULL),
  ('ab000000-0000-0000-0000-000000000002', 'sw', NULL);

-- 1. A non-admin (Student Worker) cannot author a break.
SELECT throws_ok(
  $$ SELECT author_break_period('ab000000-0000-0000-0000-000000000002', 'Winter (dev)', 'winter_break', '2099-08-10', '2099-08-14', 'short_break', NULL) $$,
  '42501', NULL, 'a non-admin cannot author a break period'
);

-- 2. An unknown profile is rejected.
SELECT throws_ok(
  $$ SELECT author_break_period('ab000000-0000-0000-0000-000000000001', 'Bad', 'winter_break', '2099-08-10', '2099-08-14', 'no_such_profile', NULL) $$,
  '23503', NULL, 'an unknown operating profile is rejected'
);

-- 3. end < start is rejected.
SELECT throws_ok(
  $$ SELECT author_break_period('ab000000-0000-0000-0000-000000000001', 'Bad', 'winter_break', '2099-08-14', '2099-08-10', 'short_break', NULL) $$,
  '22023', NULL, 'end before start is rejected'
);

-- 3b. Confused-deputy guard: an AUTHENTICATED non-admin (real caller = the sw,
--     set via the request JWT) cannot forge privilege by passing the admin's id
--     as p_actor_user_id — authz uses auth.uid(), not the param.
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'ab000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  true
);
SELECT throws_ok(
  $$ SELECT author_break_period('ab000000-0000-0000-0000-000000000001', 'Forge', 'winter_break', '2099-08-10', '2099-08-14', 'short_break', NULL) $$,
  '42501', NULL, 'an authenticated non-admin cannot forge the admin actor'
);
-- Reset the JWT so the remaining (service-context) assertions use the param path.
SELECT set_config('request.jwt.claims', NULL, true);

-- 4. Admin creates a 5-day break: reports 5 dates declared.
SELECT set_config('test.brk', (
  SELECT new_break_id::text
  FROM author_break_period('ab000000-0000-0000-0000-000000000001', 'Winter (dev)', 'winter_break', '2099-08-10', '2099-08-14', 'short_break', NULL)
), false);
SELECT isnt(current_setting('test.brk'), '', 'create returns a break_id');

-- 5. break_periods row exists with the right window + profile.
SELECT is(
  (SELECT count(*)::int FROM break_periods WHERE break_id = current_setting('test.brk')::uuid
     AND start_date = '2099-08-10' AND end_date = '2099-08-14' AND profile_name = 'short_break'),
  1, 'break_periods row written with window + profile'
);

-- 6. All 5 operating_calendar dates now point at the break profile.
SELECT is(
  (SELECT count(*)::int FROM operating_calendar
    WHERE date BETWEEN '2099-08-10' AND '2099-08-14' AND profile_name = 'short_break'),
  5, 'the 5-day range is retargeted to the break profile'
);

-- 7. Edit-shrink to a 3-day window.
SELECT author_break_period('ab000000-0000-0000-0000-000000000001', 'Winter (dev)', 'winter_break', '2099-08-10', '2099-08-12', 'short_break', current_setting('test.brk')::uuid);
SELECT is(
  (SELECT count(*)::int FROM operating_calendar
    WHERE date BETWEEN '2099-08-10' AND '2099-08-12' AND profile_name = 'short_break'),
  3, 'the shrunk window keeps 3 break dates'
);

-- 8. The dropped tail (08-13, 08-14) is restored to the school-year base.
SELECT is(
  (SELECT count(*)::int FROM operating_calendar
    WHERE date IN ('2099-08-13', '2099-08-14') AND profile_name = 'regular_school_year'),
  2, 'the dropped tail is un-declared back to regular_school_year'
);

-- 9. The break row reflects the new end date.
SELECT is(
  (SELECT end_date FROM break_periods WHERE break_id = current_setting('test.brk')::uuid),
  '2099-08-12'::date, 'break row end_date updated on edit'
);

-- 10. Remove restores the remaining range + reports the count.
SELECT is(
  remove_break_period('ab000000-0000-0000-0000-000000000001', current_setting('test.brk')::uuid),
  3, 'remove restores the 3 remaining break dates'
);

-- 11. The break row is gone.
SELECT is(
  (SELECT count(*)::int FROM break_periods WHERE break_id = current_setting('test.brk')::uuid),
  0, 'break row deleted on remove'
);

SELECT * FROM finish();
ROLLBACK;
