-- pgTAP tests for the operating-seasons authoring schema (P2; migration
-- 20260702000003). Overlap guards and admin-only RLS.
-- Self-contained: BEGIN…ROLLBACK.

BEGIN;

SELECT plan(6);

-- Fixture: an admin (Ada) and a plain SW (Stan).
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('ae000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seas-ada@test.local'),
  ('ae000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seas-stan@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('ae000000-0000-0000-0000-000000000001', 'Ada Admin', 'seas-ada@test.local',  'quad',     true),
  ('ae000000-0000-0000-0000-000000000002', 'Stan SW',   'seas-stan@test.local', 'lower-quad', true);
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('ae000000-0000-0000-0000-000000000001', 'admin', NULL),
  ('ae000000-0000-0000-0000-000000000002', 'sw',    NULL);

INSERT INTO public.operating_seasons (season_id, season_name, slug, start_date, end_date, hours_cap, cap_enforcement)
VALUES ('ae100000-0000-0000-0000-000000000001', 'Summer 2026', 'schema_test_season', '2099-06-01', '2099-08-15', 40, 'hard');

-- 1. Overlapping season rejected.
SELECT throws_ok(
  $$ INSERT INTO public.operating_seasons (season_name, slug, start_date, end_date, hours_cap, cap_enforcement)
     VALUES ('Overlap', 'overlap1', '2099-08-01', '2099-09-01', 40, 'hard') $$,
  '23P01', NULL, 'a season overlapping another season is rejected'
);

-- 2. Overlapping open windows for the SAME house rejected.
INSERT INTO public.season_house_windows (season_id, house_id, start_date, end_date, headcount)
VALUES ('ae100000-0000-0000-0000-000000000001', 'quad', '2099-06-01', '2099-06-30', 3);
SELECT throws_ok(
  $$ INSERT INTO public.season_house_windows (season_id, house_id, start_date, end_date, headcount)
     VALUES ('ae100000-0000-0000-0000-000000000001', 'quad', '2099-06-15', '2099-07-15', 2) $$,
  '23P01', NULL, 'overlapping open windows for one house are rejected'
);

-- 3. Non-overlapping window for a DIFFERENT house is fine.
SELECT lives_ok(
  $$ INSERT INTO public.season_house_windows (season_id, house_id, start_date, end_date, headcount)
     VALUES ('ae100000-0000-0000-0000-000000000001', 'harrison', '2099-06-15', '2099-07-15', 1) $$,
  'a window for a different house does not conflict'
);

-- 4. Overlapping float windows rejected.
INSERT INTO public.season_float_windows (season_id, start_date, end_date)
VALUES ('ae100000-0000-0000-0000-000000000001', '2099-07-01', '2099-08-15');
SELECT throws_ok(
  $$ INSERT INTO public.season_float_windows (season_id, start_date, end_date)
     VALUES ('ae100000-0000-0000-0000-000000000001', '2099-07-10', '2099-07-20') $$,
  '23P01', NULL, 'overlapping float windows are rejected'
);

-- Float routing is NOT authored (universal float, derived by the compiler), so there
-- is no season_float_routes table to guard. The Harnwell-destination rule is enforced
-- at runtime by the float_routing legality trigger (see operating-seasons-guardrails).

-- 5–6. RLS: admin can read seasons; a plain SW cannot.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('test.seas.admin_count', count(*)::text, false) FROM public.operating_seasons;
SELECT set_config('request.jwt.claims', '{"sub":"ae000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('test.seas.sw_count', count(*)::text, false) FROM public.operating_seasons;
RESET ROLE;

SELECT cmp_ok(current_setting('test.seas.admin_count')::int, '>=', 1, 'admin can read operating_seasons');
SELECT is(current_setting('test.seas.sw_count')::int, 0, 'a plain SW cannot read operating_seasons');

SELECT * FROM finish();
ROLLBACK;
