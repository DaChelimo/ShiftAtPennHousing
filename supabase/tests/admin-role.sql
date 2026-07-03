-- pgTAP behavioral tests for the top-level Administrator role (BSpec §2.7;
-- migrations 20260702000001 + 20260702000002). Covers the invariants that must
-- never regress: (1) house-agnostic superuser powers over people-admin AND
-- schedule for EVERY house, (2) scope_house_id must be NULL, (3) admin can never
-- broadcast-subscribe, (4) admin can read every house's assignments, (5) admin
-- can read+write system_config. Self-contained: BEGIN…ROLLBACK, own fixtures.
--
-- Run with: supabase test db   (or psql -f against a DB with migrations applied)

BEGIN;

SELECT plan(13);

-- ============================================================
-- Fixture: one admin (Ada, home house quad, scope NULL), one plain SW (Stan).
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('ad000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-ada@test.local'),
  ('ad000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-stan@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('ad000000-0000-0000-0000-000000000001', 'Ada Admin', 'admin-ada@test.local',  'quad',     true),
  ('ad000000-0000-0000-0000-000000000002', 'Stan SW',   'admin-stan@test.local', 'lower-quad', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('ad000000-0000-0000-0000-000000000001', 'admin', NULL),
  ('ad000000-0000-0000-0000-000000000002', 'sw',    NULL);

-- ============================================================
-- 1–2. user_is_admin.
-- ============================================================
SELECT is(public.user_is_admin('ad000000-0000-0000-0000-000000000001'), true,  'user_is_admin true for the admin');
SELECT is(public.user_is_admin('ad000000-0000-0000-0000-000000000002'), false, 'user_is_admin false for a plain SW');

-- ============================================================
-- 3. user_is_schedule_admin — admin joins the elevated tier.
-- ============================================================
SELECT is(public.user_is_schedule_admin('ad000000-0000-0000-0000-000000000001'), true, 'admin is in the schedule-admin tier');

-- ============================================================
-- 4–7. Superuser: people-admin AND schedule-build in EVERY house (unlike RSM,
-- whose people-admin is own-house only).
-- ============================================================
SELECT is(public.user_has_house_admin_role('ad000000-0000-0000-0000-000000000001', 'quad'),     true, 'admin is people-admin of quad');
SELECT is(public.user_has_house_admin_role('ad000000-0000-0000-0000-000000000001', 'kings-court'), true, 'admin is people-admin of ANY house (cross-house superuser)');
SELECT is(public.user_can_build_schedule('ad000000-0000-0000-0000-000000000001', 'harnwell'),   true, 'admin can build any house schedule');
SELECT is(public.user_has_house_admin_role('ad000000-0000-0000-0000-000000000002', 'lower-quad'), false, 'a plain SW is not people-admin of their own house');

-- ============================================================
-- 8. Scope constraint — an admin role row must have NULL scope_house_id.
-- ============================================================
SELECT throws_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('ad000000-0000-0000-0000-000000000002', 'admin', 'lower-quad') $$,
  NULL, NULL,
  'an admin role row cannot carry a scope_house_id'
);

-- ============================================================
-- 9. Broadcast subscription is rejected for an admin (admin-only, like hm/bm).
-- ============================================================
SELECT throws_ok(
  $$ UPDATE public.users SET broadcast_subscribed = true
     WHERE user_id = 'ad000000-0000-0000-0000-000000000001' $$,
  NULL, NULL,
  'an admin cannot subscribe to broadcast notifications'
);

-- ============================================================
-- 10–11. Cross-house READ: an admin sees any house's assignments; a plain SW at
-- a different home house does not.
-- ============================================================
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES ('adb10000-0000-0000-0000-0000000000c1', 'quad', '2099-06-17 16:00:00+00', 1);
INSERT INTO public.shift_block_assignments (block_id, user_id, status, vacancy_origin)
VALUES ('adb10000-0000-0000-0000-0000000000c1', NULL, 'vacant', 'never_assigned');

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"ad000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('test.admin.admin_count', count(*)::text, false)
FROM public.shift_block_assignments WHERE block_id = 'adb10000-0000-0000-0000-0000000000c1';
SELECT set_config('request.jwt.claims', '{"sub":"ad000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('test.admin.sw_count', count(*)::text, false)
FROM public.shift_block_assignments WHERE block_id = 'adb10000-0000-0000-0000-0000000000c1';
RESET ROLE;

SELECT cmp_ok(current_setting('test.admin.admin_count')::int, '>=', 1, 'admin can READ any house''s assignments (cross-house view)');
SELECT is(current_setting('test.admin.sw_count')::int, 0, 'a plain SW cannot read another house''s assignments');

-- ============================================================
-- 12–13. system_config: the admin ROLE may read and write config keys.
-- ============================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"ad000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  $$ INSERT INTO public.system_config (config_key, config_value, value_type)
     VALUES ('test_admin_key', '7', 'integer') $$,
  'admin role can insert a system_config row'
);
SELECT set_config('test.admin.cfg_count', count(*)::text, false)
FROM public.system_config WHERE config_key = 'test_admin_key';
RESET ROLE;
SELECT is(current_setting('test.admin.cfg_count')::int, 1, 'admin role can read system_config it wrote');

SELECT * FROM finish();
ROLLBACK;
