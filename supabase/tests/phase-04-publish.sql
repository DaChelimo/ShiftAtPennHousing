-- pgTAP behavioral tests for Phase 04: Schedule Publish Operation
-- Spec sources: BEHAVIORAL_SPECIFICATION §4.3 (Phase 3 — Live Publishing);
--               ARCHITECTURE §2.10 (scheduling_periods.published_at),
--                            §3.9 (publish operation contract).
-- Run with: supabase test db
--
-- The publish operation is implemented as a Postgres function
--   publish_schedule(p_period_id uuid)
-- that runs atomically in a single transaction and:
--   1. Copies every draft_block_assignments row for the period into
--      shift_block_assignments with status='scheduled',
--      vacancy_origin='none', is_float=false, is_cross_house_pickup=false,
--      source_house_id=NULL.
--   2. For every block in the period (every shift_blocks row whose
--      block_start_at falls inside [period.start_date, period.end_date])
--      that has NO matching draft row, inserts one shift_block_assignments
--      row per missing seat (required_headcount minus drafted seats) with
--      status='vacant', vacancy_origin='never_assigned', user_id=NULL.
--   3. Deletes all draft_block_assignments rows for the period.
--   4. Sets scheduling_periods.published_at = now() in the same transaction.
--
-- TDD-first: function does not yet exist. These tests pin observable
-- behavior. Mechanism (CTE vs plpgsql vs SQL function) is implementer's
-- choice; the signature and effects are not.

BEGIN;

SELECT plan(31);

-- ============================================================
-- 0. Setup: users, period, blocks across two distinct dates.
-- The period spans 2026-09-08 and 2026-09-09. Three blocks total:
--   B1: harnwell 2026-09-08 10:00, headcount=2
--   B2: harnwell 2026-09-08 10:30, headcount=2
--   B3: quad     2026-09-09 14:00, headcount=3
-- We will draft assignments for B1 (1 of 2 seats) and B3 (3 of 3 seats),
-- leaving B2 with no draft rows (must produce 2 vacant rows).
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('b0000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pub-sw-1@test.local'),
  ('b0000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pub-sw-2@test.local'),
  ('b0000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pub-sw-3@test.local'),
  ('b0000001-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pub-sw-4@test.local'),
  ('b0000001-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pub-sm@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('b0000001-0000-0000-0000-000000000001', 'Pub SW 1', 'pub-sw-1@test.local', 'harnwell', true),
  ('b0000001-0000-0000-0000-000000000002', 'Pub SW 2', 'pub-sw-2@test.local', 'harnwell', true),
  ('b0000001-0000-0000-0000-000000000003', 'Pub SW 3', 'pub-sw-3@test.local', 'quad',     true),
  ('b0000001-0000-0000-0000-000000000004', 'Pub SW 4', 'pub-sw-4@test.local', 'quad',     true),
  ('b0000001-0000-0000-0000-000000000099', 'Pub SM',   'pub-sm@test.local',   'harnwell', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('b0000001-0000-0000-0000-000000000001', 'sw', NULL),
  ('b0000001-0000-0000-0000-000000000002', 'sw', NULL),
  ('b0000001-0000-0000-0000-000000000003', 'sw', NULL),
  ('b0000001-0000-0000-0000-000000000004', 'sw', NULL),
  ('b0000001-0000-0000-0000-000000000099', 'sm', 'harnwell');

INSERT INTO public.scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date,
   preference_deadline, published_at)
VALUES
  ('c0000000-0000-0000-0000-0000000000a0', 'Publish Period A',
   'regular_school_year', '2026-09-08', '2026-09-09',
   (now() - interval '1 day'),  -- deadline already passed; SM is building
   NULL);

-- Independent control period — never published; used to assert that
-- publishing period A does NOT touch period B's drafts.
INSERT INTO public.scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date,
   preference_deadline, published_at)
VALUES
  ('c0000000-0000-0000-0000-0000000000b0', 'Publish Period B',
   'regular_school_year', '2027-01-15', '2027-05-15',
   (now() + interval '30 days'),
   NULL);

-- Blocks B1, B2, B3.
INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('d0000000-0000-0000-0000-0000000000b1', 'harnwell',
   '2026-09-08 10:00:00 America/New_York'::timestamptz, 2),
  ('d0000000-0000-0000-0000-0000000000b2', 'harnwell',
   '2026-09-08 10:30:00 America/New_York'::timestamptz, 2),
  ('d0000000-0000-0000-0000-0000000000b3', 'quad',
   '2026-09-09 14:00:00 America/New_York'::timestamptz, 3);

