-- pgTAP transaction-atomicity tests for Phase 08: the force-trigger pathway.
--
-- Spec sources:
--   BEHAVIORAL_SPECIFICATION.md §6.6 (force-triggered float — all sub-rules:
--                                #2 bypass, #5 source-side gap, #7 decline +
--                                source-side reconciliation, #8 no-takeback);
--   ARCHITECTURE.md §4.5 (force-trigger pathway: destination + source-side
--                          rows, block_step_status pre-marking, rollback
--                          procedure, source-side reconciliation),
--                   §6.3 ("Atomic: all source-side and destination-side
--                          updates happen in one transaction").
--   AGENTS.md hard invariant #3 (no-takeback).
-- Run with: supabase test db
--
-- WHAT THIS SUITE COVERS
-- ----------------------
-- The force-trigger pathway is activated end-to-end across several RPCs that
-- already exist (the no-ack RPC's own header notes its force-trigger branch
-- "activates when Phase 08 adds [the endpoint]"). This suite tests the
-- TRANSACTION ATOMICITY of every force-trigger-specific multi-write path:
--
--   A. Schema-level atomicity guarantees that make the single-transaction
--      execution write safe: the force_triggered_by CHECK and the
--      block_step_status pre-mark idempotency (PK + ON CONFLICT).
--   B. A valid force-trigger SUCCESS state (the rows ARCH §4.5 writes for one
--      floater) is accepted by every constraint and pre-marks broadcast +
--      float_lookup as completed_via_force_trigger while leaving
--      hmod_notify_allied unmarked.
--   C. DECLINE of a force-triggered float (decline_float): void + destination
--      vacant + rolled_back marks + source restore, all atomic (§6.6 #7,
--      source still vacant → floater restored).
--   D. DECLINE with the source-side gap CLAIMED by another worker: floater
--      displaced (vacancy_origin = 'displaced_decliner'), atomic.
--   E. NO-TAKEBACK (§6.6 #8): the automated no-ack RPC will NOT recall a
--      pending force-triggered float before its trigger window — outside the
--      lookahead it is a no-op and the float stays pending.
--   F. ACKNOWLEDGE then drop the floater's separate home shift: the float
--      commitment STANDS (§6.6 #8 / no-takeback); the home drop is an
--      independent gap.
--
-- The force-trigger INITIATION/execution RPC (force_trigger_float) itself is
-- TDD-red — its pure validation surface is pinned in
-- packages/core/tests/phase-08/force-trigger-validation.test.ts and its
-- atomic SQL contract is documented in tests/PHASE_08/TEST_PLAN.md. This
-- suite tests the constraints and reconciliation machinery that execution
-- relies on, all GREEN against the current schema.
--
-- Float direction: harnwell home -> house-03 destination, the only direction
-- the harnwell-training trigger permits for a harnwell worker.

BEGIN;

SELECT plan(40);

-- ============================================================
-- 0. Fixture: users, roles, blocks, assignments, floats.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('e0000508-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p08-floater1@test.local'),
  ('e0000508-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p08-floater2@test.local'),
  ('e0000508-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p08-floater3@test.local'),
  ('e0000508-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p08-floater4@test.local'),
  ('e0000508-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p08-sm-initiator@test.local'),
  ('e0000508-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p08-gap-claimer@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('e0000508-0000-0000-0000-000000000001', 'FT Floater 1', 'p08-floater1@test.local', 'harnwell', true),
  ('e0000508-0000-0000-0000-000000000002', 'FT Floater 2', 'p08-floater2@test.local', 'harnwell', true),
  ('e0000508-0000-0000-0000-000000000003', 'FT Floater 3', 'p08-floater3@test.local', 'harnwell', true),
  ('e0000508-0000-0000-0000-000000000004', 'FT Floater 4', 'p08-floater4@test.local', 'harnwell', true),
  ('e0000508-0000-0000-0000-000000000006', 'SM Initiator', 'p08-sm-initiator@test.local', 'house-03', true),
  ('e0000508-0000-0000-0000-000000000008', 'Gap Claimer', 'p08-gap-claimer@test.local', 'harnwell', true);

-- The initiator is SM of the destination house (force_triggered_by).
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('e0000508-0000-0000-0000-000000000006', 'sm', 'house-03')
ON CONFLICT DO NOTHING;

-- Anchor 30 days out, hour-truncated NY-local (already on a 30-min boundary),
-- safely outside any seed-generated calendar blocks.
SELECT set_config(
  'test.p08.anchor',
  ((date_trunc('hour', now() AT TIME ZONE 'America/New_York') + interval '30 days')
    AT TIME ZONE 'America/New_York')::text,
  false
);

-- Blocks (offsets from anchor):
--   +0   : float #1 destination (house-03) + source (harnwell)
--   +30  : float #2 destination + source
--   +60  : float #3 destination + source (no-ack / no-takeback)
--   +90  : float #4 destination + source (acknowledge)
--   +120 : float #4 floater's SEPARATE home shift (the one they drop)
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000508-0000-0000-0000-0000000000d1', 'house-03', current_setting('test.p08.anchor')::timestamptz, 1),
  ('f0000508-0000-0000-0000-000000000051', 'harnwell', current_setting('test.p08.anchor')::timestamptz, 3),
  ('f0000508-0000-0000-0000-0000000000d2', 'house-03', current_setting('test.p08.anchor')::timestamptz + interval '30 minutes', 1),
  ('f0000508-0000-0000-0000-000000000052', 'harnwell', current_setting('test.p08.anchor')::timestamptz + interval '30 minutes', 3),
  ('f0000508-0000-0000-0000-0000000000d3', 'house-03', current_setting('test.p08.anchor')::timestamptz + interval '60 minutes', 1),
  ('f0000508-0000-0000-0000-000000000053', 'harnwell', current_setting('test.p08.anchor')::timestamptz + interval '60 minutes', 3),
  ('f0000508-0000-0000-0000-0000000000d4', 'house-03', current_setting('test.p08.anchor')::timestamptz + interval '90 minutes', 1),
  ('f0000508-0000-0000-0000-000000000054', 'harnwell', current_setting('test.p08.anchor')::timestamptz + interval '90 minutes', 3),
  ('f0000508-0000-0000-0000-000000000055', 'harnwell', current_setting('test.p08.anchor')::timestamptz + interval '120 minutes', 3);

-- ---- float #1: force-trigger SUCCESS state, source gap STILL VACANT ----
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id, parent_float_id)
VALUES
  ('a0000508-0000-0000-0000-0000000000d1', 'f0000508-0000-0000-0000-0000000000d1',
   'e0000508-0000-0000-0000-000000000001', 'pending_float_in', 'none', true, 'harnwell', NULL),
  ('a0000508-0000-0000-0000-000000000051', 'f0000508-0000-0000-0000-000000000051',
   'e0000508-0000-0000-0000-000000000001', 'pending_float_out', 'none', false, NULL, NULL),
  -- source-side compensation gap (the source dropped below headcount), still vacant:
  ('a0000508-0000-0000-0000-0000000000c1', 'f0000508-0000-0000-0000-000000000051',
   NULL, 'vacant', 'temporary_drop', false, NULL, NULL);

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids, status,
   initiated_by, force_triggered_by, expires_for_cleanup_at)
VALUES
  ('c0000508-0000-0000-0000-000000000001', 'e0000508-0000-0000-0000-000000000001',
   ARRAY['a0000508-0000-0000-0000-000000000051']::uuid[],
   ARRAY['a0000508-0000-0000-0000-0000000000d1']::uuid[],
   'pending', 'force_triggered', 'e0000508-0000-0000-0000-000000000006',
   current_setting('test.p08.anchor')::timestamptz + interval '14 days');

UPDATE public.shift_block_assignments
SET parent_float_id = 'c0000508-0000-0000-0000-000000000001'::uuid
WHERE assignment_id IN (
  'a0000508-0000-0000-0000-0000000000d1'::uuid,
  'a0000508-0000-0000-0000-000000000051'::uuid,
  'a0000508-0000-0000-0000-0000000000c1'::uuid
);

-- Pre-marks ARCH §4.5 writes on success: broadcast + float_lookup only.
INSERT INTO public.block_step_status (block_id, step_name, status, fired_at, updated_at)
VALUES
  ('f0000508-0000-0000-0000-0000000000d1', 'broadcast', 'completed_via_force_trigger',
   current_setting('test.p08.anchor')::timestamptz - interval '3 hours',
   current_setting('test.p08.anchor')::timestamptz - interval '3 hours'),
  ('f0000508-0000-0000-0000-0000000000d1', 'float_lookup', 'completed_via_force_trigger',
   current_setting('test.p08.anchor')::timestamptz - interval '3 hours',
   current_setting('test.p08.anchor')::timestamptz - interval '3 hours');

-- ---- float #2: force-trigger SUCCESS state, source gap CLAIMED by another ----
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id, parent_float_id)
VALUES
  ('a0000508-0000-0000-0000-0000000000d2', 'f0000508-0000-0000-0000-0000000000d2',
   'e0000508-0000-0000-0000-000000000002', 'pending_float_in', 'none', true, 'harnwell', NULL),
  ('a0000508-0000-0000-0000-000000000052', 'f0000508-0000-0000-0000-000000000052',
   'e0000508-0000-0000-0000-000000000002', 'pending_float_out', 'none', false, NULL, NULL),
  -- source-side compensation gap claimed by another worker (NOT vacant):
  ('a0000508-0000-0000-0000-0000000000c2', 'f0000508-0000-0000-0000-000000000052',
   'e0000508-0000-0000-0000-000000000008', 'claimed', 'none', false, NULL, NULL);

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids, status,
   initiated_by, force_triggered_by, expires_for_cleanup_at)
VALUES
  ('c0000508-0000-0000-0000-000000000002', 'e0000508-0000-0000-0000-000000000002',
   ARRAY['a0000508-0000-0000-0000-000000000052']::uuid[],
   ARRAY['a0000508-0000-0000-0000-0000000000d2']::uuid[],
   'pending', 'force_triggered', 'e0000508-0000-0000-0000-000000000006',
   current_setting('test.p08.anchor')::timestamptz + interval '14 days');

UPDATE public.shift_block_assignments
SET parent_float_id = 'c0000508-0000-0000-0000-000000000002'::uuid
WHERE assignment_id IN (
  'a0000508-0000-0000-0000-0000000000d2'::uuid,
  'a0000508-0000-0000-0000-000000000052'::uuid,
  'a0000508-0000-0000-0000-0000000000c2'::uuid
);

INSERT INTO public.block_step_status (block_id, step_name, status, fired_at, updated_at)
VALUES
  ('f0000508-0000-0000-0000-0000000000d2', 'broadcast', 'completed_via_force_trigger',
   current_setting('test.p08.anchor')::timestamptz - interval '3 hours',
   current_setting('test.p08.anchor')::timestamptz - interval '3 hours'),
  ('f0000508-0000-0000-0000-0000000000d2', 'float_lookup', 'completed_via_force_trigger',
   current_setting('test.p08.anchor')::timestamptz - interval '3 hours',
   current_setting('test.p08.anchor')::timestamptz - interval '3 hours');

-- ---- float #3: force-trigger SUCCESS state for the no-ack / no-takeback test ----
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id, parent_float_id)
VALUES
  ('a0000508-0000-0000-0000-0000000000d3', 'f0000508-0000-0000-0000-0000000000d3',
   'e0000508-0000-0000-0000-000000000003', 'pending_float_in', 'none', true, 'harnwell', NULL),
  ('a0000508-0000-0000-0000-000000000053', 'f0000508-0000-0000-0000-000000000053',
   'e0000508-0000-0000-0000-000000000003', 'pending_float_out', 'none', false, NULL, NULL);

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids, status,
   initiated_by, force_triggered_by, expires_for_cleanup_at)
