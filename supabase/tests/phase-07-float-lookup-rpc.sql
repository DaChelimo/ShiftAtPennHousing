-- pgTAP behavioral tests for Phase 07: process_float_lookup_assignment()
-- atomic RPC (audit findings B-2 and C-3).
--
-- Spec sources:
--   ARCHITECTURE §1.3 (idempotency + atomicity invariants),
--                §3.2 (shift_block_assignments column semantics:
--                       is_float = "true if this assignment is a float-in";
--                       source_house_id populated "whenever the worker
--                       is at a non-home desk"),
--                §4.2 (chain step implementations — float_lookup),
--                §9.5 ("Float assignment (automated): insert
--                       float_assignments row, update source-side
--                       and destination-side shift_block_assignments,
--                       all in one transaction.");
--   BEHAVIORAL_SPECIFICATION §3.2 (status enum semantics).
--
-- Audit findings exercised:
--   B-2: float_lookup writes were 4 separate PostgREST calls in the
--        Edge Function. A crash between any two left partial state
--        (e.g., float row created, destination updated, source still
--        scheduled → worker double-booked). This RPC consolidates
--        them into one plpgsql transaction.
--   C-3: the source (pending_float_out) row must have is_float=false
--        and source_house_id=NULL — the source row is the worker's
--        home seat, not a non-home assignment. The previous
--        implementation set is_float=true and source_house_id=home,
--        accidentally satisfying the source_house_required_when_non_home
--        check while violating the field's semantic meaning.
--
-- Run with: supabase test db

BEGIN;

SELECT plan(19);

-- ============================================================
-- 0. Fixture: users, blocks, assignments for the assignment scenarios.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('e0000508-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07fl-floater@test.local'),
  ('e0000508-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07fl-stale-floater@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('e0000508-0000-0000-0000-000000000001', 'Float Lookup Floater',
   'p07fl-floater@test.local', 'harnwell', true),
  ('e0000508-0000-0000-0000-000000000002', 'Stale Floater',
   'p07fl-stale-floater@test.local', 'harnwell', true);

-- Anchor at a far-future moment to avoid colliding with seed-generated
-- blocks for current calendar dates.
SELECT set_config(
  'test.phase07fl.anchor',
  (
    (date_trunc('hour', now() AT TIME ZONE 'America/New_York')
     + interval '45 days') AT TIME ZONE 'America/New_York'
  )::text,
  false
);

-- Blocks:
--   +0   : scenario A (success — single floater, single block)
--   +30  : scenario B (destination no longer vacant — must skip)
--   +60  : scenario C (idempotency — second call returns claimed=false)
INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000508-0000-0000-0000-000000000001', 'harnwell',
   current_setting('test.phase07fl.anchor')::timestamptz, 3),
  ('f0000508-0000-0000-0000-000000000002', 'house-03',
   current_setting('test.phase07fl.anchor')::timestamptz, 1),
  ('f0000508-0000-0000-0000-000000000003', 'harnwell',
   current_setting('test.phase07fl.anchor')::timestamptz + interval '30 minutes', 3),
  ('f0000508-0000-0000-0000-000000000004', 'house-03',
   current_setting('test.phase07fl.anchor')::timestamptz + interval '30 minutes', 1),
  ('f0000508-0000-0000-0000-000000000005', 'harnwell',
   current_setting('test.phase07fl.anchor')::timestamptz + interval '60 minutes', 3),
  ('f0000508-0000-0000-0000-000000000006', 'house-03',
   current_setting('test.phase07fl.anchor')::timestamptz + interval '60 minutes', 1);

-- Scenario A: floater scheduled at home (harnwell), destination vacant.
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin,
   is_float, is_cross_house_pickup, source_house_id, parent_float_id)
VALUES
  ('a0000508-0000-0000-0000-000000000001',
   'f0000508-0000-0000-0000-000000000001',
   'e0000508-0000-0000-0000-000000000001',
   'scheduled', 'none', false, false, NULL, NULL),
  ('a0000508-0000-0000-0000-000000000002',
   'f0000508-0000-0000-0000-000000000002',
   NULL,
   'vacant', 'temporary_drop', false, false, NULL, NULL);

