-- pgTAP behavioral tests for Phase 05: Claim Open Shift
-- Spec sources: BEHAVIORAL_SPECIFICATION §5.3 (claiming, cross-house
--               matrix, T-2h cutoff, hours cap, time conflict, race
--               condition), §5.4 (T-2h boundary semantics), §9.1
--               (hours attribution), §9.3 (hard vs soft cap);
--               ARCHITECTURE §1.5 (algorithmic invariants —
--               Harnwell training constraint), §3.3 (status enum —
--               claimed status, vacancy_origin transitions).
-- Run with: supabase test db
--
-- The claim is implemented as a Postgres function that runs atomically
-- in a single transaction:
--
--   public.claim_open_shift(
--     p_assignment_id uuid,
--     p_user_id       uuid,
--     p_as_of         timestamptz
--   ) RETURNS uuid
--
-- On success: the targeted shift_block_assignments row is updated to
--   status='claimed', user_id=p_user_id, vacancy_origin='none', and
--   (for cross-house pickups) is_cross_house_pickup=true with
--   source_house_id=p_user.home_house_id. The function returns the
--   assignment_id.
--
-- On failure: the function RAISES an exception with one of these
-- SQLSTATE-coded messages:
--   'shift_unavailable'        — the row is no longer vacant (race
--                                resolution: first writer wins).
--   'past_t2h_cutoff'          — at or after T-2h relative to p_as_of.
--   'cross_house_ineligible'   — Harnwell-training rule violation.
--   'time_conflict'            — worker already has an assignment whose
--                                block overlaps the claimed block.
--   'hard_cap_exceeded'        — adding this block would push the worker
--                                over the hard cap for the calendar week.
--   'user_inactive'            — p_user_id is inactive (is_active=false).
--
-- Soft-cap claims SUCCEED at the DB layer (BEH §5.3: "permitted with a
-- warning"). The warning is a UI concern surfaced by reading the
-- worker's weekly hours before invoking claim_open_shift.
--
-- TDD-first: function does not yet exist. These tests pin observable behavior.

BEGIN;

SELECT plan(28);

-- ============================================================
-- 0. Fixture
-- Three workers:
--   W_harn  — Harnwell SW
--   W_quad  — Quad SW (cannot claim Harnwell — training rule)
--   W_inact — inactive Harnwell SW
-- A spread of blocks at Harnwell and Quad with anchored timing.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('e0000506-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p05-harn@test.local'),
  ('e0000506-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p05-quad@test.local'),
  ('e0000506-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p05-inact@test.local'),
  ('e0000506-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p05-harn2@test.local'),
  ('e0000506-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p05-cov@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('e0000506-0000-0000-0000-000000000001', 'W Harn', 'p05-harn@test.local',
   'harnwell', true),
  ('e0000506-0000-0000-0000-000000000002', 'W Quad', 'p05-quad@test.local',
   'quad', true),
  ('e0000506-0000-0000-0000-000000000003', 'W Inactive', 'p05-inact@test.local',
   'harnwell', false),
  ('e0000506-0000-0000-0000-000000000004', 'W Harn 2', 'p05-harn2@test.local',
   'harnwell', true),
  ('e0000506-0000-0000-0000-000000000005', 'W Cov', 'p05-cov@test.local',
   'harnwell', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('e0000506-0000-0000-0000-000000000001', 'sw', NULL),
  ('e0000506-0000-0000-0000-000000000002', 'sw', NULL),
  ('e0000506-0000-0000-0000-000000000003', 'sw', NULL),
  ('e0000506-0000-0000-0000-000000000004', 'sw', NULL),
  ('e0000506-0000-0000-0000-000000000005', 'sw', NULL);

-- Anchor for relative timing: hour-aligned NY timestamp 30 days from now().
-- The 30-day forward offset keeps every fixture block in the future relative
-- to real wall-clock time, so behavior that branches on "future vs past"
-- (T-2h cutoff, claimable check) doesn't depend on machine clock drift.
-- Anchor as_of to a Monday 09:00 ~75 days out. (Was 30 days; moved 2026-07-26.) The
-- seeded real-Harnwell schedule runs to 2026-09-07, and a 30-day anchor put these
-- Harnwell fixtures inside it, so every insert hit
-- shift_blocks_house_id_block_start_at_key and the whole file aborted before a single
-- assertion ran. 75 days clears the seeded range. The cap fixture (§9) inserts 80
-- consecutive 30-min blocks (40h) starting in the as_of+7d week; anchoring to a
-- Monday guarantees they all fall inside one Mon..Sun calendar week, so the
-- per-week hard-cap check is exercised deterministically (was flaky when as_of
-- landed late in a week and the 40h straddled the week boundary).
SELECT set_config(
  'test.phase05c.as_of',
  ((date_trunc('week', (now() AT TIME ZONE 'America/New_York') + interval '75 days')
    + interval '9 hours') AT TIME ZONE 'America/New_York')::text,
  false
);

-- Blocks:
--   H_safe_mon : harnwell, 5 days out (Monday window — easy to claim)
--   H_far_mon  : harnwell, 7 days out (different block, used for hours cap fixture)
--   H_t2h_eq   : harnwell, exactly +2h (boundary — unclaimable)
--   H_t3h      : harnwell, +3h (claimable)
--   H_conflict : harnwell, 5 days out at SAME time-of-day as H_safe_mon
--                but different block — actually we use a Quad block to test
--                cross-house time conflict.
--   Q_safe     : quad, 5 days out
--   Q_overlap  : quad, identical block_start_at to H_safe_mon (time conflict
--                exercise for cross-house claim by a Harnwell worker who
--                holds a scheduled Harnwell shift at that moment)

INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000506-0000-0000-0000-000000000001', 'harnwell',
   (current_setting('test.phase05c.as_of')::timestamptz + interval '5 days'), 2),
  ('f0000506-0000-0000-0000-000000000002', 'harnwell',
   (current_setting('test.phase05c.as_of')::timestamptz + interval '7 days'), 2),
  ('f0000506-0000-0000-0000-000000000003', 'harnwell',
   (current_setting('test.phase05c.as_of')::timestamptz + interval '2 hours'), 2),
  ('f0000506-0000-0000-0000-000000000004', 'harnwell',
   (current_setting('test.phase05c.as_of')::timestamptz + interval '3 hours'), 2),
  ('f0000506-0000-0000-0000-000000000005', 'quad',
   (current_setting('test.phase05c.as_of')::timestamptz + interval '6 days'), 3),
  ('f0000506-0000-0000-0000-000000000006', 'quad',
   (current_setting('test.phase05c.as_of')::timestamptz + interval '5 days'), 3);

-- Vacant assignments for each block. Use deterministic assignment_ids.
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('a0000506-0000-0000-0000-000000000001',
   'f0000506-0000-0000-0000-000000000001', NULL, 'vacant', 'temporary_drop'),
  ('a0000506-0000-0000-0000-000000000002',
   'f0000506-0000-0000-0000-000000000002', NULL, 'vacant', 'temporary_drop'),
  ('a0000506-0000-0000-0000-000000000003',
   'f0000506-0000-0000-0000-000000000003', NULL, 'vacant', 'temporary_drop'),
  ('a0000506-0000-0000-0000-000000000004',
   'f0000506-0000-0000-0000-000000000004', NULL, 'vacant', 'temporary_drop'),
  ('a0000506-0000-0000-0000-000000000005',
   'f0000506-0000-0000-0000-000000000005', NULL, 'vacant', 'temporary_drop'),
  ('a0000506-0000-0000-0000-000000000006',
   'f0000506-0000-0000-0000-000000000006', NULL, 'vacant', 'temporary_drop');

-- Coverage-conditional fixture (BEH §5.4/§5.5): two double-staffed Harnwell
-- blocks within T-2h, each with one vacant seat AND one scheduled sibling
-- (W_harn) — the desk is still covered.
--   D_covered (+1h)  : claimable within T-2h because a real worker remains on.
--   D_locked  (+1h30): same, but one-way coverage-locked → unpickable.
INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000506-0000-0000-0000-0000000000d1', 'harnwell',
   (current_setting('test.phase05c.as_of')::timestamptz + interval '1 hour'), 2),
  ('f0000506-0000-0000-0000-0000000000d2', 'harnwell',
   (current_setting('test.phase05c.as_of')::timestamptz + interval '90 minutes'), 2);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('a0000506-0000-0000-0000-0000000000d1',  -- D_covered vacant seat
   'f0000506-0000-0000-0000-0000000000d1', NULL, 'vacant', 'temporary_drop'),
  ('a0000506-0000-0000-0000-0000000000e1',  -- D_covered sibling (scheduled, W_harn)
   'f0000506-0000-0000-0000-0000000000d1',
   'e0000506-0000-0000-0000-000000000001', 'scheduled', 'none'),
  ('a0000506-0000-0000-0000-0000000000d2',  -- D_locked vacant seat
   'f0000506-0000-0000-0000-0000000000d2', NULL, 'vacant', 'temporary_drop'),
  ('a0000506-0000-0000-0000-0000000000e2',  -- D_locked sibling (scheduled, W_harn)
   'f0000506-0000-0000-0000-0000000000d2',
   'e0000506-0000-0000-0000-000000000001', 'scheduled', 'none');

