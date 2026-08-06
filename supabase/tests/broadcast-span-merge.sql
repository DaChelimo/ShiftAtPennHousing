-- pgTAP: process_broadcast_step merges contiguous runs and refuses locked seats
-- (migration 20260806000004).
--
-- THE BUGS THIS PINS, both seen live on 2026-08-06:
--   1. The step emitted one notification PER 30-MINUTE BLOCK. A one-hour vacancy
--      pushed twice; a four-hour vacancy would push eight times.
--   2. It announced "Open the app to claim it" for blocks it had already
--      coverage-locked, which `is_assignment_claimable` refuses.
--
-- The merge test deliberately fires the blocks OUT OF ORDER (19:00, then 18:00,
-- then 18:30). The run-start test is a property of the run's shape, not of visit
-- order, and this is the assertion that proves it.
--
-- House choice: `quad` (a harnwell house would restrict recipients to home-harnwell
-- workers under hard invariant #1 and mask the recipient counts).
BEGIN;
SELECT plan(11);

-- ---- Actors: R (eligible recipient), C (a worker who COVERS one block). ----
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email,
  'x', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', ''
FROM (VALUES
  ('bc000000-0000-4000-8000-000000000001','bsm.r@example.test'),
  ('bc000000-0000-4000-8000-000000000002','bsm.c@example.test')
) AS v(id, email);

INSERT INTO users (user_id, name, email, home_house_id, is_active) VALUES
  ('bc000000-0000-4000-8000-000000000001','BSM R','bsm.r@example.test','quad',true),
  ('bc000000-0000-4000-8000-000000000002','BSM C','bsm.c@example.test','quad',true);

INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('bc000000-0000-4000-8000-000000000001','sw',NULL),
  ('bc000000-0000-4000-8000-000000000002','sw',NULL);

-- ---- Blocks (all quad, 2026-09-02):
--        18:00 / 18:30 / 19:00  vacant  -> run A
--        19:30                  COVERED -> breaks the run
--        20:00                  vacant  -> run B
--        21:00                  vacant + coverage-locked
--        22:00 / 22:30          vacant  -> the incremental-announcement case
INSERT INTO shift_blocks (block_id, house_id, block_start_at, required_headcount, coverage_locked_at) VALUES
  ('bc000000-0000-4000-9000-000000000001','quad','2026-09-02 18:00:00-04',1,NULL),
  ('bc000000-0000-4000-9000-000000000002','quad','2026-09-02 18:30:00-04',1,NULL),
  ('bc000000-0000-4000-9000-000000000003','quad','2026-09-02 19:00:00-04',1,NULL),
  ('bc000000-0000-4000-9000-000000000004','quad','2026-09-02 19:30:00-04',1,NULL),
  ('bc000000-0000-4000-9000-000000000005','quad','2026-09-02 20:00:00-04',1,NULL),
  ('bc000000-0000-4000-9000-000000000006','quad','2026-09-02 21:00:00-04',1,'2026-09-02 17:00:00-04'),
  ('bc000000-0000-4000-9000-000000000007','quad','2026-09-02 22:00:00-04',1,NULL),
  ('bc000000-0000-4000-9000-000000000008','quad','2026-09-02 22:30:00-04',1,NULL);

INSERT INTO shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin, is_float, is_cross_house_pickup, source_house_id)
SELECT
  ('bc000000-0000-4000-a000-00000000000' || v.n)::uuid,
  ('bc000000-0000-4000-9000-00000000000' || v.n)::uuid,
  NULL, 'vacant','temporary_drop',false,false,NULL
FROM (VALUES (1),(2),(3),(5),(6),(7),(8)) AS v(n);

-- 19:30 is STAFFED, which is what splits run A from run B.
INSERT INTO shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin, is_float, is_cross_house_pickup, source_house_id) VALUES
  ('bc000000-0000-4000-a000-000000000004','bc000000-0000-4000-9000-000000000004',
   'bc000000-0000-4000-8000-000000000002','scheduled','none',false,false,NULL);

-- ===== One tick, blocks visited OUT OF ORDER. =====
-- Every call shares one p_now, exactly as orchestrator-tick passes a single
-- `firedAt` for the whole tick.
SELECT ok(
  (process_broadcast_step('bc000000-0000-4000-9000-000000000003'::uuid,'quad',
     '2026-09-02 19:00:00-04'::timestamptz,'2026-09-02 16:00:00-04'::timestamptz)->>'claimed')::boolean,
  'the 19:00 block claims its own chain step');

