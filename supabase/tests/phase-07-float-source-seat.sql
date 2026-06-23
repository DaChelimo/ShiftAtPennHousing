-- pgTAP behavioral tests: float-out reopens the floater's vacated HOME seat for
-- AUTOMATED floats (migration 20260623000002), and the release paths reconcile it.
--
-- Spec: BEHAVIORAL_SPECIFICATION §3.5 / §6.6 #5 (the source-side gap enters the
-- source house's open-shifts feed on float-out), §6.6 #7 (decline after the seat
-- was claimed displaces the floater; the claimer keeps it).
--
-- Before this migration, only force-triggered floats materialised the source gap;
-- the automated path (process_float_lookup_assignment) created no open row. These
-- tests pin the now-shared behaviour: the gap is created at ASSIGNMENT time, and
-- decline restores-or-displaces the floater identically for both float types.
--
-- Run with: supabase test db  (or the e2e/pgTAP harness)

BEGIN;

SELECT plan(8);

-- ============================================================
-- 0. Fixture: users + a fully-staffed (2/2) Quad source block + a vacant DuBois
--    destination. Anchored far in the future so it never collides with seeded
--    calendar blocks.
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('e0000623-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07ss-floater@test.local'),
  ('e0000623-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07ss-filler@test.local'),
  ('e0000623-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07ss-claimer@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('e0000623-0000-0000-0000-000000000001', 'Source Seat Floater', 'p07ss-floater@test.local', 'quad', true),
  ('e0000623-0000-0000-0000-000000000002', 'Source Seat Filler',  'p07ss-filler@test.local',  'quad', true),
  ('e0000623-0000-0000-0000-000000000003', 'Source Seat Claimer', 'p07ss-claimer@test.local', 'quad', true);

SELECT set_config(
  'test.p07ss.anchor',
  (date_trunc('hour', now() AT TIME ZONE 'America/New_York') + interval '500 days')
    AT TIME ZONE 'America/New_York' || '',
  false
);

-- Source: Quad block, required_headcount 2, with the floater + one filler scheduled
-- (2 present → floating the floater out leaves 1 < 2 → a gap is opened).
-- Destination: DuBois block with a single vacant seat.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000623-0000-0000-0000-000000000001', 'quad',   current_setting('test.p07ss.anchor')::timestamptz, 2),
  ('f0000623-0000-0000-0000-000000000002', 'dubois', current_setting('test.p07ss.anchor')::timestamptz, 1);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, is_cross_house_pickup, source_house_id, parent_float_id)
VALUES
  -- source block: floater + filler
  ('a0000623-0000-0000-0000-000000000001', 'f0000623-0000-0000-0000-000000000001',
   'e0000623-0000-0000-0000-000000000001', 'scheduled', 'none', false, false, NULL, NULL),
  ('a0000623-0000-0000-0000-000000000002', 'f0000623-0000-0000-0000-000000000001',
   'e0000623-0000-0000-0000-000000000002', 'scheduled', 'none', false, false, NULL, NULL),
  -- destination block: one vacant seat
  ('a0000623-0000-0000-0000-000000000003', 'f0000623-0000-0000-0000-000000000002',
   NULL, 'vacant', 'temporary_drop', false, false, NULL, NULL);

-- ============================================================
-- 1. Automated float-out OPENS the vacated source seat.
-- ============================================================
SELECT lives_ok(
  $$ SELECT public.process_float_lookup_assignment(
       'e0000623-0000-0000-0000-000000000001'::uuid, 'quad',
       ARRAY['a0000623-0000-0000-0000-000000000001']::uuid[],
       ARRAY['a0000623-0000-0000-0000-000000000003']::uuid[],
       'dubois',
       (current_setting('test.p07ss.anchor')::timestamptz - interval '2 hours'),
       14
     ) $$,
  'automated float assignment runs without error'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
   WHERE block_id = 'f0000623-0000-0000-0000-000000000001'
     AND status = 'vacant' AND vacancy_origin = 'temporary_drop'
     AND parent_float_id IS NOT NULL),
  1,
  'automated float opens exactly one vacant source-seat gap row'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000623-0000-0000-0000-000000000001'),
  'pending_float_out',
  'the floater''s own source row goes pending_float_out (still linked to the float)'
);

-- The gap row is a future vacant 'temporary_drop' seat — i.e. exactly the shape the
-- weekly open-shifts feed surfaces for pickup.
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.shift_block_assignments sba
    JOIN public.shift_blocks sb ON sb.block_id = sba.block_id
    WHERE sba.block_id = 'f0000623-0000-0000-0000-000000000001'
      AND sba.status = 'vacant' AND sba.vacancy_origin = 'temporary_drop'
      AND sba.parent_float_id IS NOT NULL
      AND sb.block_start_at > now()
  ),
  'the opened seat is a future vacant seat (claimable in the weekly open-shifts feed)'
);

-- ============================================================
-- 2. Decline while the seat is STILL UNCLAIMED → restore the floater, drop the gap.
-- ============================================================
SELECT lives_ok(
  $$ SELECT public.decline_float(
       (SELECT float_id FROM public.float_assignments
        WHERE user_id = 'e0000623-0000-0000-0000-000000000001' AND status = 'pending'),
       'e0000623-0000-0000-0000-000000000001'::uuid,
       (current_setting('test.p07ss.anchor')::timestamptz - interval '2 hours')
     ) $$,
  'decline (seat unclaimed) runs without error'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000623-0000-0000-0000-000000000001'),
  'scheduled',
  'decline while unclaimed restores the floater''s source seat to scheduled'
);

SELECT is(
  (SELECT count(*)::integer FROM public.shift_block_assignments
   WHERE block_id = 'f0000623-0000-0000-0000-000000000001'
     AND status = 'vacant' AND vacancy_origin = 'temporary_drop'),
  0,
  'decline while unclaimed removes the opened gap row (no orphan open seat)'
);

-- ============================================================
-- 3. Re-float, CLAIM the opened seat, then decline → floater displaced, claimer keeps it.
-- ============================================================
SELECT public.process_float_lookup_assignment(
  'e0000623-0000-0000-0000-000000000001'::uuid, 'quad',
  ARRAY['a0000623-0000-0000-0000-000000000001']::uuid[],
  ARRAY['a0000623-0000-0000-0000-000000000003']::uuid[],
  'dubois',
  (current_setting('test.p07ss.anchor')::timestamptz - interval '2 hours'),
  14
);

-- Another worker claims the opened seat (keeps parent_float_id, as the claim path does).
UPDATE public.shift_block_assignments
SET status = 'claimed', user_id = 'e0000623-0000-0000-0000-000000000003', vacancy_origin = 'none'
WHERE block_id = 'f0000623-0000-0000-0000-000000000001'
  AND status = 'vacant' AND vacancy_origin = 'temporary_drop';

SELECT public.decline_float(
  (SELECT float_id FROM public.float_assignments
   WHERE user_id = 'e0000623-0000-0000-0000-000000000001' AND status = 'pending'),
  'e0000623-0000-0000-0000-000000000001'::uuid,
  (current_setting('test.p07ss.anchor')::timestamptz - interval '2 hours')
);

SELECT is(
  (SELECT status::text || '/' || vacancy_origin::text FROM public.shift_block_assignments
   WHERE assignment_id = 'a0000623-0000-0000-0000-000000000001'),
  'vacant/displaced_decliner',
  'decline after the seat was claimed displaces the floater (source vacant/displaced_decliner)'
);

SELECT * FROM finish();
ROLLBACK;
