-- pgTAP: worker_my_shifts / worker_open_shifts read-model views.
-- Self-contained: creates its own actors + fixtures inside BEGIN…ROLLBACK, so it is
-- robust to whatever else is (or isn't) seeded. Verifies the contract in
-- apps/mobile/docs/worker-read-model/TEST_PLAN.md.
-- NOTE: the views expose `id = assignment_id::text`, so fixtures use explicit
-- assignment_id values (the 'a000' namespace) and assertions key off those.
BEGIN;
SELECT plan(19);

-- ---- Actors (harnwell SW ×2, quad SW, quad BM) ----
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email,
  'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', ''
FROM (VALUES
  ('f0000000-0000-4000-8000-000000000001','rm.h1@example.test'),
  ('f0000000-0000-4000-8000-000000000002','rm.h2@example.test'),
  ('f0000000-0000-4000-8000-000000000003','rm.q1@example.test'),
  ('f0000000-0000-4000-8000-000000000004','rm.bm@example.test')
) AS v(id, email);

INSERT INTO users (user_id, name, email, home_house_id, is_active) VALUES
  ('f0000000-0000-4000-8000-000000000001','RM H1','rm.h1@example.test','harnwell',true),
  ('f0000000-0000-4000-8000-000000000002','RM H2','rm.h2@example.test','harnwell',true),
  ('f0000000-0000-4000-8000-000000000003','RM Q1','rm.q1@example.test','quad',true),
  ('f0000000-0000-4000-8000-000000000004','RM BM','rm.bm@example.test','quad',true);

INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('f0000000-0000-4000-8000-000000000001','sw',NULL),
  ('f0000000-0000-4000-8000-000000000002','sw',NULL),
  ('f0000000-0000-4000-8000-000000000003','sw',NULL),
  ('f0000000-0000-4000-8000-000000000004','bm','quad');

-- ---- Blocks (future, on 30-min boundaries) ----
INSERT INTO shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('f0000000-0000-4000-9000-000000000001','harnwell','2026-07-01 20:00:00-04',2),
  ('f0000000-0000-4000-9000-000000000002','harnwell','2026-07-01 20:30:00-04',2),
  ('f0000000-0000-4000-9000-000000000003','harnwell','2026-07-01 21:00:00-04',2),
  ('f0000000-0000-4000-9000-000000000004','harnwell','2026-07-01 21:30:00-04',2),
  ('f0000000-0000-4000-9000-000000000010','quad','2026-07-01 20:00:00-04',3),
  ('f0000000-0000-4000-9000-000000000011','quad','2026-07-01 20:30:00-04',3),
  -- A future block on a date OUTSIDE the regular_school_year calendar (beyond the
  -- seeded semester) — stands in for a break / off-calendar occurrence of a
  -- permanently-dropped slot. The permanent feed must NOT treat it as a permanent
  -- opening (it mirrors the permanent-pickup candidate filter), else it strands.
  ('f0000000-0000-4000-9000-000000000012','quad','2027-06-01 20:00:00-04',3);

-- ---- Assignments — EXPLICIT assignment_id (= the view's `id`). Constraint-valid:
-- non-vacant ⇒ vacancy_origin 'none' + user set; vacant ⇒ null user; is_float ⇒ source set. ----
INSERT INTO shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin, is_float, is_cross_house_pickup, source_house_id) VALUES
  ('f0000000-0000-4000-a000-000000000001','f0000000-0000-4000-9000-000000000001','f0000000-0000-4000-8000-000000000001','scheduled','none',false,false,NULL),
  ('f0000000-0000-4000-a000-000000000002','f0000000-0000-4000-9000-000000000002','f0000000-0000-4000-8000-000000000001','claimed','none',false,false,NULL),
  ('f0000000-0000-4000-a000-000000000003','f0000000-0000-4000-9000-000000000003','f0000000-0000-4000-8000-000000000001','pending_float_in','none',true,false,'harnwell'),
  ('f0000000-0000-4000-a000-000000000004','f0000000-0000-4000-9000-000000000004',NULL,'vacant','never_assigned',false,false,NULL),
  ('f0000000-0000-4000-a000-000000000010','f0000000-0000-4000-9000-000000000010',NULL,'vacant','never_assigned',false,false,NULL),
  ('f0000000-0000-4000-a000-000000000011','f0000000-0000-4000-9000-000000000011',NULL,'vacant','permanent_drop',false,false,NULL),
  ('f0000000-0000-4000-a000-000000000012','f0000000-0000-4000-9000-000000000012',NULL,'vacant','permanent_drop',false,false,NULL);

-- ===== worker_my_shifts =====
SELECT is((SELECT count(*)::int FROM worker_my_shifts WHERE user_id='f0000000-0000-4000-8000-000000000001' AND id LIKE 'f0000000-0000-4000-a000-%'),
          3, 'my_shifts: worker sees their 3 fixture rows (vacant excluded)');
SELECT is((SELECT kind FROM worker_my_shifts WHERE id='f0000000-0000-4000-a000-000000000001'), 'scheduled', 'my_shifts: scheduled→scheduled');
SELECT is((SELECT kind FROM worker_my_shifts WHERE id='f0000000-0000-4000-a000-000000000002'), 'temp_pickup', 'my_shifts: claimed→temp_pickup');
SELECT is((SELECT kind FROM worker_my_shifts WHERE id='f0000000-0000-4000-a000-000000000003'), 'float_out', 'my_shifts: pending_float_in→float_out');
SELECT ok((SELECT pending FROM worker_my_shifts WHERE id='f0000000-0000-4000-a000-000000000003'), 'my_shifts: pending_float_in→pending=true');
SELECT ok((SELECT bool_and(dropped_still_open = false AND cross_house IS NOT NULL AND pending IS NOT NULL AND break_shift IS NOT NULL)
           FROM worker_my_shifts WHERE id LIKE 'f0000000-0000-4000-a000-%'),
          'my_shifts: booleans non-null; dropped_still_open=false');
SELECT is((SELECT end_at - start_at FROM worker_my_shifts WHERE id='f0000000-0000-4000-a000-000000000001'),
          interval '30 minutes', 'my_shifts: end_at = start_at + 30m');
SELECT is((SELECT count(*)::int FROM worker_my_shifts WHERE id IN ('f0000000-0000-4000-a000-000000000004','f0000000-0000-4000-a000-000000000010')),
          0, 'my_shifts: vacant blocks excluded');

-- ===== worker_open_shifts =====
SELECT ok(EXISTS(SELECT 1 FROM worker_open_shifts WHERE id='f0000000-0000-4000-a000-000000000004' AND eligible_user_id='f0000000-0000-4000-8000-000000000001'),
          'open: harnwell vacant → harnwell worker eligible');
SELECT ok(NOT EXISTS(SELECT 1 FROM worker_open_shifts WHERE id='f0000000-0000-4000-a000-000000000004' AND eligible_user_id='f0000000-0000-4000-8000-000000000003'),
          'open: harnwell vacant → quad worker NOT eligible (Harnwell training invariant)');
SELECT ok(EXISTS(SELECT 1 FROM worker_open_shifts WHERE id='f0000000-0000-4000-a000-000000000010' AND eligible_user_id='f0000000-0000-4000-8000-000000000003')
       AND EXISTS(SELECT 1 FROM worker_open_shifts WHERE id='f0000000-0000-4000-a000-000000000010' AND eligible_user_id='f0000000-0000-4000-8000-000000000001'),
          'open: quad vacant → both quad and harnwell workers eligible');
SELECT ok(NOT EXISTS(SELECT 1 FROM worker_open_shifts WHERE eligible_user_id='f0000000-0000-4000-8000-000000000004'),
          'open: BM role excluded from eligibility');
SELECT is((SELECT DISTINCT feed FROM worker_open_shifts WHERE id='f0000000-0000-4000-a000-000000000011'),
          'permanent_opening', 'open: vacancy_origin permanent_drop → feed permanent_opening');
SELECT ok((SELECT weeks_remaining IS NOT NULL FROM worker_open_shifts WHERE id='f0000000-0000-4000-a000-000000000011' LIMIT 1),
          'open: permanent_opening has non-null weeks_remaining');
SELECT ok((SELECT bool_and(weeks_remaining IS NULL) FROM worker_open_shifts WHERE id IN ('f0000000-0000-4000-a000-000000000004','f0000000-0000-4000-a000-000000000010')),
          'open: weekly rows have null weeks_remaining');
SELECT ok((SELECT home_house FROM worker_open_shifts WHERE id='f0000000-0000-4000-a000-000000000010' AND eligible_user_id='f0000000-0000-4000-8000-000000000003'),
          'open: quad block → home_house=true for quad worker');
SELECT ok((SELECT home_house = false FROM worker_open_shifts WHERE id='f0000000-0000-4000-a000-000000000010' AND eligible_user_id='f0000000-0000-4000-8000-000000000001'),
          'open: quad block → home_house=false for harnwell worker (cross-house)');

-- Permanent_drop block OFF the regular_school_year calendar (break / off-calendar):
-- must NOT be a permanent_opening (mirrors the permanent-pickup candidate filter), so
-- it cannot strand in the permanent feed as an un-pickable phantom.
SELECT isnt((SELECT DISTINCT feed FROM worker_open_shifts WHERE id='f0000000-0000-4000-a000-000000000012'),
          'permanent_opening', 'open: permanent_drop off the regular calendar is NOT a permanent_opening');
SELECT ok((SELECT bool_and(weeks_remaining IS NULL) FROM worker_open_shifts WHERE id='f0000000-0000-4000-a000-000000000012'),
          'open: off-calendar permanent_drop has null weeks_remaining (not counted)');

SELECT finish();
ROLLBACK;
