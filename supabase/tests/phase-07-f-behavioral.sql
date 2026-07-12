-- pgTAP tests for Batch F behavioral fixes: drop_shift (F-05-004/005/006) and
-- the ack-cadence snapshot (F-07-008/F3). Times are relative to a controlled
-- p_as_of so the within-2h / past-block branches are deterministic.

BEGIN;

SELECT plan(11);

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('e000050f-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','f-w1@test.local'),
  ('e000050f-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','f-w2@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('e000050f-0000-0000-0000-000000000001','F W1','f-w1@test.local','harnwell',true),
  ('e000050f-0000-0000-0000-000000000002','F W2','f-w2@test.local','harnwell',true);

-- Reference moment on a 30-min boundary, 30 days out.
SELECT set_config('test.f.ref',
  (to_timestamp(floor(extract(epoch FROM (now() + interval '30 days')) / 1800) * 1800))::text, false);

-- Blocks (all harnwell, headcount 1 unless noted).
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('f000050f-0000-0000-0000-000000000001','harnwell', current_setting('test.f.ref')::timestamptz + interval '3 hours', 1),
  ('f000050f-0000-0000-0000-000000000002','harnwell', current_setting('test.f.ref')::timestamptz + interval '1 hour', 1),
  ('f000050f-0000-0000-0000-000000000003','harnwell', current_setting('test.f.ref')::timestamptz + interval '90 minutes', 1),
  ('f000050f-0000-0000-0000-000000000004','harnwell', current_setting('test.f.ref')::timestamptz - interval '1 hour', 1),
  ('f000050f-0000-0000-0000-000000000005','harnwell', current_setting('test.f.ref')::timestamptz + interval '4 hours', 1);

INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin) VALUES
  ('a000050f-0000-0000-0000-000000000001','f000050f-0000-0000-0000-000000000001','e000050f-0000-0000-0000-000000000001','scheduled','none'),
  ('a000050f-0000-0000-0000-000000000002','f000050f-0000-0000-0000-000000000002','e000050f-0000-0000-0000-000000000001','scheduled','none'),
  -- over-staffed block 3: two scheduled for headcount 1
  ('a000050f-0000-0000-0000-000000000003','f000050f-0000-0000-0000-000000000003','e000050f-0000-0000-0000-000000000001','scheduled','none'),
  ('a000050f-0000-0000-0000-000000000013','f000050f-0000-0000-0000-000000000003','e000050f-0000-0000-0000-000000000002','scheduled','none'),
  ('a000050f-0000-0000-0000-000000000004','f000050f-0000-0000-0000-000000000004','e000050f-0000-0000-0000-000000000001','scheduled','none'),
  -- a floated-out home seat (F-05-004): is_float=false, parent links a float (use a dummy)
  ('a000050f-0000-0000-0000-000000000005','f000050f-0000-0000-0000-000000000005','e000050f-0000-0000-0000-000000000001','floated_out','none');

-- 1. Far-future drop (>2h): direct_hmod=false even though below headcount.
SELECT is(
  (SELECT direct_hmod_notification FROM public.drop_shift(
     ARRAY['a000050f-0000-0000-0000-000000000001']::uuid[],
     'e000050f-0000-0000-0000-000000000001', current_setting('test.f.ref')::timestamptz)),
  false, 'drop >2h out: no direct HMOD notification');

-- 2. Within-2h drop leaving block below headcount: direct_hmod=true.
SELECT is(
  (SELECT direct_hmod_notification FROM public.drop_shift(
     ARRAY['a000050f-0000-0000-0000-000000000002']::uuid[],
     'e000050f-0000-0000-0000-000000000001', current_setting('test.f.ref')::timestamptz)),
  true, 'drop within 2h below headcount: direct HMOD (F-05-006)');

-- 3. Within-2h drop on an over-staffed block (still at headcount after): direct_hmod=false.
SELECT is(
  (SELECT direct_hmod_notification FROM public.drop_shift(
     ARRAY['a000050f-0000-0000-0000-000000000003']::uuid[],
     'e000050f-0000-0000-0000-000000000001', current_setting('test.f.ref')::timestamptz)),
  false, 'drop within 2h but still at headcount: no direct HMOD (F-05-006)');

-- 4. Past block: rejected (F-05-005).
SELECT throws_ok(
  $$ SELECT public.drop_shift(
       ARRAY['a000050f-0000-0000-0000-000000000004']::uuid[],
       'e000050f-0000-0000-0000-000000000001', current_setting('test.f.ref')::timestamptz) $$,
  'P0001', 'drop_past_block', 'dropping a past block is rejected (F-05-005)');

-- 5. A floated-out home seat is droppable (F-05-004).
SELECT lives_ok(
  $$ SELECT public.drop_shift(
       ARRAY['a000050f-0000-0000-0000-000000000005']::uuid[],
       'e000050f-0000-0000-0000-000000000001', current_setting('test.f.ref')::timestamptz) $$,
  'a floated_out home seat can be dropped (F-05-004)');

