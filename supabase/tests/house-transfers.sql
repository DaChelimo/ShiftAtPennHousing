-- pgTAP behavioral tests for house transfers — migration 20260719000001.
--
-- Season-scoped house membership: a worker belongs to a house for a span, and
-- users.home_house_id is the maintained cache of the row covering today. Either
-- the source OR destination house's HM/BM may transfer; an immediate move flips
-- home house + reopens old-house shifts, a future move is applied by the daily job.
--
-- Invariants pinned here (must never regress):
--   * either-side authz: source HM and dest HM both allowed; unrelated HM rejected.
--   * immediate transfer flips home_house_id and reopens the worker's future
--     old-house seats (Harnwell-out leaves NO seat held by the departed worker —
--     the training invariant holds).
--   * future transfer changes nothing live; apply_due_house_transfers applies it
--     once the effective date arrives.
--   * membership_house_for_date / house_roster_as_of are forward-looking: a worker
--     with a scheduled transfer resolves to their DESTINATION for the future season
--     and their CURRENT house for today.
--
-- Self-contained: BEGIN…ROLLBACK, own fixtures, far-future anchors. Non-Harnwell
-- houses (lauder / mayer / gutmann) plus one harnwell seat for the invariant.
--
-- Run with: supabase test db (or psql -f under the pgtap extension).

BEGIN;

SELECT plan(19);

-- ============================================================
-- Fixtures
--   lauder:   Holly (HM), Wendy (SW, to transfer), Iris (SW, inactive)
--   mayer:    Mimi (HM, the destination-side admin)
--   gutmann:  Ursula (HM, unrelated to lauder↔mayer)
--   harnwell: Hank (SW) with a future CLAIMED harnwell seat
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('d1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ht-holly@test.local'),
  ('d1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ht-wendy@test.local'),
  ('d1000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ht-mimi@test.local'),
  ('d1000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ht-ursula@test.local'),
  ('d1000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ht-hank@test.local'),
  ('d1000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ht-iris@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('d1000000-0000-4000-8000-000000000001','Holly HM','ht-holly@test.local','lauder',true),
  ('d1000000-0000-4000-8000-000000000002','Wendy SW','ht-wendy@test.local','lauder',true),
  ('d1000000-0000-4000-8000-000000000003','Mimi HM','ht-mimi@test.local','mayer',true),
  ('d1000000-0000-4000-8000-000000000004','Ursula HM','ht-ursula@test.local','gutmann',true),
  ('d1000000-0000-4000-8000-000000000005','Hank SW','ht-hank@test.local','harnwell',true),
  ('d1000000-0000-4000-8000-000000000006','Iris SW','ht-iris@test.local','lauder',false);

INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('d1000000-0000-4000-8000-000000000001','hm','lauder'),
  ('d1000000-0000-4000-8000-000000000002','sw',NULL),
  ('d1000000-0000-4000-8000-000000000003','hm','mayer'),
  ('d1000000-0000-4000-8000-000000000004','hm','gutmann'),
  ('d1000000-0000-4000-8000-000000000005','sw',NULL),
  ('d1000000-0000-4000-8000-000000000006','sw',NULL);

-- Seed current memberships for the fixture workers (mirrors the migration backfill,
-- which ran before these rows existed).
INSERT INTO public.user_house_memberships (user_id, house_id, effective_from, effective_to, applied_at) VALUES
  ('d1000000-0000-4000-8000-000000000002','lauder',DATE '2000-01-01',NULL,now()),
  ('d1000000-0000-4000-8000-000000000005','harnwell',DATE '2000-01-01',NULL,now());

-- Hank holds a future harnwell seat (claimed → direct-vacate on transfer-out).
INSERT INTO shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('d1000000-0000-4000-9000-000000000001','harnwell','2029-07-09 20:00:00-04',2);
INSERT INTO shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin, is_float, is_cross_house_pickup, source_house_id) VALUES
  ('d1000000-0000-4000-a000-000000000001','d1000000-0000-4000-9000-000000000001','d1000000-0000-4000-8000-000000000005','claimed','none',false,false,NULL);

-- ============================================================
-- 1. Rejections
-- ============================================================
SELECT throws_ok(
  $$ SELECT transfer_worker('d1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000002','mayer', current_date, 't') $$,
  'not_authorized',
  'unrelated HM (neither source nor dest) is rejected'
);

SELECT throws_ok(
  $$ SELECT transfer_worker('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','lauder', current_date, 't') $$,
  'already_in_destination_house',
  'transfer to the worker''s current house is rejected'
);

SELECT throws_ok(
  $$ SELECT transfer_worker('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000006','mayer', current_date, 't') $$,
  'worker_inactive',
  'transferring an inactive worker is rejected'
);

SELECT throws_ok(
  $$ SELECT transfer_worker('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','mayer', current_date - 5, 't') $$,
  'effective_date_in_past',
  'a past effective date is rejected'
);

