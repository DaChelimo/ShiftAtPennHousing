-- pgTAP behavioral tests for direct Allied desk assignment — migration
-- 20260805000002.
--
-- The 2026-08-05 stakeholder decision: a manager may assign the Allied contractor
-- to a desk directly, at ANY house including Harnwell, because Allied is often
-- secured by phone before any automated escalation step would fire.
--
-- This AMENDS hard invariant #1 (the Harnwell training constraint), so the tests
-- below pin both halves of the amendment: Allied gets through, and nobody else does.
--
-- Invariants pinned here (must never regress):
--   * user_is_allied_contractor is true ONLY for an account whose home house is
--     non-staffable. A normal worker, an RSM, and an unknown uuid are all false.
--   * The enforce_harnwell_assignment_training TRIGGER admits Allied on a Harnwell
--     block and still rejects a non-Harnwell-home student worker on the same block.
--   * admin_assign_worker places Allied on a Harnwell block (no
--     cross_house_not_supported) and still raises it for an ordinary cross-house
--     worker at a NON-Harnwell house, so the same-house guard survives intact.
--   * Allied is exempt from the hard weekly cap: an assignment that would exceed it
--     for a normal worker still lands for Allied.
--   * The seat Allied lands on is a normal occupied seat (status 'claimed',
--     is_cross_house_pickup false), i.e. no new state was introduced.
--   * user_is_allied_contractor is NOT executable by anon / authenticated.
--
-- Self-contained: BEGIN…ROLLBACK, own fixtures, far-future anchors so the seeded
-- Harnwell schedule cannot collide.
--
-- Run with: supabase test db  (RLS-reading pgTAP needs the CLI's role grants; see
-- supabase/AGENTS.md).

BEGIN;

SELECT plan(14);

