-- pgTAP behavioral tests for Phase 04: Schedule Publish Operation
-- Spec sources: BEHAVIORAL_SPECIFICATION §4.3 (Phase 3 — Live Publishing);
--               ARCHITECTURE §2.10 (scheduling_periods.published_at), §3.9.
-- Run with: supabase test db
--
-- Per-house publish contract (audit D-2 Option A + D-3 per-house):
--   publish_schedule(p_period_id uuid, p_published_by uuid, p_house_id text)
-- runs atomically and:
--   0. The Phase-3 generator has already created one vacant/never_assigned
--      shift_block_assignments row per required seat for every block.
--   1. Authorizes p_published_by as an sm/hm/bm of p_house_id.
--   2. UPSERTs each draft_block_assignments row for that house's blocks onto a
--      vacant seat (-> status='scheduled', vacancy_origin='none', is_float=false,
--      is_cross_house_pickup=false, source_house_id=NULL); leftover seats stay
--      vacant/never_assigned. Each block ends with exactly required_headcount rows.
--   3. Deletes that house's draft rows for the period.
--   4. Records (period, house) in period_house_publications; flips
--      scheduling_periods.published_at only once every house with blocks in the
--      period is published.

BEGIN;

SELECT plan(30);

-- ============================================================
-- 0. Setup: users (incl. an SM per house + a non-builder), period, blocks,
-- and the generator's pre-created vacant rows.
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
   'authenticated', 'authenticated', 'pub-sm-harn@test.local'),
  ('b0000001-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pub-sm-quad@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('b0000001-0000-0000-0000-000000000001', 'Pub SW 1', 'pub-sw-1@test.local', 'harnwell', true),
  ('b0000001-0000-0000-0000-000000000002', 'Pub SW 2', 'pub-sw-2@test.local', 'harnwell', true),
  ('b0000001-0000-0000-0000-000000000003', 'Pub SW 3', 'pub-sw-3@test.local', 'quad',     true),
  ('b0000001-0000-0000-0000-000000000004', 'Pub SW 4', 'pub-sw-4@test.local', 'quad',     true),
  ('b0000001-0000-0000-0000-000000000099', 'Pub SM Harn', 'pub-sm-harn@test.local', 'harnwell', true),
  ('b0000001-0000-0000-0000-000000000098', 'Pub SM Quad', 'pub-sm-quad@test.local', 'quad',     true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('b0000001-0000-0000-0000-000000000001', 'sw', NULL),
  ('b0000001-0000-0000-0000-000000000002', 'sw', NULL),
  ('b0000001-0000-0000-0000-000000000003', 'sw', NULL),
  ('b0000001-0000-0000-0000-000000000004', 'sw', NULL),
  ('b0000001-0000-0000-0000-000000000099', 'sm', 'harnwell'),
  ('b0000001-0000-0000-0000-000000000098', 'sm', 'quad');

INSERT INTO public.scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date, preference_deadline, published_at)
VALUES
  ('c0000000-0000-0000-0000-0000000000a0', 'Publish Period A',
   'regular_school_year', '2026-09-08', '2026-09-09', (now() - interval '1 day'), NULL),
  ('c0000000-0000-0000-0000-0000000000b0', 'Publish Period B',
   'regular_school_year', '2027-01-15', '2027-05-15', (now() + interval '30 days'), NULL);

-- Blocks: B1 harnwell hc=2, B2 harnwell hc=2, B3 quad hc=3; C1 is in period B's range.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('d0000000-0000-0000-0000-0000000000b1', 'harnwell', '2026-09-08 10:00:00 America/New_York'::timestamptz, 2),
  ('d0000000-0000-0000-0000-0000000000b2', 'harnwell', '2026-09-08 10:30:00 America/New_York'::timestamptz, 2),
  ('d0000000-0000-0000-0000-0000000000b3', 'quad',     '2026-09-09 14:00:00 America/New_York'::timestamptz, 3),
  ('d0000000-0000-0000-0000-0000000000c1', 'harnwell', '2027-02-02 10:00:00 America/New_York'::timestamptz, 2);

-- Generator pre-creates one vacant/never_assigned seat per required headcount.
INSERT INTO public.shift_block_assignments (block_id, status, vacancy_origin)
SELECT b.block_id, 'vacant', 'never_assigned'
FROM public.shift_blocks b
CROSS JOIN LATERAL generate_series(1, b.required_headcount)
WHERE b.block_id IN (
  'd0000000-0000-0000-0000-0000000000b1',
  'd0000000-0000-0000-0000-0000000000b2',
  'd0000000-0000-0000-0000-0000000000b3',
  'd0000000-0000-0000-0000-0000000000c1');

-- Drafts: B1 -> 1 seat (user-1); B3 -> 3 seats (user-3, user-4, user-1). B2 -> none.
INSERT INTO public.draft_block_assignments (period_id, block_id, user_id, created_by)
VALUES
  ('c0000000-0000-0000-0000-0000000000a0', 'd0000000-0000-0000-0000-0000000000b1',
   'b0000001-0000-0000-0000-000000000001', 'b0000001-0000-0000-0000-000000000099'),
  ('c0000000-0000-0000-0000-0000000000a0', 'd0000000-0000-0000-0000-0000000000b3',
   'b0000001-0000-0000-0000-000000000003', 'b0000001-0000-0000-0000-000000000098'),
  ('c0000000-0000-0000-0000-0000000000a0', 'd0000000-0000-0000-0000-0000000000b3',
   'b0000001-0000-0000-0000-000000000004', 'b0000001-0000-0000-0000-000000000098'),
  ('c0000000-0000-0000-0000-0000000000a0', 'd0000000-0000-0000-0000-0000000000b3',
   'b0000001-0000-0000-0000-000000000001', 'b0000001-0000-0000-0000-000000000098'),
  -- control draft for period B (must not be touched)
  ('c0000000-0000-0000-0000-0000000000b0', 'd0000000-0000-0000-0000-0000000000c1',
   'b0000001-0000-0000-0000-000000000001', 'b0000001-0000-0000-0000-000000000099');

-- ============================================================
-- 1. Function exists with the per-house signature.
-- ============================================================
SELECT has_function(
  'public', 'publish_schedule', ARRAY['uuid', 'uuid', 'text'],
  'publish_schedule(uuid, uuid, text) exists');

SELECT hasnt_function(
  'public', 'publish_schedule', ARRAY['uuid'],
  'old single-arg publish_schedule(uuid) overload removed');

-- ============================================================
-- 2. Pre-publish invariants.
-- ============================================================
SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id IN ('d0000000-0000-0000-0000-0000000000b1',
      'd0000000-0000-0000-0000-0000000000b2','d0000000-0000-0000-0000-0000000000b3')
      AND status = 'vacant')::integer,
  7, 'generator pre-created 7 vacant seats for period A blocks (2+2+3)');

