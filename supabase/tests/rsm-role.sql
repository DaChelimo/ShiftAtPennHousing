-- pgTAP behavioral tests for the Residential Services Manager role (BSpec §2.3a;
-- migrations 20260617000005 + 20260617000006). Covers the three invariants that
-- must never regress: (1) own-house HM-equivalent admin powers but scope-matched
-- writes, (2) read-only cross-house schedule visibility, (3) in-hours Allied/no-ack
-- notifications route to the RSM (never the HM). Self-contained: BEGIN…ROLLBACK,
-- own fixtures, far-future anchor to avoid colliding with any seeded shift_blocks.
--
-- Run with: supabase test db   (or psql -f against a DB with the migrations applied)

BEGIN;

SELECT plan(14);

-- ============================================================
-- Fixture: at house-03 an RSM (Diana), an HM (Henry), a plain SW (Stu).
-- house-04 gets only an HM (Hilda) — its in-hours notification must fall back to
-- the HMOD (proving the HM is never the in-hours recipient). An HMOD on the rotor
-- for the anchor week makes that fallback resolvable.
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('a5000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rsm-diana@test.local'),
  ('a5000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rsm-henry@test.local'),
  ('a5000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rsm-stu@test.local'),
  ('a5000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rsm-hilda@test.local'),
  ('a5000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rsm-hmod@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('a5000000-0000-0000-0000-000000000001', 'Diana RSM', 'rsm-diana@test.local', 'house-03', true),
  ('a5000000-0000-0000-0000-000000000002', 'Henry HM',  'rsm-henry@test.local', 'house-03', true),
  ('a5000000-0000-0000-0000-000000000003', 'Stu SW',    'rsm-stu@test.local',   'house-03', true),
  ('a5000000-0000-0000-0000-000000000004', 'Hilda HM',  'rsm-hilda@test.local', 'house-04', true),
  ('a5000000-0000-0000-0000-000000000005', 'Olga HMOD', 'rsm-hmod@test.local',  'harnwell', true);

-- The house-03 RSM and HM are the sole role holders for those slots in this txn.
DELETE FROM public.user_roles WHERE role = 'rsm' AND scope_house_id IN ('house-03', 'house-04');
DELETE FROM public.user_roles WHERE role = 'hm'  AND scope_house_id IN ('house-03', 'house-04');

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('a5000000-0000-0000-0000-000000000001', 'rsm', 'house-03'),
  ('a5000000-0000-0000-0000-000000000002', 'hm',  'house-03'),
  ('a5000000-0000-0000-0000-000000000003', 'sw',  NULL),
  ('a5000000-0000-0000-0000-000000000004', 'hm',  'house-04'),
  ('a5000000-0000-0000-0000-000000000005', 'hm',  'harnwell');

-- Anchor a weekday inside HM hours (Wednesday 12:00 NY, 30 days out).
SELECT set_config(
  'test.rsm.anchor',
  (
    (
      date_trunc('hour', now() AT TIME ZONE 'America/New_York')
        + interval '30 days'
        + (12 - extract(hour from now() AT TIME ZONE 'America/New_York'))::int * interval '1 hour'
        + ((3 - extract(isodow from now() AT TIME ZONE 'America/New_York'))::int * interval '1 day')
    ) AT TIME ZONE 'America/New_York'
  )::text,
  false
);

-- HMOD on the rotor for the anchor's Friday-anchored duty week (for the house-04 fallback).
INSERT INTO public.hmod_rotor (week_start_date, hmod_user_id)
VALUES (
  (
    WITH shifted AS (
      SELECT ((current_setting('test.rsm.anchor')::timestamptz AT TIME ZONE 'America/New_York') - interval '8 hours')::date AS d
    )
    SELECT d - (((extract(isodow FROM d)::int + 2) % 7)) FROM shifted
  ),
  'a5000000-0000-0000-0000-000000000005'
)
ON CONFLICT (week_start_date) DO UPDATE SET hmod_user_id = EXCLUDED.hmod_user_id;

-- ============================================================
-- 1–2. user_is_rsm.
-- ============================================================
SELECT is(public.user_is_rsm('a5000000-0000-0000-0000-000000000001'), true,  'user_is_rsm true for the RSM');
SELECT is(public.user_is_rsm('a5000000-0000-0000-0000-000000000003'), false, 'user_is_rsm false for a plain SW');

-- ============================================================
-- 3–6. Own-house admin power, but scope-matched (no cross-house write).
-- ============================================================
SELECT is(public.user_has_house_admin_role('a5000000-0000-0000-0000-000000000001', 'house-03'), true,  'RSM is house admin of own house');
SELECT is(public.user_has_house_admin_role('a5000000-0000-0000-0000-000000000001', 'quad'),     false, 'RSM is NOT house admin of another house');
SELECT is(public.user_can_build_schedule('a5000000-0000-0000-0000-000000000001', 'house-03'),   true,  'RSM can build own house schedule');
SELECT is(public.user_can_build_schedule('a5000000-0000-0000-0000-000000000001', 'quad'),       false, 'RSM cannot build another house schedule');

-- ============================================================
-- 7. Scope is required for an rsm role row (like sm/hm/bm).
-- ============================================================
SELECT throws_ok(
  $$ INSERT INTO public.user_roles (user_id, role, scope_house_id)
     VALUES ('a5000000-0000-0000-0000-000000000003', 'rsm', NULL) $$,
  NULL, NULL,
  'an rsm role row requires a scope_house_id'
);

-- ============================================================
-- 8–9. resolve_rsm_for_house: the acting RSM, walking the leave chain.
-- ============================================================
SELECT is(
  public.resolve_rsm_for_house('house-03', current_setting('test.rsm.anchor')::timestamptz),
  'a5000000-0000-0000-0000-000000000001'::uuid,
  'resolve_rsm_for_house returns the house RSM'
);

-- RSM on leave for the anchor date with the HM as replacement → resolves to the HM.
INSERT INTO public.hm_leave (user_id, start_date, end_date, replacement_user_id, status)
VALUES (
  'a5000000-0000-0000-0000-000000000001',
  (current_setting('test.rsm.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date,
  (current_setting('test.rsm.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date,
  'a5000000-0000-0000-0000-000000000002',
  'active'
);
SELECT is(
  public.resolve_rsm_for_house('house-03', current_setting('test.rsm.anchor')::timestamptz),
  'a5000000-0000-0000-0000-000000000002'::uuid,
  'resolve_rsm_for_house follows the RSM leave chain to the HM replacement'
);

-- ============================================================
-- 10–11. In-hours Allied notification → RSM (house-03), HMOD fallback (house-04, no RSM).
-- Use a fresh anchor moment for the block start so the leave row above (which
-- moved the acting RSM to the HM) does not affect target='rsm' — re-clear it.
-- ============================================================
DELETE FROM public.hm_leave WHERE user_id = 'a5000000-0000-0000-0000-000000000001';

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('a5b10000-0000-0000-0000-000000000003', 'house-03', current_setting('test.rsm.anchor')::timestamptz, 1),
  ('a5b10000-0000-0000-0000-000000000004', 'house-04', current_setting('test.rsm.anchor')::timestamptz, 1);

SELECT is(
  (public.process_hmod_notify_allied_step(
     'a5b10000-0000-0000-0000-000000000003', 'house-03',
     current_setting('test.rsm.anchor')::timestamptz,
     current_setting('test.rsm.anchor')::timestamptz,
     'escalation_chain') ->> 'target'),
  'rsm',
  'in-hours notification at a house WITH an RSM targets the RSM'
);

SELECT is(
  (public.process_hmod_notify_allied_step(
     'a5b10000-0000-0000-0000-000000000004', 'house-04',
     current_setting('test.rsm.anchor')::timestamptz,
     current_setting('test.rsm.anchor')::timestamptz,
     'escalation_chain') ->> 'target'),
  'hmod',
  'in-hours notification at a house with NO RSM falls back to the HMOD (never the HM)'
);

-- ============================================================
-- 12. Broadcast subscription is rejected for an RSM (admin, not a broadcast SW).
-- ============================================================
SELECT throws_ok(
  $$ UPDATE public.users SET broadcast_subscribed = true
     WHERE user_id = 'a5000000-0000-0000-0000-000000000001' $$,
  NULL, NULL,
  'an RSM cannot subscribe to broadcast notifications'
);

-- ============================================================
-- 13–14. Cross-house READ: an RSM sees another house's assignments; a plain SW at
-- the same home house does not (proves the user_is_rsm clause is what grants it).
-- A quad vacant assignment is the probe row.
-- ============================================================
-- A far-future, on-boundary start (no seed reaches 2099) dodges any seeded quad
-- block while satisfying the 30-minute boundary check.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES ('a5b10000-0000-0000-0000-0000000000c1', 'quad', '2099-06-17 16:00:00+00', 1);
INSERT INTO public.shift_block_assignments (block_id, user_id, status, vacancy_origin)
VALUES ('a5b10000-0000-0000-0000-0000000000c1', NULL, 'vacant', 'never_assigned');

-- As the RSM (read scoped by RLS), capture the visible count into a GUC.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a5000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('test.rsm.rsm_count', count(*)::text, false)
FROM public.shift_block_assignments WHERE block_id = 'a5b10000-0000-0000-0000-0000000000c1';
SELECT set_config('request.jwt.claims', '{"sub":"a5000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT set_config('test.rsm.sw_count', count(*)::text, false)
FROM public.shift_block_assignments WHERE block_id = 'a5b10000-0000-0000-0000-0000000000c1';
RESET ROLE;

SELECT cmp_ok(current_setting('test.rsm.rsm_count')::int, '>=', 1, 'RSM can READ another house''s assignments (cross-house view)');
SELECT is(current_setting('test.rsm.sw_count')::int, 0, 'a plain SW at the same home house cannot read another house''s assignments');

SELECT * FROM finish();
ROLLBACK;