-- ============================================================
-- Fixture. The Allied account is provisioned by the migration itself, so it is
-- asserted rather than inserted. Added here: a Harnwell HM operator, a Harnwell
-- student worker, and a Lauder student worker (the cross-house control).
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('ad000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ad-hm@test.local'),
  ('ad000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ad-hw@test.local'),
  ('ad000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ad-lauder@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('ad000000-0000-0000-0000-000000000001', 'Hana HM',   'ad-hm@test.local',     'harnwell', true),
  ('ad000000-0000-0000-0000-000000000002', 'Hal SW',    'ad-hw@test.local',     'harnwell', true),
  ('ad000000-0000-0000-0000-000000000003', 'Lena SW',   'ad-lauder@test.local', 'lauder',   true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('ad000000-0000-0000-0000-000000000001', 'hm', 'harnwell'),
  ('ad000000-0000-0000-0000-000000000002', 'sw', NULL),
  ('ad000000-0000-0000-0000-000000000003', 'sw', NULL);

-- ============================================================
-- 1–4. user_is_allied_contractor — true ONLY for the non-staffable home house.
-- ============================================================
SELECT is(
  public.user_is_allied_contractor('a111ed00-0000-4000-8000-000000000001'),
  true,
  'user_is_allied_contractor true for the Allied account (provisioned by the migration)'
);
SELECT is(
  public.user_is_allied_contractor('ad000000-0000-0000-0000-000000000002'),
  false,
  'user_is_allied_contractor false for a Harnwell student worker'
);
SELECT is(
  public.user_is_allied_contractor('ad000000-0000-0000-0000-000000000001'),
  false,
  'user_is_allied_contractor false for an HM'
);
SELECT is(
  public.user_is_allied_contractor('00000000-0000-0000-0000-0000000000ff'),
  false,
  'user_is_allied_contractor false for an unknown uuid (no row, not an error)'
);

-- ============================================================
-- Fixtures: a far-future Harnwell block and a far-future Lauder block, each with
-- one generator-shaped vacant seat, plus a published period covering them.
-- ============================================================
INSERT INTO public.scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date, preference_deadline, published_at)
VALUES
  ('ad100000-0000-0000-0000-0000000000a0', 'Allied Test Period', 'regular_school_year',
   '2099-10-05', '2099-10-06', (now() - interval '1 day'), now());

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('ad200000-0000-0000-0000-0000000000b1', 'harnwell', '2099-10-05 22:00:00 America/New_York'::timestamptz, 1),
  ('ad200000-0000-0000-0000-0000000000b2', 'harnwell', '2099-10-05 22:30:00 America/New_York'::timestamptz, 1),
  ('ad200000-0000-0000-0000-0000000000b3', 'lauder',   '2099-10-05 22:00:00 America/New_York'::timestamptz, 1);

INSERT INTO public.shift_block_assignments (block_id, status, vacancy_origin)
VALUES
  ('ad200000-0000-0000-0000-0000000000b1', 'vacant', 'never_assigned'),
  ('ad200000-0000-0000-0000-0000000000b2', 'vacant', 'never_assigned'),
  ('ad200000-0000-0000-0000-0000000000b3', 'vacant', 'never_assigned');

-- ============================================================
-- 5–6. The TRIGGER itself, exercised by a direct write (bypassing the RPC), so a
--      later change to admin_assign_worker cannot make these pass vacuously.
-- ============================================================
-- `vacancy_origin = 'none'` is REQUIRED on an occupied seat by the
-- `valid_vacancy_origin` check constraint. Leaving it at 'never_assigned' raises
-- 23514 — the SAME sqlstate the training trigger uses — which made the negative
-- test below pass for the wrong reason on the first run. Hence also the explicit
-- message match there: sqlstate alone does not identify the trigger.
SELECT lives_ok(
  $$UPDATE public.shift_block_assignments
      SET status = 'claimed', user_id = 'a111ed00-0000-4000-8000-000000000001',
          vacancy_origin = 'none'
    WHERE block_id = 'ad200000-0000-0000-0000-0000000000b2'$$,
  'Harnwell training trigger ADMITS the Allied contractor'
);

-- Reset before the negative case, so it starts from the same vacant seat.
UPDATE public.shift_block_assignments
   SET status = 'vacant', user_id = NULL, vacancy_origin = 'never_assigned'
 WHERE block_id = 'ad200000-0000-0000-0000-0000000000b2';

SELECT throws_ok(
  $$UPDATE public.shift_block_assignments
      SET status = 'claimed', user_id = 'ad000000-0000-0000-0000-000000000003',
          vacancy_origin = 'none'
    WHERE block_id = 'ad200000-0000-0000-0000-0000000000b2'$$,
  '23514',
  'non-Harnwell workers may not staff Harnwell',
  'Harnwell training trigger STILL rejects a non-Harnwell-home student worker'
);

-- Reset that seat so the RPC tests below start from a vacant Harnwell block.
UPDATE public.shift_block_assignments
   SET status = 'vacant', user_id = NULL, vacancy_origin = 'never_assigned'
 WHERE block_id = 'ad200000-0000-0000-0000-0000000000b2';

-- ============================================================
-- 7–9. admin_assign_worker — Allied lands on Harnwell as an ordinary occupied seat.
-- ============================================================
SELECT lives_ok(
  $$SELECT public.admin_assign_worker(
      'ad000000-0000-0000-0000-000000000001',
      ARRAY['ad200000-0000-0000-0000-0000000000b1']::uuid[],
      'a111ed00-0000-4000-8000-000000000001',
      'this_week',
      true,
      '2099-10-01 12:00:00 America/New_York'::timestamptz
    )$$,
  'admin_assign_worker places Allied on a HARNWELL block (no cross_house_not_supported)'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
    WHERE block_id = 'ad200000-0000-0000-0000-0000000000b1'
      AND user_id = 'a111ed00-0000-4000-8000-000000000001'),
  'claimed',
  'the Allied seat is an ordinary claimed seat, not a new state'
);

SELECT is(
  (SELECT is_cross_house_pickup FROM public.shift_block_assignments
    WHERE block_id = 'ad200000-0000-0000-0000-0000000000b1'
      AND user_id = 'a111ed00-0000-4000-8000-000000000001'),
  false,
  'the Allied seat is NOT flagged as a cross-house pickup'
);