SELECT is(
  (SELECT published_at FROM public.scheduling_periods
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0'),
  NULL::timestamptz, 'published_at IS NULL before publish');

SELECT is(
  (SELECT count(*) FROM public.draft_block_assignments
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0')::integer,
  4, '4 draft rows for period A before publish');

-- ============================================================
-- 3. Authorization: a non-builder (sw) cannot publish.
-- ============================================================
SELECT throws_ok(
  $$ SELECT public.publish_schedule(
       'c0000000-0000-0000-0000-0000000000a0'::uuid,
       'b0000001-0000-0000-0000-000000000001'::uuid, 'harnwell') $$,
  '42501', NULL,
  'sw (not a builder of harnwell) cannot publish');

-- ============================================================
-- 4. Publish harnwell only.
-- ============================================================
SELECT lives_ok(
  $$ SELECT public.publish_schedule(
       'c0000000-0000-0000-0000-0000000000a0'::uuid,
       'b0000001-0000-0000-0000-000000000099'::uuid, 'harnwell') $$,
  'SM publishes harnwell without error');

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000b1'
      AND user_id = 'b0000001-0000-0000-0000-000000000001' AND status = 'scheduled')::integer,
  1, 'B1 has one scheduled assignment for user-1');

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000b1' AND status = 'vacant')::integer,
  1, 'B1 keeps 1 vacant seat (2 headcount - 1 drafted)');

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000b2'
      AND status = 'vacant' AND vacancy_origin = 'never_assigned' AND user_id IS NULL)::integer,
  2, 'B2 (no drafts) keeps 2 vacant/never_assigned seats');

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000b1' AND status = 'scheduled'
      AND vacancy_origin = 'none' AND is_float = false
      AND is_cross_house_pickup = false AND source_house_id IS NULL)::integer,
  1, 'published scheduled row carries default flags');

