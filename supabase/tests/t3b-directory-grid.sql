-- pgTAP: T3b-1 — worker_directory (full-directory contact, per the 2026-06-12
-- ruling) + houses.desk_phone + house_schedule_grid (§11.4).
-- Self-contained: creates its own actors + fixtures inside BEGIN…ROLLBACK.
-- RLS probes run as `authenticated` with request.jwt.claims set (the
-- break-periods-worker-read pattern), capturing results via set_config.
BEGIN;
SELECT plan(15);

-- ---- Schema surface ----
SELECT has_column('public', 'houses', 'desk_phone', 'houses.desk_phone exists (§11.4 desk call)');
SELECT has_view('public', 'worker_directory', 'worker_directory view exists');
SELECT has_view('public', 'house_schedule_grid', 'house_schedule_grid view exists');
SELECT hasnt_column('public', 'worker_directory', 'email',
  'directory does NOT expose email (only user_id/name/phone/home_house_id/is_active)');
SELECT hasnt_column('public', 'worker_directory', 'broadcast_subscribed',
  'directory does NOT expose notification settings');

-- ---- Actors (harnwell SW ×2, quad SW, an INACTIVE worker) ----
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email,
  'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', ''
FROM (VALUES
  ('d3b00000-0000-4000-8000-000000000001','t3b.h1@example.test'),
  ('d3b00000-0000-4000-8000-000000000002','t3b.h2@example.test'),
  ('d3b00000-0000-4000-8000-000000000003','t3b.q1@example.test'),
  ('d3b00000-0000-4000-8000-000000000004','t3b.gone@example.test')
) AS v(id, email);

INSERT INTO users (user_id, name, email, phone, home_house_id, is_active) VALUES
  ('d3b00000-0000-4000-8000-000000000001','T3B H1','t3b.h1@example.test','+12150000001','harnwell',true),
  ('d3b00000-0000-4000-8000-000000000002','T3B H2','t3b.h2@example.test','+12150000002','harnwell',true),
  ('d3b00000-0000-4000-8000-000000000003','T3B Q1','t3b.q1@example.test','+12150000003','quad',true),
  ('d3b00000-0000-4000-8000-000000000004','T3B GONE','t3b.gone@example.test','+12150000004','harnwell',false);

INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('d3b00000-0000-4000-8000-000000000001','sw',NULL),
  ('d3b00000-0000-4000-8000-000000000002','sw',NULL),
  ('d3b00000-0000-4000-8000-000000000003','sw',NULL);

UPDATE houses SET desk_phone = '+12155551234' WHERE id = 'harnwell';

-- ---- Blocks + assignments: H2 staffs a harnwell block; one harnwell vacant
--      gap; Q1 staffs a quad block (must be INVISIBLE to a harnwell worker). ----
INSERT INTO shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('d3b00000-0000-4000-9000-000000000001','harnwell','2026-07-01 20:00:00-04',2),
  ('d3b00000-0000-4000-9000-000000000002','harnwell','2026-07-01 20:30:00-04',2),
  ('d3b00000-0000-4000-9000-000000000003','quad','2026-07-01 20:00:00-04',1);

INSERT INTO shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin) VALUES
  ('d3b00000-0000-4000-a000-000000000001','d3b00000-0000-4000-9000-000000000001',
   'd3b00000-0000-4000-8000-000000000002','scheduled','none'),
  ('d3b00000-0000-4000-a000-000000000002','d3b00000-0000-4000-9000-000000000002',
   NULL,'vacant','never_assigned'),
  ('d3b00000-0000-4000-a000-000000000003','d3b00000-0000-4000-9000-000000000003',
   'd3b00000-0000-4000-8000-000000000003','scheduled','none');