-- ============================================================
-- 10. The same-house guard survives for everyone else. A Lauder worker on a
--     HARNWELL block would be caught by the training trigger too, so the control
--     uses a NON-Harnwell house: only the same-house guard can reject it there.
-- ============================================================
SELECT throws_ok(
  $$SELECT public.admin_assign_worker(
      'ad000000-0000-0000-0000-000000000001',
      ARRAY['ad200000-0000-0000-0000-0000000000b3']::uuid[],
      'ad000000-0000-0000-0000-000000000002',
      'this_week',
      true,
      '2099-10-01 12:00:00 America/New_York'::timestamptz
    )$$,
  'cross_house_not_supported',
  'the same-house guard STILL rejects an ordinary cross-house worker (non-Harnwell house)'
);

-- ============================================================
-- 11. Allied IS assignable to a non-Harnwell house too (it has no home desk).
-- ============================================================
SELECT lives_ok(
  $$SELECT public.admin_assign_worker(
      'ad000000-0000-0000-0000-000000000001',
      ARRAY['ad200000-0000-0000-0000-0000000000b3']::uuid[],
      'a111ed00-0000-4000-8000-000000000001',
      'this_week',
      true,
      '2099-10-01 12:00:00 America/New_York'::timestamptz
    )$$,
  'admin_assign_worker places Allied on a NON-Harnwell block as well'
);

-- ============================================================
-- 12. Hard-cap exemption. Give Allied 40h of held hours in the fixture week (well
--     past any configured hard cap), then assign one more block: a capped worker
--     would raise hard_cap_exceeded, Allied must not.
--
--     2099-10-05 is a Monday, so 80 blocks from 08:00 land inside one NY week.
--     The filler blocks go at MAYER, not lauder, so they cannot collide with the
--     lauder block already created above; the weekly cap is campus-wide, so the
--     house they sit at is irrelevant to what this asserts.
-- ============================================================
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
SELECT
  ('ad300000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
  'mayer',
  '2099-10-05 08:00:00 America/New_York'::timestamptz + (g * interval '30 minutes'),
  1
FROM generate_series(1, 80) g;

INSERT INTO public.shift_block_assignments (block_id, status, user_id, vacancy_origin)
SELECT
  ('ad300000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
  'claimed',
  'a111ed00-0000-4000-8000-000000000001',
  'none'
FROM generate_series(1, 80) g;

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES ('ad200000-0000-0000-0000-0000000000b4', 'lauder', '2099-10-06 09:00:00 America/New_York'::timestamptz, 1);
INSERT INTO public.shift_block_assignments (block_id, status, vacancy_origin)
VALUES ('ad200000-0000-0000-0000-0000000000b4', 'vacant', 'never_assigned');

-- Asserted on assigned_count, not lives_ok: a needs_confirm return would also
-- "live", and this must prove the write actually landed past the cap.
SELECT is(
  (public.admin_assign_worker(
      'ad000000-0000-0000-0000-000000000001',
      ARRAY['ad200000-0000-0000-0000-0000000000b4']::uuid[],
      'a111ed00-0000-4000-8000-000000000001',
      'this_week',
      false,
      '2099-10-01 12:00:00 America/New_York'::timestamptz
    ) ->> 'assigned_count')::integer,
  1,
  'Allied is exempt from the hard weekly cap (40h already held, one more block lands)'
);

-- ============================================================
-- 13–14. Grant hygiene: the new definer is not client-reachable.
--        has_function_privilege('public', …) alone would pass while both roles
--        still hold EXECUTE, so anon and authenticated are named explicitly.
-- ============================================================
SELECT is(
  has_function_privilege('anon', 'public.user_is_allied_contractor(uuid)', 'EXECUTE'),
  false,
  'user_is_allied_contractor is NOT executable by anon'
);
SELECT is(
  has_function_privilege('authenticated', 'public.user_is_allied_contractor(uuid)', 'EXECUTE'),
  false,
  'user_is_allied_contractor is NOT executable by authenticated'
);

SELECT * FROM finish();
ROLLBACK;