-- A fourth block belongs to a DIFFERENT period (outside the date
-- range of period A). Publishing A must not touch it.
INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('d0000000-0000-0000-0000-0000000000c1', 'harnwell',
   '2027-02-02 10:00:00 America/New_York'::timestamptz, 2);

-- Draft assignments:
--   B1 → seat 1 = user-1
--   B3 → seat 1 = user-3, seat 2 = user-4, seat 3 = user-1 (cross-house pickup model not relevant here)
-- B2 has NO draft rows → must become 2 vacant rows.
INSERT INTO public.draft_block_assignments
  (period_id, block_id, user_id, created_by)
VALUES
  ('c0000000-0000-0000-0000-0000000000a0',
   'd0000000-0000-0000-0000-0000000000b1',
   'b0000001-0000-0000-0000-000000000001',
   'b0000001-0000-0000-0000-000000000099'),
  ('c0000000-0000-0000-0000-0000000000a0',
   'd0000000-0000-0000-0000-0000000000b3',
   'b0000001-0000-0000-0000-000000000003',
   'b0000001-0000-0000-0000-000000000099'),
  ('c0000000-0000-0000-0000-0000000000a0',
   'd0000000-0000-0000-0000-0000000000b3',
   'b0000001-0000-0000-0000-000000000004',
   'b0000001-0000-0000-0000-000000000099'),
  ('c0000000-0000-0000-0000-0000000000a0',
   'd0000000-0000-0000-0000-0000000000b3',
   'b0000001-0000-0000-0000-000000000001',
   'b0000001-0000-0000-0000-000000000099');

-- A control draft row for period B (must NOT be touched by publishing A).
INSERT INTO public.draft_block_assignments
  (period_id, block_id, user_id, created_by)
VALUES
  ('c0000000-0000-0000-0000-0000000000b0',
   'd0000000-0000-0000-0000-0000000000c1',
   'b0000001-0000-0000-0000-000000000001',
   'b0000001-0000-0000-0000-000000000099');

-- ============================================================
-- 1. Function exists with the agreed signature
-- ============================================================

SELECT has_function(
  'public', 'publish_schedule', ARRAY['uuid'],
  'publish_schedule(uuid) function exists'
);

-- ============================================================
-- 2. Pre-publish invariants
-- ============================================================

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id IN (
      'd0000000-0000-0000-0000-0000000000b1',
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000b3'))::integer,
  0,
  'no shift_block_assignments rows exist for period A blocks before publish'
);

SELECT is(
  (SELECT published_at FROM public.scheduling_periods
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0'),
  NULL::timestamptz,
  'scheduling_periods.published_at IS NULL before publish'
);

SELECT is(
  (SELECT count(*) FROM public.draft_block_assignments
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0')::integer,
  4,
  '4 draft rows exist for period A before publish (B1×1 + B3×3)'
);

-- ============================================================
-- 3. Publish — invoke the function
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.publish_schedule('c0000000-0000-0000-0000-0000000000a0'::uuid) $$,
  'publish_schedule(period_A) executes without error'
);

-- ============================================================
-- 4. Post-publish: every drafted row became a scheduled assignment.
-- ============================================================

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id IN (
      'd0000000-0000-0000-0000-0000000000b1',
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000b3')
      AND status = 'scheduled')::integer,
  4,
  '4 scheduled assignments inserted post-publish (one per draft row)'
);

-- The drafted user-1 sits on B1 as scheduled.
SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000b1'
      AND user_id  = 'b0000001-0000-0000-0000-000000000001'
      AND status   = 'scheduled')::integer,
  1,
  'B1 has exactly one scheduled assignment for user-1'
);

-- B3 has all three of its drafted seats scheduled.
SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000b3'
      AND status   = 'scheduled')::integer,
  3,
  'B3 has 3 scheduled assignments (all drafted seats published)'
);

-- The scheduled rows have the spec-mandated default flag values.
SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id IN (
      'd0000000-0000-0000-0000-0000000000b1',
      'd0000000-0000-0000-0000-0000000000b3')
      AND status = 'scheduled'
      AND vacancy_origin = 'none'
      AND is_float = false
      AND is_cross_house_pickup = false
      AND source_house_id IS NULL)::integer,
  4,
  'all published scheduled rows carry default flags (vacancy_origin=none, is_float=false, is_cross_house_pickup=false, source_house_id=NULL)'
);