-- ===== Probe as H1 (a plain harnwell SW) =====
DO $$
DECLARE
  v_dir_name text; v_dir_phone text; v_dir_inactive int; v_dir_cross_name text;
  v_grid_worker text; v_grid_phone text; v_grid_desk text;
  v_grid_vacant int; v_grid_other_house int; v_upd_denied boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"d3b00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;

  -- Full directory: ANOTHER worker's (cross-house, even) name + phone.
  SELECT name, phone INTO v_dir_name, v_dir_phone
    FROM public.worker_directory WHERE user_id = 'd3b00000-0000-4000-8000-000000000002';
  SELECT name INTO v_dir_cross_name
    FROM public.worker_directory WHERE user_id = 'd3b00000-0000-4000-8000-000000000003';
  SELECT count(*)::int INTO v_dir_inactive
    FROM public.worker_directory WHERE user_id = 'd3b00000-0000-4000-8000-000000000004';

  -- A write THROUGH the (auto-updatable, owner-rights) view must be denied.
  BEGIN
    UPDATE public.worker_directory SET phone = '+19999999999'
      WHERE user_id = 'd3b00000-0000-4000-8000-000000000002';
  EXCEPTION WHEN insufficient_privilege THEN
    v_upd_denied := true;
  END;

  -- Grid: the home house's staffed block carries the housemate's name/phone +
  -- the desk phone; the vacant gap shows; the OTHER house's rows are invisible.
  SELECT worker_name, worker_phone, desk_phone
    INTO v_grid_worker, v_grid_phone, v_grid_desk
    FROM public.house_schedule_grid WHERE id = 'd3b00000-0000-4000-a000-000000000001';
  SELECT count(*)::int INTO v_grid_vacant
    FROM public.house_schedule_grid
    WHERE id = 'd3b00000-0000-4000-a000-000000000002' AND worker_name IS NULL;
  SELECT count(*)::int INTO v_grid_other_house
    FROM public.house_schedule_grid WHERE house_id = 'quad'
      AND id = 'd3b00000-0000-4000-a000-000000000003';

  RESET ROLE;
  PERFORM set_config('t3b.dir_name', COALESCE(v_dir_name,'<null>'), true);
  PERFORM set_config('t3b.dir_phone', COALESCE(v_dir_phone,'<null>'), true);
  PERFORM set_config('t3b.dir_cross', COALESCE(v_dir_cross_name,'<null>'), true);
  PERFORM set_config('t3b.dir_inactive', v_dir_inactive::text, true);
  PERFORM set_config('t3b.upd_denied', v_upd_denied::text, true);
  PERFORM set_config('t3b.grid_worker', COALESCE(v_grid_worker,'<null>'), true);
  PERFORM set_config('t3b.grid_phone', COALESCE(v_grid_phone,'<null>'), true);
  PERFORM set_config('t3b.grid_desk', COALESCE(v_grid_desk,'<null>'), true);
  PERFORM set_config('t3b.grid_vacant', v_grid_vacant::text, true);
  PERFORM set_config('t3b.grid_other', v_grid_other_house::text, true);
END $$;

SELECT is(current_setting('t3b.dir_name'), 'T3B H2',
  'directory: a plain worker reads ANOTHER worker''s name (full directory ruling)');
SELECT is(current_setting('t3b.dir_phone'), '+12150000002',
  'directory: ...and their phone');
SELECT is(current_setting('t3b.dir_cross'), 'T3B Q1',
  'directory: cross-house contact readable too (full directory, not house-scoped)');
SELECT is(current_setting('t3b.dir_inactive')::int, 0,
  'directory: inactive workers are excluded');
SELECT is(current_setting('t3b.upd_denied')::boolean, true,
  'directory: UPDATE through the view is denied (SELECT-only grant)');
SELECT is(current_setting('t3b.grid_worker'), 'T3B H2',
  'grid: home-house block carries the staffing worker''s name');
SELECT is(current_setting('t3b.grid_phone'), '+12150000002',
  'grid: ...and their phone (§11.4 contact lookup)');
SELECT is(current_setting('t3b.grid_desk'), '+12155551234',
  'grid: the house desk_phone rides along');
SELECT is(current_setting('t3b.grid_vacant')::int, 1,
  'grid: vacant gaps are included (worker_name null)');
SELECT is(current_setting('t3b.grid_other')::int, 0,
  'grid: another house''s rows are INVISIBLE to a plain worker (RLS scope)');

SELECT finish();
ROLLBACK;
