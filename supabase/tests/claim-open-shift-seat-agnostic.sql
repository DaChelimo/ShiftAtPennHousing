-- pgTAP: claim_open_shift is seat-agnostic within a block (BSpec §5.3 FCFS).
--
-- The open feed exposes one row per vacant SEAT; the client coalesces same-span lanes of a
-- multi-staff desk into ONE "N open" card carrying a single representative lane's
-- assignment_ids. Two workers tapping Claim on that card therefore send the SAME
-- assignment_id, and the pre-fix RPC rejected the second with shift_unavailable while a
-- seat on the block was still open. The RPC now treats the id as naming the BLOCK and the
-- FEED, and claims any still-open seat of that feed (FOR UPDATE SKIP LOCKED).
--
--   A. two workers claiming the SAME id on a 3-seat block both land, on distinct seats
--   B. the requested seat is preferred when it is still open (single-lane behaviour)
--   C. a 1-seat block still rejects the second claimer (shift_unavailable)
--   D. a weekly claim drains ordinary seats first and falls back to a permanent_drop seat
--      only when none is left, and only inside the 30-day horizon (§5.1, §5.3)
--   E. guards still apply on the fallback: Harnwell training (#1), per-block time conflict
--   F. the coverage-conditional T-2h lock is unaffected (§5.4/§5.5)
--
-- Dates are 2029 (seed-free), all EST: blocks on Fri 2029-11-16, claims as of
-- 2029-11-14 09:00. No operating_calendar rows, so effective_weekly_cap falls back to its
-- 20h SOFT default and never hard-rejects. Invariants #5 (30-min blocks), #6 (NY tz).
--
-- Run with: supabase test db  (or, against a seed-free DB: psql -f this; it BEGIN/ROLLBACKs).

BEGIN;

SELECT plan(19);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('ca000001-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca-a@test.local'),
  ('ca000001-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca-b@test.local'),
  ('ca000001-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca-c@test.local'),
  ('ca000001-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ca-n@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('ca000001-0000-4000-8000-00000000000a', 'CA A', 'ca-a@test.local', 'quad',     true),
  ('ca000001-0000-4000-8000-00000000000b', 'CA B', 'ca-b@test.local', 'quad',     true),
  ('ca000001-0000-4000-8000-00000000000c', 'CA C', 'ca-c@test.local', 'quad',     true),
  ('ca000001-0000-4000-8000-00000000000d', 'CA N', 'ca-n@test.local', 'harrison', true)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount, coverage_locked_at)
VALUES
  -- A/B: quad 09:00, 3 vacant seats — the "3 open" coalesced card.
  ('ca000002-0000-4000-8000-000000000900', 'quad',     ('2029-11-16 09:00'::timestamp AT TIME ZONE 'America/New_York'), 3, NULL),
  -- C: harrison 10:00, a single seat — the genuine FCFS loser case.
  ('ca000002-0000-4000-8000-000000001000', 'harrison', ('2029-11-16 10:00'::timestamp AT TIME ZONE 'America/New_York'), 1, NULL),
  -- D: quad 11:00, one weekly-vacant seat + one permanent-opening seat.
  ('ca000002-0000-4000-8000-000000001100', 'quad',     ('2029-11-16 11:00'::timestamp AT TIME ZONE 'America/New_York'), 2, NULL),
  -- E1: harnwell 12:00, 2 vacant seats — training constraint on the fallback path.
  ('ca000002-0000-4000-8000-000000001200', 'harnwell', ('2029-11-16 12:00'::timestamp AT TIME ZONE 'America/New_York'), 2, NULL),
  -- E2: quad 13:00, C already scheduled on seat 1, 2 vacant — time conflict.
  ('ca000002-0000-4000-8000-000000001300', 'quad',     ('2029-11-16 13:00'::timestamp AT TIME ZONE 'America/New_York'), 3, NULL),
  -- F1: quad 14:00, 2 vacant seats, desk EMPTY — claimed within T-2h → locked.
  ('ca000002-0000-4000-8000-000000001400', 'quad',     ('2029-11-16 14:00'::timestamp AT TIME ZONE 'America/New_York'), 2, NULL),
  -- F2: quad 15:00, 2 vacant seats, one-way coverage lock already set.
  ('ca000002-0000-4000-8000-000000001500', 'quad',     ('2029-11-16 15:00'::timestamp AT TIME ZONE 'America/New_York'), 2,
   ('2029-11-16 13:00'::timestamp AT TIME ZONE 'America/New_York')),
  -- D4: quad 16:00, one ordinary vacant seat + one permanent opening.
  ('ca000002-0000-4000-8000-000000001600', 'quad',     ('2029-11-16 16:00'::timestamp AT TIME ZONE 'America/New_York'), 2, NULL),
  -- D5: quad 2030-01-21 (68 days after as_of), a lone permanent opening outside the
  --     30-day weekly horizon — not temporarily claimable at all.
  ('ca000002-0000-4000-8000-000000001700', 'quad',     ('2030-01-21 09:00'::timestamp AT TIME ZONE 'America/New_York'), 1, NULL);

INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  -- quad 09:00 — 3 vacant seats; ...901 is the id both clients send.
  ('ca000003-0000-4000-8000-000000000901', 'ca000002-0000-4000-8000-000000000900', NULL, 'vacant', 'never_assigned'),
  ('ca000003-0000-4000-8000-000000000902', 'ca000002-0000-4000-8000-000000000900', NULL, 'vacant', 'never_assigned'),
  ('ca000003-0000-4000-8000-000000000903', 'ca000002-0000-4000-8000-000000000900', NULL, 'vacant', 'never_assigned'),
  -- harrison 10:00 — the only seat.
  ('ca000003-0000-4000-8000-000000001000', 'ca000002-0000-4000-8000-000000001000', NULL, 'vacant', 'temporary_drop'),
  -- quad 11:00 — weekly seat (...1101) + permanent opening (...1102).
  ('ca000003-0000-4000-8000-000000001101', 'ca000002-0000-4000-8000-000000001100', NULL, 'vacant', 'temporary_drop'),
  ('ca000003-0000-4000-8000-000000001102', 'ca000002-0000-4000-8000-000000001100', NULL, 'vacant', 'permanent_drop'),
  -- harnwell 12:00 — 2 vacant seats.
  ('ca000003-0000-4000-8000-000000001201', 'ca000002-0000-4000-8000-000000001200', NULL, 'vacant', 'never_assigned'),
  ('ca000003-0000-4000-8000-000000001202', 'ca000002-0000-4000-8000-000000001200', NULL, 'vacant', 'never_assigned'),
  -- quad 13:00 — C scheduled on seat 1, 2 vacant.
  ('ca000003-0000-4000-8000-000000001301', 'ca000002-0000-4000-8000-000000001300', 'ca000001-0000-4000-8000-00000000000c', 'scheduled', 'none'),
  ('ca000003-0000-4000-8000-000000001302', 'ca000002-0000-4000-8000-000000001300', NULL, 'vacant', 'never_assigned'),
  ('ca000003-0000-4000-8000-000000001303', 'ca000002-0000-4000-8000-000000001300', NULL, 'vacant', 'never_assigned'),
  -- quad 14:00 — 2 vacant seats, nobody present.
  ('ca000003-0000-4000-8000-000000001401', 'ca000002-0000-4000-8000-000000001400', NULL, 'vacant', 'never_assigned'),
  ('ca000003-0000-4000-8000-000000001402', 'ca000002-0000-4000-8000-000000001400', NULL, 'vacant', 'never_assigned'),
  -- quad 15:00 — 2 vacant seats on a coverage-locked block.
  ('ca000003-0000-4000-8000-000000001501', 'ca000002-0000-4000-8000-000000001500', NULL, 'vacant', 'never_assigned'),
  ('ca000003-0000-4000-8000-000000001502', 'ca000002-0000-4000-8000-000000001500', NULL, 'vacant', 'never_assigned'),
  -- D4: quad 16:00 — permanent opening (...1602) + ordinary seat (...1601). The claim
  -- requests the PERMANENT id; the ordinary seat must still win.
  ('ca000003-0000-4000-8000-000000001601', 'ca000002-0000-4000-8000-000000001600', NULL, 'vacant', 'never_assigned'),
  ('ca000003-0000-4000-8000-000000001602', 'ca000002-0000-4000-8000-000000001600', NULL, 'vacant', 'permanent_drop'),
  -- D5: a lone permanent opening 66 days out — beyond the §5.1 weekly horizon.
  ('ca000003-0000-4000-8000-000000001701', 'ca000002-0000-4000-8000-000000001700', NULL, 'vacant', 'permanent_drop');

-- ============================================================
-- A. Two workers claiming the SAME representative seat id both land.
-- ============================================================
SELECT is(
  public.claim_open_shift(
    'ca000003-0000-4000-8000-000000000901'::uuid,
    'ca000001-0000-4000-8000-00000000000a'::uuid,
    ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')),
  'ca000003-0000-4000-8000-000000000901'::uuid,
  'B: a claim on a still-open seat takes exactly that seat'
);

SELECT lives_ok(
  $$ SELECT public.claim_open_shift(
       'ca000003-0000-4000-8000-000000000901'::uuid,
       'ca000001-0000-4000-8000-00000000000b'::uuid,
       ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')) $$,
  'A: a second worker sending the SAME coalesced id still gets a seat'
);

SELECT isnt(
  (SELECT assignment_id FROM public.shift_block_assignments
    WHERE block_id = 'ca000002-0000-4000-8000-000000000900'
      AND user_id = 'ca000001-0000-4000-8000-00000000000b'),
  'ca000003-0000-4000-8000-000000000901'::uuid,
  'A: the second worker landed on a DIFFERENT seat, not the requested one'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
    WHERE block_id = 'ca000002-0000-4000-8000-000000000900' AND status = 'claimed'),
  2,
  'A: the block now carries two claimed seats (both workers staffed)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
    WHERE block_id = 'ca000002-0000-4000-8000-000000000900' AND status = 'vacant'),
  1,
  'A: one of the three seats is still open (count decremented by two)'
);

-- The third worker takes the last seat; a fourth would have nothing left.
SELECT lives_ok(
  $$ SELECT public.claim_open_shift(
       'ca000003-0000-4000-8000-000000000901'::uuid,
       'ca000001-0000-4000-8000-00000000000c'::uuid,
       ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')) $$,
  'A: the third worker takes the last open seat'
);

SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'ca000003-0000-4000-8000-000000000901'::uuid,
       'ca000001-0000-4000-8000-00000000000d'::uuid,
       ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')) $$,
  'shift_unavailable',
  'A: a fourth claimer on a now-full block is rejected'
);

-- ============================================================
-- C. Single-seat block: the second claimer loses, as before.
-- ============================================================
SELECT lives_ok(
  $$ SELECT public.claim_open_shift(
       'ca000003-0000-4000-8000-000000001000'::uuid,
       'ca000001-0000-4000-8000-00000000000a'::uuid,
       ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')) $$,
  'C: the first claimer takes the only seat'
);

SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'ca000003-0000-4000-8000-000000001000'::uuid,
       'ca000001-0000-4000-8000-00000000000b'::uuid,
       ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')) $$,
  'shift_unavailable',
  'C: the second claimer on a one-seat block gets shift_unavailable'
);

-- ============================================================
-- D. Ordinary seats drain first; a permanent-opening seat is the fallback, and only
--    inside the §5.1 30-day horizon (BSpec §5.3 single-occurrence temporary claim).
-- ============================================================
SELECT is(
  public.claim_open_shift(
    'ca000003-0000-4000-8000-000000001101'::uuid,
    'ca000001-0000-4000-8000-00000000000a'::uuid,
    ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')),
  'ca000003-0000-4000-8000-000000001101'::uuid,
  'D: the ordinary weekly seat is taken first'
);

-- §5.3: "A worker may also temporarily claim a single occurrence of a permanently-dropped
-- slot that has surfaced in the weekly feed." With the ordinary seat gone, the second
-- claimer takes the permanent-opening seat for this week rather than being refused while
-- the desk still has an open seat.
SELECT is(
  public.claim_open_shift(
    'ca000003-0000-4000-8000-000000001101'::uuid,
    'ca000001-0000-4000-8000-00000000000b'::uuid,
    ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')),
  'ca000003-0000-4000-8000-000000001102'::uuid,
  'D: with no ordinary seat left, the claim falls back to the permanent-opening seat'
);

-- The occurrence leaves the permanent feed (vacancy_origin cleared) but ONLY for this
-- week; every other week of the slot keeps its permanent_drop origin.
SELECT is(
  (SELECT vacancy_origin FROM public.shift_block_assignments
    WHERE assignment_id = 'ca000003-0000-4000-8000-000000001102')::text,
  'none',
  'D: the claimed occurrence is no longer a permanent opening for that week'
);

SELECT is(
  public.claim_open_shift(
    'ca000003-0000-4000-8000-000000001602'::uuid,
    'ca000001-0000-4000-8000-00000000000c'::uuid,
    ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')),
  'ca000003-0000-4000-8000-000000001601'::uuid,
  'D: requesting the permanent seat still lands on the ordinary seat while one is open'
);

SELECT is(
  (SELECT status FROM public.shift_block_assignments
    WHERE assignment_id = 'ca000003-0000-4000-8000-000000001602')::text,
  'vacant',
  'D: the permanent opening stays whole-recurrence pickable while the block has another seat'
);

SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'ca000003-0000-4000-8000-000000001701'::uuid,
       'ca000001-0000-4000-8000-00000000000a'::uuid,
       ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')) $$,
  'shift_unavailable',
  'D: a permanent opening beyond the 30-day horizon is not temporarily claimable'
);

-- ============================================================
-- E. The guards still apply on the block-scoped path.
-- ============================================================
SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'ca000003-0000-4000-8000-000000001201'::uuid,
       'ca000001-0000-4000-8000-00000000000d'::uuid,
       ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')) $$,
  'cross_house_ineligible',
  'E: Harnwell training still blocks a non-Harnwell worker on a 2-open block (#1)'
);

SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'ca000003-0000-4000-8000-000000001302'::uuid,
       'ca000001-0000-4000-8000-00000000000c'::uuid,
       ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')) $$,
  'time_conflict',
  'E: a worker already on the block cannot take a second seat'
);

-- ============================================================
-- F. The coverage-conditional T-2h lock is unaffected (§5.4/§5.5).
-- ============================================================
SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'ca000003-0000-4000-8000-000000001401'::uuid,
       'ca000001-0000-4000-8000-00000000000a'::uuid,
       ('2029-11-16 13:00'::timestamp AT TIME ZONE 'America/New_York')) $$,
  'past_t2h_cutoff',
  'F: within T-2h with an empty desk, open seats stay locked'
);

SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'ca000003-0000-4000-8000-000000001501'::uuid,
       'ca000001-0000-4000-8000-00000000000a'::uuid,
       ('2029-11-14 09:00'::timestamp AT TIME ZONE 'America/New_York')) $$,
  'past_t2h_cutoff',
  'F: a one-way coverage-locked block refuses every seat'
);

SELECT * FROM finish();
ROLLBACK;