-- ============================================================
-- 5. Vacant creation: every undrafted seat in the period becomes a
-- vacant row with origin='never_assigned'.
-- B1 was drafted for 1 of 2 seats → 1 vacant row.
-- B2 was drafted for 0 of 2 seats → 2 vacant rows.
-- B3 was drafted for 3 of 3 seats → 0 vacant rows.
-- Expected total vacant rows: 3.
-- ============================================================

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id IN (
      'd0000000-0000-0000-0000-0000000000b1',
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000b3')
      AND status = 'vacant')::integer,
  3,
  '3 vacant rows inserted (B1: 1 missing seat, B2: 2 missing seats, B3: 0 missing seats)'
);

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000b2'
      AND status = 'vacant'
      AND vacancy_origin = 'never_assigned'
      AND user_id IS NULL)::integer,
  2,
  'B2 (no drafts) produces 2 vacant rows with vacancy_origin=never_assigned and user_id=NULL'
);

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000b1'
      AND status = 'vacant'
      AND vacancy_origin = 'never_assigned')::integer,
  1,
  'B1 (1 of 2 seats drafted) produces 1 vacant row with vacancy_origin=never_assigned'
);

-- Every block in the period now carries exactly required_headcount
-- assignment rows (scheduled + vacant combined).
SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments a
    JOIN public.shift_blocks b USING (block_id)
    WHERE a.block_id IN (
      'd0000000-0000-0000-0000-0000000000b1',
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000b3'))::integer,
  7,
  'total assignment rows across period A blocks = 4 scheduled + 3 vacant = 7 (= sum of headcounts)'
);

-- ============================================================
-- 6. Draft cleanup: draft_block_assignments for period A is empty.
-- ============================================================