VALUES
  ('c0000508-0000-0000-0000-000000000003', 'e0000508-0000-0000-0000-000000000003',
   ARRAY['a0000508-0000-0000-0000-000000000053']::uuid[],
   ARRAY['a0000508-0000-0000-0000-0000000000d3']::uuid[],
   'pending', 'force_triggered', 'e0000508-0000-0000-0000-000000000006',
   current_setting('test.p08.anchor')::timestamptz + interval '14 days');

UPDATE public.shift_block_assignments
SET parent_float_id = 'c0000508-0000-0000-0000-000000000003'::uuid
WHERE assignment_id IN (
  'a0000508-0000-0000-0000-0000000000d3'::uuid,
  'a0000508-0000-0000-0000-000000000053'::uuid
);

-- ---- float #4: force-trigger SUCCESS state for the acknowledge / no-takeback test ----
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id, parent_float_id)
VALUES
  ('a0000508-0000-0000-0000-0000000000d4', 'f0000508-0000-0000-0000-0000000000d4',
   'e0000508-0000-0000-0000-000000000004', 'pending_float_in', 'none', true, 'harnwell', NULL),
  ('a0000508-0000-0000-0000-000000000054', 'f0000508-0000-0000-0000-000000000054',
   'e0000508-0000-0000-0000-000000000004', 'pending_float_out', 'none', false, NULL, NULL),
  -- the floater's SEPARATE home shift (NOT part of the float), which they later drop:
  ('a0000508-0000-0000-0000-000000000055', 'f0000508-0000-0000-0000-000000000055',
   'e0000508-0000-0000-0000-000000000004', 'scheduled', 'none', false, NULL, NULL);

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids, status,
   initiated_by, force_triggered_by, expires_for_cleanup_at)
