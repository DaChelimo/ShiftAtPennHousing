-- pgTAP behavioral tests for Phase 07: process_no_ack_float() atomic RPC.
--
-- Spec sources:
--   BEHAVIORAL_SPECIFICATION §7.3 (no-ack trigger semantics);
--   ARCHITECTURE §1.3 (idempotency + atomicity invariants),
--                §4.4 (no-ack trigger: void + rollback + reconciliation
--                      in one transaction; hmod_notify_allied fires
--                      after commit),
--                §4.5 (force-trigger rollback procedure;
--                      source-side reconciliation #2-#3).
-- Run with: supabase test db
--
-- The RPC under test is created in migration
-- 20260528000003_phase_07_no_ack_rpc.sql. It replaces the chain of
-- separate PostgREST calls the Edge Function originally made, so it
-- can write void + destination-vacant + exclusion + block_step_status
-- rollback + source reconciliation + hmod_notify_allied claim in a
-- single transaction. The Edge Function fires the HMOD notification
-- only after this RPC returns, so external delivery happens strictly
-- after the transaction commits.
--
-- Each scenario uses a destination block at anchor + N * 30 minutes
-- and passes p_now = block_start - 5 minutes for the in-lookahead
-- branch, or p_now = block_start - 60 minutes for the outside-lookahead
-- branch. Float direction: Harnwell home -> single-staff destination
-- (lower-quad), the only direction the harnwell-training trigger allows.

BEGIN;

SELECT plan(36);

-- ============================================================
-- 0. Fixture: users, blocks, assignments, and float records.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('e0000507-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07-auto@test.local'),
  ('e0000507-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07-ft-still@test.local'),
  ('e0000507-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07-ft-claimed@test.local'),
  ('e0000507-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07-acked@test.local'),
  ('e0000507-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07-future@test.local'),
  ('e0000507-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07-sm-initiator@test.local'),
  ('e0000507-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07-precl@test.local'),
  ('e0000507-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07-gap-claimer@test.local'),
  ('e0000507-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07-ft-nocomp@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('e0000507-0000-0000-0000-000000000001', 'Auto Floater', 'p07-auto@test.local',
   'harnwell', true),
  ('e0000507-0000-0000-0000-000000000002', 'FT Floater Still', 'p07-ft-still@test.local',
   'harnwell', true),
  ('e0000507-0000-0000-0000-000000000003', 'FT Floater Claimed', 'p07-ft-claimed@test.local',
   'harnwell', true),
  ('e0000507-0000-0000-0000-000000000004', 'Acked Floater', 'p07-acked@test.local',
   'harnwell', true),
  ('e0000507-0000-0000-0000-000000000005', 'Future Floater', 'p07-future@test.local',
   'harnwell', true),
  ('e0000507-0000-0000-0000-000000000006', 'SM Initiator', 'p07-sm-initiator@test.local',
   'lower-quad', true),
  ('e0000507-0000-0000-0000-000000000007', 'Pre-Claimed Floater', 'p07-precl@test.local',
   'harnwell', true),
  ('e0000507-0000-0000-0000-000000000008', 'Gap Claimer', 'p07-gap-claimer@test.local',
   'harnwell', true),
  ('e0000507-0000-0000-0000-000000000009', 'FT Floater NoComp', 'p07-ft-nocomp@test.local',
   'harnwell', true);

-- Anchor 30 days in the future, hour-truncated NY local time (already
-- on a 30-min boundary). The 30-day offset puts the fixture safely
-- outside any seed-generated calendar blocks.
SELECT set_config(
  'test.phase07rpc.anchor',
  (
    (date_trunc('hour', now() AT TIME ZONE 'America/New_York')
     + interval '30 days') AT TIME ZONE 'America/New_York'
  )::text,
  false
);

-- Block schedule (offsets from anchor):
--   +0   : scenario #1 (automated)
--   +30  : scenario #2 (force-trigger, gap still vacant)
--   +60  : scenario #3 (force-trigger, gap claimed)
--   +90  : scenario #4 (already acknowledged)
--   +120 : scenario #6 (hmod pre-claimed)
--   +150 : scenario #7 (force-trigger, NO compensation rows — A-1 audit fix)
--   +1440 (24h) : scenario #5 (outside lookahead)

INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000507-0000-0000-0000-000000000001', 'harnwell',
   current_setting('test.phase07rpc.anchor')::timestamptz, 3),
  ('f0000507-0000-0000-0000-000000000002', 'lower-quad',
   current_setting('test.phase07rpc.anchor')::timestamptz, 1),
  ('f0000507-0000-0000-0000-000000000003', 'harnwell',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '30 minutes', 3),
  ('f0000507-0000-0000-0000-000000000004', 'lower-quad',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '30 minutes', 1),
  ('f0000507-0000-0000-0000-000000000005', 'harnwell',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '60 minutes', 3),
  ('f0000507-0000-0000-0000-000000000006', 'lower-quad',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '60 minutes', 1),
  ('f0000507-0000-0000-0000-000000000007', 'harnwell',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '90 minutes', 3),
  ('f0000507-0000-0000-0000-000000000008', 'lower-quad',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '90 minutes', 1),
  ('f0000507-0000-0000-0000-000000000009', 'harnwell',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '1440 minutes', 3),
  ('f0000507-0000-0000-0000-00000000000a', 'lower-quad',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '1440 minutes', 1),
  ('f0000507-0000-0000-0000-00000000000b', 'harnwell',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '120 minutes', 3),
  ('f0000507-0000-0000-0000-00000000000c', 'lower-quad',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '120 minutes', 1),
  ('f0000507-0000-0000-0000-00000000000d', 'harnwell',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '150 minutes', 3),
  ('f0000507-0000-0000-0000-00000000000e', 'lower-quad',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '150 minutes', 1);

