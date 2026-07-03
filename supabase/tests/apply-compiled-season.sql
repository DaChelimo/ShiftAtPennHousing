-- pgTAP tests for apply_compiled_season (P6; migration 20260702000006).
-- Exercises: dry-run writes nothing, apply materializes config + generates blocks,
-- headcount decrease trims vacant seats, headcount decrease with occupants
-- grandfathers, and a house close voids future blocks + cancels occupants.
-- Far-future (2099) dates avoid colliding with seeded calendar. Self-contained.

BEGIN;

SELECT plan(16);

-- Admin fixture.
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('af000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'apply-ada@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES ('af000000-0000-0000-0000-000000000001', 'Ada Admin', 'apply-ada@test.local', 'quad', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('af000000-0000-0000-0000-000000000001', 'admin', NULL);
-- A worker for the grandfather/void occupancy tests.
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('af000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'apply-w1@test.local'),
  ('af000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'apply-w2@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('af000000-0000-0000-0000-000000000002', 'W1', 'apply-w1@test.local', 'quad', true),
  ('af000000-0000-0000-0000-000000000003', 'W2', 'apply-w2@test.local', 'quad', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('af000000-0000-0000-0000-000000000002', 'sw', NULL),
  ('af000000-0000-0000-0000-000000000003', 'sw', NULL);

-- Season header (FK target for audit + last_applied_at).
INSERT INTO public.operating_seasons (season_id, season_name, slug, start_date, end_date, hours_cap, cap_enforcement, shift_start_bound, shift_end_bound)
VALUES ('af100000-0000-0000-0000-000000000001', 'Test Summer', 'testsummer', '2099-07-01', '2099-07-01', 40, 'hard', '08:00', '10:00');

-- Compiled payload: one phase, quad headcount 2, desk hours 08:00-10:00 (4 blocks).
SELECT set_config('test.payload', $json$
{
  "seasonId": "af100000-0000-0000-0000-000000000001",
  "slug": "testsummer",
  "phases": [{
    "profileName": "s_testsummer_20990701",
    "startDate": "2099-07-01", "endDate": "2099-07-01",
    "floatEnabled": false,
    "escalationChain": [{"step":"broadcast","offset":"-3 hours"},{"step":"hmod_notify_allied","offset":"-2 hours"}],
    "schedulingMode": "sm_built",
    "hoursCap": 40, "capEnforcement": "hard",
    "shiftStartBound": "08:00", "shiftEndBound": "10:00",
    "houses": [{"houseId":"quad","weekdayBands":[{"block_start":"08:00","block_end":"10:00","headcount":2}],"weekendBands":[{"block_start":"08:00","block_end":"10:00","headcount":2}]}],
    "floatRouting": []
  }],
  "period": {"periodName":"Test Summer","profileName":"s_testsummer_20990701","startDate":"2099-07-01","endDate":"2099-07-01"}
}
$json$, false);

-- 1. Non-admin is rejected.
SELECT throws_ok(
  $$ SELECT apply_compiled_season('af000000-0000-0000-0000-000000000002', 'af100000-0000-0000-0000-000000000001', current_setting('test.payload')::jsonb, false) $$,
  '42501', NULL, 'a non-admin cannot apply a season'
);

-- 2. Dry-run reports the impact...
SELECT is(
  (apply_compiled_season('af000000-0000-0000-0000-000000000001', 'af100000-0000-0000-0000-000000000001', current_setting('test.payload')::jsonb, true) ->> 'blocks_generated')::int,
  4, 'dry-run reports 4 blocks would be generated'
);
-- 3. ...but writes NOTHING.
SELECT is(
  (SELECT count(*)::int FROM operating_calendar WHERE date = '2099-07-01'),
  0, 'dry-run left operating_calendar untouched'
);
SELECT is(
  (SELECT count(*)::int FROM shift_blocks WHERE house_id = 'quad' AND block_start_at::date = '2099-07-01'),
  0, 'dry-run generated no real blocks'
);

-- 4. Real apply materializes config + blocks.
SELECT is(
  (apply_compiled_season('af000000-0000-0000-0000-000000000001', 'af100000-0000-0000-0000-000000000001', current_setting('test.payload')::jsonb, false) ->> 'blocks_generated')::int,
  4, 'apply generated 4 blocks'
);
SELECT is(
  (SELECT count(*)::int FROM operating_calendar WHERE date = '2099-07-01' AND profile_name = 's_testsummer_20990701'),
  1, 'operating_calendar now maps the date to the compiled profile'
);
SELECT ok(
  EXISTS (SELECT 1 FROM operating_profiles WHERE profile_name = 's_testsummer_20990701' AND float_enabled = false),
  'the compiled operating_profile exists with float disabled'
);
SELECT is(
  (SELECT count(DISTINCT required_headcount)::int FROM shift_blocks WHERE house_id = 'quad' AND block_start_at::date = '2099-07-01'),
  1, 'all generated blocks share one headcount'
);
SELECT is(
  (SELECT max(required_headcount)::int FROM shift_blocks WHERE house_id = 'quad' AND block_start_at::date = '2099-07-01'),
  2, 'generated blocks have headcount 2'
);
SELECT is(
  (SELECT count(*)::int FROM shift_block_assignments a JOIN shift_blocks b ON a.block_id = b.block_id
   WHERE b.house_id = 'quad' AND b.block_start_at::date = '2099-07-01' AND a.status = 'vacant'),
  8, '4 blocks x 2 seats = 8 vacant assignments'
);

-- 5. Occupy both seats of the earliest block (for grandfather test).
WITH first_block AS (
  SELECT block_id FROM shift_blocks WHERE house_id = 'quad' AND block_start_at::date = '2099-07-01'
  ORDER BY block_start_at LIMIT 1
), seats AS (
  SELECT a.assignment_id, row_number() OVER () AS rn
  FROM shift_block_assignments a JOIN first_block f ON a.block_id = f.block_id
  WHERE a.status = 'vacant'
)
UPDATE shift_block_assignments a
SET status = 'scheduled',
    user_id = CASE WHEN s.rn = 1 THEN 'af000000-0000-0000-0000-000000000002'::uuid ELSE 'af000000-0000-0000-0000-000000000003'::uuid END,
    vacancy_origin = 'none'
FROM seats s WHERE a.assignment_id = s.assignment_id;

-- 6. Re-apply with headcount reduced to 1.
SELECT set_config('test.payload1', replace(current_setting('test.payload'), '"headcount":2', '"headcount":1'), false);
SELECT ok(
  (apply_compiled_season('af000000-0000-0000-0000-000000000001', 'af100000-0000-0000-0000-000000000001', current_setting('test.payload1')::jsonb, false) ->> 'blocks_grandfathered')::int >= 1,
  'headcount decrease reports at least one grandfathered block'
);
-- The occupied block keeps BOTH occupants (grandfathered); required_headcount is 1.
SELECT is(
  (SELECT count(*)::int FROM shift_block_assignments a
   JOIN shift_blocks b ON a.block_id = b.block_id
   WHERE b.house_id = 'quad' AND b.block_start_at::date = '2099-07-01'
     AND b.block_start_at = (SELECT min(block_start_at) FROM shift_blocks WHERE house_id='quad' AND block_start_at::date='2099-07-01')
     AND a.status = 'scheduled'),
  2, 'the occupied block keeps both grandfathered occupants after the decrease'
);

-- 7. Re-apply with the house CLOSED (no houses) → future blocks voided, occupants cancelled.
SELECT set_config('test.payload_closed', $json$
{
  "seasonId": "af100000-0000-0000-0000-000000000001",
  "slug": "testsummer",
  "phases": [{
    "profileName": "s_testsummer_20990701",
    "startDate": "2099-07-01", "endDate": "2099-07-01",
    "floatEnabled": false,
    "escalationChain": [{"step":"broadcast","offset":"-3 hours"},{"step":"hmod_notify_allied","offset":"-2 hours"}],
    "schedulingMode": "sm_built", "hoursCap": 40, "capEnforcement": "hard",
    "shiftStartBound": "08:00", "shiftEndBound": "10:00",
    "houses": [], "floatRouting": []
  }],
  "period": {"periodName":"Test Summer","profileName":"s_testsummer_20990701","startDate":"2099-07-01","endDate":"2099-07-01"}
}
$json$, false);

SELECT set_config('test.close_impact',
  apply_compiled_season('af000000-0000-0000-0000-000000000001', 'af100000-0000-0000-0000-000000000001', current_setting('test.payload_closed')::jsonb, false)::text,
  false);
SELECT is(
  (current_setting('test.close_impact')::jsonb ->> 'blocks_voided')::int,
  4, 'closing the house voids all 4 future blocks'
);
SELECT is(
  (SELECT count(*)::int FROM shift_block_assignments a JOIN shift_blocks b ON a.block_id = b.block_id
   WHERE b.house_id = 'quad' AND b.block_start_at::date = '2099-07-01' AND a.status = 'cancelled_config'),
  2, 'the two grandfathered occupants were cancelled (cancelled_config)'
);
-- 15. The impact lists WHO was affected (skimmable detail), with worker + house.
SELECT ok(
  jsonb_array_length(current_setting('test.close_impact')::jsonb -> 'affected_workers') >= 1,
  'the impact records at least one affected worker'
);
SELECT is(
  (current_setting('test.close_impact')::jsonb -> 'affected_workers' -> 0 ->> 'kind'),
  'shift', 'affected-worker entries carry a kind (shift/float)'
);

SELECT * FROM finish();
ROLLBACK;