SELECT ok(
  (process_broadcast_step('bc000000-0000-4000-9000-000000000001'::uuid,'quad',
     '2026-09-02 18:00:00-04'::timestamptz,'2026-09-02 16:00:00-04'::timestamptz)->>'claimed')::boolean,
  'the 18:00 block claims its own chain step');

SELECT ok(
  (process_broadcast_step('bc000000-0000-4000-9000-000000000002'::uuid,'quad',
     '2026-09-02 18:30:00-04'::timestamptz,'2026-09-02 16:00:00-04'::timestamptz)->>'claimed')::boolean,
  'the 18:30 block claims its own chain step');

SELECT ok(
  (process_broadcast_step('bc000000-0000-4000-9000-000000000005'::uuid,'quad',
     '2026-09-02 20:00:00-04'::timestamptz,'2026-09-02 16:00:00-04'::timestamptz)->>'claimed')::boolean,
  'the 20:00 block claims its own chain step');

-- ---- Every block still advanced the chain, which is what keeps float/Allied working.
SELECT is(
  (SELECT count(*)::int FROM block_step_status
    WHERE block_id::text LIKE 'bc000000-0000-4000-9000-%' AND step_name = 'broadcast' AND status = 'fired'),
  4, 'all four blocks fired their chain step, merged or not');

-- ---- Two runs, so TWO notifications. Before the fix this was four. ----
SELECT is(
  (SELECT count(*)::int FROM notifications
    WHERE recipient_user_id = 'bc000000-0000-4000-8000-000000000001' AND type = 'broadcast'),
  2, 'four vacant blocks in two runs produce TWO notifications, not four');

SELECT ok(
  EXISTS(SELECT 1 FROM notifications
          WHERE recipient_user_id = 'bc000000-0000-4000-8000-000000000001' AND type = 'broadcast'
            AND payload->>'body' LIKE '%18:00 to 19:30%'),
  'run A is announced once as 18:00 to 19:30, from its first block, despite reverse visit order');

SELECT ok(
  EXISTS(SELECT 1 FROM notifications
          WHERE recipient_user_id = 'bc000000-0000-4000-8000-000000000001' AND type = 'broadcast'
            AND payload->>'body' LIKE '%20:00 to 20:30%'),
  'a staffed block splits the run: 20:00 is announced separately');

-- ===== A coverage-locked block claims its step but says nothing. =====
SELECT is(
  (process_broadcast_step('bc000000-0000-4000-9000-000000000006'::uuid,'quad',
     '2026-09-02 21:00:00-04'::timestamptz,'2026-09-02 16:00:00-04'::timestamptz)->>'notifications_sent')::int,
  0, 'a coverage-locked block sends nothing: its seats are not claimable');

SELECT ok(
  (SELECT status = 'fired' FROM block_step_status
    WHERE block_id = 'bc000000-0000-4000-9000-000000000006' AND step_name = 'broadcast'),
  'the locked block still CLAIMS its step, so the chain escalates onward as before');

-- ===== Incremental vacancy: a run whose head was announced in an EARLIER tick. =====
-- 22:00 announced at 16:00. 22:30 opens later and fires at 17:00. 22:00 is still
-- vacant and contiguous, so a naive run-start test would swallow 22:30 forever.
SELECT process_broadcast_step('bc000000-0000-4000-9000-000000000007'::uuid,'quad',
  '2026-09-02 22:00:00-04'::timestamptz,'2026-09-02 16:00:00-04'::timestamptz);

SELECT process_broadcast_step('bc000000-0000-4000-9000-000000000008'::uuid,'quad',
  '2026-09-02 22:30:00-04'::timestamptz,'2026-09-02 17:00:00-04'::timestamptz);

SELECT ok(
  EXISTS(SELECT 1 FROM notifications
          WHERE recipient_user_id = 'bc000000-0000-4000-8000-000000000001' AND type = 'broadcast'
            AND payload->>'body' LIKE '%22:30 to 23:00%'),
  'a block opening AFTER its neighbour was announced still gets its own announcement');

SELECT finish();
ROLLBACK;
