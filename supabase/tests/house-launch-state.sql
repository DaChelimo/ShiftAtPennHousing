-- pgTAP behavioral tests for the staggered-launch gate (rollout; migration
-- 20260712000001). Covers the invariants that must never regress: (1) the master
-- switch defaults OFF so every house reads live (backward compatible), (2) with the
-- switch ON only launch_state = 'live' houses read live, (3) the mutation RPCs are
-- admin-only, (4) worker_visible_houses filters to live houses. Self-contained:
-- BEGIN...ROLLBACK, own fixtures.
--
-- Run with: supabase test db   (or psql -f against a DB with migrations applied)

BEGIN;

SELECT plan(16);

-- ============================================================
-- Fixture: one admin (Ada, scope NULL) and one plain SW (Stan). Two throwaway
-- houses so the test never depends on seed launch states: 'lx-live' and 'lx-dark'.
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('1c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'launch-ada@test.local'),
  ('1c000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'launch-stan@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('1c000000-0000-0000-0000-000000000001', 'Ada Admin', 'launch-ada@test.local',  'quad',       true),
  ('1c000000-0000-0000-0000-000000000002', 'Stan SW',   'launch-stan@test.local', 'lower-quad', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('1c000000-0000-0000-0000-000000000001', 'admin', NULL),
  ('1c000000-0000-0000-0000-000000000002', 'sw',    NULL);

INSERT INTO houses (id, name) VALUES ('lx-live', 'Launch Test Live'), ('lx-dark', 'Launch Test Dark');

-- ============================================================
-- 1. New houses default to pre_launch.
-- ============================================================
SELECT is((SELECT launch_state FROM houses WHERE id = 'lx-live'), 'pre_launch',
  'a freshly inserted house defaults to pre_launch');

-- ============================================================
-- 2-5. Master switch OFF (default): the gate is disabled, every real house is live.
-- ============================================================
SELECT is(public.is_staggered_launch_enabled(), false,
  'master switch defaults to disabled (no config row)');
SELECT is(public.house_is_live('lx-dark'), true,
  'with the gate off, a pre_launch house still reads live');
SELECT is(public.house_is_live('does-not-exist'), false,
  'an unknown house is never live');
SELECT is(
  (SELECT count(*) FROM worker_visible_houses WHERE id IN ('lx-live', 'lx-dark')),
  2::bigint,
  'with the gate off, worker_visible_houses lists every house');

-- ============================================================
-- 6. set_staggered_launch_enabled is admin-only.
-- ============================================================
SELECT set_config('request.jwt.claims', '{"sub":"1c000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.set_staggered_launch_enabled(true) $$,
  'only the project administrator may change the staggered launch switch',
  'a plain SW cannot flip the master switch');

-- ============================================================
-- 7-8. As admin, enable the gate: pre_launch houses now read dark.
-- ============================================================
SELECT set_config('request.jwt.claims', '{"sub":"1c000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.set_staggered_launch_enabled(true) $$,
  'admin flips the master switch on');
SELECT is(public.house_is_live('lx-dark'), false,
  'with the gate on, a pre_launch house reads dark');

-- ============================================================
-- 9. set_house_launch_state is admin-only.
-- ============================================================
SELECT set_config('request.jwt.claims', '{"sub":"1c000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.set_house_launch_state('lx-live', true) $$,
  'only the project administrator may change a house launch state',
  'a plain SW cannot launch a house');

-- ============================================================
-- 10-12. As admin, launch one house: it reads live + is stamped; the other stays dark.
-- ============================================================
SELECT set_config('request.jwt.claims', '{"sub":"1c000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.set_house_launch_state('lx-live', true) $$,
  'admin launches lx-live');
SELECT is(
  (SELECT launch_state FROM houses WHERE id = 'lx-live'), 'live',
  'launched house is now live');
SELECT isnt(
  (SELECT launched_at FROM houses WHERE id = 'lx-live'), NULL,
  'launching stamps launched_at');
SELECT is(public.house_is_live('lx-live'), true,
  'a launched house reads live directly, even with the gate on');
SELECT bag_eq(
  $$ SELECT id FROM worker_visible_houses WHERE id IN ('lx-live', 'lx-dark') $$,
  $$ VALUES ('lx-live') $$,
  'worker_visible_houses lists only the live house when the gate is on');

-- ============================================================
-- 14-15. Un-launching resets launch_state but KEEPS the first-launch stamp; unknown
-- house errors.
-- ============================================================
SELECT public.set_house_launch_state('lx-live', false);
SELECT is(
  (SELECT launch_state || '/' || CASE WHEN launched_at IS NULL THEN 'null' ELSE 'kept' END
     FROM houses WHERE id = 'lx-live'),
  'pre_launch/kept',
  'un-launching resets launch_state to pre_launch but keeps the launched_at audit stamp');
SELECT throws_ok(
  $$ SELECT public.set_house_launch_state('nope', true) $$,
  'unknown house nope',
  'launching an unknown house errors');

SELECT * FROM finish();
ROLLBACK;
