-- pgTAP tests for Batch F (F2): acknowledge_float / decline_float RPCs.
-- Spec: BEHAVIORAL_SPECIFICATION §7 (acknowledgment), §6.6 #7 (decline resumes
-- the escalation chain). Created in 20260528000014.

BEGIN;

SELECT plan(15);

-- ---- fixture ----
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('e0000514-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07ad-worker@test.local'),
  ('e0000514-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07ad-other@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('e0000514-0000-0000-0000-000000000001', 'AD Worker', 'p07ad-worker@test.local', 'harnwell', true),
  ('e0000514-0000-0000-0000-000000000002', 'AD Other',  'p07ad-other@test.local',  'harnwell', true);

SELECT set_config('test.p07ad.anchor',
  ((date_trunc('hour', now() AT TIME ZONE 'America/New_York') + interval '30 days')
    AT TIME ZONE 'America/New_York')::text, false);

-- Blocks: destination (lower-quad) + source (harnwell) for ACK and for DECLINE.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000514-0000-0000-0000-0000000000d1', 'lower-quad',
   current_setting('test.p07ad.anchor')::timestamptz, 1),
  ('f0000514-0000-0000-0000-000000000051', 'harnwell',
   current_setting('test.p07ad.anchor')::timestamptz, 1),
  ('f0000514-0000-0000-0000-0000000000d2', 'lower-quad',
   current_setting('test.p07ad.anchor')::timestamptz + interval '30 minutes', 1),
  ('f0000514-0000-0000-0000-000000000052', 'harnwell',
   current_setting('test.p07ad.anchor')::timestamptz + interval '30 minutes', 1);

-- Pending-float rows (mirrors process_float_lookup_assignment output).
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id, parent_float_id)
VALUES
  ('a0000514-0000-0000-0000-0000000000d1', 'f0000514-0000-0000-0000-0000000000d1',
   'e0000514-0000-0000-0000-000000000001', 'pending_float_in', 'none', true, 'harnwell',
   'c0000514-0000-0000-0000-00000000fa01'),
  ('a0000514-0000-0000-0000-000000000051', 'f0000514-0000-0000-0000-000000000051',
   'e0000514-0000-0000-0000-000000000001', 'pending_float_out', 'none', false, NULL,
   'c0000514-0000-0000-0000-00000000fa01'),
  ('a0000514-0000-0000-0000-0000000000d2', 'f0000514-0000-0000-0000-0000000000d2',
   'e0000514-0000-0000-0000-000000000001', 'pending_float_in', 'none', true, 'harnwell',
   'c0000514-0000-0000-0000-00000000fa02'),
  ('a0000514-0000-0000-0000-000000000052', 'f0000514-0000-0000-0000-000000000052',
   'e0000514-0000-0000-0000-000000000001', 'pending_float_out', 'none', false, NULL,
   'c0000514-0000-0000-0000-00000000fa02');

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids, status,
   initiated_by, expires_for_cleanup_at)
VALUES
  ('c0000514-0000-0000-0000-00000000fa01', 'e0000514-0000-0000-0000-000000000001',
   ARRAY['a0000514-0000-0000-0000-000000000051']::uuid[],
   ARRAY['a0000514-0000-0000-0000-0000000000d1']::uuid[],
   'pending', 'automated', current_setting('test.p07ad.anchor')::timestamptz + interval '14 days'),
  ('c0000514-0000-0000-0000-00000000fa02', 'e0000514-0000-0000-0000-000000000001',
   ARRAY['a0000514-0000-0000-0000-000000000052']::uuid[],
   ARRAY['a0000514-0000-0000-0000-0000000000d2']::uuid[],
   'pending', 'automated', current_setting('test.p07ad.anchor')::timestamptz + interval '14 days');

-- ============================================================
-- 1. acknowledge_float (float fa01)
-- ============================================================
SELECT is(
  (SELECT (public.acknowledge_float(
     'c0000514-0000-0000-0000-00000000fa01'::uuid,
     'e0000514-0000-0000-0000-000000000001'::uuid,
     current_setting('test.p07ad.anchor')::timestamptz - interval '1 hour')) ->> 'acknowledged'),
  'true', 'acknowledge_float returns acknowledged=true');

SELECT is(
  (SELECT status FROM public.float_assignments WHERE float_id = 'c0000514-0000-0000-0000-00000000fa01'),
  'acknowledged', 'float fa01 status=acknowledged');

SELECT isnt(
  (SELECT acknowledged_at FROM public.float_assignments WHERE float_id = 'c0000514-0000-0000-0000-00000000fa01'),
  NULL::timestamptz, 'float fa01 acknowledged_at set');

SELECT is(
  (SELECT status FROM public.shift_block_assignments WHERE assignment_id = 'a0000514-0000-0000-0000-0000000000d1'),
  'floated_in', 'destination -> floated_in');

SELECT is(
  (SELECT status FROM public.shift_block_assignments WHERE assignment_id = 'a0000514-0000-0000-0000-000000000051'),
  'floated_out', 'source -> floated_out');

-- Ownership: another user cannot acknowledge (already acknowledged here, so
-- a fresh ownership check on the still-pending fa02 by the wrong user).
SELECT is(
  (SELECT (public.acknowledge_float(
     'c0000514-0000-0000-0000-00000000fa02'::uuid,
     'e0000514-0000-0000-0000-000000000002'::uuid,
     current_setting('test.p07ad.anchor')::timestamptz)) ->> 'acknowledged'),
  'false', 'acknowledge by a non-owner is a no-op (not_pending)');

-- ============================================================
-- 2. decline_float (float fa02, still pending)
-- ============================================================
SELECT is(
  (SELECT (public.decline_float(
     'c0000514-0000-0000-0000-00000000fa02'::uuid,
     'e0000514-0000-0000-0000-000000000001'::uuid,
     current_setting('test.p07ad.anchor')::timestamptz - interval '1 hour')) ->> 'declined'),
  'true', 'decline_float returns declined=true');

SELECT is(
  (SELECT status FROM public.float_assignments WHERE float_id = 'c0000514-0000-0000-0000-00000000fa02'),
  'declined', 'float fa02 status=declined');

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000514-0000-0000-0000-0000000000d2'),
  'vacant', 'declined destination -> vacant');
SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000514-0000-0000-0000-0000000000d2'),
  'temporary_drop', 'declined destination -> vacancy_origin temporary_drop');
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = 'a0000514-0000-0000-0000-0000000000d2'),
  NULL::uuid, 'declined destination -> user_id NULL');
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = 'a0000514-0000-0000-0000-000000000052'),
  'scheduled', 'declined automated float restores source seat to scheduled');
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = 'a0000514-0000-0000-0000-000000000052'),
  'e0000514-0000-0000-0000-000000000001'::uuid, 'restored source seat belongs to the floater');

SELECT is(
  (SELECT count(*)::integer FROM public.float_exclusions
    WHERE user_id = 'e0000514-0000-0000-0000-000000000001'
      AND reason = 'declined'
      AND destination_house_id = 'lower-quad'),
  1, 'a declined exclusion is recorded for the gap window');

-- Re-declining an already-declined float is a no-op.
SELECT is(
  (SELECT (public.decline_float(
     'c0000514-0000-0000-0000-00000000fa02'::uuid,
     'e0000514-0000-0000-0000-000000000001'::uuid,
     current_setting('test.p07ad.anchor')::timestamptz)) ->> 'declined'),
  'false', 're-declining is a no-op (not_pending)');

SELECT finish();
ROLLBACK;