-- ============================================================
-- 1. Function existence
-- ============================================================

SELECT has_function(
  'public', 'claim_open_shift', ARRAY['uuid', 'uuid', 'timestamptz'],
  'claim_open_shift(uuid, uuid, timestamptz) function exists'
);

-- ============================================================
-- 2. Successful in-house claim
-- W_harn claims H_safe_mon (5 days out, Harnwell). The row becomes
-- status='claimed', user_id=W_harn, vacancy_origin='none'.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-000000000001'::uuid,
       'e0000506-0000-0000-0000-000000000001'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz) $$,
  'in-house claim by an eligible Harnwell SW succeeds'
);

SELECT is(
  (SELECT status FROM public.shift_block_assignments
    WHERE assignment_id = 'a0000506-0000-0000-0000-000000000001')::text,
  'claimed',
  'after claim, status flipped to claimed'
);

SELECT is(
  (SELECT user_id FROM public.shift_block_assignments
    WHERE assignment_id = 'a0000506-0000-0000-0000-000000000001'),
  'e0000506-0000-0000-0000-000000000001'::uuid,
  'after claim, user_id populated with claimer'
);

SELECT is(
  (SELECT vacancy_origin FROM public.shift_block_assignments
    WHERE assignment_id = 'a0000506-0000-0000-0000-000000000001')::text,
  'none',
  'after claim, vacancy_origin reset to none'
);