VALUES
  ('c0000508-0000-0000-0000-000000000004', 'e0000508-0000-0000-0000-000000000004',
   ARRAY['a0000508-0000-0000-0000-000000000054']::uuid[],
   ARRAY['a0000508-0000-0000-0000-0000000000d4']::uuid[],
   'pending', 'force_triggered', 'e0000508-0000-0000-0000-000000000006',
   current_setting('test.p08.anchor')::timestamptz + interval '14 days');

UPDATE public.shift_block_assignments
SET parent_float_id = 'c0000508-0000-0000-0000-000000000004'::uuid
WHERE assignment_id IN (
  'a0000508-0000-0000-0000-0000000000d4'::uuid,
  'a0000508-0000-0000-0000-000000000054'::uuid
);

-- ============================================================
-- A. Schema-level atomicity guarantees for the force-trigger write.
-- ============================================================

-- A1. A force_triggered float MUST carry force_triggered_by (CHECK 23514).
SELECT throws_ok(
  $$ INSERT INTO public.float_assignments
       (user_id, source_assignment_ids, destination_assignment_ids, status,
        initiated_by, force_triggered_by, expires_for_cleanup_at)
     VALUES
       ('e0000508-0000-0000-0000-000000000001',
        ARRAY['a0000508-0000-0000-0000-000000000051']::uuid[],
        ARRAY['a0000508-0000-0000-0000-0000000000d1']::uuid[],
        'pending', 'force_triggered', NULL, now() + interval '14 days') $$,
  '23514',
  NULL,
  'force_triggered float without force_triggered_by is rejected (atomic CHECK)'
);