SELECT is(
  (SELECT count(*) FROM public.draft_block_assignments
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0')::integer,
  0,
  'draft_block_assignments has zero rows for period A after publish'
);

-- ============================================================
-- 7. published_at set in the same transaction.
-- ============================================================

SELECT isnt(
  (SELECT published_at FROM public.scheduling_periods
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0'),
  NULL::timestamptz,
  'scheduling_periods.published_at IS NOT NULL after publish'
);

-- And it is approximately "now" (within ±5 seconds).
SELECT ok(
  (SELECT abs(extract(epoch from (now() - published_at))) < 5
     FROM public.scheduling_periods
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0'),
  'published_at is set to approximately now() at publish time'
);

-- ============================================================
-- 8. Period isolation — publishing A does NOT affect period B.
-- ============================================================

SELECT is(
  (SELECT count(*) FROM public.draft_block_assignments
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000b0')::integer,
  1,
  'period B drafts are untouched by publishing period A'
);

SELECT is(
  (SELECT published_at FROM public.scheduling_periods
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000b0'),
  NULL::timestamptz,
  'period B remains unpublished after publishing period A'
);

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000c1')::integer,
  0,
  'period B blocks have no assignment rows after publishing period A'
);

-- ============================================================
-- 9. Re-publish guard — publishing an already-published period is a
-- no-op or an explicit error. Either way it MUST NOT duplicate rows.
-- ============================================================

DO $$
DECLARE
  v_scheduled_before bigint;
  v_vacant_before bigint;
  v_publish_failed boolean := false;
BEGIN
  SELECT count(*) INTO v_scheduled_before
    FROM public.shift_block_assignments
    WHERE block_id IN (
      'd0000000-0000-0000-0000-0000000000b1',
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000b3')
      AND status = 'scheduled';

  SELECT count(*) INTO v_vacant_before
    FROM public.shift_block_assignments
    WHERE block_id IN (
      'd0000000-0000-0000-0000-0000000000b1',
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000b3')
      AND status = 'vacant';

  BEGIN
    PERFORM public.publish_schedule('c0000000-0000-0000-0000-0000000000a0'::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_publish_failed := true;
  END;

  PERFORM set_config('test.phase04.republish_failed',
                     v_publish_failed::text, true);
  PERFORM set_config('test.phase04.scheduled_before',
                     v_scheduled_before::text, true);
  PERFORM set_config('test.phase04.vacant_before',
                     v_vacant_before::text, true);
END $$;

-- Whichever resolution applied — silent no-op or explicit error — the
-- assignment-row counts MUST be unchanged.
SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id IN (
      'd0000000-0000-0000-0000-0000000000b1',
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000b3')
      AND status = 'scheduled')::integer,
  current_setting('test.phase04.scheduled_before')::integer,
  're-publish does not duplicate scheduled assignments'
);

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id IN (
      'd0000000-0000-0000-0000-0000000000b1',
      'd0000000-0000-0000-0000-0000000000b2',
      'd0000000-0000-0000-0000-0000000000b3')
      AND status = 'vacant')::integer,
  current_setting('test.phase04.vacant_before')::integer,
  're-publish does not duplicate vacant assignments'
);

-- And the draft table remains empty for period A.
SELECT is(
  (SELECT count(*) FROM public.draft_block_assignments
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0')::integer,
  0,
  'draft_block_assignments for period A remains empty after re-publish attempt'
);

-- ============================================================
-- 10. Atomicity — when publish fails mid-stream, no partial state is
-- left behind. We exercise this by attempting to publish a period whose
-- draft includes a FK-invalid user_id (simulated by inserting a draft
-- with a valid user that we then delete from public.users after the
-- draft insert). We cannot violate FK at insert time; instead we use a
-- conflict path: insert a pre-existing shift_block_assignments row for
-- one of period C's blocks, so the publish's INSERT will collide.
-- Period C is a fresh period that owns block B_C; B_C already has an
-- assignment row, so attempting to publish should error out and leave
-- no draft rows deleted.
-- ============================================================

INSERT INTO public.scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date,
   preference_deadline)
VALUES
  ('c0000000-0000-0000-0000-0000000000c0', 'Atomic Period C',
   'regular_school_year', '2028-01-15', '2028-05-15',
   (now() - interval '1 day'));

INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('d0000000-0000-0000-0000-0000000000d1', 'harnwell',
   '2028-02-02 10:00:00 America/New_York'::timestamptz, 2),
  ('d0000000-0000-0000-0000-0000000000d2', 'harnwell',
   '2028-02-02 10:30:00 America/New_York'::timestamptz, 2);

-- Draft assignment for D1 — but D1 already has a pre-existing scheduled
-- row inserted directly, simulating a state the publish must reconcile.
-- If the implementer chose an INSERT path that conflicts with the
-- existing row's UNIQUE/PK, the entire publish must roll back.
INSERT INTO public.shift_block_assignments
  (block_id, user_id, status, vacancy_origin)
VALUES
  ('d0000000-0000-0000-0000-0000000000d1',
   'b0000001-0000-0000-0000-000000000001',
   'scheduled', 'none');

INSERT INTO public.draft_block_assignments
  (period_id, block_id, user_id, created_by)
VALUES
  ('c0000000-0000-0000-0000-0000000000c0',
   'd0000000-0000-0000-0000-0000000000d1',
   'b0000001-0000-0000-0000-000000000001',
   'b0000001-0000-0000-0000-000000000099'),
  ('c0000000-0000-0000-0000-0000000000c0',
   'd0000000-0000-0000-0000-0000000000d2',
   'b0000001-0000-0000-0000-000000000002',
   'b0000001-0000-0000-0000-000000000099');

-- Note: this section asserts atomicity for the case where the publish
-- function chose to enforce "period must be in a clean state" by
-- erroring on pre-existing assignment rows. If the implementer chose a
-- semantics where pre-existing rows coexist with publish (UPSERT path),
-- the assertions below would be inappropriate. The publish-spec wording
-- ("copy every row [...] insert", "for every block [...] insert") is
-- write-only; pre-existing assignment rows for the period before publish
-- should NEVER occur in normal SM flow, so erroring is the sane choice.
-- This block is informational coverage; the harness asserts only that
-- ANY error must leave drafts intact.

DO $$
DECLARE
  v_publish_failed boolean := false;
  v_draft_count_before bigint;
  v_draft_count_after bigint;
BEGIN
  SELECT count(*) INTO v_draft_count_before
    FROM public.draft_block_assignments
   WHERE period_id = 'c0000000-0000-0000-0000-0000000000c0';

  BEGIN
    PERFORM public.publish_schedule('c0000000-0000-0000-0000-0000000000c0'::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_publish_failed := true;
  END;

  SELECT count(*) INTO v_draft_count_after
    FROM public.draft_block_assignments
   WHERE period_id = 'c0000000-0000-0000-0000-0000000000c0';

  PERFORM set_config('test.phase04.atomic_failed',
                     v_publish_failed::text, true);
  PERFORM set_config('test.phase04.atomic_draft_before',
                     v_draft_count_before::text, true);
  PERFORM set_config('test.phase04.atomic_draft_after',
                     v_draft_count_after::text, true);
END $$;

-- If publish failed (atomicity-relevant case), drafts MUST remain.
-- If publish succeeded (the implementer chose UPSERT semantics), the
-- assertion is vacuously satisfied because the draft count delta is
-- not asserted in the success branch.
SELECT ok(
  current_setting('test.phase04.atomic_failed') = 'false'
  OR current_setting('test.phase04.atomic_draft_before') =
     current_setting('test.phase04.atomic_draft_after'),
  'on publish failure, draft_block_assignments for the period is unchanged (atomic rollback)'
);

-- And published_at remained NULL on failure.
SELECT ok(
  current_setting('test.phase04.atomic_failed') = 'false'
  OR (SELECT published_at FROM public.scheduling_periods
       WHERE period_id = 'c0000000-0000-0000-0000-0000000000c0') IS NULL,
  'on publish failure, scheduling_periods.published_at remains NULL'
);

-- ============================================================
-- 11. Worker-visibility contract: workers' calendars only show
-- assignments for periods where published_at IS NOT NULL.
-- This phase asserts the underlying state — the RLS / app-layer
-- filter assertion is part of the calendar-render test surface
-- in later phases. Here we assert the necessary DB invariant:
-- after publish, shift_block_assignments rows exist; before publish,
-- the SM's draft does NOT live in shift_block_assignments at all.
-- ============================================================

-- The atomic-period C case (publish presumed failed) has no
-- shift_block_assignments rows for D2 because D2 was draft-only and
-- the publish rolled back.
SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000d2')::integer,
  0,
  'D2 has no shift_block_assignments rows (publish rolled back, draft was the only source)'
);

-- ============================================================
-- 12. Publish with zero draft rows: every block in the period becomes
-- fully vacant. This covers the edge case from the spec prompt:
-- "Publish with zero draft rows → all blocks become vacant (never_assigned)".
-- ============================================================

INSERT INTO public.scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date,
   preference_deadline)
VALUES
  ('c0000000-0000-0000-0000-0000000000e0', 'Empty Draft Period E',
   'regular_school_year', '2029-01-15', '2029-05-15',
   (now() - interval '1 day'));

INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('d0000000-0000-0000-0000-0000000000e1', 'harnwell',
   '2029-02-02 10:00:00 America/New_York'::timestamptz, 2),
  ('d0000000-0000-0000-0000-0000000000e2', 'quad',
   '2029-02-02 14:00:00 America/New_York'::timestamptz, 3);

SELECT lives_ok(
  $$ SELECT public.publish_schedule('c0000000-0000-0000-0000-0000000000e0'::uuid) $$,
  'publish_schedule on a period with zero drafts executes without error'
);

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id IN (
      'd0000000-0000-0000-0000-0000000000e1',
      'd0000000-0000-0000-0000-0000000000e2'))::integer,
  5,
  'zero-draft publish creates one vacant row per seat (2 + 3 = 5)'
);

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id IN (
      'd0000000-0000-0000-0000-0000000000e1',
      'd0000000-0000-0000-0000-0000000000e2')
      AND status = 'vacant'
      AND vacancy_origin = 'never_assigned'
      AND user_id IS NULL)::integer,
  5,
  'every vacant row from zero-draft publish carries vacancy_origin=never_assigned and user_id=NULL'
);