-- ============================================================
-- AUTOMATED scenario (float #1).
-- ============================================================

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float,
   source_house_id, parent_float_id)
VALUES
  ('a0000507-0000-0000-0000-000000000001',
   'f0000507-0000-0000-0000-000000000001',
   'e0000507-0000-0000-0000-000000000001',
   'pending_float_out', 'none', true, 'harnwell', NULL),
  ('a0000507-0000-0000-0000-000000000002',
   'f0000507-0000-0000-0000-000000000002',
   'e0000507-0000-0000-0000-000000000001',
   'pending_float_in', 'none', true, 'harnwell', NULL);

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids,
   status, initiated_by, expires_for_cleanup_at)
VALUES
  ('b0000507-0000-0000-0000-000000000001',
   'e0000507-0000-0000-0000-000000000001',
   ARRAY['a0000507-0000-0000-0000-000000000001']::uuid[],
   ARRAY['a0000507-0000-0000-0000-000000000002']::uuid[],
   'pending', 'automated',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '14 days');

UPDATE public.shift_block_assignments
SET parent_float_id = 'b0000507-0000-0000-0000-000000000001'::uuid
WHERE assignment_id IN (
  'a0000507-0000-0000-0000-000000000001'::uuid,
  'a0000507-0000-0000-0000-000000000002'::uuid
);

-- ============================================================
-- FORCE_TRIGGERED + still-vacant gap scenario (float #2).
-- ============================================================

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float,
   source_house_id, parent_float_id)
VALUES
  ('a0000507-0000-0000-0000-000000000003',
   'f0000507-0000-0000-0000-000000000003',
   'e0000507-0000-0000-0000-000000000002',
   'pending_float_out', 'none', true, 'harnwell', NULL),
  ('a0000507-0000-0000-0000-000000000004',
   'f0000507-0000-0000-0000-000000000004',
   'e0000507-0000-0000-0000-000000000002',
   'pending_float_in', 'none', true, 'harnwell', NULL),
  ('a0000507-0000-0000-0000-000000000005',
   'f0000507-0000-0000-0000-000000000003',
   NULL, 'vacant', 'temporary_drop', false, NULL, NULL);

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids,
   status, initiated_by, force_triggered_by, expires_for_cleanup_at)
VALUES
  ('b0000507-0000-0000-0000-000000000002',
   'e0000507-0000-0000-0000-000000000002',
   ARRAY['a0000507-0000-0000-0000-000000000003']::uuid[],
   ARRAY['a0000507-0000-0000-0000-000000000004']::uuid[],
   'pending', 'force_triggered',
   'e0000507-0000-0000-0000-000000000006',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '14 days');

