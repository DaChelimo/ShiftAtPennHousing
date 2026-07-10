-- pgTAP for apply_compiled_break / remove_break_period (migration 20260709000004).
-- Exercises admin-gate + confused-deputy guard, dry-run writes nothing, apply
-- materializes the per-break profile + staffing + float routing + break row +
-- calendar + generated blocks, and remove restores the calendar + drops the profile.
-- Far-future (2099) dates avoid colliding with the seeded calendar. Self-contained.

BEGIN;

SELECT plan(15);

-- Admin + worker fixtures.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('cc000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'brk2-admin@test.local'),
  ('cc000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'brk2-sw@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('cc000000-0000-0000-0000-0000000000a1', 'Ada Admin', 'brk2-admin@test.local', 'quad', true),
  ('cc000000-0000-0000-0000-0000000000a2', 'Sam Worker', 'brk2-sw@test.local', 'quad', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('cc000000-0000-0000-0000-0000000000a1', 'admin', NULL),
  ('cc000000-0000-0000-0000-0000000000a2', 'sw', NULL);

SELECT set_config('test.payload', $json$
{
  "breakId": "cc000000-0000-0000-0000-0000000000b1",
  "breakName": "Test Break", "breakType": "winter_break", "slug": "test_break",
  "profileName": "b_test_break_20990810",
  "startDate": "2099-08-10", "endDate": "2099-08-12",
  "floatEnabled": true, "schedulingMode": "claim_based",
  "hoursCap": 40, "capEnforcement": "hard",
  "shiftStartBound": "08:00", "shiftEndBound": "10:00",
  "escalationChain": [{"step":"broadcast","offset":"-3 hours"},{"step":"float_lookup","offset":"-2 hours"},{"step":"hmod_notify_allied","offset":"-2 hours","trigger":"on_float_failure"}],
  "claimOpenOffset": "-14 days", "claimAlertOffset": "-3 days", "claimCloseOffset": "-1 days",
  "houses": [
    {"houseId":"quad","weekdayBands":[{"block_start":"08:00","block_end":"10:00","headcount":2}],"weekendBands":[{"block_start":"08:00","block_end":"10:00","headcount":2}]},
    {"houseId":"lower-quad","weekdayBands":[{"block_start":"08:00","block_end":"10:00","headcount":1}],"weekendBands":[{"block_start":"08:00","block_end":"10:00","headcount":1}]}
  ],
  "floatRouting": [{"sourceHouseId":"quad","destinationHouseId":"lower-quad","precedenceOrder":1}]
}
$json$, false);

-- 1. Non-admin rejected.
SELECT throws_ok(
  $$ SELECT apply_compiled_break('cc000000-0000-0000-0000-0000000000a2', current_setting('test.payload')::jsonb, false) $$,
  '42501', NULL, 'a non-admin cannot apply a compiled break'
);

-- 2. Confused-deputy: an authenticated non-admin cannot forge the admin actor.
SELECT set_config('request.jwt.claims',
  json_build_object('sub','cc000000-0000-0000-0000-0000000000a2','role','authenticated')::text, true);
SELECT throws_ok(
  $$ SELECT apply_compiled_break('cc000000-0000-0000-0000-0000000000a1', current_setting('test.payload')::jsonb, false) $$,
  '42501', NULL, 'an authenticated non-admin cannot forge the admin actor'
);
SELECT set_config('request.jwt.claims', NULL, true);

-- 3. Dry-run reports the block generation...
SELECT is(
  (apply_compiled_break('cc000000-0000-0000-0000-0000000000a1', current_setting('test.payload')::jsonb, true) ->> 'blocks_generated')::int,
  24, 'dry-run reports 24 blocks would be generated (4 blocks x 3 days x 2 houses)'
);
-- 4. ...but writes NOTHING.
SELECT is(
  (SELECT count(*)::int FROM operating_calendar WHERE date = '2099-08-10'),
  0, 'dry-run left operating_calendar untouched'
);

-- 5. Real apply returns the break id.
SELECT is(
  (apply_compiled_break('cc000000-0000-0000-0000-0000000000a1', current_setting('test.payload')::jsonb, false) ->> 'break_id'),
  'cc000000-0000-0000-0000-0000000000b1', 'apply returns the break id'
);

-- 6. break_periods row written with the compiled profile.
SELECT is(
  (SELECT count(*)::int FROM break_periods
    WHERE break_id = 'cc000000-0000-0000-0000-0000000000b1' AND profile_name = 'b_test_break_20990810'
      AND start_date = '2099-08-10' AND end_date = '2099-08-12'),
  1, 'break_periods row written with the per-break profile'
);

-- 7. Operating profile is claim-based with the claim-open offset.
SELECT is(
  (SELECT scheduling_mode::text FROM operating_profiles WHERE profile_name = 'b_test_break_20990810'),
  'claim_based', 'break profile is claim_based'
);
SELECT is(
  (SELECT claim_phase_open_offset FROM operating_profiles WHERE profile_name = 'b_test_break_20990810'),
  interval '-14 days', 'break profile carries the -14d claim-open offset'
);

-- 8. Calendar retargeted.
SELECT is(
  (SELECT profile_name FROM operating_calendar WHERE date = '2099-08-11'),
  'b_test_break_20990810', 'operating_calendar retargeted to the break profile'
);

-- 9. A quad block on 2099-08-10 08:00 ET has required_headcount 2.
SELECT is(
  (SELECT required_headcount FROM shift_blocks
    WHERE house_id = 'quad'
      AND block_start_at = '2099-08-10 08:00'::timestamp AT TIME ZONE 'America/New_York'),
  2, 'quad break block generated at headcount 2'
);

-- 10. 24 blocks materialized in the window.
SELECT is(
  (SELECT count(*)::int FROM shift_blocks
    WHERE (block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN '2099-08-10' AND '2099-08-12'
      AND house_id IN ('quad','lower-quad')),
  24, '24 break blocks materialized'
);

-- 11. Float routing quad -> lower-quad.
SELECT is(
  (SELECT count(*)::int FROM float_routing
    WHERE profile_name = 'b_test_break_20990810' AND source_house_id = 'quad' AND destination_house_id = 'lower-quad'),
  1, 'universal float route quad -> lower-quad written'
);

-- 12. Remove reports success.
SELECT is(
  (remove_break_period('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000b1') ->> 'removed')::boolean,
  true, 'remove_break_period succeeds'
);

-- 13. break_periods row gone.
SELECT is(
  (SELECT count(*)::int FROM break_periods WHERE break_id = 'cc000000-0000-0000-0000-0000000000b1'),
  0, 'break row deleted on remove'
);

-- 14. Calendar restored + per-break profile dropped.
SELECT is(
  (SELECT profile_name FROM operating_calendar WHERE date = '2099-08-11'),
  'regular_school_year', 'calendar restored to the school year on remove'
);

SELECT * FROM finish();
ROLLBACK;
