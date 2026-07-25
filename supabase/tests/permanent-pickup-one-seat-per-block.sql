-- pgTAP: permanent_pickup_slot takes ONE seat per block (ARCH §7.2 step 6, invariant #5).
--
-- A multi-staff desk (Harnwell required_headcount 2, Quad 3) can hold SEVERAL
-- permanent-drop vacancies on the same 30-minute block: two owners of the same recurring
-- slot each permanently drop it, and permanent_drop_slot vacates one seat per owner. The
-- pre-fix pickup was a bare set-update on `block_id = ANY (...)` with no per-block LIMIT, so
-- it assigned the picker BOTH seats of that block — one worker on two seats of one block —
-- and reported assigned_count 2 for a single occurrence. Nothing else catches it: there is
-- no unique index on (block_id, user_id), and enforce_block_occupied_headcount
-- (20260614000004) only compares occupied seats to required_headcount, which two seats on a
-- headcount-2 block satisfy no matter who holds them.
--
--   A. a headcount-2 block with TWO permanent_drop seats yields exactly one seat to the
--      picker; the other stays vacant / permanent_drop (still in the permanent feed)
--   B. that leftover seat is genuinely still pickable — a second worker gets it, and the
--      block ends with two claimed seats held by two DIFFERENT workers
--   C. multi-week pickup counts occurrences, not seats (3 blocks, one of them
--      double-vacant, -> assigned_count 3)
--   D. the skipped pass also re-flags one seat per block, so a co-tenant's independent drop
--      is not retired from the permanent feed as collateral
--   E. single-seat blocks (every house but Harnwell and Quad) are unchanged
--   F. the guards still fire: Harnwell training (#1), inactive user
--
-- Dates are 2029 (seed-free), all EST. The RPC itself does no time / cap / calendar
-- resolution (the EF's evaluator partitions the weeks), so no operating_calendar or
-- scheduling_periods rows are needed. Invariants #5 (30-min blocks), #6 (NY tz).
--
-- Run with: supabase test db  (or, against a seed-free DB: psql -f this; it BEGIN/ROLLBACKs).

BEGIN;

SELECT plan(18);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('cb000001-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cb-a@test.local'),
  ('cb000001-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cb-b@test.local'),
  ('cb000001-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cb-c@test.local'),
  ('cb000001-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cb-d@test.local'),
  ('cb000001-0000-4000-8000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cb-e@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  -- A/B: two Harnwell-trained workers picking up the same Harnwell recurring slot.
  ('cb000001-0000-4000-8000-00000000000a', 'CB A', 'cb-a@test.local', 'harnwell', true),
  ('cb000001-0000-4000-8000-00000000000b', 'CB B', 'cb-b@test.local', 'harnwell', true),
  -- C/D/E: a Quad worker.
  ('cb000001-0000-4000-8000-00000000000c', 'CB C', 'cb-c@test.local', 'quad',     true),
  -- F: a non-Harnwell worker, and an inactive one.
  ('cb000001-0000-4000-8000-00000000000d', 'CB D', 'cb-d@test.local', 'harrison', true),
  ('cb000001-0000-4000-8000-00000000000e', 'CB E', 'cb-e@test.local', 'quad',     false)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  -- A/B: harnwell Fri 09:00, headcount 2, BOTH seats permanently dropped.
  ('cb000002-0000-4000-8000-000000000900', 'harnwell', ('2029-11-16 09:00'::timestamp AT TIME ZONE 'America/New_York'), 2),
  -- C: three weekly occurrences of a quad 10:00 slot; week 1 is double-vacant.
  ('cb000002-0000-4000-8000-000000001001', 'quad',     ('2029-11-16 10:00'::timestamp AT TIME ZONE 'America/New_York'), 2),
  ('cb000002-0000-4000-8000-000000001002', 'quad',     ('2029-11-23 10:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  ('cb000002-0000-4000-8000-000000001003', 'quad',     ('2029-11-30 10:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- D: quad Fri 11:00, headcount 2, both seats permanently dropped — a SKIPPED week.
  ('cb000002-0000-4000-8000-000000001100', 'quad',     ('2029-11-16 11:00'::timestamp AT TIME ZONE 'America/New_York'), 2),
  -- E: quad Fri 12:00, the ordinary single-seat desk.
  ('cb000002-0000-4000-8000-000000001200', 'quad',     ('2029-11-16 12:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- F: harnwell Fri 13:00 for the training guard.
  ('cb000002-0000-4000-8000-000000001300', 'harnwell', ('2029-11-16 13:00'::timestamp AT TIME ZONE 'America/New_York'), 2);

INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  -- A/B: two permanent_drop seats on ONE block.
  ('cb000003-0000-4000-8000-000000000901', 'cb000002-0000-4000-8000-000000000900', NULL, 'vacant', 'permanent_drop'),
  ('cb000003-0000-4000-8000-000000000902', 'cb000002-0000-4000-8000-000000000900', NULL, 'vacant', 'permanent_drop'),
  -- C: week 1 double-vacant, weeks 2 and 3 single.
  ('cb000003-0000-4000-8000-000000001011', 'cb000002-0000-4000-8000-000000001001', NULL, 'vacant', 'permanent_drop'),
  ('cb000003-0000-4000-8000-000000001012', 'cb000002-0000-4000-8000-000000001001', NULL, 'vacant', 'permanent_drop'),
  ('cb000003-0000-4000-8000-000000001021', 'cb000002-0000-4000-8000-000000001002', NULL, 'vacant', 'permanent_drop'),
  ('cb000003-0000-4000-8000-000000001031', 'cb000002-0000-4000-8000-000000001003', NULL, 'vacant', 'permanent_drop'),
  -- D: two permanent_drop seats on a block the evaluator SKIPPED.
  ('cb000003-0000-4000-8000-000000001101', 'cb000002-0000-4000-8000-000000001100', NULL, 'vacant', 'permanent_drop'),
  ('cb000003-0000-4000-8000-000000001102', 'cb000002-0000-4000-8000-000000001100', NULL, 'vacant', 'permanent_drop'),
  -- E: the single seat.
  ('cb000003-0000-4000-8000-000000001201', 'cb000002-0000-4000-8000-000000001200', NULL, 'vacant', 'permanent_drop'),
  -- F: harnwell seat the non-Harnwell worker must not reach.
  ('cb000003-0000-4000-8000-000000001301', 'cb000002-0000-4000-8000-000000001300', NULL, 'vacant', 'permanent_drop');

-- ============================================================
-- A. A headcount-2 block with two permanent_drop seats yields ONE seat.
-- ============================================================
SELECT is(
  (public.permanent_pickup_slot(
    'cb000001-0000-4000-8000-00000000000a'::uuid,
    ARRAY['cb000002-0000-4000-8000-000000000900']::uuid[],
    ARRAY[]::uuid[]
  ) ->> 'assigned_count')::integer,
  1,
  'A: a block with two permanent_drop seats reports ONE assigned occurrence'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
    WHERE block_id = 'cb000002-0000-4000-8000-000000000900'
      AND user_id = 'cb000001-0000-4000-8000-00000000000a'),
  1,
  'A: the picker holds exactly ONE seat on the block (invariant #5, no double-booking)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
    WHERE block_id = 'cb000002-0000-4000-8000-000000000900'
      AND status = 'vacant'),
  1,
  'A: the other seat is still vacant'
);

-- Count-based, not a scalar read of the row: under the pre-fix function the picker holds
-- BOTH seats, and a scalar subquery would abort the transaction instead of failing the test.
SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
    WHERE block_id = 'cb000002-0000-4000-8000-000000000900'
      AND status = 'vacant'
      AND vacancy_origin = 'permanent_drop'),
  1,
  'A: the untouched seat keeps permanent_drop — the co-tenant''s drop stays in the §5.1 feed'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
    WHERE block_id = 'cb000002-0000-4000-8000-000000000900'
      AND user_id = 'cb000001-0000-4000-8000-00000000000a'
      AND status = 'claimed'
      AND vacancy_origin = 'none'),
  1,
  'A: the picker''s single seat is claimed with the vacancy state cleared'
);

-- ============================================================
-- B. The leftover seat is still pickable by a SECOND worker.
-- ============================================================
SELECT is(
  (public.permanent_pickup_slot(
    'cb000001-0000-4000-8000-00000000000b'::uuid,
    ARRAY['cb000002-0000-4000-8000-000000000900']::uuid[],
    ARRAY[]::uuid[]
  ) ->> 'assigned_count')::integer,
  1,
  'B: the second owner''s dropped seat is picked up by a second worker'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
    WHERE block_id = 'cb000002-0000-4000-8000-000000000900'
      AND status = 'claimed'),
  2,
  'B: the headcount-2 block is now fully staffed'
);

SELECT is(
  (SELECT count(DISTINCT user_id)::integer FROM public.shift_block_assignments
    WHERE block_id = 'cb000002-0000-4000-8000-000000000900'
      AND status = 'claimed'),
  2,
  'B: by two DIFFERENT workers'
);

SELECT is(
  (public.permanent_pickup_slot(
    'cb000001-0000-4000-8000-00000000000a'::uuid,
    ARRAY['cb000002-0000-4000-8000-000000000900']::uuid[],
    ARRAY[]::uuid[]
  ) ->> 'assigned_count')::integer,
  0,
  'B: a third pickup on the full block assigns nothing (§10.9 race guard)'
);

-- ============================================================
-- C. A multi-week pickup counts OCCURRENCES, not seats.
-- ============================================================
SELECT is(
  (public.permanent_pickup_slot(
    'cb000001-0000-4000-8000-00000000000c'::uuid,
    ARRAY[
      'cb000002-0000-4000-8000-000000001001',
      'cb000002-0000-4000-8000-000000001002',
      'cb000002-0000-4000-8000-000000001003'
    ]::uuid[],
    ARRAY[]::uuid[]
  ) ->> 'assigned_count')::integer,
  3,
  'C: three weeks, one of them double-vacant -> assigned_count 3 (was 4 pre-fix)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
    WHERE block_id = 'cb000002-0000-4000-8000-000000001001'
      AND user_id = 'cb000001-0000-4000-8000-00000000000c'),
  1,
  'C: the double-vacant week gave the picker one seat, not two'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
    WHERE block_id = 'cb000002-0000-4000-8000-000000001001'
      AND status = 'vacant'
      AND vacancy_origin = 'permanent_drop'),
  1,
  'C: the double-vacant week still has one permanent opening left'
);