-- Scenario B: destination has been claimed already (no longer vacant).
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin,
   is_float, is_cross_house_pickup, source_house_id, parent_float_id)
VALUES
  ('a0000508-0000-0000-0000-000000000003',
   'f0000508-0000-0000-0000-000000000003',
   'e0000508-0000-0000-0000-000000000002',
   'scheduled', 'none', false, false, NULL, NULL),
  ('a0000508-0000-0000-0000-000000000004',
   'f0000508-0000-0000-0000-000000000004',
   'e0000508-0000-0000-0000-000000000001',
   'claimed', 'none', false, false, NULL, NULL);

-- Scenario C: identical to A; used for the idempotency test.
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin,
   is_float, is_cross_house_pickup, source_house_id, parent_float_id)
VALUES
  ('a0000508-0000-0000-0000-000000000005',
   'f0000508-0000-0000-0000-000000000005',
   'e0000508-0000-0000-0000-000000000001',
   'scheduled', 'none', false, false, NULL, NULL),
  ('a0000508-0000-0000-0000-000000000006',
   'f0000508-0000-0000-0000-000000000006',
   NULL,
   'vacant', 'temporary_drop', false, false, NULL, NULL);

-- ============================================================
-- 1. Function exists with the expected signature.
-- ============================================================

SELECT has_function(
  'public', 'process_float_lookup_assignment',
  ARRAY['uuid', 'text', 'uuid[]', 'uuid[]', 'text', 'timestamptz', 'integer'],
  'process_float_lookup_assignment(worker, source_house, source_ids, dest_ids, dest_house, now, retention_days) exists'
);

-- ============================================================
-- 2. Scenario A: successful assignment writes all four artifacts in
--    one transaction. We invoke the RPC and verify each artifact
--    individually — the lives_ok guarantees no rollback occurred.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.process_float_lookup_assignment(
       'e0000508-0000-0000-0000-000000000001'::uuid,                                  -- worker
       'harnwell',                                                                     -- source house
       ARRAY['a0000508-0000-0000-0000-000000000001']::uuid[],                          -- source ids
       ARRAY['a0000508-0000-0000-0000-000000000002']::uuid[],                          -- destination ids
       'house-03',                                                                     -- destination house
       (current_setting('test.phase07fl.anchor')::timestamptz - interval '2 hours'),   -- now (T-2h)
       14                                                                              -- retention days
     ) $$,
  'B-2 scenario A: process_float_lookup_assignment runs without error'
);

SELECT is(
  (SELECT count(*)::integer FROM public.float_assignments
   WHERE user_id = 'e0000508-0000-0000-0000-000000000001'
     AND 'a0000508-0000-0000-0000-000000000002'::uuid = ANY(destination_assignment_ids)),
  1,
  'B-2 scenario A: float_assignments row inserted with worker + destination id'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000508-0000-0000-0000-000000000002'),
  'pending_float_in',
  'B-2 scenario A: destination flipped to pending_float_in'
);