SELECT is(
  (SELECT is_cross_house_pickup FROM public.shift_block_assignments
    WHERE assignment_id = 'a0000506-0000-0000-0000-000000000001'),
  false,
  'in-house claim has is_cross_house_pickup=false'
);

SELECT is(
  (SELECT source_house_id FROM public.shift_block_assignments
    WHERE assignment_id = 'a0000506-0000-0000-0000-000000000001'),
  NULL::text,
  'in-house claim leaves source_house_id NULL'
);

-- ============================================================
-- 3. Successful cross-house claim (Quad worker → Quad shift is in-house;
-- Harnwell worker → Quad shift is cross-house)
-- W_harn claims Q_safe (6 days out, Quad). Harnwell→Quad is allowed.
-- The row becomes claimed with is_cross_house_pickup=true,
-- source_house_id='harnwell'.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-000000000005'::uuid,
       'e0000506-0000-0000-0000-000000000001'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz) $$,
  'cross-house claim (Harnwell SW → Quad shift) succeeds'
);

SELECT is(
  (SELECT is_cross_house_pickup FROM public.shift_block_assignments
    WHERE assignment_id = 'a0000506-0000-0000-0000-000000000005'),
  true,
  'cross-house claim has is_cross_house_pickup=true'
);

SELECT is(
  (SELECT source_house_id FROM public.shift_block_assignments
    WHERE assignment_id = 'a0000506-0000-0000-0000-000000000005'),
  'harnwell',
  'cross-house claim populates source_house_id with worker''s home house'
);