-- A2. An automated float must NOT carry force_triggered_by (CHECK 23514).
SELECT throws_ok(
  $$ INSERT INTO public.float_assignments
       (user_id, source_assignment_ids, destination_assignment_ids, status,
        initiated_by, force_triggered_by, expires_for_cleanup_at)
     VALUES
       ('e0000508-0000-0000-0000-000000000001',
        ARRAY['a0000508-0000-0000-0000-000000000051']::uuid[],
        ARRAY['a0000508-0000-0000-0000-0000000000d1']::uuid[],
        'pending', 'automated', 'e0000508-0000-0000-0000-000000000006',
        now() + interval '14 days') $$,
  '23514',
  NULL,
  'automated float with a force_triggered_by is rejected (atomic CHECK)'
);

-- A3. Pre-mark idempotency: re-inserting a force-trigger pre-mark via
--     ON CONFLICT DO NOTHING is a no-op (the orchestrator pattern). A
--     conflicting (block_id, step_name) row is not duplicated or overwritten.
INSERT INTO public.block_step_status (block_id, step_name, status, fired_at, updated_at)
VALUES ('f0000508-0000-0000-0000-0000000000d1', 'broadcast', 'fired', now(), now())
ON CONFLICT (block_id, step_name) DO NOTHING;

SELECT is(
  (SELECT count(*)::integer FROM public.block_step_status
   WHERE block_id = 'f0000508-0000-0000-0000-0000000000d1' AND step_name = 'broadcast'),
  1,
  'pre-mark idempotency: ON CONFLICT DO NOTHING leaves exactly one (block, step) row'
);

SELECT is(
  (SELECT status::text FROM public.block_step_status
   WHERE block_id = 'f0000508-0000-0000-0000-0000000000d1' AND step_name = 'broadcast'),
  'completed_via_force_trigger',
  'pre-mark idempotency: the conflicting insert did not overwrite the original status'
);