SELECT is(
  (SELECT count(*) FROM public.draft_block_assignments
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0'
      AND block_id = 'd0000000-0000-0000-0000-0000000000b1')::integer,
  0, 'harnwell drafts deleted after publish');

-- B3 (quad) is untouched by publishing harnwell.
SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000b3' AND status = 'vacant')::integer,
  3, 'quad B3 still fully vacant after harnwell publish');

SELECT is(
  (SELECT count(*) FROM public.draft_block_assignments
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0'
      AND block_id = 'd0000000-0000-0000-0000-0000000000b3')::integer,
  3, 'quad B3 drafts remain after harnwell publish');

-- ============================================================
-- 5. Period not fully published yet (quad pending).
-- ============================================================
SELECT is(
  (SELECT published_at FROM public.scheduling_periods
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0'),
  NULL::timestamptz, 'published_at still NULL (quad not yet published)');

SELECT is(
  (SELECT count(*) FROM public.period_house_publications
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0')::integer,
  1, 'one house recorded in period_house_publications');

-- Re-publishing harnwell errors (already published).
SELECT throws_ok(
  $$ SELECT public.publish_schedule(
       'c0000000-0000-0000-0000-0000000000a0'::uuid,
       'b0000001-0000-0000-0000-000000000099'::uuid, 'harnwell') $$,
  '23505', NULL,
  're-publishing an already-published house errors');

-- ============================================================
-- 6. Publish quad → period now fully published.
-- ============================================================
SELECT lives_ok(
  $$ SELECT public.publish_schedule(
       'c0000000-0000-0000-0000-0000000000a0'::uuid,
       'b0000001-0000-0000-0000-000000000098'::uuid, 'quad') $$,
  'SM publishes quad without error');

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000b3' AND status = 'scheduled')::integer,
  3, 'B3 has 3 scheduled assignments after quad publish');

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments a
    JOIN public.shift_blocks b USING (block_id)
    WHERE a.block_id IN ('d0000000-0000-0000-0000-0000000000b1',
      'd0000000-0000-0000-0000-0000000000b2','d0000000-0000-0000-0000-0000000000b3'))::integer,
  7, 'total rows across period A blocks = sum of headcounts (7)');

