-- pgTAP tests for admin_seed_draft_schedule (dev-seeding Feature B; migration
-- 20260711000003). Exercises: admin gating, draft write with created_by = actor,
-- per-house idempotent replace, and that the Harnwell training trigger still
-- backstops the insert. Far-future (2099) dates avoid the seeded calendar.
-- Self-contained.

BEGIN;

SELECT plan(8);

-- ---------------------------------------------------------------------------
-- Fixtures: an admin, one quad SW, one harnwell SW, a far-future period, and one
-- quad block + one harnwell block.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('da000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seeddraft-admin@test.local'),
  ('da000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seeddraft-sw-quad@test.local'),
  ('da000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'seeddraft-sw-hw@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('da000000-0000-0000-0000-000000000001', 'Draft Admin', 'seeddraft-admin@test.local', 'quad', true),
  ('da000000-0000-0000-0000-000000000002', 'Draft SW Quad', 'seeddraft-sw-quad@test.local', 'quad', true),
  ('da000000-0000-0000-0000-000000000003', 'Draft SW HW', 'seeddraft-sw-hw@test.local', 'harnwell', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('da000000-0000-0000-0000-000000000001', 'admin', NULL),
  ('da000000-0000-0000-0000-000000000002', 'sw', NULL),
  ('da000000-0000-0000-0000-000000000003', 'sw', NULL);

INSERT INTO public.scheduling_periods (period_id, period_name, profile_name, start_date, end_date)
VALUES ('da000000-0000-0000-0000-0000000000f0', 'Draft Period', 'regular_school_year', '2099-06-01', '2099-08-31');

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('da000000-0000-0000-0000-0000000000b1', 'quad', '2099-06-01 18:00:00-04', 3),
  ('da000000-0000-0000-0000-0000000000a1', 'harnwell', '2099-06-01 18:00:00-04', 2);

-- ---------------------------------------------------------------------------
-- 1. Non-admin actor is rejected.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT admin_seed_draft_schedule(
       'da000000-0000-0000-0000-000000000002',
       'da000000-0000-0000-0000-0000000000f0', 'quad', '[]'::jsonb) $$,
  '42501', 'Only an administrator may seed draft schedules.',
  'non-admin actor is rejected');

-- ---------------------------------------------------------------------------
-- 2. Admin seed writes a draft and reports the count.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT admin_seed_draft_schedule(
     'da000000-0000-0000-0000-000000000001',
     'da000000-0000-0000-0000-0000000000f0', 'quad',
     $j$[{"block_id":"da000000-0000-0000-0000-0000000000b1","user_id":"da000000-0000-0000-0000-000000000002"}]$j$::jsonb)),
  '{"assigned": 1}'::jsonb,
  'seed reports 1 draft assigned');

SELECT is(
  (SELECT count(*)::int FROM draft_block_assignments
   WHERE period_id = 'da000000-0000-0000-0000-0000000000f0'
     AND block_id = 'da000000-0000-0000-0000-0000000000b1'),
  1, 'draft row written');

-- ---------------------------------------------------------------------------
-- 3. created_by is the actor (service-client calls have no auth.uid() fallback).
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT created_by FROM draft_block_assignments
   WHERE block_id = 'da000000-0000-0000-0000-0000000000b1'),
  'da000000-0000-0000-0000-000000000001'::uuid,
  'created_by is the actor uuid');

-- ---------------------------------------------------------------------------
-- 4. Idempotent replace: re-seeding quad with empty rows clears its drafts.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT admin_seed_draft_schedule(
     'da000000-0000-0000-0000-000000000001',
     'da000000-0000-0000-0000-0000000000f0', 'quad', '[]'::jsonb)),
  '{"assigned": 0}'::jsonb,
  're-seed with empty rows assigns nothing');

SELECT is(
  (SELECT count(*)::int FROM draft_block_assignments
   WHERE period_id = 'da000000-0000-0000-0000-0000000000f0'
     AND block_id = 'da000000-0000-0000-0000-0000000000b1'),
  0, 'idempotent replace cleared the prior quad draft');

-- ---------------------------------------------------------------------------
-- 5. Replace is per house: a harnwell-home SW drafted onto harnwell survives a
--    later quad re-seed (scoped delete does not touch other houses).
-- ---------------------------------------------------------------------------
SELECT admin_seed_draft_schedule(
  'da000000-0000-0000-0000-000000000001',
  'da000000-0000-0000-0000-0000000000f0', 'harnwell',
  $j$[{"block_id":"da000000-0000-0000-0000-0000000000a1","user_id":"da000000-0000-0000-0000-000000000003"}]$j$::jsonb);
SELECT admin_seed_draft_schedule(
  'da000000-0000-0000-0000-000000000001',
  'da000000-0000-0000-0000-0000000000f0', 'quad', '[]'::jsonb);
SELECT is(
  (SELECT count(*)::int FROM draft_block_assignments
   WHERE block_id = 'da000000-0000-0000-0000-0000000000a1'),
  1, 'a quad re-seed leaves harnwell drafts intact (per-house scope)');

-- ---------------------------------------------------------------------------
-- 6. Harnwell training trigger backstops the insert: a non-Harnwell worker
--    drafted onto a Harnwell block is rejected.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT admin_seed_draft_schedule(
       'da000000-0000-0000-0000-000000000001',
       'da000000-0000-0000-0000-0000000000f0', 'harnwell',
       $j$[{"block_id":"da000000-0000-0000-0000-0000000000a1","user_id":"da000000-0000-0000-0000-000000000002"}]$j$::jsonb) $$,
  '23514',
  'non-Harnwell workers may not staff Harnwell',
  'Harnwell training trigger rejects a quad worker on a Harnwell block');

SELECT * FROM finish();
ROLLBACK;