-- ============================================================
-- B. A valid force-trigger SUCCESS state (float #1, pre-decline).
-- ============================================================

SELECT is(
  (SELECT initiated_by::text FROM public.float_assignments WHERE float_id = 'c0000508-0000-0000-0000-000000000001'),
  'force_triggered',
  'success: float row is initiated_by = force_triggered'
);

SELECT is(
  (SELECT force_triggered_by FROM public.float_assignments WHERE float_id = 'c0000508-0000-0000-0000-000000000001'),
  'e0000508-0000-0000-0000-000000000006'::uuid,
  'success: force_triggered_by records the SM/HM/BM initiator'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-0000000000d1'),
  'pending_float_in',
  'success: destination block -> pending_float_in'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-000000000051'),
  'pending_float_out',
  'success: source block -> pending_float_out'
);

SELECT is(
  (SELECT count(*)::integer FROM public.block_step_status
   WHERE block_id = 'f0000508-0000-0000-0000-0000000000d1'
     AND step_name IN ('broadcast', 'float_lookup')
     AND status = 'completed_via_force_trigger'),
  2,
  'success: broadcast + float_lookup pre-marked completed_via_force_trigger'
);

SELECT is(
  (SELECT count(*)::integer FROM public.block_step_status
   WHERE block_id = 'f0000508-0000-0000-0000-0000000000d1'
     AND step_name = 'hmod_notify_allied'),
  0,
  'success: hmod_notify_allied is NOT pre-marked (stays fireable on rollback)'
);

-- ============================================================
-- C. DECLINE of a force-triggered float — source gap still vacant -> RESTORE.
--    All writes are one atomic transaction (ARCH §6.3 / §4.5).
-- ============================================================

SELECT is(
  (SELECT (public.decline_float(
     'c0000508-0000-0000-0000-000000000001'::uuid,
     'e0000508-0000-0000-0000-000000000001'::uuid,
     current_setting('test.p08.anchor')::timestamptz - interval '4 hours')) ->> 'declined'),
  'true',
  'decline (still-vacant): decline_float returns declined=true'
);

SELECT is(
  (SELECT status::text FROM public.float_assignments WHERE float_id = 'c0000508-0000-0000-0000-000000000001'),
  'declined',
  'decline (still-vacant): float -> declined'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-0000000000d1'),
  'vacant',
  'decline (still-vacant): destination -> vacant'
);

SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-0000000000d1'),
  'temporary_drop',
  'decline (still-vacant): destination vacancy_origin -> temporary_drop'
);

SELECT is(
  (SELECT status::text FROM public.block_step_status
   WHERE block_id = 'f0000508-0000-0000-0000-0000000000d1' AND step_name = 'broadcast'),
  'rolled_back',
  'decline (still-vacant): broadcast pre-mark -> rolled_back (same transaction)'
);

SELECT is(
  (SELECT status::text FROM public.block_step_status
   WHERE block_id = 'f0000508-0000-0000-0000-0000000000d1' AND step_name = 'float_lookup'),
  'rolled_back',
  'decline (still-vacant): float_lookup pre-mark -> rolled_back (same transaction)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.block_step_status
   WHERE block_id = 'f0000508-0000-0000-0000-0000000000d1' AND step_name = 'hmod_notify_allied'),
  0,
  'decline (still-vacant): hmod_notify_allied still has NO row (decline does not fire it)'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-000000000051'),
  'scheduled',
  'decline (still-vacant): floater source seat RESTORED to scheduled (§6.6 #7)'
);

SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-000000000051'),
  'e0000508-0000-0000-0000-000000000001'::uuid,
  'decline (still-vacant): restored source seat belongs to the original floater'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-0000000000c1'),
  0,
  'decline (still-vacant): the redundant source-side compensation gap row is deleted'
);

SELECT is(
  (SELECT count(*)::integer FROM public.float_exclusions
   WHERE user_id = 'e0000508-0000-0000-0000-000000000001'
     AND reason = 'declined' AND destination_house_id = 'house-03'),
  1,
  'decline (still-vacant): a declined exclusion is recorded for the gap window'
);