-- ============================================================
-- §5.5 Float-drop exception: a worker who is holding/covering a float may
-- drop the FLOAT DESTINATION (the inbound seat they cover), not only their
-- floated-out home seat (F-05-004, test 5). drop_shift must ALLOW it and
-- vacate the row to vacant/temporary_drop so the orchestrator re-escalates
-- the destination independently. (Escalation itself is the orchestrator's
-- job, not drop_shift's — here we assert the drop is permitted and leaves a
-- re-escalatable vacancy.)
-- ============================================================
-- Destination seats the floater covers at lower-quad (non-home), >2h out so no
-- direct-HMOD branch fires; one acknowledged (floated_in), one pending.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('f000050f-0000-0000-0000-0000000000e1','lower-quad', current_setting('test.f.ref')::timestamptz + interval '3 hours', 1),
  ('f000050f-0000-0000-0000-0000000000e2','lower-quad', current_setting('test.f.ref')::timestamptz + interval '3 hours 30 minutes', 1);

INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin) VALUES
  ('a000050f-0000-0000-0000-0000000000e1','f000050f-0000-0000-0000-0000000000e1','e000050f-0000-0000-0000-000000000001','floated_in','none'),
  ('a000050f-0000-0000-0000-0000000000e2','f000050f-0000-0000-0000-0000000000e2','e000050f-0000-0000-0000-000000000001','pending_float_in','none');

-- 6. The acknowledged float destination (floated_in) is droppable (§5.5).
SELECT lives_ok(
  $$ SELECT public.drop_shift(
       ARRAY['a000050f-0000-0000-0000-0000000000e1']::uuid[],
       'e000050f-0000-0000-0000-000000000001', current_setting('test.f.ref')::timestamptz) $$,
  'float destination (floated_in) is droppable by the covering worker (§5.5)');

-- 7. The drop leaves a re-escalatable vacancy (vacant / temporary_drop).
SELECT is(
  (SELECT status || '/' || vacancy_origin FROM public.shift_block_assignments
     WHERE assignment_id = 'a000050f-0000-0000-0000-0000000000e1'),
  'vacant/temporary_drop',
  'dropped float destination is vacated for orchestrator re-escalation (§5.5)');

-- 8. A pending (not-yet-acked) float destination (pending_float_in) is also droppable (§5.5).
SELECT lives_ok(
  $$ SELECT public.drop_shift(
       ARRAY['a000050f-0000-0000-0000-0000000000e2']::uuid[],
       'e000050f-0000-0000-0000-000000000001', current_setting('test.f.ref')::timestamptz) $$,
  'pending float destination (pending_float_in) is droppable (§5.5)');

-- ============================================================
-- F3: ack-cadence snapshot on float assignment.
-- ============================================================
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('f000050f-0000-0000-0000-0000000000d1','lower-quad', current_setting('test.f.ref')::timestamptz + interval '2 days', 1),
  ('f000050f-0000-0000-0000-0000000000c1','harnwell', current_setting('test.f.ref')::timestamptz + interval '2 days', 1);

INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin) VALUES
  ('a000050f-0000-0000-0000-0000000000d1','f000050f-0000-0000-0000-0000000000d1', NULL, 'vacant', 'temporary_drop'),
  ('a000050f-0000-0000-0000-0000000000c1','f000050f-0000-0000-0000-0000000000c1','e000050f-0000-0000-0000-000000000001','scheduled','none');

SELECT lives_ok(
  $$ SELECT public.process_float_lookup_assignment(
       'e000050f-0000-0000-0000-000000000001', 'harnwell',
       ARRAY['a000050f-0000-0000-0000-0000000000c1']::uuid[],
       ARRAY['a000050f-0000-0000-0000-0000000000d1']::uuid[],
       'lower-quad', current_setting('test.f.ref')::timestamptz) $$,
  'float lookup assignment runs');

-- All five reminders (6h/2h/1h/30m/5m before the T-10m deadline) are future
-- for a float ~2 days out, so five ack_reminder rows are snapshotted.
SELECT is(
  (SELECT count(*)::integer FROM public.notifications
    WHERE recipient_user_id = 'e000050f-0000-0000-0000-000000000001'
      AND type = 'ack_reminder'
      AND payload ->> 'kind' = 'float_ack_reminder'),
  5, 'ack-cadence snapshot writes 5 future ack_reminder rows (F3)');

-- And the float_assigned personal_shift notification exists.
SELECT is(
  (SELECT count(*)::integer FROM public.notifications
    WHERE recipient_user_id = 'e000050f-0000-0000-0000-000000000001'
      AND type = 'personal_shift'
      AND payload ->> 'kind' = 'float_assigned'),
  1, 'float assignment still notifies the floater');

SELECT finish();
ROLLBACK;