-- ============================================================
-- D. The skipped pass retires ONE seat per block.
-- ============================================================
SELECT is(
  (public.permanent_pickup_slot(
    'cb000001-0000-4000-8000-00000000000c'::uuid,
    ARRAY[]::uuid[],
    ARRAY['cb000002-0000-4000-8000-000000001100']::uuid[]
  ) ->> 'skipped_count')::integer,
  1,
  'D: a double-vacant skipped week reports ONE skipped occurrence'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
    WHERE block_id = 'cb000002-0000-4000-8000-000000001100'
      AND status = 'vacant'
      AND vacancy_origin = 'temporary_drop'),
  1,
  'D: exactly one seat left the permanent feed (weekly escalation takes it over)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
    WHERE block_id = 'cb000002-0000-4000-8000-000000001100'
      AND status = 'vacant'
      AND vacancy_origin = 'permanent_drop'),
  1,
  'D: the co-tenant''s drop is NOT retired as collateral — still permanently pickable'
);

-- ============================================================
-- E. Single-seat blocks are unchanged.
-- ============================================================
SELECT is(
  (public.permanent_pickup_slot(
    'cb000001-0000-4000-8000-00000000000c'::uuid,
    ARRAY['cb000002-0000-4000-8000-000000001200']::uuid[],
    ARRAY[]::uuid[]
  ) ->> 'assigned_count')::integer,
  1,
  'E: the ordinary headcount-1 desk behaves exactly as before'
);

-- ============================================================
-- F. The guards still fire.
-- ============================================================
SELECT throws_ok(
  $$ SELECT public.permanent_pickup_slot(
       'cb000001-0000-4000-8000-00000000000d'::uuid,
       ARRAY['cb000002-0000-4000-8000-000000001300']::uuid[],
       ARRAY[]::uuid[]) $$,
  'harnwell_training_required',
  'F: Harnwell training (#1) still blocks a non-Harnwell picker'
);

SELECT throws_ok(
  $$ SELECT public.permanent_pickup_slot(
       'cb000001-0000-4000-8000-00000000000e'::uuid,
       ARRAY['cb000002-0000-4000-8000-000000001200']::uuid[],
       ARRAY[]::uuid[]) $$,
  'user_inactive',
  'F: an inactive user still cannot pick up'
);

SELECT * FROM finish();
ROLLBACK;