-- ============================================================
-- 4. Cross-house ineligibility: Quad worker claiming Harnwell rejected
-- (BEH §5.3, ARCH §1.5 Harnwell training constraint).
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-000000000002'::uuid,
       'e0000506-0000-0000-0000-000000000002'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz) $$,
  NULL,  -- SQLSTATE not pinned; implementer may choose any code class
  'cross_house_ineligible',
  'Quad worker claiming Harnwell shift is rejected with cross_house_ineligible'
);

-- The row remains vacant after a rejected claim.
SELECT is(
  (SELECT status FROM public.shift_block_assignments
    WHERE assignment_id = 'a0000506-0000-0000-0000-000000000002')::text,
  'vacant',
  'rejected cross-house claim leaves the row in vacant status'
);

-- ============================================================
-- 5. T-2h cutoff (BEH §5.4): claim at exactly T-2h boundary fails;
-- claim strictly before T-2h succeeds. The block H_t2h_eq starts at
-- exactly as_of + 2h, so a claim at as_of fails. The block H_t3h starts
-- at as_of + 3h, so a claim at as_of succeeds.
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-000000000003'::uuid,
       'e0000506-0000-0000-0000-000000000001'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz) $$,
  NULL,
  'past_t2h_cutoff',
  'claim at exactly T-2h boundary rejected with past_t2h_cutoff'
);

-- Strictly before T-2h: 1 second before the boundary.
SELECT lives_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-000000000003'::uuid,
       'e0000506-0000-0000-0000-000000000004'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz - interval '1 second') $$,
  'claim 1 second before T-2h boundary succeeds (W_harn2 takes the seat)'
);

-- ============================================================
-- 6. Race condition: shift_unavailable (BEH §5.3)
-- The H_t3h block was already claimed in test §5 above by W_harn2. A
-- second claim attempt on the same assignment must fail with
-- shift_unavailable.
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-000000000003'::uuid,
       'e0000506-0000-0000-0000-000000000001'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz - interval '5 seconds') $$,
  NULL,
  'shift_unavailable',
  'second claim attempt on an already-claimed assignment fails with shift_unavailable'
);

-- The row's user_id is still W_harn2 (the first claimer), not overwritten.
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments
    WHERE assignment_id = 'a0000506-0000-0000-0000-000000000003'),
  'e0000506-0000-0000-0000-000000000004'::uuid,
  'after failed second claim, user_id remains the first claimer'
);

-- ============================================================
-- 7. Inactive worker rejected (ARCH §3.1 is_active invariant)
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-000000000002'::uuid,
       'e0000506-0000-0000-0000-000000000003'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz) $$,
  NULL,
  'user_inactive',
  'inactive worker claim is rejected with user_inactive'
);

-- ============================================================
-- 8. Time conflict (BEH §5.3 — "claimed blocks must not overlap any
-- block the worker is already assigned to that week, at any house").
-- W_harn already holds Q_safe (claimed above in §3). Q_overlap is a
-- DIFFERENT block at Quad starting at the SAME timestamp as H_safe_mon
-- (which W_harn also holds, claimed in §2). Attempting to claim
-- Q_overlap by W_harn must fail with time_conflict.
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-000000000006'::uuid,
       'e0000506-0000-0000-0000-000000000001'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz) $$,
  NULL,
  'time_conflict',
  'claim blocked when worker already has an overlapping assignment that week'
);