SELECT is(
  (SELECT user_id FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000508-0000-0000-0000-000000000002'),
  'e0000508-0000-0000-0000-000000000001'::uuid,
  'B-2 scenario A: destination row carries the floater'
);

SELECT is(
  (SELECT is_float FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000508-0000-0000-0000-000000000002'),
  true,
  'B-2 scenario A: destination is_float = true (this row IS a float-in)'
);

SELECT is(
  (SELECT source_house_id FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000508-0000-0000-0000-000000000002'),
  'harnwell',
  'B-2 scenario A: destination source_house_id = worker home'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000508-0000-0000-0000-000000000001'),
  'pending_float_out',
  'B-2 scenario A: source flipped to pending_float_out'
);

-- ============================================================
-- 3. C-3: source row attribute semantics.
--    ARCH §3.2: is_float = "true if this assignment is a float-in"
--    and source_house_id = "the worker's home_house_id" when the
--    worker is at a NON-HOME desk. The source row IS the worker's
--    home seat — so is_float MUST be false and source_house_id MUST
--    be NULL. The previous implementation set both to truthy values.
-- ============================================================

SELECT is(
  (SELECT is_float FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000508-0000-0000-0000-000000000001'),
  false,
  'C-3: source row is_float = false (home seat, NOT a float-in)'
);

SELECT is(
  (SELECT source_house_id FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000508-0000-0000-0000-000000000001'),
  NULL,
  'C-3: source row source_house_id IS NULL (home seat, no source-house reference)'
);

-- The parent_float_id is still set on the source row so the source
-- side can be reconciled later (no-ack restore or acknowledge). This
-- is independent of is_float / source_house_id.
SELECT ok(
  (SELECT parent_float_id IS NOT NULL FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000508-0000-0000-0000-000000000001'),
  'B-2 scenario A: source row parent_float_id populated (links to float for reconciliation)'
);

-- ============================================================
-- 4. Personal notification row inserted in the same transaction.
-- ============================================================

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notifications
    WHERE recipient_user_id = 'e0000508-0000-0000-0000-000000000001'
      AND type = 'personal_shift'
      AND payload ->> 'kind' = 'float_assigned'
  ),
  'B-2 scenario A: personal_shift notification inserted in the same transaction'
);

-- ============================================================
-- 5. Scenario B: destination is no longer vacant — RPC must abort
--    cleanly and write NOTHING. This protects against TOCTOU between
--    the algorithm snapshot and the writes.
-- ============================================================

SELECT is(
  (SELECT (public.process_float_lookup_assignment(
            'e0000508-0000-0000-0000-000000000002'::uuid,
            'harnwell',
            ARRAY['a0000508-0000-0000-0000-000000000003']::uuid[],
            ARRAY['a0000508-0000-0000-0000-000000000004']::uuid[],
            'house-03',
            (current_setting('test.phase07fl.anchor')::timestamptz + interval '30 minutes' - interval '2 hours'),
            14
          ) ->> 'assigned')::boolean),
  false,
  'B-2 scenario B: destination not vacant -> assigned=false'
);

SELECT is(
  (SELECT count(*)::integer FROM public.float_assignments
   WHERE user_id = 'e0000508-0000-0000-0000-000000000002'),
  0,
  'B-2 scenario B: no float_assignments row inserted when destination not vacant'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000508-0000-0000-0000-000000000003'),
  'scheduled',
  'B-2 scenario B: source row left untouched when assignment aborts'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000508-0000-0000-0000-000000000004'),
  'claimed',
  'B-2 scenario B: pre-existing claimed destination left untouched'
);

-- ============================================================
-- 6. Scenario C: idempotency — re-running on a worker+destination
--    pair that has already been assigned must NOT double-insert.
--    The first call writes; the second sees the destination is no
--    longer 'vacant' and aborts (same TOCTOU guard as scenario B).
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.process_float_lookup_assignment(
       'e0000508-0000-0000-0000-000000000001'::uuid,
       'harnwell',
       ARRAY['a0000508-0000-0000-0000-000000000005']::uuid[],
       ARRAY['a0000508-0000-0000-0000-000000000006']::uuid[],
       'house-03',
       (current_setting('test.phase07fl.anchor')::timestamptz + interval '60 minutes' - interval '2 hours'),
       14
     ) $$,
  'B-2 scenario C: first call succeeds'
);

SELECT is(
  (SELECT (public.process_float_lookup_assignment(
            'e0000508-0000-0000-0000-000000000001'::uuid,
            'harnwell',
            ARRAY['a0000508-0000-0000-0000-000000000005']::uuid[],
            ARRAY['a0000508-0000-0000-0000-000000000006']::uuid[],
            'house-03',
            (current_setting('test.phase07fl.anchor')::timestamptz + interval '60 minutes' - interval '2 hours'),
            14
          ) ->> 'assigned')::boolean),
  false,
  'B-2 scenario C: idempotent — second call returns assigned=false (destination already pending_float_in)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.float_assignments
   WHERE 'a0000508-0000-0000-0000-000000000006'::uuid = ANY(destination_assignment_ids)),
  1,
  'B-2 scenario C: exactly one float_assignments row across both calls'
);

SELECT * FROM finish();
ROLLBACK;