UPDATE public.shift_block_assignments
SET parent_float_id = 'b0000507-0000-0000-0000-000000000002'::uuid
WHERE assignment_id IN (
  'a0000507-0000-0000-0000-000000000003'::uuid,
  'a0000507-0000-0000-0000-000000000004'::uuid,
  'a0000507-0000-0000-0000-000000000005'::uuid
);

INSERT INTO public.block_step_status
  (block_id, step_name, status, fired_at, updated_at)
VALUES
  ('f0000507-0000-0000-0000-000000000004', 'broadcast',
   'completed_via_force_trigger',
   current_setting('test.phase07rpc.anchor')::timestamptz - interval '3 hours',
   current_setting('test.phase07rpc.anchor')::timestamptz - interval '3 hours'),
  ('f0000507-0000-0000-0000-000000000004', 'float_lookup',
   'completed_via_force_trigger',
   current_setting('test.phase07rpc.anchor')::timestamptz - interval '3 hours',
   current_setting('test.phase07rpc.anchor')::timestamptz - interval '3 hours');

-- ============================================================
-- FORCE_TRIGGERED + claimed-gap scenario (float #3).
-- ============================================================

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float,
   source_house_id, parent_float_id)
VALUES
  ('a0000507-0000-0000-0000-000000000006',
   'f0000507-0000-0000-0000-000000000005',
   'e0000507-0000-0000-0000-000000000003',
   'pending_float_out', 'none', true, 'harnwell', NULL),
  ('a0000507-0000-0000-0000-000000000007',
   'f0000507-0000-0000-0000-000000000006',
   'e0000507-0000-0000-0000-000000000003',
   'pending_float_in', 'none', true, 'harnwell', NULL),
  ('a0000507-0000-0000-0000-000000000008',
   'f0000507-0000-0000-0000-000000000005',
   'e0000507-0000-0000-0000-000000000008',
   'claimed', 'none', false, NULL, NULL);

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids,
   status, initiated_by, force_triggered_by, expires_for_cleanup_at)
VALUES
  ('b0000507-0000-0000-0000-000000000003',
   'e0000507-0000-0000-0000-000000000003',
   ARRAY['a0000507-0000-0000-0000-000000000006']::uuid[],
   ARRAY['a0000507-0000-0000-0000-000000000007']::uuid[],
   'pending', 'force_triggered',
   'e0000507-0000-0000-0000-000000000006',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '14 days');

UPDATE public.shift_block_assignments
SET parent_float_id = 'b0000507-0000-0000-0000-000000000003'::uuid
WHERE assignment_id IN (
  'a0000507-0000-0000-0000-000000000006'::uuid,
  'a0000507-0000-0000-0000-000000000007'::uuid,
  'a0000507-0000-0000-0000-000000000008'::uuid
);

-- ============================================================
-- ACKNOWLEDGED scenario (float #4).
-- ============================================================

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float,
   source_house_id, parent_float_id)
VALUES
  ('a0000507-0000-0000-0000-000000000009',
   'f0000507-0000-0000-0000-000000000007',
   'e0000507-0000-0000-0000-000000000004',
   'pending_float_out', 'none', true, 'harnwell', NULL),
  ('a0000507-0000-0000-0000-00000000000a',
   'f0000507-0000-0000-0000-000000000008',
   'e0000507-0000-0000-0000-000000000004',
   'pending_float_in', 'none', true, 'harnwell', NULL);

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids,
   status, acknowledged_at, initiated_by, expires_for_cleanup_at)
VALUES
  ('b0000507-0000-0000-0000-000000000004',
   'e0000507-0000-0000-0000-000000000004',
   ARRAY['a0000507-0000-0000-0000-000000000009']::uuid[],
   ARRAY['a0000507-0000-0000-0000-00000000000a']::uuid[],
   'pending',
   current_setting('test.phase07rpc.anchor')::timestamptz - interval '1 hour',
   'automated',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '14 days');

-- ============================================================
-- OUTSIDE_LOOKAHEAD scenario (float #5).
-- ============================================================

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float,
   source_house_id, parent_float_id)
VALUES
  ('a0000507-0000-0000-0000-00000000000b',
   'f0000507-0000-0000-0000-000000000009',
   'e0000507-0000-0000-0000-000000000005',
   'pending_float_out', 'none', true, 'harnwell', NULL),
  ('a0000507-0000-0000-0000-00000000000c',
   'f0000507-0000-0000-0000-00000000000a',
   'e0000507-0000-0000-0000-000000000005',
   'pending_float_in', 'none', true, 'harnwell', NULL);

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids,
   status, initiated_by, expires_for_cleanup_at)
