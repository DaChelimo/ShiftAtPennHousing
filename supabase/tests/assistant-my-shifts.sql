-- pgTAP: assistant_my_shifts personal-schedule resolver (Desk Assistant v1 tool).
-- Self-contained: creates its own actors + fixtures inside BEGIN…ROLLBACK.
-- Asserts: own-user scoping (confused-deputy safe), 30-min block coalescing into
-- contiguous spans with hours, gap-splitting, and NY-local date-range filtering.
BEGIN;
SELECT plan(8);

-- ---- Actors: two harnwell SWs (one is the "other" user for the scoping check) ----
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email,
  'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', ''
FROM (VALUES
  ('e0000000-0000-4000-8000-000000000001','ams.me@example.test'),
  ('e0000000-0000-4000-8000-000000000002','ams.other@example.test')
) AS v(id, email);

INSERT INTO users (user_id, name, email, home_house_id, is_active) VALUES
  ('e0000000-0000-4000-8000-000000000001','AMS Me','ams.me@example.test','harnwell',true),
  ('e0000000-0000-4000-8000-000000000002','AMS Other','ams.other@example.test','harnwell',true);

INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('e0000000-0000-4000-8000-000000000001','sw',NULL),
  ('e0000000-0000-4000-8000-000000000002','sw',NULL);

-- ---- Blocks: a contiguous 3-block run (20:00,20:30,21:00) + a gapped 4th (22:00) ----
INSERT INTO shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('e0000000-0000-4000-9000-000000000001','harnwell','2029-07-09 20:00:00-04',2),
  ('e0000000-0000-4000-9000-000000000002','harnwell','2029-07-09 20:30:00-04',2),
  ('e0000000-0000-4000-9000-000000000003','harnwell','2029-07-09 21:00:00-04',2),
  ('e0000000-0000-4000-9000-000000000004','harnwell','2029-07-09 22:00:00-04',2),
  -- Out of the queried date range (next day).
  ('e0000000-0000-4000-9000-000000000005','harnwell','2029-07-10 20:00:00-04',2);

INSERT INTO shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin, is_float, is_cross_house_pickup, source_house_id) VALUES
  -- Me: contiguous scheduled run (3 blocks → one 1.5h span).
  ('e0000000-0000-4000-a000-000000000001','e0000000-0000-4000-9000-000000000001','e0000000-0000-4000-8000-000000000001','scheduled','none',false,false,NULL),
  ('e0000000-0000-4000-a000-000000000002','e0000000-0000-4000-9000-000000000002','e0000000-0000-4000-8000-000000000001','scheduled','none',false,false,NULL),
  ('e0000000-0000-4000-a000-000000000003','e0000000-0000-4000-9000-000000000003','e0000000-0000-4000-8000-000000000001','scheduled','none',false,false,NULL),
  -- Me: gapped single block (22:00) → a second span (0.5h).
  ('e0000000-0000-4000-a000-000000000004','e0000000-0000-4000-9000-000000000004','e0000000-0000-4000-8000-000000000001','scheduled','none',false,false,NULL),
  -- Me: next-day block (outside range).
  ('e0000000-0000-4000-a000-000000000005','e0000000-0000-4000-9000-000000000005','e0000000-0000-4000-8000-000000000001','scheduled','none',false,false,NULL),
  -- Other user co-staffed on MY first block (Harnwell 2-staff): same block_id, second
  -- assignment. The user_id filter must show each worker only their own row.
  ('e0000000-0000-4000-a000-000000000006','e0000000-0000-4000-9000-000000000001','e0000000-0000-4000-8000-000000000002','scheduled','none',false,false,NULL);

-- ===== Scoping: only my rows, never the other user's =====
SELECT is(
  (SELECT count(*)::int FROM assistant_my_shifts('e0000000-0000-4000-8000-000000000001','2029-07-09','2029-07-09')),
  2, 'two spans on 2029-07-09 (contiguous run + gapped single)');

SELECT is(
  (SELECT count(*)::int FROM assistant_my_shifts('e0000000-0000-4000-8000-000000000002','2029-07-09','2029-07-09')),
  1, 'other user sees only their own single span (no cross-user leak)');

-- ===== Coalescing: the 3-block run becomes ONE 1.5h span =====
SELECT is(
  (SELECT hours FROM assistant_my_shifts('e0000000-0000-4000-8000-000000000001','2029-07-09','2029-07-09') ORDER BY start_at LIMIT 1),
  1.5::numeric, 'contiguous 3-block run coalesces to 1.5 hours');

SELECT is(
  (SELECT block_count FROM assistant_my_shifts('e0000000-0000-4000-8000-000000000001','2029-07-09','2029-07-09') ORDER BY start_at LIMIT 1),
  3, 'first span spans 3 blocks');

SELECT is(
  (SELECT end_at FROM assistant_my_shifts('e0000000-0000-4000-8000-000000000001','2029-07-09','2029-07-09') ORDER BY start_at LIMIT 1),
  '2029-07-09 21:30:00-04'::timestamptz, 'first span end_at = last block end (21:30)');

-- ===== Gap split: the 22:00 block is its own 0.5h span =====
SELECT is(
  (SELECT hours FROM assistant_my_shifts('e0000000-0000-4000-8000-000000000001','2029-07-09','2029-07-09') ORDER BY start_at OFFSET 1 LIMIT 1),
  0.5::numeric, 'gapped 22:00 block is a separate 0.5h span');

-- ===== Date-range filter (NY-local) excludes the next-day block =====
SELECT is(
  (SELECT count(*)::int FROM assistant_my_shifts('e0000000-0000-4000-8000-000000000001','2029-07-10','2029-07-10')),
  1, 'querying 2029-07-10 returns only that day''s span');

SELECT is(
  (SELECT count(*)::int FROM assistant_my_shifts('e0000000-0000-4000-8000-000000000001','2029-07-09','2029-07-10')),
  3, 'two-day range returns all three spans');

SELECT finish();
ROLLBACK;
