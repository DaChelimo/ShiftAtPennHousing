-- pgTAP tests for Phase 09: Swaps — schema, the expiry cron, and atomic acceptance.
--
-- Spec sources:
--   BEHAVIORAL_SPECIFICATION.md §8.1 (temporary shift swap — atomic exchange,
--     acceptance guard re-runs eligibility, silent invalidation when a span is
--     dropped before acceptance), §8.2 (temporary float swap — retroactive
--     acceptance with NO cap re-check; destination SM/HM notified of the
--     corrected floater), §8.3 (permanent shift swap — 7-day expiry; bulk
--     transfer of future weeks A currently owns; skip weeks A no longer owns);
--   ARCHITECTURE.md §3.5 (swap_requests schema + the three expiry policies;
--     "The orchestrator scans swap_requests with status = pending and flips
--     them to expired when expires_at is reached"), §8.4 (the
--     `user_id = :owner` bulk-update ownership predicate), §10 (acceptance
--     atomicity: "swap user_id between block sets atomically").
--   AGENTS.md hard invariant #1 (Harnwell training — re-checked at acceptance).
-- Run with: supabase test db
--
-- WHAT THIS SUITE COVERS
-- ----------------------
--   A. SCHEMA — swap_type/swap_status enums, the swap_requests columns and
--      constraints (initiator ids always non-empty; counterparty ids nullable
--      ONLY for permanent_swap before resolution; status defaults pending; RLS).
--   B. EXPIRY CRON — `expire_pending_swaps(now)` flips pending + overdue rows to
--      `expired`, leaves not-yet-due rows, is idempotent, and never touches
--      non-pending rows. The per-type expires_at anchors (shift T-3h of the
--      earlier span; float +24h after the latest span end; permanent +7d from
--      created_at) are exercised by constructing each row's expires_at with the
--      anchor formula and flipping it at the boundary.
--   C/D/E/F. ATOMIC ACCEPTANCE — `accept_swap(...)` for temporary shift & float
--      swaps (atomic user_id exchange, acceptance-time Harnwell guard, silent
--      invalidation, non-pending guard, retroactive float swap + destination
--      notification) and `apply_permanent_swap(...)` for the ownership-guarded
--      bulk transfer of recurring weeks.
--
-- TDD-RED: the phase-09 migration (swap_requests + the RPCs) is not yet written;
-- this suite pins its contract and turns GREEN when the migration lands — the
-- same TDD discipline phase-06/07/08 used for their not-yet-existing surfaces.
-- The symmetric pre-creation/acceptance ELIGIBILITY decision and the
-- permanent-swap WEEK-SCOPING partition are the pure-function surfaces tested in
-- packages/core/tests/phase-09/*.test.ts; this suite tests the DB-side
-- transaction atomicity those decisions feed.

BEGIN;

SELECT plan(64);

-- ============================================================
-- 0. Fixture: users, roles, blocks, assignments.
--    Houses: house-05 / house-07 are single-staff; quad is the multi-staff
--    training-equivalent house; harnwell is training-gated.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('09000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p09-a1@test.local'),
  ('09000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p09-b1@test.local'),
  ('09000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p09-c1@test.local'),
  ('09000001-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p09-harn@test.local'),
  ('09000001-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p09-smdest@test.local'),
  ('09000001-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p09-q1@test.local'),
  ('09000001-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p09-q2@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('09000001-0000-0000-0000-000000000001', 'A1 (house-05)',  'p09-a1@test.local',     'house-05', true),
  ('09000001-0000-0000-0000-000000000002', 'B1 (house-07)',  'p09-b1@test.local',     'house-07', true),
  ('09000001-0000-0000-0000-000000000003', 'C1 (house-05)',  'p09-c1@test.local',     'house-05', true),
  ('09000001-0000-0000-0000-000000000004', 'Harn (harnwell)','p09-harn@test.local',   'harnwell', true),
  ('09000001-0000-0000-0000-000000000005', 'SM (house-05)',  'p09-smdest@test.local', 'house-05', true),
  ('09000001-0000-0000-0000-000000000006', 'Q1 (quad)',      'p09-q1@test.local',     'quad',     true),
  ('09000001-0000-0000-0000-000000000007', 'Q2 (quad)',      'p09-q2@test.local',     'quad',     true);

-- SM of house-05 — the destination SM notified on float-swap acceptance (§8.2).
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('09000001-0000-0000-0000-000000000005', 'sm', 'house-05')
ON CONFLICT DO NOTHING;

-- Anchor 30 days out, hour-truncated NY-local, outside seed-generated blocks.
SELECT set_config(
  'test.p09.anchor',
  ((date_trunc('hour', now() AT TIME ZONE 'America/New_York') + interval '30 days')
    AT TIME ZONE 'America/New_York')::text,
  false
);

-- Blocks. Every house-05 block needs a distinct start (UNIQUE house_id,start).
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('09000002-0000-0000-0000-0000000000a1', 'house-05', current_setting('test.p09.anchor')::timestamptz,                          1),
  ('09000002-0000-0000-0000-0000000000b1', 'house-07', current_setting('test.p09.anchor')::timestamptz + interval '30 minutes', 1),
  ('09000002-0000-0000-0000-0000000000d1', 'harnwell', current_setting('test.p09.anchor')::timestamptz + interval '60 minutes', 1),
  ('09000002-0000-0000-0000-0000000000d2', 'house-05', current_setting('test.p09.anchor')::timestamptz + interval '90 minutes', 1),
  ('09000002-0000-0000-0000-0000000000e1', 'house-05', current_setting('test.p09.anchor')::timestamptz + interval '120 minutes',1),
  ('09000002-0000-0000-0000-0000000000e2', 'house-07', current_setting('test.p09.anchor')::timestamptz + interval '150 minutes',1),
  ('09000002-0000-0000-0000-0000000000f1', 'house-05', current_setting('test.p09.anchor')::timestamptz + interval '180 minutes',1),
  ('09000002-0000-0000-0000-0000000000f2', 'house-05', current_setting('test.p09.anchor')::timestamptz + interval '210 minutes',1),
  ('09000002-0000-0000-0000-0000000000c1', 'house-05', current_setting('test.p09.anchor')::timestamptz + interval '1 day',      1),
  ('09000002-0000-0000-0000-0000000000c2', 'house-05', current_setting('test.p09.anchor')::timestamptz + interval '8 days',     1),
  ('09000002-0000-0000-0000-0000000000c3', 'house-05', current_setting('test.p09.anchor')::timestamptz + interval '15 days',    1),
  -- c4: a future, A1-owned recurring-slot week that falls on a BREAK-profile date
  -- (mapped to winter_break below) — it must NOT be permanently swappable (§8.3).
  ('09000002-0000-0000-0000-0000000000c4', 'house-05', current_setting('test.p09.anchor')::timestamptz + interval '22 days',    1);

-- Operating-profile context so the permanent-swap regular_school_year guard has
-- a calendar to read. Self-contained (no-op if seeded); mirrors phase-05-cap.sql.
INSERT INTO public.operating_profiles
  (profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
   default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
   claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset)
VALUES
  ('regular_school_year', '08:00', '00:00', 20, 'soft', 'sm_built',    true,  '[]'::jsonb,
   NULL, NULL, NULL),
  ('winter_break',        '08:00', '00:00', 40, 'hard', 'claim_based', false, '[]'::jsonb,
   '-14 days'::interval, '-3 days'::interval, '-1 day'::interval)
ON CONFLICT (profile_name) DO NOTHING;

-- Map the NY-local dates spanned by the permanent-swap weeks to regular_school_year,
-- then override the c4 week (anchor + 22d) to a break profile.
INSERT INTO public.operating_calendar (date, profile_name)
SELECT g::date, 'regular_school_year'
FROM generate_series(
  ((current_setting('test.p09.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date - 1)::timestamp,
  ((current_setting('test.p09.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date + 25)::timestamp,
  interval '1 day'
) AS g
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

INSERT INTO public.operating_calendar (date, profile_name)
VALUES (
  ((current_setting('test.p09.anchor')::timestamptz + interval '22 days')
    AT TIME ZONE 'America/New_York')::date,
  'winter_break'
)
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES
  -- Shift-swap pair (A1 @ house-05  <->  B1 @ house-07).
  ('09000003-0000-0000-0000-0000000000a1', '09000002-0000-0000-0000-0000000000a1',
   '09000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  ('09000003-0000-0000-0000-0000000000b1', '09000002-0000-0000-0000-0000000000b1',
   '09000001-0000-0000-0000-000000000002', 'scheduled', 'none', false, NULL),
  -- Harnwell-guard pair (Harn @ harnwell  <->  B1 @ house-05).
  ('09000003-0000-0000-0000-0000000000d1', '09000002-0000-0000-0000-0000000000d1',
   '09000001-0000-0000-0000-000000000004', 'scheduled', 'none', false, NULL),
  ('09000003-0000-0000-0000-0000000000d2', '09000002-0000-0000-0000-0000000000d2',
   '09000001-0000-0000-0000-000000000002', 'scheduled', 'none', false, NULL),
  -- Invalidation pair (A1 @ house-05  <->  B1 @ house-07).
  ('09000003-0000-0000-0000-0000000000e1', '09000002-0000-0000-0000-0000000000e1',
   '09000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  ('09000003-0000-0000-0000-0000000000e2', '09000002-0000-0000-0000-0000000000e2',
   '09000001-0000-0000-0000-000000000002', 'scheduled', 'none', false, NULL),
  -- Float-swap pair: Q1's float-IN @ house-05  <->  Q2's desk shift @ house-05.
  ('09000003-0000-0000-0000-0000000000f1', '09000002-0000-0000-0000-0000000000f1',
   '09000001-0000-0000-0000-000000000006', 'floated_in', 'none', true, 'quad'),
  ('09000003-0000-0000-0000-0000000000f2', '09000002-0000-0000-0000-0000000000f2',
   '09000001-0000-0000-0000-000000000007', 'scheduled', 'none', false, NULL),
  -- Permanent-swap recurring slot, three future weeks of A1's house-05 slot.
  -- Week 2 was claimed away from A1 (now C1's) — it must be skipped.
  ('09000003-0000-0000-0000-0000000000c1', '09000002-0000-0000-0000-0000000000c1',
   '09000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  ('09000003-0000-0000-0000-0000000000c2', '09000002-0000-0000-0000-0000000000c2',
   '09000001-0000-0000-0000-000000000003', 'scheduled', 'none', false, NULL),
  ('09000003-0000-0000-0000-0000000000c3', '09000002-0000-0000-0000-0000000000c3',
   '09000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  -- c4: A1 currently owns this week, but it falls on a break-profile date.
  ('09000003-0000-0000-0000-0000000000c4', '09000002-0000-0000-0000-0000000000c4',
   '09000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL);

-- Swap requests. Temporary/permanent acceptance swaps carry a far-future
-- expires_at so the expiry-cron `now` values below never flip them.
INSERT INTO public.swap_requests
  (swap_id, swap_type, initiator_user_id, counterparty_user_id,
   initiator_assignment_ids, counterparty_assignment_ids, recurring_pattern, status,
   created_at, expires_at)
VALUES
  -- C. shift swap A1 <-> B1.
  ('09000004-0000-0000-0000-0000000000c0', 'shift_swap',
   '09000001-0000-0000-0000-000000000001', '09000001-0000-0000-0000-000000000002',
   ARRAY['09000003-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY['09000003-0000-0000-0000-0000000000b1']::uuid[],
   NULL, 'pending',
   current_setting('test.p09.anchor')::timestamptz - interval '1 day',
   current_setting('test.p09.anchor')::timestamptz + interval '100 days'),
  -- D1. shift swap that would place B1 (house-07) at the Harnwell desk.
  ('09000004-0000-0000-0000-0000000000d0', 'shift_swap',
   '09000001-0000-0000-0000-000000000004', '09000001-0000-0000-0000-000000000002',
   ARRAY['09000003-0000-0000-0000-0000000000d1']::uuid[],
   ARRAY['09000003-0000-0000-0000-0000000000d2']::uuid[],
   NULL, 'pending',
   current_setting('test.p09.anchor')::timestamptz - interval '1 day',
   current_setting('test.p09.anchor')::timestamptz + interval '100 days'),
  -- D2. shift swap whose initiator span is dropped before acceptance.
  ('09000004-0000-0000-0000-0000000000e0', 'shift_swap',
   '09000001-0000-0000-0000-000000000001', '09000001-0000-0000-0000-000000000002',
   ARRAY['09000003-0000-0000-0000-0000000000e1']::uuid[],
   ARRAY['09000003-0000-0000-0000-0000000000e2']::uuid[],
   NULL, 'pending',
   current_setting('test.p09.anchor')::timestamptz - interval '1 day',
   current_setting('test.p09.anchor')::timestamptz + interval '100 days'),
  -- E. float swap Q1's float-in <-> Q2's desk shift.
  ('09000004-0000-0000-0000-0000000000f0', 'float_swap',
   '09000001-0000-0000-0000-000000000006', '09000001-0000-0000-0000-000000000007',
   ARRAY['09000003-0000-0000-0000-0000000000f1']::uuid[],
   ARRAY['09000003-0000-0000-0000-0000000000f2']::uuid[],
   NULL, 'pending',
   current_setting('test.p09.anchor')::timestamptz - interval '1 day',
   current_setting('test.p09.anchor')::timestamptz + interval '100 days'),
  -- F. permanent swap A1 <-> B1; counterparty ids unresolved (NULL) at creation.
  ('09000004-0000-0000-0000-0000000000a0', 'permanent_swap',
   '09000001-0000-0000-0000-000000000001', '09000001-0000-0000-0000-000000000002',
   ARRAY['09000003-0000-0000-0000-0000000000c1',
         '09000003-0000-0000-0000-0000000000c3']::uuid[],
   NULL,
   '{"house_id":"house-05","day_of_week":4,"block_start_local":"19:00"}'::jsonb,
   'pending',
   current_setting('test.p09.anchor')::timestamptz - interval '1 day',
   current_setting('test.p09.anchor')::timestamptz + interval '100 days'),
  -- F-break. permanent swap whose A1-owned week (c4) is on a break-profile date.
  ('09000004-0000-0000-0000-0000000000a1', 'permanent_swap',
   '09000001-0000-0000-0000-000000000001', '09000001-0000-0000-0000-000000000002',
   ARRAY['09000003-0000-0000-0000-0000000000c4']::uuid[],
   NULL,
   '{"house_id":"house-05","day_of_week":4,"block_start_local":"19:00"}'::jsonb,
   'pending',
   current_setting('test.p09.anchor')::timestamptz - interval '1 day',
   current_setting('test.p09.anchor')::timestamptz + interval '100 days');

-- Expiry-cron swaps, each with its per-type anchor expires_at.
INSERT INTO public.swap_requests
  (swap_id, swap_type, initiator_user_id, counterparty_user_id,
   initiator_assignment_ids, counterparty_assignment_ids, recurring_pattern, status,
   created_at, expires_at)
VALUES
  -- shift swap: expires at T-3h of the EARLIER span (min start = anchor+0).
  ('09000004-0000-0000-0000-0000000000e9', 'shift_swap',
   '09000001-0000-0000-0000-000000000001', '09000001-0000-0000-0000-000000000002',
   ARRAY['09000003-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY['09000003-0000-0000-0000-0000000000b1']::uuid[],
   NULL, 'pending',
   current_setting('test.p09.anchor')::timestamptz - interval '1 day',
   current_setting('test.p09.anchor')::timestamptz - interval '3 hours'),
  -- float swap: expires 24h after the LATEST span end (latest start anchor+210m,
  -- + 30m block = anchor+240m, + 24h).
  ('09000004-0000-0000-0000-0000000000f9', 'float_swap',
   '09000001-0000-0000-0000-000000000006', '09000001-0000-0000-0000-000000000007',
   ARRAY['09000003-0000-0000-0000-0000000000f1']::uuid[],
   ARRAY['09000003-0000-0000-0000-0000000000f2']::uuid[],
   NULL, 'pending',
   current_setting('test.p09.anchor')::timestamptz - interval '1 day',
   current_setting('test.p09.anchor')::timestamptz + interval '240 minutes' + interval '24 hours'),
  -- permanent swap: expires 7 days after created_at.
  ('09000004-0000-0000-0000-0000000000a9', 'permanent_swap',
   '09000001-0000-0000-0000-000000000001', '09000001-0000-0000-0000-000000000002',
   ARRAY['09000003-0000-0000-0000-0000000000c1']::uuid[],
   NULL,
   '{"house_id":"house-05","day_of_week":4,"block_start_local":"19:00"}'::jsonb,
   'pending',
   current_setting('test.p09.anchor')::timestamptz,
   current_setting('test.p09.anchor')::timestamptz + interval '7 days'),
  -- already-accepted swap with a long-past expires_at — the cron must NOT touch it.
  ('09000004-0000-0000-0000-0000000000b9', 'shift_swap',
   '09000001-0000-0000-0000-000000000001', '09000001-0000-0000-0000-000000000002',
   ARRAY['09000003-0000-0000-0000-0000000000e1']::uuid[],
   ARRAY['09000003-0000-0000-0000-0000000000e2']::uuid[],
   NULL, 'accepted',
   current_setting('test.p09.anchor')::timestamptz - interval '20 days',
   current_setting('test.p09.anchor')::timestamptz - interval '10 days');

-- ============================================================
-- A. SCHEMA — enums, columns, constraints, defaults, RLS.
-- ============================================================

SELECT has_table('public', 'swap_requests', 'swap_requests table exists (ARCH §3.5)');

SELECT has_type('public', 'swap_type_enum', 'swap_type_enum type exists');
SELECT enum_has_labels(
  'public', 'swap_type_enum',
  ARRAY['shift_swap', 'float_swap', 'permanent_swap'],
  'swap_type_enum has the three swap types (ARCH §3.5)'
);

SELECT has_type('public', 'swap_status_enum', 'swap_status_enum type exists');
SELECT enum_has_labels(
  'public', 'swap_status_enum',
  ARRAY['pending', 'accepted', 'rejected', 'expired', 'voided'],
  'swap_status_enum has all five statuses (ARCH §3.5)'
);

SELECT has_column('public', 'swap_requests', 'swap_id', 'swap_requests.swap_id');
SELECT has_column('public', 'swap_requests', 'initiator_assignment_ids', 'swap_requests.initiator_assignment_ids');
SELECT has_column('public', 'swap_requests', 'counterparty_assignment_ids', 'swap_requests.counterparty_assignment_ids');
SELECT has_column('public', 'swap_requests', 'recurring_pattern', 'swap_requests.recurring_pattern (jsonb for permanent_swap)');
SELECT has_column('public', 'swap_requests', 'expires_at', 'swap_requests.expires_at');

SELECT col_type_is('public', 'swap_requests', 'initiator_assignment_ids', 'uuid[]',
  'initiator_assignment_ids is uuid[] (seat-level, like floats — ARCH §3.5)');
SELECT col_type_is('public', 'swap_requests', 'recurring_pattern', 'jsonb',
  'recurring_pattern is jsonb');
SELECT col_not_null('public', 'swap_requests', 'swap_type', 'swap_type is NOT NULL');
SELECT col_default_is('public', 'swap_requests', 'status', 'pending',
  'status defaults to pending');

-- counterparty ids are NULL-able ONLY because permanent_swap leaves them
-- unresolved before acceptance.
SELECT lives_ok(
  $$ INSERT INTO public.swap_requests
       (swap_id, swap_type, initiator_user_id, counterparty_user_id,
        initiator_assignment_ids, counterparty_assignment_ids, status, expires_at)
     VALUES
       ('09000004-0000-0000-0000-0000000000aa', 'permanent_swap',
        '09000001-0000-0000-0000-000000000001', '09000001-0000-0000-0000-000000000002',
        ARRAY['09000003-0000-0000-0000-0000000000c1']::uuid[], NULL, 'pending',
        current_setting('test.p09.anchor')::timestamptz + interval '7 days') $$,
  'permanent_swap with NULL counterparty_assignment_ids is allowed (unresolved)'
);

-- a temporary swap with an EMPTY counterparty set is rejected (it must name the
-- target span at creation).
SELECT throws_ok(
  $$ INSERT INTO public.swap_requests
       (swap_id, swap_type, initiator_user_id, counterparty_user_id,
        initiator_assignment_ids, counterparty_assignment_ids, status, expires_at)
     VALUES
       ('09000004-0000-0000-0000-0000000000ab', 'shift_swap',
        '09000001-0000-0000-0000-000000000001', '09000001-0000-0000-0000-000000000002',
        ARRAY['09000003-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], 'pending',
        current_setting('test.p09.anchor')::timestamptz) $$,
  '23514', NULL,
  'shift_swap with an empty counterparty_assignment_ids is rejected (CHECK)'
);

-- the initiator span is always required.
SELECT throws_ok(
  $$ INSERT INTO public.swap_requests
       (swap_id, swap_type, initiator_user_id, counterparty_user_id,
        initiator_assignment_ids, counterparty_assignment_ids, status, expires_at)
     VALUES
       ('09000004-0000-0000-0000-0000000000ac', 'shift_swap',
        '09000001-0000-0000-0000-000000000001', '09000001-0000-0000-0000-000000000002',
        ARRAY[]::uuid[], ARRAY['09000003-0000-0000-0000-0000000000b1']::uuid[], 'pending',
        current_setting('test.p09.anchor')::timestamptz) $$,
  '23514', NULL,
  'a swap with an empty initiator_assignment_ids is rejected (CHECK)'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
   WHERE relname = 'swap_requests' AND relnamespace = 'public'::regnamespace),
  'RLS is enabled on swap_requests (AGENTS conventions)'
);

-- Clean up the two schema-probe rows so they do not perturb the cron counts.
DELETE FROM public.swap_requests
WHERE swap_id = '09000004-0000-0000-0000-0000000000aa';

-- ============================================================
-- B. EXPIRY CRON — expire_pending_swaps(now) flips pending + overdue → expired.
-- ============================================================

SELECT has_function(
  'public', 'expire_pending_swaps', ARRAY['timestamptz'],
  'expire_pending_swaps(timestamptz) exists (the orchestrator scan, ARCH §3.5)'
);

-- B1. Before the earliest anchor (anchor − 4h): nothing is due yet.
SELECT is(
  public.expire_pending_swaps(current_setting('test.p09.anchor')::timestamptz - interval '4 hours'),
  0,
  'expiry: at anchor−4h no pending swap is overdue → 0 flipped'
);
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '09000004-0000-0000-0000-0000000000e9'),
  'pending',
  'expiry: the shift swap (expires anchor−3h) is still pending at anchor−4h'
);

-- B2. At anchor − 2h: the shift swap (anchor−3h) is now overdue; float (anchor+~25h)
--     and permanent (anchor+7d) are not.
SELECT is(
  public.expire_pending_swaps(current_setting('test.p09.anchor')::timestamptz - interval '2 hours'),
  1,
  'expiry: at anchor−2h only the shift swap is overdue → 1 flipped'
);
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '09000004-0000-0000-0000-0000000000e9'),
  'expired',
  'expiry: shift swap (T-3h of earlier span) flipped to expired'
);
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '09000004-0000-0000-0000-0000000000f9'),
  'pending',
  'expiry: the float swap is NOT yet due at anchor−2h'
);

-- B3. Idempotency — re-running at the same now flips nothing new.
SELECT is(
  public.expire_pending_swaps(current_setting('test.p09.anchor')::timestamptz - interval '2 hours'),
  0,
  'expiry: idempotent — a second run at anchor−2h flips 0 (already-expired rows untouched)'
);
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '09000004-0000-0000-0000-0000000000e9'),
  'expired',
  'expiry: idempotent — the already-expired shift swap is unchanged'
);

-- B4. At anchor + 8 days: float (anchor+~25h) and permanent (anchor+7d) are now
--     overdue too. The shift swap is already expired and is not recounted.
SELECT is(
  public.expire_pending_swaps(current_setting('test.p09.anchor')::timestamptz + interval '8 days'),
  2,
  'expiry: at anchor+8d the float (+24h) and permanent (+7d) swaps flip → 2'
);
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '09000004-0000-0000-0000-0000000000f9'),
  'expired',
  'expiry: float swap (24h after latest span end) flipped to expired'
);
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '09000004-0000-0000-0000-0000000000a9'),
  'expired',
  'expiry: permanent swap (7 days after created_at) flipped to expired'
);

-- B5. The already-accepted swap (long-past expires_at) is never touched.
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '09000004-0000-0000-0000-0000000000b9'),
  'accepted',
  'expiry: an accepted swap with a past expires_at is never flipped (only pending rows expire)'
);

-- B6. The far-future acceptance swaps survived every cron run.
SELECT is(
  (SELECT count(*)::integer FROM public.swap_requests
   WHERE swap_id IN ('09000004-0000-0000-0000-0000000000c0',
                     '09000004-0000-0000-0000-0000000000d0',
                     '09000004-0000-0000-0000-0000000000e0',
                     '09000004-0000-0000-0000-0000000000f0',
                     '09000004-0000-0000-0000-0000000000a0')
     AND status = 'pending'),
  5,
  'expiry: the five far-future acceptance swaps remain pending'
);

-- ============================================================
-- C. ATOMIC ACCEPTANCE — temporary shift swap (§8.1, ARCH §10).
--    The counterparty (B1) accepts; the two seats exchange user_id atomically.
-- ============================================================

SELECT is(
  (SELECT (public.accept_swap(
     '09000004-0000-0000-0000-0000000000c0'::uuid,
     '09000001-0000-0000-0000-000000000002'::uuid,
     current_setting('test.p09.anchor')::timestamptz - interval '1 hour')) ->> 'accepted'),
  'true',
  'shift swap: accept_swap returns accepted=true'
);
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '09000004-0000-0000-0000-0000000000c0'),
  'accepted',
  'shift swap: status -> accepted'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000a1'),
  '09000001-0000-0000-0000-000000000002'::uuid,
  'shift swap: A1''s former house-05 seat now belongs to B1 (atomic exchange)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000b1'),
  '09000001-0000-0000-0000-000000000001'::uuid,
  'shift swap: B1''s former house-07 seat now belongs to A1 (atomic exchange)'
);

-- Edge: "swap, then one drops the newly received shift → the dropped shift
-- belongs to the new owner." B1 now owns the house-05 seat and drops it.
UPDATE public.shift_block_assignments
SET user_id = NULL, status = 'vacant', vacancy_origin = 'temporary_drop'
WHERE assignment_id = '09000003-0000-0000-0000-0000000000a1'
  AND user_id = '09000001-0000-0000-0000-000000000002';

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000a1'),
  'vacant',
  'post-swap drop: the new owner (B1) drops the received seat → vacant (it was B1''s to drop)'
);

-- ============================================================
-- D. ACCEPTANCE GUARDS — Harnwell re-check, silent invalidation, non-pending.
-- ============================================================

-- D1. The acceptance guard re-runs the symmetric eligibility check (§8.1):
--     B1 (house-07) cannot take the Harnwell desk. Acceptance is refused and
--     NO seat changes.
SELECT is(
  (SELECT (public.accept_swap(
     '09000004-0000-0000-0000-0000000000d0'::uuid,
     '09000001-0000-0000-0000-000000000002'::uuid,
     current_setting('test.p09.anchor')::timestamptz - interval '1 hour')) ->> 'accepted'),
  'false',
  'acceptance Harnwell guard: a swap that would place B1 at Harnwell is refused'
);
SELECT is(
  (SELECT (public.accept_swap(
     '09000004-0000-0000-0000-0000000000d0'::uuid,
     '09000001-0000-0000-0000-000000000002'::uuid,
     current_setting('test.p09.anchor')::timestamptz - interval '1 hour')) ->> 'reason'),
  'harnwell_training_required',
  'acceptance Harnwell guard: reason is harnwell_training_required (shared vocabulary)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000d1'),
  '09000001-0000-0000-0000-000000000004'::uuid,
  'acceptance Harnwell guard: the Harnwell seat is unchanged (no partial write)'
);

-- D2. Silent invalidation (§8.1): A1 drops the initiator span before B1 accepts.
--     The shift_block_assignments trigger voids the pending swap the instant the
--     seat goes vacant; accept_swap then just confirms it is no longer pending.
UPDATE public.shift_block_assignments
SET user_id = NULL, status = 'vacant', vacancy_origin = 'temporary_drop'
WHERE assignment_id = '09000003-0000-0000-0000-0000000000e1';

SELECT is(
  (SELECT (public.accept_swap(
     '09000004-0000-0000-0000-0000000000e0'::uuid,
     '09000001-0000-0000-0000-000000000002'::uuid,
     current_setting('test.p09.anchor')::timestamptz - interval '1 hour')) ->> 'accepted'),
  'false',
  'invalidation: accepting a swap whose initiator span was dropped is refused'
);
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '09000004-0000-0000-0000-0000000000e0'),
  'voided',
  'invalidation: the swap is silently voided (§8.1), not left pending'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000e2'),
  '09000001-0000-0000-0000-000000000002'::uuid,
  'invalidation: the counterparty seat is untouched'
);

-- D3. Non-pending guard: the shift swap accepted in section C cannot be
--     re-accepted.
SELECT is(
  (SELECT (public.accept_swap(
     '09000004-0000-0000-0000-0000000000c0'::uuid,
     '09000001-0000-0000-0000-000000000002'::uuid,
     current_setting('test.p09.anchor')::timestamptz)) ->> 'accepted'),
  'false',
  'non-pending guard: an already-accepted swap cannot be accepted again'
);
SELECT is(
  (SELECT (public.accept_swap(
     '09000004-0000-0000-0000-0000000000c0'::uuid,
     '09000001-0000-0000-0000-000000000002'::uuid,
     current_setting('test.p09.anchor')::timestamptz)) ->> 'reason'),
  'not_pending',
  'non-pending guard: reason is not_pending'
);

-- ============================================================
-- E. FLOAT SWAP — retroactive acceptance + destination notification (§8.2).
--    Accepted AFTER the shift end (p_now past the block). No cap re-check;
--    the destination SM is notified of the corrected floater.
-- ============================================================

SELECT is(
  (SELECT (public.accept_swap(
     '09000004-0000-0000-0000-0000000000f0'::uuid,
     '09000001-0000-0000-0000-000000000007'::uuid,
     current_setting('test.p09.anchor')::timestamptz + interval '1 day')) ->> 'accepted'),
  'true',
  'float swap: retroactive acceptance (after the shift was worked) succeeds, no cap re-check'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000f1'),
  '09000001-0000-0000-0000-000000000007'::uuid,
  'float swap: the house-05 float-IN seat now shows the corrected floater (Q2)'
);
SELECT is(
  (SELECT is_float FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000f1'),
  true,
  'float swap: the corrected seat is still a float (identity changed, not the float-ness)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000f2'),
  '09000001-0000-0000-0000-000000000006'::uuid,
  'float swap: the desk seat now belongs to Q1 (the former floater)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE recipient_user_id = '09000001-0000-0000-0000-000000000005'
     AND type = 'swap_request'
     AND payload ->> 'corrected_floater_user_id' = '09000001-0000-0000-0000-000000000007'),
  1,
  'float swap: the destination SM is notified of the corrected floater identity (§8.2)'
);

-- ============================================================
-- F. PERMANENT SWAP — ownership-guarded atomic bulk transfer (§8.3, ARCH §8.4).
--    A1's future-owned weeks (w1, w3) transfer to B1; week 2 (owned by C1) is
--    skipped by the `user_id = initiator` predicate.
-- ============================================================

SELECT has_function(
  'public', 'apply_permanent_swap',
  ARRAY['uuid', 'uuid', 'uuid[]', 'timestamptz'],
  'apply_permanent_swap(swap_id, new_owner, affected_ids[], now) exists'
);

SELECT is(
  (SELECT (public.apply_permanent_swap(
     '09000004-0000-0000-0000-0000000000a0'::uuid,
     '09000001-0000-0000-0000-000000000002'::uuid,
     ARRAY['09000003-0000-0000-0000-0000000000c1',
           '09000003-0000-0000-0000-0000000000c2',
           '09000003-0000-0000-0000-0000000000c3']::uuid[],
     current_setting('test.p09.anchor')::timestamptz)) ->> 'transferred_count'),
  '2',
  'permanent swap: only the 2 weeks A1 currently owns transfer (the 3rd is C1''s)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000c1'),
  '09000001-0000-0000-0000-000000000002'::uuid,
  'permanent swap: week 1 (A1-owned) transferred to B1'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000c3'),
  '09000001-0000-0000-0000-000000000002'::uuid,
  'permanent swap: week 3 (A1-owned) transferred to B1'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000c2'),
  '09000001-0000-0000-0000-000000000003'::uuid,
  'permanent swap: week 2 (no longer A1''s) is skipped — the ownership predicate holds (ARCH §8.4)'
);
SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '09000004-0000-0000-0000-0000000000a0'),
  'accepted',
  'permanent swap: the request is marked accepted after the bulk transfer'
);

-- F-break. The regular_school_year backstop (§8.3): apply_permanent_swap skips a
-- week whose operating date is a break profile even when A1 still owns it —
-- break shifts are claim-based and not permanently swappable.
SELECT is(
  (SELECT (public.apply_permanent_swap(
     '09000004-0000-0000-0000-0000000000a1'::uuid,
     '09000001-0000-0000-0000-000000000002'::uuid,
     ARRAY['09000003-0000-0000-0000-0000000000c4']::uuid[],
     current_setting('test.p09.anchor')::timestamptz)) ->> 'transferred_count'),
  '0',
  'permanent swap: a break-profile week is skipped by the regular_school_year backstop (§8.3)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000c4'),
  '09000001-0000-0000-0000-000000000001'::uuid,
  'permanent swap: the break-profile week stays with A1 (not transferred to B1)'
);

-- F-guard. assignments_outside_regular_school_year — the create-swap pre-creation
-- guard helper: flags break-profile assignments, clears regular-year ones.
SELECT has_function(
  'public', 'assignments_outside_regular_school_year', ARRAY['uuid[]'],
  'assignments_outside_regular_school_year(uuid[]) exists (permanent-swap creation guard, §8.3)'
);
SELECT is(
  public.assignments_outside_regular_school_year(
    ARRAY['09000003-0000-0000-0000-0000000000c1',
          '09000003-0000-0000-0000-0000000000c4']::uuid[]),
  ARRAY['09000003-0000-0000-0000-0000000000c4']::uuid[],
  'creation guard flags the break-profile assignment (c4) and clears the regular one (c1)'
);
SELECT is(
  public.assignments_outside_regular_school_year(
    ARRAY['09000003-0000-0000-0000-0000000000c1',
          '09000003-0000-0000-0000-0000000000c3']::uuid[]),
  ARRAY[]::uuid[],
  'creation guard returns empty when every assignment is regular_school_year'
);

-- ============================================================
-- G. PROACTIVE SWAP INVALIDATION (§8.1/§8.2). A shift_block_assignments trigger
--    silently voids a PENDING swap the moment one of its seats is dropped or
--    floated out, regardless of which write path did it — closing the seam the
--    Phase 5/7/8 float/drop RPCs never had (they predate swap_requests). The
--    acknowledged float-OUT case below is the one accept_swap's old
--    vacant/allied span-check missed.
-- ============================================================

-- G-fixture: a fresh pending shift swap (A1 [a2] <-> B1 [b2]).
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('09000002-0000-0000-0000-0000000000a2', 'house-05',
   current_setting('test.p09.anchor')::timestamptz + interval '3 days', 1),
  ('09000002-0000-0000-0000-0000000000b2', 'house-07',
   current_setting('test.p09.anchor')::timestamptz + interval '3 days' + interval '30 minutes', 1);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES
  ('09000003-0000-0000-0000-0000000000a2', '09000002-0000-0000-0000-0000000000a2',
   '09000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  ('09000003-0000-0000-0000-0000000000b2', '09000002-0000-0000-0000-0000000000b2',
   '09000001-0000-0000-0000-000000000002', 'scheduled', 'none', false, NULL);

INSERT INTO public.swap_requests
  (swap_id, swap_type, initiator_user_id, counterparty_user_id,
   initiator_assignment_ids, counterparty_assignment_ids, recurring_pattern, status,
   created_at, expires_at)
VALUES
  ('09000004-0000-0000-0000-0000000000b0', 'shift_swap',
   '09000001-0000-0000-0000-000000000001', '09000001-0000-0000-0000-000000000002',
   ARRAY['09000003-0000-0000-0000-0000000000a2']::uuid[],
   ARRAY['09000003-0000-0000-0000-0000000000b2']::uuid[],
   NULL, 'pending',
   current_setting('test.p09.anchor')::timestamptz - interval '1 day',
   current_setting('test.p09.anchor')::timestamptz + interval '100 days');

SELECT has_trigger(
  'public', 'shift_block_assignments', 'shift_block_assignments_void_pending_swaps',
  'the proactive swap-invalidation trigger exists on shift_block_assignments'
);

-- A1's swapped seat is floated OUT (an acknowledged automated float). No one
-- touches the swap, yet it must be voided (§8.1) — the case the old
-- vacant/allied span-check would have let slip through to a stale acceptance.
UPDATE public.shift_block_assignments
SET status = 'floated_out'
WHERE assignment_id = '09000003-0000-0000-0000-0000000000a2';

SELECT is(
  (SELECT status::text FROM public.swap_requests WHERE swap_id = '09000004-0000-0000-0000-0000000000b0'),
  'voided',
  'proactive invalidation: floating a swapped seat OUT silently voids the pending swap (§8.1/§8.2)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '09000003-0000-0000-0000-0000000000b2'),
  '09000001-0000-0000-0000-000000000002'::uuid,
  'proactive invalidation: the counterparty seat is untouched by the void'
);
SELECT is(
  (SELECT (public.accept_swap(
     '09000004-0000-0000-0000-0000000000b0'::uuid,
     '09000001-0000-0000-0000-000000000002'::uuid,
     current_setting('test.p09.anchor')::timestamptz)) ->> 'reason'),
  'not_pending',
  'proactive invalidation: the voided swap can no longer be accepted'
);

SELECT finish();
ROLLBACK;