-- ============================================================
-- 9. Hard cap enforcement (BEH §5.3, §9.3)
-- Build up W_harn's weekly hours to 40h (80 blocks) within the calendar
-- week containing H_far_mon (= as_of + 7 days = Mon 2026-06-08). Then
-- attempt to claim H_far_mon — must reject with hard_cap_exceeded.
--
-- Hard-cap enforcement requires cap_enforcement='hard' for the week
-- (TEST_PLAN decision #4 — DB raises hard_cap_exceeded ONLY when
-- enforcement='hard' AND projected > cap). The default operating
-- profile is soft 20h, so we install a weekly_cap_overrides row for
-- the target week to switch it to hard 40h.
--
-- H_safe_mon (+5d Sat) and Q_safe (+6d Sun) sit in the as_of week, not
-- the +7d week, so they do not contribute to the target-week budget.
-- We insert exactly 80 Quad assignments in the +7d week, leaving
-- H_far_mon's slot (at v_week + 0 min) untouched so it remains the
-- target. Use offsets v_week + (i+1)*30min for i=0..79 — distinct from
-- H_far_mon's exact start time.
-- ============================================================

INSERT INTO public.weekly_cap_overrides
  (week_start_date, hours_cap, cap_enforcement)
VALUES (
  date_trunc(
    'week',
    ((current_setting('test.phase05c.as_of')::timestamptz + interval '7 days')
      AT TIME ZONE 'America/New_York')
  )::date,
  40,
  'hard'
);

DO $$
DECLARE
  v_anchor  timestamptz := (current_setting('test.phase05c.as_of')::timestamptz);
  v_week    timestamptz := v_anchor + interval '7 days';   -- 2026-06-08, Monday
  v_blkid   uuid;
  v_aid     uuid;
  v_i       int;
BEGIN
  FOR v_i IN 0..79 LOOP
    v_blkid := gen_random_uuid();
    INSERT INTO public.shift_blocks
      (block_id, house_id, block_start_at, required_headcount)
    VALUES (v_blkid, 'quad',
            v_week + ((v_i + 1) * interval '30 minutes'),
            3);
    v_aid := gen_random_uuid();
    INSERT INTO public.shift_block_assignments
      (assignment_id, block_id, user_id, status, vacancy_origin)
    VALUES (v_aid, v_blkid,
            'e0000506-0000-0000-0000-000000000001',
            'scheduled', 'none');
  END LOOP;
END $$;

-- Sanity: confirm we have exactly 80 W_harn assignments in the +7d week.
SELECT is(
  (SELECT count(*)
     FROM public.shift_block_assignments a
     JOIN public.shift_blocks b USING (block_id)
    WHERE a.user_id = 'e0000506-0000-0000-0000-000000000001'
      AND a.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
      AND b.block_start_at >= (current_setting('test.phase05c.as_of')::timestamptz + interval '7 days')
      AND b.block_start_at <  (current_setting('test.phase05c.as_of')::timestamptz + interval '14 days'))::integer,
  80,
  'fixture: W_harn holds 80 assignments (40h) in the week of H_far_mon'
);

SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-000000000002'::uuid,
       'e0000506-0000-0000-0000-000000000001'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz) $$,
  NULL,
  'hard_cap_exceeded',
  'claim that would push worker past 40h in target week rejected with hard_cap_exceeded'
);

-- The hard-cap rejection MUST be cap-week-scoped, not lifetime. A
-- different worker (W_harn2) in a totally different week can still claim
-- any block. (Already exercised in §5.)

-- ============================================================
-- 10. Hours-cap weekly window (BEH §9.2 — Mon 00:00 → Sun 23:59)
-- Pre-existing assignments in OTHER weeks do not count toward the target
-- week's cap. We confirm this by having W_harn2 successfully claim
-- another vacant assignment — they hold the H_t3h block from §5 (one
-- block in the as_of week) — totally unrelated to the +7d week budget.
--
-- We need a fresh block in the as_of week to confirm W_harn2 can still
-- claim it (no spurious cap rejection). Use the H_far_mon block again
-- — no, it's already in vacant in the +7d week. Use H_t2h_eq from §0?
-- It's vacant but post-T2h. Skip — instead create a fresh block at
-- as_of + 4 days.
-- ============================================================

INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000506-0000-0000-0000-00000000000a', 'harnwell',
   (current_setting('test.phase05c.as_of')::timestamptz + interval '4 days'), 2);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('a0000506-0000-0000-0000-00000000000a',
   'f0000506-0000-0000-0000-00000000000a', NULL, 'vacant', 'temporary_drop');

SELECT lives_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-00000000000a'::uuid,
       'e0000506-0000-0000-0000-000000000004'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz) $$,
  'W_harn2 (with 1 block in as_of week) claims a 2nd as_of-week block — cap check is week-scoped, not lifetime'
);

-- ============================================================
-- 11. Soft-cap NOT enforced at DB layer (BEH §5.3 / §9.3 — "Claiming
-- over the 20-hour regular school year cap is permitted with a warning")
-- The DB function MUST NOT reject a claim solely because the worker is
-- over the soft cap; the warning is surfaced by reading current hours
-- BEFORE invoking the claim. To test this, we observe that no soft-cap
-- enforcement path exists — equivalently, a claim that would carry the
-- worker from 20h to 20.5h (which would be the soft-cap warning case)
-- succeeds when the operating profile's cap_enforcement is 'soft'.
--
-- The claim function should look up the week's effective cap and
-- enforcement from operating_profiles + weekly_cap_overrides; if
-- enforcement is 'soft', the DB does not block. We exercise this by
-- relying on the default regular_school_year profile (soft 20h) and
-- showing that W_harn2 successfully claims their 41st block of the
-- as_of week (taking them well past the 20h soft cap).
--
-- We've claimed 2 blocks for W_harn2 already (H_t3h at §5, and the +4d
-- block in §10). Generate 39 more to push to 41 in the as_of week, then
-- claim one more.
-- ============================================================

DO $$
DECLARE
  v_anchor  timestamptz := (current_setting('test.phase05c.as_of')::timestamptz);
  v_blkid   uuid;
  v_aid     uuid;
  v_i       int;
  v_start   timestamptz;
BEGIN
  -- as_of is Mon 2026-06-01 12:00 — week Mon 2026-06-01 → Sun 2026-06-07.
  -- Start from Tuesday 00:00 to avoid colliding with as_of+2h, +3h, +4d.
  -- Generate at distinct timestamps across the week; we just need 39
  -- valid 30-min boundaries that don't collide with existing blocks.
  FOR v_i IN 0..38 LOOP
    v_start := v_anchor + interval '1 day'   -- Tue 2026-06-02 12:00 NY...
               + (v_i * interval '30 minutes');
    -- ...but the constraint is wall-clock-minute = 0 or 30 NY. v_anchor
    -- is on a half-hour boundary, and we add 30-min increments, so each
    -- generated timestamp is aligned.
    v_blkid := gen_random_uuid();
    INSERT INTO public.shift_blocks
      (block_id, house_id, block_start_at, required_headcount)
    VALUES (v_blkid, 'quad', v_start, 3);
    v_aid := gen_random_uuid();
    INSERT INTO public.shift_block_assignments
      (assignment_id, block_id, user_id, status, vacancy_origin)
    VALUES (v_aid, v_blkid,
            'e0000506-0000-0000-0000-000000000004',
            'scheduled', 'none');
  END LOOP;
END $$;

SELECT cmp_ok(
  (SELECT count(*)
     FROM public.shift_block_assignments a
     JOIN public.shift_blocks b USING (block_id)
    WHERE a.user_id = 'e0000506-0000-0000-0000-000000000004'
      AND a.status IN ('scheduled', 'claimed')
      AND b.block_start_at >= (current_setting('test.phase05c.as_of')::timestamptz - interval '5 days')
      AND b.block_start_at <  (current_setting('test.phase05c.as_of')::timestamptz + interval '7 days'))::integer,
  '>=',
  40,
  'fixture: W_harn2 now has at least 40 assignments in the as_of week (= 20h soft cap reached)'
);