SELECT isnt(
  (SELECT published_at FROM public.scheduling_periods
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000e0'),
  NULL::timestamptz,
  'zero-draft publish still sets published_at'
);

-- ============================================================
-- 13. Post-publish manual override path (BEH §4.3 Phase 3 / ARCH §3.9)
-- After publish, SMs use post-publish manual overrides that write
-- DIRECTLY to shift_block_assignments — no more draft round-trip.
-- This is observable as the ability to insert a new
-- shift_block_assignments row for an already-published period's block.
-- ============================================================

SELECT lives_ok(
  $$ INSERT INTO public.shift_block_assignments
       (block_id, user_id, status, vacancy_origin)
     VALUES (
       'd0000000-0000-0000-0000-0000000000b2',
       'b0000001-0000-0000-0000-000000000002',
       'scheduled', 'none'
     ) $$,
  'post-publish manual override may insert a scheduled row directly into shift_block_assignments'
);

-- ============================================================
-- 14. Vacant rows generated by publish are visible to the orchestrator.
-- The orchestrator queries shift_block_assignments WHERE status='vacant'.
-- (ARCH §3.9: "orchestrator never reads draft_block_assignments".)
-- ============================================================

SELECT cmp_ok(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE status = 'vacant'
      AND vacancy_origin = 'never_assigned'
      AND block_id IN (
        'd0000000-0000-0000-0000-0000000000b1',
        'd0000000-0000-0000-0000-0000000000b2'))::integer,
  '>=',
  3,
  'post-publish vacant rows are visible via the orchestrator status=vacant query'
);

SELECT finish();
ROLLBACK;
