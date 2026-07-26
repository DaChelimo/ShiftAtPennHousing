-- pgTAP: the single-session half of the 2026-07-26 concurrency audit remediation
-- (migrations 20260726000009 / 000010 / 000011).
--
-- Scope note, deliberately drawn: this file covers everything the fixes made observable
-- from ONE session -- a new constraint, a new return value, and new guard predicates.
-- The findings whose fix is purely "hold a lock across two statements" (F1 drop_shift,
-- F2 accept_swap, F3's seat lock, F8's user lock) cannot be shown here, because pgTAP is
-- single-session and a lock is only observable when something else contends for it.
-- Those live in scripts/concurrency/race-harness.sh, which drives two real psql sessions
-- and asserts the actual interleaving.
--
--   A. F7 -- a worker may hold at most ONE seat of a block; the DB now rejects a second
--   B. F7 -- the constraint is scoped: vacant seats and terminal statuses are unaffected
--   C. F4 -- lock_block_coverage is a check-and-lock and ANSWERS; a staffed desk is
--            neither locked nor greenlit, and Allied counts as coverage for escalation
--            while still NOT counting as a present worker for claimability
--   D. F6 -- the source floor (invariant #2) is enforced at the write point, in BOTH
--            float writers
--   E. F5 -- a competing pending float-in blocks a second float, in BOTH float writers
--   F. F3/F7 -- admin_assign_worker never hands a worker a second seat on one block
--   G. F10 -- apply_permanent_swap leaves float-committed seats alone
--
-- Dates are 2029 (seed-free), all EST. Invariants #5 (30-min blocks), #6 (NY tz).
--
-- Run with: supabase test db  (or, against a seed-free DB: psql -f this; it BEGIN/ROLLBACKs).

BEGIN;

SELECT plan(22);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('ca000001-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca-a@test.local'),
  ('ca000001-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca-b@test.local'),
  ('ca000001-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca-c@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('ca000001-0000-4000-8000-00000000000a', 'CA A', 'ca-a@test.local', 'quad',     true),
  ('ca000001-0000-4000-8000-00000000000b', 'CA B', 'ca-b@test.local', 'quad',     true),
  ('ca000001-0000-4000-8000-00000000000c', 'CA C', 'ca-c@test.local', 'harrison', true)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  -- A/B: a headcount-2 Quad desk used for the uniqueness tests.
  ('ca000002-0000-4000-8000-000000000900', 'quad', ('2029-11-16 09:00'::timestamp AT TIME ZONE 'America/New_York'), 2),
  -- C: coverage-lock probes. 1000 empty, 1001 staffed, 1002 Allied-covered.
  ('ca000002-0000-4000-8000-000000001000', 'quad', ('2029-11-16 10:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  ('ca000002-0000-4000-8000-000000001001', 'quad', ('2029-11-16 10:30'::timestamp AT TIME ZONE 'America/New_York'), 1),
  ('ca000002-0000-4000-8000-000000001002', 'quad', ('2029-11-16 11:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- D/E: float source and destination. The source is headcount 2 but starts with only
  -- ONE worker actually on it, which is the point: the floor counts PRESENT workers, not
  -- required headcount, so floating that worker out would empty a desk that is merely
  -- under-staffed rather than closed. E then adds the second worker so it may source.
  ('ca000002-0000-4000-8000-000000002000', 'quad',     ('2029-11-16 12:00'::timestamp AT TIME ZONE 'America/New_York'), 2),
  ('ca000002-0000-4000-8000-000000002001', 'harrison', ('2029-11-16 12:00'::timestamp AT TIME ZONE 'America/New_York'), 2),
  -- F: admin assign onto a headcount-2 block the worker already occupies.
  ('ca000002-0000-4000-8000-000000003000', 'quad', ('2029-11-16 13:00'::timestamp AT TIME ZONE 'America/New_York'), 2),
  -- G: permanent-swap seat that is mid-float.
  ('ca000002-0000-4000-8000-000000004000', 'quad', ('2029-11-16 14:00'::timestamp AT TIME ZONE 'America/New_York'), 2);

INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  -- A/B: one seat held by A, one vacant.
  ('ca000003-0000-4000-8000-000000000901', 'ca000002-0000-4000-8000-000000000900', 'ca000001-0000-4000-8000-00000000000a', 'scheduled', 'none'),
  ('ca000003-0000-4000-8000-000000000902', 'ca000002-0000-4000-8000-000000000900', NULL, 'vacant', 'never_assigned'),
  -- C: 1000 all-vacant; 1001 staffed by B; 1002 covered by Allied only.
  ('ca000003-0000-4000-8000-000000001001', 'ca000002-0000-4000-8000-000000001000', NULL, 'vacant', 'temporary_drop'),
  ('ca000003-0000-4000-8000-000000001011', 'ca000002-0000-4000-8000-000000001001', 'ca000001-0000-4000-8000-00000000000b', 'scheduled', 'none'),
  ('ca000003-0000-4000-8000-000000001021', 'ca000002-0000-4000-8000-000000001002', NULL, 'allied', 'none'),
  -- D/E: source block holds ONLY worker A (floating A empties the desk); destination
  -- has one vacant seat plus a sibling already carrying a pending float-in.
  ('ca000003-0000-4000-8000-000000002001', 'ca000002-0000-4000-8000-000000002000', 'ca000001-0000-4000-8000-00000000000a', 'scheduled', 'none'),
  ('ca000003-0000-4000-8000-000000002011', 'ca000002-0000-4000-8000-000000002001', NULL, 'vacant', 'temporary_drop'),
  ('ca000003-0000-4000-8000-000000002012', 'ca000002-0000-4000-8000-000000002001', NULL, 'vacant', 'temporary_drop'),
  -- F: A already occupies one seat of the headcount-2 block; the other is vacant.
  ('ca000003-0000-4000-8000-000000003001', 'ca000002-0000-4000-8000-000000003000', 'ca000001-0000-4000-8000-00000000000a', 'scheduled', 'none'),
  ('ca000003-0000-4000-8000-000000003002', 'ca000002-0000-4000-8000-000000003000', NULL, 'vacant', 'never_assigned'),
  -- G: A's seat is mid-float-out (user_id RETAINED, which is the whole trap).
  ('ca000003-0000-4000-8000-000000004001', 'ca000002-0000-4000-8000-000000004000', 'ca000001-0000-4000-8000-00000000000a', 'pending_float_out', 'none');

-- ============================================================
-- A. F7 -- one seat per worker per block, enforced by the database.
-- ============================================================
SELECT has_index(
  'public', 'shift_block_assignments', 'shift_block_assignments_one_seat_per_worker',
  'A1: the one-seat-per-worker partial unique index exists'
);

SELECT throws_ok(
  $$UPDATE shift_block_assignments
    SET status = 'claimed', user_id = 'ca000001-0000-4000-8000-00000000000a', vacancy_origin = 'none'
    WHERE assignment_id = 'ca000003-0000-4000-8000-000000000902'$$,
  '23505',
  NULL,
  'A2: giving a worker a SECOND occupied seat on a block they already hold now raises 23505'
);

-- The same write for a DIFFERENT worker is the legitimate multi-staff case and must pass.
SELECT lives_ok(
  $$UPDATE shift_block_assignments
    SET status = 'claimed', user_id = 'ca000001-0000-4000-8000-00000000000b', vacancy_origin = 'none'
    WHERE assignment_id = 'ca000003-0000-4000-8000-000000000902'$$,
  'A3: a DIFFERENT worker on the block''s other seat is untouched by the constraint'
);

-- ============================================================
-- B. F7 -- the constraint is correctly scoped.
-- ============================================================
-- Two vacant seats on one block (user_id NULL) are the normal multi-staff shape.
SELECT lives_ok(
  $$INSERT INTO shift_block_assignments (block_id, user_id, status, vacancy_origin)
    VALUES ('ca000002-0000-4000-8000-000000001000', NULL, 'vacant', 'never_assigned')$$,
  'B1: many vacant (user_id NULL) seats per block still allowed'
);

-- A terminal/non-occupying status is history, not occupancy, so it does not collide.
SELECT lives_ok(
  $$INSERT INTO shift_block_assignments (block_id, user_id, status, vacancy_origin)
    VALUES ('ca000002-0000-4000-8000-000000000900', 'ca000001-0000-4000-8000-00000000000a', 'floated_out', 'none')$$,
  'B2: a non-occupying status (floated_out) for a worker already on the block is allowed'
);

-- ============================================================
-- C. F4 -- lock_block_coverage checks, then locks, and answers.
-- ============================================================
SELECT is(
  public.lock_block_coverage('ca000002-0000-4000-8000-000000001000', '2029-11-16 08:00'::timestamptz),
  true,
  'C1: an EMPTY desk greenlights the securing step'
);

SELECT isnt(
  (SELECT coverage_locked_at FROM shift_blocks WHERE block_id = 'ca000002-0000-4000-8000-000000001000'),
  NULL,
  'C2: ... and stamps the one-way coverage lock'
);

SELECT is(
  public.lock_block_coverage('ca000002-0000-4000-8000-000000001001', '2029-11-16 08:00'::timestamptz),
  false,
  'C3: a desk STAFFED since the tick''s scan refuses the securing step (the F4 bug)'
);

SELECT is(
  (SELECT coverage_locked_at FROM shift_blocks WHERE block_id = 'ca000002-0000-4000-8000-000000001001'),
  NULL,
  'C4: ... and is NOT stamped, so its remaining vacant seats stay pickable'
);

-- Allied is coverage for ESCALATION (stop paging for a desk Allied already holds) ...
SELECT is(
  public.lock_block_coverage('ca000002-0000-4000-8000-000000001002', '2029-11-16 08:00'::timestamptz),
  false,
  'C5: an Allied-covered desk also refuses the step (escalation present-set includes allied)'
);

-- ... but is NOT a present worker for claimability. The two present-sets stay distinct.
SELECT is(
  public.block_has_present_worker('ca000002-0000-4000-8000-000000001002'),
  false,
  'C6: allied is still NOT a present worker (§5.5 pickup-lock set stays separate)'
);

SELECT is(
  public.block_has_escalation_coverage('ca000002-0000-4000-8000-000000001002'),
  true,
  'C7: ... while the escalation set counts it'
);

-- The lock stays ONE-WAY: re-running on a now-staffed but already-locked block must not
-- clear the marker.
UPDATE shift_block_assignments
SET status = 'claimed', user_id = 'ca000001-0000-4000-8000-00000000000c', vacancy_origin = 'none'
WHERE assignment_id = 'ca000003-0000-4000-8000-000000001001';

SELECT isnt(
  (SELECT coverage_locked_at FROM shift_blocks WHERE block_id = 'ca000002-0000-4000-8000-000000001000'),
  NULL,
  'C8: a later fill never RE-OPENS an already-locked block (§5.5 one-way preserved)'
);

-- ============================================================
-- D. F6 -- source floor (invariant #2) enforced at the write point.
-- ============================================================
-- Block 2000 holds ONLY worker A, so floating A out would empty that desk.
SELECT is(
  public.process_float_lookup_assignment(
    'ca000001-0000-4000-8000-00000000000a'::uuid,
    'quad',
    ARRAY['ca000003-0000-4000-8000-000000002001']::uuid[],
    ARRAY['ca000003-0000-4000-8000-000000002011']::uuid[],
    'harrison',
    '2029-11-16 10:00'::timestamptz
  ) ->> 'reason',
  'source_floor_violated',
  'D1: the automated float refuses to empty a source desk (invariant #2, at the write point)'
);

SELECT is(
  (SELECT status::text FROM shift_block_assignments WHERE assignment_id = 'ca000003-0000-4000-8000-000000002001'),
  'scheduled',
  'D2: ... and the source worker is untouched'
);

SELECT is(
  public.force_trigger_float(
    'ca000001-0000-4000-8000-00000000000b'::uuid,
    'ca000001-0000-4000-8000-00000000000a'::uuid,
    'quad',
    ARRAY['ca000003-0000-4000-8000-000000002001']::uuid[],
    ARRAY['ca000003-0000-4000-8000-000000002011']::uuid[],
    'harrison',
    '2029-11-16 10:00'::timestamptz
  ) ->> 'reason',
  'source_floor_violated',
  'D3: the MANUAL force-trigger path enforces the same floor (both write points)'
);

-- ============================================================
-- E. F5 -- a competing pending float-in blocks a second float on the same desk.
-- ============================================================
-- Give the source desk a second worker so it may legitimately source, and put a pending
-- float-in on a SIBLING seat of the destination block.
INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES ('ca000003-0000-4000-8000-000000002002', 'ca000002-0000-4000-8000-000000002000', 'ca000001-0000-4000-8000-00000000000b', 'scheduled', 'none');

UPDATE shift_block_assignments
SET status = 'pending_float_in', user_id = 'ca000001-0000-4000-8000-00000000000c', vacancy_origin = 'none', is_float = true, source_house_id = 'harrison'
WHERE assignment_id = 'ca000003-0000-4000-8000-000000002012';

SELECT is(
  public.process_float_lookup_assignment(
    'ca000001-0000-4000-8000-00000000000a'::uuid,
    'quad',
    ARRAY['ca000003-0000-4000-8000-000000002001']::uuid[],
    ARRAY['ca000003-0000-4000-8000-000000002011']::uuid[],
    'harrison',
    '2029-11-16 10:00'::timestamptz
  ) ->> 'reason',
  'destination_has_pending_float_in',
  'E1: the automated path now refuses a desk another float is already inbound to'
);

SELECT is(
  public.force_trigger_float(
    'ca000001-0000-4000-8000-00000000000b'::uuid,
    'ca000001-0000-4000-8000-00000000000a'::uuid,
    'quad',
    ARRAY['ca000003-0000-4000-8000-000000002001']::uuid[],
    ARRAY['ca000003-0000-4000-8000-000000002011']::uuid[],
    'harrison',
    '2029-11-16 10:00'::timestamptz
  ) ->> 'reason',
  'destination_has_pending_float_in',
  'E2: ... and so does the force-trigger path, so neither can defeat the other'
);

-- ============================================================
-- F. F3/F7 -- admin_assign_worker never doubles a worker onto one block.
-- ============================================================
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('ca000001-0000-4000-8000-00000000000b', 'sm', 'quad')
ON CONFLICT DO NOTHING;

-- A already holds a seat on block 3000. Assigning A there again must be a no-op, NOT a
-- raw 23505 from the new index and NOT a second seat.
SELECT lives_ok(
  $$SELECT public.admin_assign_worker(
      'ca000001-0000-4000-8000-00000000000b'::uuid,
      ARRAY['ca000002-0000-4000-8000-000000003000']::uuid[],
      'ca000001-0000-4000-8000-00000000000a'::uuid,
      'this_week',
      true,
      '2029-11-16 08:00'::timestamptz
    )$$,
  'F1: assigning a worker to a block they already occupy does not error out'
);

SELECT is(
  (SELECT count(*)::integer FROM shift_block_assignments
    WHERE block_id = 'ca000002-0000-4000-8000-000000003000'
      AND user_id = 'ca000001-0000-4000-8000-00000000000a'
      AND status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')),
  1,
  'F2: ... and they still hold exactly ONE seat on it (invariant #5)'
);

-- ============================================================
-- G. F10 -- apply_permanent_swap leaves a float-committed seat alone.
-- ============================================================
INSERT INTO public.swap_requests (
  swap_id, initiator_user_id, counterparty_user_id, swap_type, status,
  initiator_assignment_ids, counterparty_assignment_ids, expires_at
)
VALUES (
  'ca000005-0000-4000-8000-000000000001',
  'ca000001-0000-4000-8000-00000000000a',
  'ca000001-0000-4000-8000-00000000000b',
  'permanent_swap', 'pending',
  ARRAY['ca000003-0000-4000-8000-000000004001']::uuid[],
  ARRAY[]::uuid[],
  '2029-12-01 00:00'::timestamptz
);

SELECT is(
  (public.apply_permanent_swap(
    'ca000005-0000-4000-8000-000000000001'::uuid,
    'ca000001-0000-4000-8000-00000000000b'::uuid,
    ARRAY['ca000003-0000-4000-8000-000000004001']::uuid[],
    '2029-11-16 08:00'::timestamptz
  ) ->> 'transferred_count')::integer,
  0,
  'G1: a seat in pending_float_out is NOT transferred, despite still carrying user_id'
);

SELECT is(
  (SELECT user_id FROM shift_block_assignments WHERE assignment_id = 'ca000003-0000-4000-8000-000000004001'),
  'ca000001-0000-4000-8000-00000000000a'::uuid,
  'G2: ... so float_assignments and the seat cannot disagree about who owns it'
);

SELECT * FROM finish();
ROLLBACK;
