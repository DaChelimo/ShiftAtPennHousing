-- pgTAP test for the publish voided-block guard (migration 20260711000004).
-- Before the fix, publish_schedule iterated EVERY block of the house with no
-- voided_at filter, so its normalize branch re-inserted vacant seats onto a voided
-- block (and its excess-insert branch could add scheduled rows) — resurrecting a
-- block the season void had emptied. This asserts a voided block is left untouched
-- while the live block still publishes. Far-future (2099) dates avoid the seeded
-- calendar. Self-contained.

BEGIN;

SELECT plan(3);

-- Admin (authorized builder), a far-future period, and two quad blocks: one live
-- (with a pre-created vacant seat + a draft) and one voided (emptied, as the season
-- void leaves it).
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('be000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pubvoid-admin@test.local'),
  ('be000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pubvoid-sw@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('be000000-0000-0000-0000-000000000001', 'Pub Admin', 'pubvoid-admin@test.local', 'quad', true),
  ('be000000-0000-0000-0000-000000000002', 'Pub SW', 'pubvoid-sw@test.local', 'quad', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('be000000-0000-0000-0000-000000000001', 'admin', NULL),
  ('be000000-0000-0000-0000-000000000002', 'sw', NULL);

INSERT INTO public.scheduling_periods (period_id, period_name, profile_name, start_date, end_date)
VALUES ('be000000-0000-0000-0000-0000000000f0', 'Pub Period', 'regular_school_year', '2099-06-01', '2099-08-31');

-- Live block b1 (18:00) with a pre-created vacant seat; voided block b2 (19:00),
-- emptied like the season-void path (voided_at set, no seats).
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount, voided_at) VALUES
  ('be000000-0000-0000-0000-0000000000b1', 'quad', '2099-06-01 18:00:00-04', 1, NULL),
  ('be000000-0000-0000-0000-0000000000b2', 'quad', '2099-06-01 19:00:00-04', 1, now());

INSERT INTO public.shift_block_assignments (block_id, status, vacancy_origin)
VALUES ('be000000-0000-0000-0000-0000000000b1', 'vacant', 'never_assigned');

INSERT INTO public.draft_block_assignments (period_id, block_id, user_id, created_by)
VALUES ('be000000-0000-0000-0000-0000000000f0', 'be000000-0000-0000-0000-0000000000b1',
        'be000000-0000-0000-0000-000000000002', 'be000000-0000-0000-0000-000000000001');

-- Publish the house.
SELECT publish_schedule(
  'be000000-0000-0000-0000-0000000000f0',
  'be000000-0000-0000-0000-000000000001',
  'quad');

-- 1. The live block was scheduled.
SELECT is(
  (SELECT count(*)::int FROM shift_block_assignments
   WHERE block_id = 'be000000-0000-0000-0000-0000000000b1' AND status = 'scheduled'),
  1, 'the live block publishes (draft becomes scheduled)');

-- 2. The voided block got NO rows written (not resurrected).
SELECT is(
  (SELECT count(*)::int FROM shift_block_assignments
   WHERE block_id = 'be000000-0000-0000-0000-0000000000b2'),
  0, 'publish writes nothing onto the voided block');

-- 3. The voided block is still voided.
SELECT isnt(
  (SELECT voided_at FROM shift_blocks WHERE block_id = 'be000000-0000-0000-0000-0000000000b2'),
  NULL, 'the voided block stays voided after publish');

SELECT * FROM finish();
ROLLBACK;
