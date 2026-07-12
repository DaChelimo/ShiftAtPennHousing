-- pgTAP: Phase 13b — HM/BM leave submission-time cycle prevention + "I'm back".
--
-- §2.6 mandates the incoming-chain (cycle) check be re-run INSIDE the submit
-- transaction (the picker's selection-time exclusion is not enough; another HM may
-- create a leave between picker-load and submit). Also verifies the "I'm back"
-- early-return side effects (§2.6 #6): cancelled_early + cancelled_at, the in-app
-- notification to the now-released replacement, and the back-from-leave mailto.

BEGIN;

SELECT plan(11);

-- Three admins: A (hm, quad), B (bm, quad), C (hm, lower-quad). Active leave C -> A
-- puts C in A's INCOMING chain, so A selecting C as replacement closes a cycle.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('a0001313-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','leave-a@test.local'),
  ('a0001313-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','leave-b@test.local'),
  ('a0001313-0000-0000-0000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','leave-c@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('a0001313-0000-0000-0000-00000000000a','Adira HM','leave-a@test.local','quad',true),
  ('a0001313-0000-0000-0000-00000000000b','Boris BM','leave-b@test.local','quad',true),
  ('a0001313-0000-0000-0000-00000000000c','Cora HM','leave-c@test.local','lower-quad',true);

INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('a0001313-0000-0000-0000-00000000000a','hm','quad'),
  ('a0001313-0000-0000-0000-00000000000b','bm','quad'),
  ('a0001313-0000-0000-0000-00000000000c','hm','lower-quad');

-- Active leave: C -> A.
INSERT INTO public.hm_leave (leave_id, user_id, start_date, end_date, replacement_user_id, status) VALUES
  ('d0001313-0000-0000-0000-000000000001','a0001313-0000-0000-0000-00000000000c',
   DATE '2026-09-10', DATE '2026-09-12','a0001313-0000-0000-0000-00000000000a','active');

-- 1. CYCLE: A selecting C (who resolves through A) is rejected at submit time.
SELECT throws_ok(
  $$ SELECT submit_hm_leave(
       'a0001313-0000-0000-0000-00000000000a'::uuid, DATE '2026-09-10', DATE '2026-09-12',
       'a0001313-0000-0000-0000-00000000000c'::uuid) $$,
  '23514',
  'Selected replacement is now in your incoming delegation chain (cycle); please re-select',
  'submit_hm_leave rejects a replacement in the leaving user''s incoming chain (cycle)');

-- No row was written by the rejected submit.
SELECT is(
  (SELECT count(*)::int FROM public.hm_leave
   WHERE user_id = 'a0001313-0000-0000-0000-00000000000a' AND status = 'active'),
  0, 'rejected submit writes no hm_leave row (atomic)');

-- 2. NON-CYCLE: A selecting B (no onward chain) succeeds and writes an active row.
SELECT isnt(
  submit_hm_leave('a0001313-0000-0000-0000-00000000000a'::uuid, DATE '2026-09-10', DATE '2026-09-12',
    'a0001313-0000-0000-0000-00000000000b'::uuid),
  NULL, 'submit_hm_leave with a non-chain replacement returns a leave_id');

SELECT is(
  (SELECT count(*)::int FROM public.hm_leave
   WHERE user_id = 'a0001313-0000-0000-0000-00000000000a'
     AND replacement_user_id = 'a0001313-0000-0000-0000-00000000000b' AND status = 'active'),
  1, 'the accepted submit wrote exactly one active hm_leave row');

-- 3. TERMINAL: NULL replacement (project administrator) is always valid.
SELECT isnt(
  submit_hm_leave('a0001313-0000-0000-0000-00000000000a'::uuid, DATE '2026-10-01', DATE '2026-10-02', NULL),
  NULL, 'submit_hm_leave with NULL (project-admin terminal) replacement succeeds');

-- 4. "I'm back": end_hm_leave_early on the seeded C->A leave.
SELECT ok(
  end_hm_leave_early('d0001313-0000-0000-0000-000000000001'::uuid,
    'a0001313-0000-0000-0000-00000000000c'::uuid, timestamptz '2026-09-11T15:00:00Z')
    LIKE 'mailto:%back%from%leave%',
  'end_hm_leave_early returns a back-from-leave mailto: href');

SELECT is(
  (SELECT status::text FROM public.hm_leave WHERE leave_id = 'd0001313-0000-0000-0000-000000000001'),
  'cancelled_early', 'end_hm_leave_early sets status = cancelled_early');

SELECT ok(
  (SELECT cancelled_at IS NOT NULL FROM public.hm_leave WHERE leave_id = 'd0001313-0000-0000-0000-000000000001'),
  'end_hm_leave_early stamps cancelled_at');

-- 5. The released replacement (A) is notified in-app.
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE recipient_user_id = 'a0001313-0000-0000-0000-00000000000a'
     AND type = 'hm_leave_notice'
     AND payload->>'kind' = 'leave_ended_early'
     AND payload->>'leave_id' = 'd0001313-0000-0000-0000-000000000001'),
  1, 'the released replacement gets a leave_ended_early notification (§2.6 #6)');

-- 6. Idempotent: a second "I'm back" on the same leave is a no-op (NULL).
SELECT is(
  end_hm_leave_early('d0001313-0000-0000-0000-000000000001'::uuid,
    'a0001313-0000-0000-0000-00000000000c'::uuid, now()),
  NULL, 'a second end_hm_leave_early on an already-cancelled leave is a no-op');

-- 7. Ownership: another user cannot end someone else's leave.
INSERT INTO public.hm_leave (leave_id, user_id, start_date, end_date, replacement_user_id, status) VALUES
  ('d0001313-0000-0000-0000-000000000002','a0001313-0000-0000-0000-00000000000c',
   DATE '2026-11-01', DATE '2026-11-02','a0001313-0000-0000-0000-00000000000b','active');
SELECT is(
  end_hm_leave_early('d0001313-0000-0000-0000-000000000002'::uuid,
    'a0001313-0000-0000-0000-00000000000a'::uuid, now()),
  NULL, 'end_hm_leave_early will not cancel a leave owned by a different user');

SELECT finish();
ROLLBACK;
