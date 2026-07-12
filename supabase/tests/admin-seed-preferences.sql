-- pgTAP tests for admin_seed_preferences (dev-seeding Feature A; migration
-- 20260711000002). Exercises: admin gating, write of preferences + targets,
-- deadline reopen/restore around the deadline-enforcing triggers, and strictly
-- idempotent period-wide replace. Far-future (2099) dates avoid colliding with the
-- seeded calendar. Self-contained.

BEGIN;

SELECT plan(10);

-- ---------------------------------------------------------------------------
-- Fixtures: an admin, two SWs in quad, a far-future period on an existing
-- operating profile (regular_school_year, cap 20), and two quad blocks.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('ad000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seedpref-admin@test.local'),
  ('ad000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seedpref-sw1@test.local'),
  ('ad000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seedpref-sw2@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('ad000000-0000-0000-0000-000000000001', 'Seed Admin', 'seedpref-admin@test.local', 'quad', true),
  ('ad000000-0000-0000-0000-000000000002', 'Seed SW One', 'seedpref-sw1@test.local', 'quad', true),
  ('ad000000-0000-0000-0000-000000000003', 'Seed SW Two', 'seedpref-sw2@test.local', 'quad', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('ad000000-0000-0000-0000-000000000001', 'admin', NULL),
  ('ad000000-0000-0000-0000-000000000002', 'sw', NULL),
  ('ad000000-0000-0000-0000-000000000003', 'sw', NULL);

INSERT INTO public.scheduling_periods (period_id, period_name, profile_name, start_date, end_date, preference_deadline)
VALUES ('ad000000-0000-0000-0000-0000000000f0', 'Seed Period', 'regular_school_year', '2099-06-01', '2099-08-31', NULL);

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('ad000000-0000-0000-0000-0000000000b1', 'quad', '2099-06-01 18:00:00-04', 3),
  ('ad000000-0000-0000-0000-0000000000b2', 'quad', '2099-06-01 18:30:00-04', 3);

-- ---------------------------------------------------------------------------
-- 1. Non-admin actor is rejected.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT admin_seed_preferences(
       'ad000000-0000-0000-0000-000000000002',
       'ad000000-0000-0000-0000-0000000000f0',
       '[]'::jsonb) $$,
  '42501',
  'Only an administrator may seed preferences.',
  'non-admin actor is rejected with insufficient_privilege');

-- ---------------------------------------------------------------------------
-- 2. Unknown period is rejected.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT admin_seed_preferences(
       'ad000000-0000-0000-0000-000000000001',
       'ad000000-0000-0000-0000-0000000000ff',
       '[]'::jsonb) $$,
  'P0002',
  NULL,
  'unknown period raises no_data_found');

-- ---------------------------------------------------------------------------
-- 3. Admin seed writes preferences + targets and reports counts.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT admin_seed_preferences(
     'ad000000-0000-0000-0000-000000000001',
     'ad000000-0000-0000-0000-0000000000f0',
     $j$[
       {"user_id":"ad000000-0000-0000-0000-000000000002","target_hours":16,"opted_out":false,
        "entries":[{"block_id":"ad000000-0000-0000-0000-0000000000b1","status":"preferred"},
                   {"block_id":"ad000000-0000-0000-0000-0000000000b2","status":"cannot"}]},
       {"user_id":"ad000000-0000-0000-0000-000000000003","target_hours":10,"opted_out":true,
        "entries":[{"block_id":"ad000000-0000-0000-0000-0000000000b1","status":"preferred"}]}
     ]$j$::jsonb)),
  '{"workers": 2, "preferences": 3}'::jsonb,
  'seed reports 2 targets + 3 preferences');

SELECT is(
  (SELECT count(*)::int FROM preferences WHERE period_id = 'ad000000-0000-0000-0000-0000000000f0'),
  3, '3 preference rows written');

SELECT is(
  (SELECT count(*)::int FROM period_targets WHERE period_id = 'ad000000-0000-0000-0000-0000000000f0'),
  2, '2 period_target rows written');

SELECT is(
  (SELECT opted_out FROM period_targets
   WHERE period_id = 'ad000000-0000-0000-0000-0000000000f0'
     AND user_id = 'ad000000-0000-0000-0000-000000000003'),
  true, 'opted_out flag persisted');

-- ---------------------------------------------------------------------------
-- 4. Deadline reopen/restore: with a PAST deadline (window closed), the trigger
--    would normally reject writes; the RPC opens the window then restores the
--    exact prior deadline.
-- ---------------------------------------------------------------------------
UPDATE scheduling_periods
  SET preference_deadline = '2000-01-01 00:00:00-05'
  WHERE period_id = 'ad000000-0000-0000-0000-0000000000f0';

SELECT lives_ok(
  $$ SELECT admin_seed_preferences(
       'ad000000-0000-0000-0000-000000000001',
       'ad000000-0000-0000-0000-0000000000f0',
       $j$[{"user_id":"ad000000-0000-0000-0000-000000000002","target_hours":18,"opted_out":false,
            "entries":[{"block_id":"ad000000-0000-0000-0000-0000000000b1","status":"preferred"}]}]$j$::jsonb) $$,
  'seed succeeds despite a past deadline (window reopened for the rewrite)');

SELECT is(
  (SELECT preference_deadline FROM scheduling_periods WHERE period_id = 'ad000000-0000-0000-0000-0000000000f0'),
  '2000-01-01 00:00:00-05'::timestamptz,
  'the prior (past) deadline is restored exactly after the seed');

-- ---------------------------------------------------------------------------
-- 5. Idempotent replace: the second seed wiped the first entirely (SW two's
--    rows are gone; only SW one's single new row remains).
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM preferences WHERE period_id = 'ad000000-0000-0000-0000-0000000000f0'),
  1, 'idempotent replace wiped all prior period preferences (only the new one remains)');

SELECT is(
  (SELECT count(*)::int FROM period_targets WHERE period_id = 'ad000000-0000-0000-0000-0000000000f0'),
  1, 'idempotent replace wiped all prior period targets');

SELECT * FROM finish();
ROLLBACK;
