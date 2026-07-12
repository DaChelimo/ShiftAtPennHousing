-- pgTAP behavioral tests for cross-house SCHEDULE editing by the elevated admin
-- tier (HM / BM / RSM) — migration 20260627000002.
--
-- The 2026-06-27 stakeholder decision: hm/bm/rsm may modify ANY house's SCHEDULE,
-- not only their own. SM stays own-house. PEOPLE admin (hire/fire/roles), leave,
-- and cap remain own-house (user_has_house_admin_role is unchanged).
--
-- Invariants pinned here (must never regress):
--   * user_is_schedule_admin true for hm/bm/rsm, false for sm/sw.
--   * user_can_build_schedule is CROSS-HOUSE for hm/bm/rsm, OWN-HOUSE for sm.
--   * user_has_house_admin_role stays OWN-HOUSE for the elevated tier (people admin).
--   * draft_block_assignments admin RLS lets an HM write ANOTHER house's drafts,
--     but an SM of another house cannot.
--   * publish_schedule accepts an HM publishing a house they are NOT scoped to.
--
-- Self-contained: BEGIN…ROLLBACK, own fixtures, far-future anchors. Non-Harnwell
-- houses (lauder / mayer) so the Harnwell training constraint is not in play.
--
-- Run with: psql … -f supabase/tests/cross-house-schedule-admin.sql

BEGIN;

SELECT plan(13);

-- ============================================================
-- Fixture: lauder holds an HM (Holly), a BM (Bea), an SM (Sam), a SW (Stu).
-- mayer holds a worker (Will) to be drafted into a mayer block.
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('c8000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'xh-holly@test.local'),
  ('c8000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'xh-bea@test.local'),
  ('c8000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'xh-sam@test.local'),
  ('c8000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'xh-stu@test.local'),
  ('c8000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'xh-will@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('c8000000-0000-0000-0000-000000000001', 'Holly HM', 'xh-holly@test.local', 'lauder', true),
  ('c8000000-0000-0000-0000-000000000002', 'Bea BM',   'xh-bea@test.local',   'lauder', true),
  ('c8000000-0000-0000-0000-000000000003', 'Sam SM',   'xh-sam@test.local',   'lauder', true),
  ('c8000000-0000-0000-0000-000000000004', 'Stu SW',   'xh-stu@test.local',   'lauder', true),
  ('c8000000-0000-0000-0000-000000000005', 'Will SW',  'xh-will@test.local',  'mayer', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('c8000000-0000-0000-0000-000000000001', 'hm', 'lauder'),
  ('c8000000-0000-0000-0000-000000000002', 'bm', 'lauder'),
  ('c8000000-0000-0000-0000-000000000003', 'sm', 'lauder'),
  ('c8000000-0000-0000-0000-000000000004', 'sw', NULL),
  ('c8000000-0000-0000-0000-000000000005', 'sw', NULL);

-- ============================================================
-- 1–4. user_is_schedule_admin — the elevated tier (hm/bm/rsm), never sm/sw.
-- ============================================================
SELECT is(public.user_is_schedule_admin('c8000000-0000-0000-0000-000000000001'), true,  'user_is_schedule_admin true for an HM');
SELECT is(public.user_is_schedule_admin('c8000000-0000-0000-0000-000000000002'), true,  'user_is_schedule_admin true for a BM');
SELECT is(public.user_is_schedule_admin('c8000000-0000-0000-0000-000000000003'), false, 'user_is_schedule_admin false for an SM');
SELECT is(public.user_is_schedule_admin('c8000000-0000-0000-0000-000000000004'), false, 'user_is_schedule_admin false for a plain SW');

-- ============================================================
-- 5–8. user_can_build_schedule — cross-house for hm/bm, own-house for sm.
-- ============================================================
SELECT is(public.user_can_build_schedule('c8000000-0000-0000-0000-000000000001', 'mayer'), true,  'HM can build ANOTHER house schedule (cross-house)');
SELECT is(public.user_can_build_schedule('c8000000-0000-0000-0000-000000000002', 'mayer'), true,  'BM can build ANOTHER house schedule (cross-house)');
SELECT is(public.user_can_build_schedule('c8000000-0000-0000-0000-000000000003', 'mayer'), false, 'SM CANNOT build another house schedule (own-house only)');
SELECT is(public.user_can_build_schedule('c8000000-0000-0000-0000-000000000003', 'lauder'), true,  'SM can build OWN house schedule');

-- ============================================================
-- 9–10. user_has_house_admin_role — people admin stays OWN-HOUSE (unchanged).
-- ============================================================
SELECT is(public.user_has_house_admin_role('c8000000-0000-0000-0000-000000000001', 'mayer'), false, 'HM is NOT people-admin of another house (people admin stays own-house)');
SELECT is(public.user_has_house_admin_role('c8000000-0000-0000-0000-000000000001', 'lauder'), true,  'HM is people-admin of own house');

-- ============================================================
-- Fixtures for the RLS + publish paths: a period + a mayer block + its
-- generator-created vacant seat.
-- ============================================================
INSERT INTO public.scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date, preference_deadline, published_at)
VALUES
  ('c9000000-0000-0000-0000-0000000000a0', 'XH Period', 'regular_school_year',
   '2099-09-08', '2099-09-09', (now() - interval '1 day'), NULL);

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('d9000000-0000-0000-0000-0000000000b1', 'mayer', '2099-09-08 10:00:00 America/New_York'::timestamptz, 1);

INSERT INTO public.shift_block_assignments (block_id, status, vacancy_origin)
VALUES
  ('d9000000-0000-0000-0000-0000000000b1', 'vacant', 'never_assigned');

-- ============================================================
-- 11. draft RLS — an HM of lauder may INSERT a draft for a mayer block
-- (cross-house schedule write), acting as the authenticated user.
-- ============================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"c8000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  $$ INSERT INTO public.draft_block_assignments (period_id, block_id, user_id, created_by)
     VALUES ('c9000000-0000-0000-0000-0000000000a0',
             'd9000000-0000-0000-0000-0000000000b1',
             'c8000000-0000-0000-0000-000000000005',
             'c8000000-0000-0000-0000-000000000001') $$,
  'HM of lauder can draft into a mayer block (cross-house draft RLS)'
);

-- ============================================================
-- 12. draft RLS — an SM of lauder may NOT insert a draft for a mayer block
-- (own-house only). RLS rejects with 42501.
-- ============================================================
SELECT set_config('request.jwt.claims', '{"sub":"c8000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT throws_ok(
  $$ INSERT INTO public.draft_block_assignments (period_id, block_id, user_id, created_by)
     VALUES ('c9000000-0000-0000-0000-0000000000a0',
             'd9000000-0000-0000-0000-0000000000b1',
             'c8000000-0000-0000-0000-000000000005',
             'c8000000-0000-0000-0000-000000000003') $$,
  '42501', NULL,
  'SM of lauder CANNOT draft into a mayer block (RLS denies cross-house)'
);
RESET ROLE;

-- ============================================================
-- 13. publish_schedule — an HM scoped to lauder may publish mayer (the gate
-- user_can_build_schedule is now cross-house). The HM's draft from test 11 is
-- converted onto the vacant seat. No insufficient_privilege is raised.
-- ============================================================
SELECT lives_ok(
  $$ SELECT public.publish_schedule(
       'c9000000-0000-0000-0000-0000000000a0',
       'c8000000-0000-0000-0000-000000000001',
       'mayer') $$,
  'HM scoped to lauder can publish mayer (cross-house publish)'
);

SELECT * FROM finish();
ROLLBACK;