VALUES
  ('b0000507-0000-0000-0000-000000000005',
   'e0000507-0000-0000-0000-000000000005',
   ARRAY['a0000507-0000-0000-0000-00000000000b']::uuid[],
   ARRAY['a0000507-0000-0000-0000-00000000000c']::uuid[],
   'pending', 'automated',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '14 days');

-- ============================================================
-- HMOD pre-claimed scenario (float #6).
-- ============================================================

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float,
   source_house_id, parent_float_id)
VALUES
  ('a0000507-0000-0000-0000-00000000000d',
   'f0000507-0000-0000-0000-00000000000b',
   'e0000507-0000-0000-0000-000000000007',
   'pending_float_out', 'none', true, 'harnwell', NULL),
  ('a0000507-0000-0000-0000-00000000000e',
   'f0000507-0000-0000-0000-00000000000c',
   'e0000507-0000-0000-0000-000000000007',
   'pending_float_in', 'none', true, 'harnwell', NULL);

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids,
   status, initiated_by, expires_for_cleanup_at)
VALUES
  ('b0000507-0000-0000-0000-000000000006',
   'e0000507-0000-0000-0000-000000000007',
   ARRAY['a0000507-0000-0000-0000-00000000000d']::uuid[],
   ARRAY['a0000507-0000-0000-0000-00000000000e']::uuid[],
   'pending', 'automated',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '14 days');

-- Pre-claim hmod_notify_allied for this float's destination block.
INSERT INTO public.block_step_status
  (block_id, step_name, status, fired_at, updated_at)
VALUES
  ('f0000507-0000-0000-0000-00000000000c', 'hmod_notify_allied', 'fired',
   current_setting('test.phase07rpc.anchor')::timestamptz - interval '1 hour',
   current_setting('test.phase07rpc.anchor')::timestamptz - interval '1 hour');

-- ============================================================
-- FORCE_TRIGGERED + NO compensation rows scenario (float #7).
--
-- Audit finding A-1: when force-trigger pulls a floater but source
-- still has enough headcount (i.e., no compensation rows are created
-- because source isn't dropped below required), the no-ack handler
-- must RESTORE the floater to scheduled — there's no displaced gap to
-- worry about. Per ARCH §4.5 #2 ("If still vacant: revert the
-- floater's row from pending_float_out back to scheduled"), the
-- restore branch should also fire when no compensation rows ever
-- existed.
-- ============================================================

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float,
   source_house_id, parent_float_id)
VALUES
  ('a0000507-0000-0000-0000-00000000000f',
   'f0000507-0000-0000-0000-00000000000d',
   'e0000507-0000-0000-0000-000000000009',
   'pending_float_out', 'none', true, 'harnwell', NULL),
  ('a0000507-0000-0000-0000-000000000010',
   'f0000507-0000-0000-0000-00000000000e',
   'e0000507-0000-0000-0000-000000000009',
   'pending_float_in', 'none', true, 'harnwell', NULL);

-- Note: NO compensation row inserted here. This is the key fixture
-- difference from float #2 (which has a vacant compensation row at
-- a0...05).

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids,
   status, initiated_by, force_triggered_by, expires_for_cleanup_at)
VALUES
  ('b0000507-0000-0000-0000-000000000007',
   'e0000507-0000-0000-0000-000000000009',
   ARRAY['a0000507-0000-0000-0000-00000000000f']::uuid[],
   ARRAY['a0000507-0000-0000-0000-000000000010']::uuid[],
   'pending', 'force_triggered',
   'e0000507-0000-0000-0000-000000000006',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '14 days');

UPDATE public.shift_block_assignments
SET parent_float_id = 'b0000507-0000-0000-0000-000000000007'::uuid
WHERE assignment_id IN (
  'a0000507-0000-0000-0000-00000000000f'::uuid,
  'a0000507-0000-0000-0000-000000000010'::uuid
);

-- ============================================================
-- 1. Function exists.
-- ============================================================

SELECT has_function(
  'public', 'process_no_ack_float',
  ARRAY['uuid', 'timestamptz', 'integer'],
  'process_no_ack_float(uuid, timestamptz, integer) function exists'
);