-- Claim one more in the same week — soft cap path → DB allows.
INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000506-0000-0000-0000-00000000000b', 'harnwell',
   (current_setting('test.phase05c.as_of')::timestamptz + interval '5 days' + interval '6 hours'), 2);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('a0000506-0000-0000-0000-00000000000b',
   'f0000506-0000-0000-0000-00000000000b', NULL, 'vacant', 'temporary_drop');

SELECT lives_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-00000000000b'::uuid,
       'e0000506-0000-0000-0000-000000000004'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz) $$,
  'soft-cap-exceeded claim succeeds at DB layer (BEH §5.3 — warning is UI-only)'
);

-- ============================================================
-- 12. Atomicity: a claim that rejects mid-stream leaves no partial
-- state behind. After a failed claim (e.g., time_conflict), the vacant
-- row's columns are unchanged.
-- ============================================================

-- Re-use Q_overlap's still-vacant row to assert atomicity. After §8's
-- rejected claim, the row's status remains 'vacant' with user_id NULL.
SELECT is(
  (SELECT status FROM public.shift_block_assignments
    WHERE assignment_id = 'a0000506-0000-0000-0000-000000000006')::text,
  'vacant',
  'atomicity: status unchanged after rejected time_conflict claim'
);

SELECT is(
  (SELECT user_id FROM public.shift_block_assignments
    WHERE assignment_id = 'a0000506-0000-0000-0000-000000000006'),
  NULL::uuid,
  'atomicity: user_id unchanged after rejected time_conflict claim'
);

-- ============================================================
-- 13. Drop-then-reclaim by the same worker (BEH §5.2 — "A worker who
-- has dropped a shift may reclaim it themselves, provided no other
-- worker has claimed it in the interim.")
-- ============================================================

-- Drop W_harn's H_safe_mon assignment (simulate by flipping back to
-- vacant/temporary_drop). The claim API must accept a re-claim from the
-- same worker.
UPDATE public.shift_block_assignments
   SET status = 'vacant',
       vacancy_origin = 'temporary_drop',
       user_id = NULL
 WHERE assignment_id = 'a0000506-0000-0000-0000-000000000001';

SELECT lives_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-000000000001'::uuid,
       'e0000506-0000-0000-0000-000000000001'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz) $$,
  'a worker may reclaim a shift they themselves dropped (BEH §5.2)'
);

-- ============================================================
-- 14. Coverage-conditional T-2h lock at claim time (BEH §5.4/§5.5)
-- D_covered (+1h) is inside T-2h but double-staffed, so a fresh worker
-- (W_cov) can still claim its vacant seat. D_locked (+1h30) is identical
-- but one-way coverage-locked → the claim is rejected (the secured window
-- never re-opens, even though a sibling is present).
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-0000000000d1'::uuid,
       'e0000506-0000-0000-0000-000000000005'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz) $$,
  'claim within T-2h on a STILL-STAFFED desk succeeds (coverage-conditional, §5.4)'
);

SELECT public.lock_block_coverage(
  'f0000506-0000-0000-0000-0000000000d2'::uuid,
  (current_setting('test.phase05c.as_of')::timestamptz));

SELECT throws_ok(
  $$ SELECT public.claim_open_shift(
       'a0000506-0000-0000-0000-0000000000d2'::uuid,
       'e0000506-0000-0000-0000-000000000005'::uuid,
       current_setting('test.phase05c.as_of')::timestamptz) $$,
  NULL,
  'past_t2h_cutoff',
  'claim on a coverage-locked block is rejected even while a sibling worker is present (one-way §5.5)'
);

SELECT finish();
ROLLBACK;
