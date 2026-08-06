-- pgTAP: admin_remove_worker (this_week) emits merged `shift_opened` notifications
-- (migration 20260806000003).
--
-- THE BUG THIS PINS. Before 20260806000003 the `this_week` branch vacated seats and
-- returned in silence: workers heard nothing until the escalation chain's T-3h
-- broadcast, and then only per 30-minute block. Seen live on 2026-08-06.
--
-- Four properties, in the order they matter:
--   1. Something is emitted at all.
--   2. It is emitted ONE PER CONTIGUOUS RUN, not one per block -- an operator may
--      click disjoint seats, so a single MIN..MAX span would announce staffed hours.
--   3. The operator and the removed worker are both excluded.
--   4. A coverage-locked block is never announced (its seats are not claimable).
--
-- House choice: `quad`. A harnwell house would restrict recipients to home-harnwell
-- workers (hard invariant #1) and mask the recipient assertions.
BEGIN;
SELECT plan(9);

-- ---- Actors: W (removed), OP (operator/sm), R (eligible recipient). ----
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email,
  'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', ''
FROM (VALUES
  ('ad000000-0000-4000-8000-000000000001','arn.w@example.test'),
  ('ad000000-0000-4000-8000-000000000002','arn.op@example.test'),
  ('ad000000-0000-4000-8000-000000000003','arn.r@example.test')
) AS v(id, email);

INSERT INTO users (user_id, name, email, home_house_id, is_active) VALUES
  ('ad000000-0000-4000-8000-000000000001','ARN W','arn.w@example.test','quad',true),
  ('ad000000-0000-4000-8000-000000000002','ARN OP','arn.op@example.test','quad',true),
  ('ad000000-0000-4000-8000-000000000003','ARN R','arn.r@example.test','quad',true);

INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('ad000000-0000-4000-8000-000000000001','sw',NULL),
  ('ad000000-0000-4000-8000-000000000002','sm','quad'),
  ('ad000000-0000-4000-8000-000000000003','sw',NULL);

-- ---- Blocks. Three contiguous (18:00, 18:30, 19:00), one disjoint (21:00), one
-- ---- coverage-locked (22:00). W is scheduled on every one of them.
INSERT INTO shift_blocks (block_id, house_id, block_start_at, required_headcount, coverage_locked_at) VALUES
  ('ad000000-0000-4000-9000-000000000001','quad','2026-09-01 18:00:00-04',1,NULL),
  ('ad000000-0000-4000-9000-000000000002','quad','2026-09-01 18:30:00-04',1,NULL),
  ('ad000000-0000-4000-9000-000000000003','quad','2026-09-01 19:00:00-04',1,NULL),
  ('ad000000-0000-4000-9000-000000000004','quad','2026-09-01 21:00:00-04',1,NULL),
  ('ad000000-0000-4000-9000-000000000005','quad','2026-09-01 22:00:00-04',1,'2026-08-30 12:00:00-04');

INSERT INTO shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin, is_float, is_cross_house_pickup, source_house_id)
SELECT
  ('ad000000-0000-4000-a000-00000000000' || v.n)::uuid,
  ('ad000000-0000-4000-9000-00000000000' || v.n)::uuid,
  'ad000000-0000-4000-8000-000000000001'::uuid,
  'scheduled','none',false,false,NULL
FROM (VALUES (1),(2),(3),(4),(5)) AS v(n);

-- ===== The removal =====
SELECT lives_ok(
  $$ SELECT admin_remove_worker(
       'ad000000-0000-4000-8000-000000000002'::uuid,
       ARRAY['ad000000-0000-4000-9000-000000000001',
             'ad000000-0000-4000-9000-000000000002',
             'ad000000-0000-4000-9000-000000000003',
             'ad000000-0000-4000-9000-000000000004',
             'ad000000-0000-4000-9000-000000000005']::uuid[],
       'ad000000-0000-4000-8000-000000000001'::uuid,
       'this_week',
       '2026-08-30 12:00:00-04'::timestamptz) $$,
  'admin_remove_worker(this_week) succeeds for an authorized operator');

SELECT is(
  (SELECT count(*)::int FROM shift_block_assignments
    WHERE assignment_id::text LIKE 'ad000000-0000-4000-a000-%' AND status = 'vacant'),
  5, 'all five seats were vacated');

-- ---- 1 + 2. One notification per contiguous run, so TWO, not five. ----
SELECT is(
  (SELECT count(*)::int FROM notifications
    WHERE recipient_user_id = 'ad000000-0000-4000-8000-000000000003'
      AND type = 'shift_opened'),
  2, 'recipient gets ONE notification per contiguous run (2), not one per block (5)');

SELECT ok(
  EXISTS(SELECT 1 FROM notifications
          WHERE recipient_user_id = 'ad000000-0000-4000-8000-000000000003'
            AND type = 'shift_opened'
            AND payload->>'body' LIKE '%18:00 to 19:30%'),
  'the three contiguous blocks are announced as one 18:00 to 19:30 span');

SELECT ok(
  EXISTS(SELECT 1 FROM notifications
          WHERE recipient_user_id = 'ad000000-0000-4000-8000-000000000003'
            AND type = 'shift_opened'
            AND payload->>'body' LIKE '%21:00 to 21:30%'),
  'the disjoint block is announced as its own 21:00 to 21:30 span');

-- ---- 4. The coverage-locked block is never announced. ----
SELECT ok(
  NOT EXISTS(SELECT 1 FROM notifications
              WHERE recipient_user_id = 'ad000000-0000-4000-8000-000000000003'
                AND type = 'shift_opened'
                AND payload->>'body' LIKE '%22:00%'),
  'a coverage-locked block is vacated but NOT announced (its seats are not claimable)');

-- ---- 3. Neither the operator nor the removed worker hears about it. ----
SELECT is(
  (SELECT count(*)::int FROM notifications
    WHERE recipient_user_id = 'ad000000-0000-4000-8000-000000000002'
      AND type = 'shift_opened'),
  0, 'the operator who performed the removal is not notified');

SELECT is(
  (SELECT count(*)::int FROM notifications
    WHERE recipient_user_id = 'ad000000-0000-4000-8000-000000000001'
      AND type = 'shift_opened'),
  0, 'the worker who was removed is not told their own shift "just opened up"');

-- ---- The payload carries the full span, not just the start. ----
SELECT is(
  (SELECT (payload->>'block_end_at')::timestamptz FROM notifications
    WHERE recipient_user_id = 'ad000000-0000-4000-8000-000000000003'
      AND type = 'shift_opened'
      AND (payload->>'block_start_at')::timestamptz = '2026-09-01 18:00:00-04'),
  '2026-09-01 19:30:00-04'::timestamptz,
  'payload block_end_at is the END of the run, so a client need not re-derive it');

SELECT finish();
ROLLBACK;