SELECT isnt(
  (SELECT published_at FROM public.scheduling_periods
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000a0'),
  NULL::timestamptz, 'published_at set once all houses published');

-- ============================================================
-- 7. Isolation — period B untouched.
-- ============================================================
SELECT is(
  (SELECT count(*) FROM public.draft_block_assignments
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000b0')::integer,
  1, 'period B drafts untouched');

SELECT is(
  (SELECT published_at FROM public.scheduling_periods
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000b0'),
  NULL::timestamptz, 'period B remains unpublished');

-- ============================================================
-- 8. Atomicity — over-assigned block (drafts > headcount) errors and
-- rolls back, leaving drafts intact and published_at NULL.
-- ============================================================
INSERT INTO public.scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date, preference_deadline)
VALUES
  ('c0000000-0000-0000-0000-0000000000c0', 'Atomic Period C',
   'regular_school_year', '2028-01-15', '2028-05-15', (now() - interval '1 day'));

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('d0000000-0000-0000-0000-0000000000d1', 'harnwell', '2028-02-02 10:00:00 America/New_York'::timestamptz, 1);

INSERT INTO public.shift_block_assignments (block_id, status, vacancy_origin)
VALUES ('d0000000-0000-0000-0000-0000000000d1', 'vacant', 'never_assigned');

-- two drafts for a headcount-1 block → over-assignment
INSERT INTO public.draft_block_assignments (period_id, block_id, user_id, created_by)
VALUES
  ('c0000000-0000-0000-0000-0000000000c0', 'd0000000-0000-0000-0000-0000000000d1',
   'b0000001-0000-0000-0000-000000000001', 'b0000001-0000-0000-0000-000000000099'),
  ('c0000000-0000-0000-0000-0000000000c0', 'd0000000-0000-0000-0000-0000000000d1',
   'b0000001-0000-0000-0000-000000000002', 'b0000001-0000-0000-0000-000000000099');

SELECT throws_ok(
  $$ SELECT public.publish_schedule(
       'c0000000-0000-0000-0000-0000000000c0'::uuid,
       'b0000001-0000-0000-0000-000000000099'::uuid, 'harnwell') $$,
  '23514', NULL,
  'over-assigned block rejects publish');

SELECT is(
  (SELECT count(*) FROM public.draft_block_assignments
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000c0')::integer,
  2, 'drafts intact after failed publish (atomic rollback)');

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000d1' AND status = 'scheduled')::integer,
  0, 'no scheduled rows created on failed publish');

-- ============================================================
-- 9. Zero-draft publish: every seat stays vacant; published_at still set.
-- ============================================================
INSERT INTO public.scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date, preference_deadline)
VALUES
  ('c0000000-0000-0000-0000-0000000000e0', 'Empty Draft Period E',
   'regular_school_year', '2029-01-15', '2029-05-15', (now() - interval '1 day'));

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('d0000000-0000-0000-0000-0000000000e1', 'harnwell', '2029-02-02 10:00:00 America/New_York'::timestamptz, 2);

INSERT INTO public.shift_block_assignments (block_id, status, vacancy_origin)
SELECT 'd0000000-0000-0000-0000-0000000000e1', 'vacant', 'never_assigned'
FROM generate_series(1, 2);

SELECT lives_ok(
  $$ SELECT public.publish_schedule(
       'c0000000-0000-0000-0000-0000000000e0'::uuid,
       'b0000001-0000-0000-0000-000000000099'::uuid, 'harnwell') $$,
  'zero-draft publish executes without error');

SELECT is(
  (SELECT count(*) FROM public.shift_block_assignments
    WHERE block_id = 'd0000000-0000-0000-0000-0000000000e1'
      AND status = 'vacant' AND vacancy_origin = 'never_assigned' AND user_id IS NULL)::integer,
  2, 'zero-draft publish leaves both seats vacant/never_assigned');

SELECT isnt(
  (SELECT published_at FROM public.scheduling_periods
    WHERE period_id = 'c0000000-0000-0000-0000-0000000000e0'),
  NULL::timestamptz, 'zero-draft publish still sets published_at (only house done)');

-- ============================================================
-- 10. Post-publish manual override writes directly to shift_block_assignments.
-- ============================================================
SELECT lives_ok(
  $$ INSERT INTO public.shift_block_assignments (block_id, user_id, status, vacancy_origin)
     VALUES ('d0000000-0000-0000-0000-0000000000b2',
             'b0000001-0000-0000-0000-000000000002', 'scheduled', 'none') $$,
  'post-publish manual override inserts a scheduled row directly');

SELECT finish();
ROLLBACK;