-- ============================================================
-- 2. Automated no-ack scenario.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.process_no_ack_float(
       'b0000507-0000-0000-0000-000000000001'::uuid,
       (current_setting('test.phase07rpc.anchor')::timestamptz - interval '5 minutes'),
       15
     ) $$,
  'automated no-ack: RPC runs without error'
);

SELECT is(
  (SELECT status FROM public.float_assignments
   WHERE float_id = 'b0000507-0000-0000-0000-000000000001'),
  'voided',
  'automated no-ack: float status -> voided'
);

SELECT is(
  (SELECT no_ack_at IS NOT NULL AND declined_at IS NULL FROM public.float_assignments
   WHERE float_id = 'b0000507-0000-0000-0000-000000000001'),
  true,
  'automated no-ack: no_ack_at set, declined_at left NULL (F-07-010)'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-000000000002'),
  'vacant',
  'automated no-ack: destination -> vacant'
);

-- Audit finding A-2: destination on no-ack must NOT reuse the
-- 'displaced_decliner' enum value, which BSpec §3.3 defines for the
-- floater's now-vacant source seat. The destination block is the
-- original gap re-opening — 'temporary_drop' is the correct enum
-- value (block was effectively dropped via the no-ack).
SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-000000000002'),
  'temporary_drop',
  'A-2: automated no-ack destination vacancy_origin -> temporary_drop (NOT displaced_decliner)'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-000000000001'),
  'scheduled',
  'automated no-ack: source row restored to scheduled'
);

SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-000000000001'),
  'none',
  'automated no-ack: source row vacancy_origin -> none'
);

SELECT is(
  (SELECT user_id FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-000000000001'),
  'e0000507-0000-0000-0000-000000000001'::uuid,
  'automated no-ack: source row user_id restored'
);

SELECT is(
  (SELECT count(*)::integer FROM public.float_exclusions
   WHERE user_id = 'e0000507-0000-0000-0000-000000000001'
     AND reason = 'no_acknowledgment'),
  1,
  'automated no-ack: float_exclusions row inserted'
);

SELECT is(
  (SELECT status::text FROM public.block_step_status
   WHERE block_id = 'f0000507-0000-0000-0000-000000000002'
     AND step_name = 'hmod_notify_allied'),
  'fired',
  'automated no-ack: hmod_notify_allied claimed (status=fired)'
);

-- ============================================================
-- 3. Force-triggered no-ack + still-vacant gap scenario.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.process_no_ack_float(
       'b0000507-0000-0000-0000-000000000002'::uuid,
       (current_setting('test.phase07rpc.anchor')::timestamptz + interval '25 minutes'),
       15
     ) $$,
  'force-triggered (still-vacant gap): RPC runs without error'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-000000000003'),
  'scheduled',
  'force-triggered (still-vacant gap): floater restored to scheduled'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-000000000005'),
  0,
  'force-triggered (still-vacant gap): source compensation row deleted'
);

SELECT is(
  (SELECT status::text FROM public.block_step_status
   WHERE block_id = 'f0000507-0000-0000-0000-000000000004'
     AND step_name = 'broadcast'),
  'rolled_back',
  'force-triggered no-ack: broadcast step rolled_back'
);

SELECT is(
  (SELECT status::text FROM public.block_step_status
   WHERE block_id = 'f0000507-0000-0000-0000-000000000004'
     AND step_name = 'float_lookup'),
  'rolled_back',
  'force-triggered no-ack: float_lookup step rolled_back'
);

-- ============================================================
-- 4. Force-triggered no-ack + claimed-gap scenario.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.process_no_ack_float(
       'b0000507-0000-0000-0000-000000000003'::uuid,
       (current_setting('test.phase07rpc.anchor')::timestamptz + interval '55 minutes'),
       15
     ) $$,
  'force-triggered (claimed gap): RPC runs without error'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-000000000006'),
  'vacant',
  'force-triggered (claimed gap): floater displaced (status=vacant)'
);

SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-000000000006'),
  'displaced_decliner',
  'force-triggered (claimed gap): floater displaced with vacancy_origin=displaced_decliner'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-000000000008'),
  'claimed',
  'force-triggered (claimed gap): claimer''s row left in place'
);

-- ============================================================
-- 5. Acknowledged float — RPC skips.
-- ============================================================