-- ============================================================
-- D. DECLINE with the source-side gap CLAIMED -> DISPLACE (§6.6 #7).
-- ============================================================

SELECT is(
  (SELECT (public.decline_float(
     'c0000508-0000-0000-0000-000000000002'::uuid,
     'e0000508-0000-0000-0000-000000000002'::uuid,
     current_setting('test.p08.anchor')::timestamptz - interval '4 hours')) ->> 'declined'),
  'true',
  'decline (claimed): decline_float returns declined=true'
);

SELECT is(
  (SELECT status::text FROM public.float_assignments WHERE float_id = 'c0000508-0000-0000-0000-000000000002'),
  'declined',
  'decline (claimed): float -> declined'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-0000000000d2'),
  'vacant',
  'decline (claimed): destination -> vacant'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-000000000052'),
  'vacant',
  'decline (claimed): floater source seat -> vacant (displaced)'
);

SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-000000000052'),
  'displaced_decliner',
  'decline (claimed): floater source vacancy_origin -> displaced_decliner (§3.3 / §6.6 #7)'
);

SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-000000000052'),
  NULL::uuid,
  'decline (claimed): displaced source seat has no user'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-0000000000c2'),
  'claimed',
  'decline (claimed): the other worker keeps the claimed source-side slot'
);

SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-0000000000c2'),
  'e0000508-0000-0000-0000-000000000008'::uuid,
  'decline (claimed): the claimer retains the slot (not reverted to the floater)'
);

-- ============================================================
-- E. NO-TAKEBACK — the automated no-ack will NOT recall a pending
--    force-trigger before its window (§6.6 #8). float #3, block +60m,
--    scanned at anchor (60 min out) with a 15-min lookahead.
-- ============================================================

SELECT is(
  (SELECT (public.process_no_ack_float(
     'c0000508-0000-0000-0000-000000000003'::uuid,
     current_setting('test.p08.anchor')::timestamptz,
     15)) ->> 'processed'),
  'false',
  'no-takeback: no-ack outside the lookahead window does not process the float'
);

SELECT is(
  (SELECT (public.process_no_ack_float(
     'c0000508-0000-0000-0000-000000000003'::uuid,
     current_setting('test.p08.anchor')::timestamptz,
     15)) ->> 'reason'),
  'outside_lookahead',
  'no-takeback: the no-op reason is outside_lookahead'
);

SELECT is(
  (SELECT status::text FROM public.float_assignments WHERE float_id = 'c0000508-0000-0000-0000-000000000003'),
  'pending',
  'no-takeback: the pending force-trigger is NOT voided by the automated system'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-0000000000d3'),
  'pending_float_in',
  'no-takeback: the destination commitment is untouched (no automated recall)'
);

-- ============================================================
-- F. ACKNOWLEDGE then drop the floater's separate home shift —
--    the float commitment STANDS (§6.6 #8 / no-takeback). float #4.
-- ============================================================

SELECT is(
  (SELECT (public.acknowledge_float(
     'c0000508-0000-0000-0000-000000000004'::uuid,
     'e0000508-0000-0000-0000-000000000004'::uuid,
     current_setting('test.p08.anchor')::timestamptz)) ->> 'acknowledged'),
  'true',
  'ack: acknowledge_float returns acknowledged=true'
);

SELECT is(
  (SELECT status::text FROM public.float_assignments WHERE float_id = 'c0000508-0000-0000-0000-000000000004'),
  'acknowledged',
  'ack: float -> acknowledged'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-0000000000d4'),
  'floated_in',
  'ack: destination -> floated_in'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-000000000054'),
  'floated_out',
  'ack: source -> floated_out'
);

-- The floater now drops their SEPARATE home shift (block +120, not part of
-- the float). This is an independent gap and must NOT touch the float.
UPDATE public.shift_block_assignments
SET user_id = NULL, status = 'vacant', vacancy_origin = 'temporary_drop'
WHERE assignment_id = 'a0000508-0000-0000-0000-000000000055';

SELECT is(
  (SELECT status::text FROM public.float_assignments WHERE float_id = 'c0000508-0000-0000-0000-000000000004'),
  'acknowledged',
  'no-takeback: dropping the floater''s other home shift leaves the float acknowledged'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-0000000000d4'),
  'floated_in',
  'no-takeback: the floated_in destination commitment STANDS after the home drop'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000508-0000-0000-0000-000000000055'),
  'vacant',
  'no-takeback: the dropped home shift is an independent gap (its own vacancy)'
);

SELECT finish();
ROLLBACK;