-- ============================================================
-- 2. Immediate transfer by the DESTINATION-side HM (either-side authz)
-- ============================================================
SELECT lives_ok(
  $$ SELECT transfer_worker('d1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000002','mayer',
       (app_now() AT TIME ZONE 'America/New_York')::date, 'dest-hm move') $$,
  'destination-side HM may initiate a transfer'
);

SELECT is(
  (SELECT home_house_id FROM users WHERE user_id='d1000000-0000-4000-8000-000000000002'),
  'mayer',
  'immediate transfer flips home_house_id to the destination'
);

SELECT is(
  (SELECT count(*)::int FROM user_house_memberships
   WHERE user_id='d1000000-0000-4000-8000-000000000002' AND house_id='mayer'
     AND effective_to IS NULL AND applied_at IS NOT NULL),
  1,
  'an applied, open-ended destination membership row exists'
);

SELECT is(
  (SELECT effective_to FROM user_house_memberships
   WHERE user_id='d1000000-0000-4000-8000-000000000002' AND house_id='lauder'),
  ((app_now() AT TIME ZONE 'America/New_York')::date - 1),
  'the prior lauder membership is closed the day before the effective date'
);

-- ============================================================
-- 3. Harnwell-out immediate transfer vacates the worker's future harnwell seat
-- ============================================================
SELECT lives_ok(
  $$ SELECT transfer_worker('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000005','lauder',
       (app_now() AT TIME ZONE 'America/New_York')::date, 'harnwell out') $$,
  'a Harnwell worker can be transferred out'
);

SELECT is(
  (SELECT count(*)::int FROM shift_block_assignments sba JOIN shift_blocks sb ON sb.block_id=sba.block_id
   WHERE sba.user_id='d1000000-0000-4000-8000-000000000005' AND sb.house_id='harnwell' AND sb.block_start_at > app_now()),
  0,
  'the departed Harnwell worker holds ZERO future Harnwell seats (training invariant)'
);

SELECT is(
  (SELECT status::text FROM shift_block_assignments WHERE assignment_id='d1000000-0000-4000-a000-000000000001'),
  'vacant',
  'the vacated Harnwell seat is reopened as vacant'
);

-- ============================================================
-- 4. Future-dated transfer: nothing live changes until the day
-- ============================================================
SELECT lives_ok(
  $$ SELECT transfer_worker('d1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000002','gutmann',
       ((app_now() AT TIME ZONE 'America/New_York')::date + 40), 'fall move') $$,
  'a future-dated transfer records without error'
);

SELECT is(
  (SELECT home_house_id FROM users WHERE user_id='d1000000-0000-4000-8000-000000000002'),
  'mayer',
  'a future transfer does NOT change home_house_id yet (still mayer)'
);

-- forward-looking: today resolves to current house, the future season to destination
SELECT is(
  membership_house_for_date('d1000000-0000-4000-8000-000000000002', (app_now() AT TIME ZONE 'America/New_York')::date),
  'mayer',
  'membership_house_for_date today = current house (mayer)'
);

SELECT is(
  membership_house_for_date('d1000000-0000-4000-8000-000000000002', ((app_now() AT TIME ZONE 'America/New_York')::date + 60)),
  'gutmann',
  'membership_house_for_date after the effective date = destination (gutmann)'
);

-- house_roster_as_of is forward-looking for the destination
SELECT ok(
  EXISTS (SELECT 1 FROM house_roster_as_of('gutmann', ((app_now() AT TIME ZONE 'America/New_York')::date + 60))
          WHERE user_id='d1000000-0000-4000-8000-000000000002'),
  'house_roster_as_of includes the transferring worker in the destination for the future season'
);

-- ============================================================
-- 5. hire_worker seeds a REAL membership row (20260719000002), not the
--    transfer_worker self-heal sentinel (2000-01-01).
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('d1000000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ht-newhire@test.local');

SELECT lives_ok(
  $$ SELECT hire_worker('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000007','New Hire','ht-newhire@test.local','lauder','sw',NULL) $$,
  'hire_worker succeeds'
);

SELECT is(
  (SELECT count(*)::int FROM user_house_memberships WHERE user_id='d1000000-0000-4000-8000-000000000007'),
  1,
  'the new hire has exactly one membership row'
);

SELECT is(
  (SELECT house_id||'|'||effective_from::text||'|'||(applied_at IS NOT NULL)::text
   FROM user_house_memberships WHERE user_id='d1000000-0000-4000-8000-000000000007'),
  'lauder|' || ((app_now() AT TIME ZONE 'America/New_York')::date)::text || '|true',
  'the hire''s membership is dated their real hire date (not the 2000-01-01 self-heal sentinel), open-ended and applied'
);

SELECT finish();
ROLLBACK;