SELECT is(
  (SELECT (public.process_no_ack_float(
            'b0000507-0000-0000-0000-000000000004'::uuid,
            (current_setting('test.phase07rpc.anchor')::timestamptz + interval '85 minutes'),
            15
          ) ->> 'processed')::boolean),
  false,
  'acknowledged float: processed=false'
);

SELECT is(
  (SELECT status FROM public.float_assignments
   WHERE float_id = 'b0000507-0000-0000-0000-000000000004'),
  'pending',
  'acknowledged float: status NOT mutated by RPC'
);

-- ============================================================
-- 6. Outside lookahead — RPC skips.
-- ============================================================

SELECT is(
  (SELECT (public.process_no_ack_float(
            'b0000507-0000-0000-0000-000000000005'::uuid,
            (current_setting('test.phase07rpc.anchor')::timestamptz),
            15
          ) ->> 'reason')),
  'outside_lookahead',
  'outside lookahead: reason=outside_lookahead'
);

SELECT is(
  (SELECT status FROM public.float_assignments
   WHERE float_id = 'b0000507-0000-0000-0000-000000000005'),
  'pending',
  'outside lookahead: float status NOT mutated'
);

-- ============================================================
-- 7. Idempotency: second call returns processed=false.
-- ============================================================

SELECT is(
  (SELECT (public.process_no_ack_float(
            'b0000507-0000-0000-0000-000000000001'::uuid,
            (current_setting('test.phase07rpc.anchor')::timestamptz - interval '5 minutes'),
            15
          ) ->> 'reason')),
  'not_pending',
  'idempotency: second call on already-voided float reason=not_pending'
);

-- ============================================================
-- 8. hmod_step_claimed=false when row pre-exists.
-- ============================================================

SELECT is(
  (SELECT (public.process_no_ack_float(
            'b0000507-0000-0000-0000-000000000006'::uuid,
            (current_setting('test.phase07rpc.anchor')::timestamptz + interval '115 minutes'),
            15
          ) ->> 'hmod_step_claimed')::boolean),
  false,
  'hmod_step_claimed=false when block_step_status row already present'
);

-- The float is still voided — only the notification fire-flag is gated
-- by the claim, not the rest of the transaction.
SELECT is(
  (SELECT status FROM public.float_assignments
   WHERE float_id = 'b0000507-0000-0000-0000-000000000006'),
  'voided',
  'pre-claimed hmod_notify_allied scenario: float still voided'
);

-- ============================================================
-- 9. A-2: force-trigger destinations also get 'temporary_drop'
--    (not 'displaced_decliner'). The destination is the original gap
--    re-opening, regardless of how the float was initiated.
-- ============================================================

SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-000000000004'),
  'temporary_drop',
  'A-2: force-trigger (still-vacant gap) destination vacancy_origin -> temporary_drop'
);

SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-000000000007'),
  'temporary_drop',
  'A-2: force-trigger (claimed gap) destination vacancy_origin -> temporary_drop'
);

-- ============================================================
-- 10. A-1: force-trigger with NO compensation rows must RESTORE the
--     floater, not displace them. The original RPC ELSE branch fired
--     when v_gap_rows_total = 0 (no compensation rows) and incorrectly
--     displaced. Per ARCH §4.5 #2: "If still vacant: revert the
--     floater's row from pending_float_out back to scheduled." A
--     non-existent compensation row is logically "still vacant" — no
--     other worker has claimed anything.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.process_no_ack_float(
       'b0000507-0000-0000-0000-000000000007'::uuid,
       (current_setting('test.phase07rpc.anchor')::timestamptz + interval '145 minutes'),
       15
     ) $$,
  'A-1: force-trigger (no compensation rows): RPC runs without error'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-00000000000f'),
  'scheduled',
  'A-1: force-trigger (no compensation rows): floater RESTORED to scheduled (not displaced)'
);

SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-00000000000f'),
  'none',
  'A-1: force-trigger (no compensation rows): floater source vacancy_origin -> none (restored)'
);

SELECT is(
  (SELECT user_id FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000507-0000-0000-0000-00000000000f'),
  'e0000507-0000-0000-0000-000000000009'::uuid,
  'A-1: force-trigger (no compensation rows): floater user_id restored on source'
);

-- ============================================================
-- 11. B-3: process_no_ack_float must take FOR UPDATE on compensation
--     rows before deciding restore-vs-displace. Without the lock a
--     concurrent claim can land between SELECT and IF branch and
--     cause over-staffing. We can't drive a true concurrent test in
--     pgTAP single-connection, so we inspect the function source to
--     verify the lock clause is present near the compensation SELECT.
-- ============================================================

SELECT ok(
  pg_get_functiondef('public.process_no_ack_float(uuid, timestamptz, integer)'::regprocedure)
    ~* 'parent_float_id\s*=\s*p_float_id.*FOR\s+UPDATE',
  'B-3: process_no_ack_float locks compensation rows with FOR UPDATE'
);

-- ============================================================
-- 12. F-07-009 regression: a MULTI-BLOCK destination gap. The no-ack RPC claims
--     hmod_notify_allied for every destination block (here 2). The pre-fix code
--     assigned GET DIAGNOSTICS = ROW_COUNT (=2) into a boolean and aborted with
--     "invalid input syntax for type boolean". This scenario drives ROW_COUNT=2,
--     so it errors on the old code and passes on the integer-count fix.
-- ============================================================

INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000507-0000-0000-0000-000000000020', 'harnwell',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '180 minutes', 3),
  ('f0000507-0000-0000-0000-000000000021', 'lower-quad',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '180 minutes', 1),
  ('f0000507-0000-0000-0000-000000000022', 'harnwell',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '210 minutes', 3),
  ('f0000507-0000-0000-0000-000000000023', 'lower-quad',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '210 minutes', 1);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float,
   source_house_id, parent_float_id)
VALUES
  ('a0000507-0000-0000-0000-000000000020', 'f0000507-0000-0000-0000-000000000020',
   'e0000507-0000-0000-0000-000000000001', 'pending_float_out', 'none', true, 'harnwell', NULL),
  ('a0000507-0000-0000-0000-000000000021', 'f0000507-0000-0000-0000-000000000021',
   'e0000507-0000-0000-0000-000000000001', 'pending_float_in', 'none', true, 'harnwell', NULL),
  ('a0000507-0000-0000-0000-000000000022', 'f0000507-0000-0000-0000-000000000022',
   'e0000507-0000-0000-0000-000000000001', 'pending_float_out', 'none', true, 'harnwell', NULL),
  ('a0000507-0000-0000-0000-000000000023', 'f0000507-0000-0000-0000-000000000023',
   'e0000507-0000-0000-0000-000000000001', 'pending_float_in', 'none', true, 'harnwell', NULL);

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids,
   status, initiated_by, expires_for_cleanup_at)
VALUES
  ('b0000507-0000-0000-0000-000000000020',
   'e0000507-0000-0000-0000-000000000001',
   ARRAY['a0000507-0000-0000-0000-000000000020','a0000507-0000-0000-0000-000000000022']::uuid[],
   ARRAY['a0000507-0000-0000-0000-000000000021','a0000507-0000-0000-0000-000000000023']::uuid[],
   'pending', 'automated',
   current_setting('test.phase07rpc.anchor')::timestamptz + interval '14 days');

UPDATE public.shift_block_assignments
SET parent_float_id = 'b0000507-0000-0000-0000-000000000020'::uuid
WHERE assignment_id IN (
  'a0000507-0000-0000-0000-000000000020'::uuid,
  'a0000507-0000-0000-0000-000000000021'::uuid,
  'a0000507-0000-0000-0000-000000000022'::uuid,
  'a0000507-0000-0000-0000-000000000023'::uuid
);

SELECT lives_ok(
  $$ SELECT public.process_no_ack_float(
       'b0000507-0000-0000-0000-000000000020'::uuid,
       (current_setting('test.phase07rpc.anchor')::timestamptz + interval '175 minutes'),
       15
     ) $$,
  'F-07-009: multi-block destination no-ack runs without a boolean-cast error'
);

SELECT is(
  (SELECT count(*)::integer FROM public.block_step_status
   WHERE block_id IN ('f0000507-0000-0000-0000-000000000021',
                      'f0000507-0000-0000-0000-000000000023')
     AND step_name = 'hmod_notify_allied'
     AND status = 'fired'),
  2,
  'F-07-009: hmod_notify_allied claimed once for each of the 2 destination blocks'
);

SELECT * FROM finish();

ROLLBACK;
