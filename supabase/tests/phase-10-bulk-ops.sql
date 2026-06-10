-- pgTAP tests for Phase 10: Permanent Drop and Permanent Pickup bulk operations.
--
-- Spec sources:
--   BEHAVIORAL_SPECIFICATION.md
--     §8.4.1 (permanent drop — atomic bulk-vacate of every FUTURE occurrence of
--       a recurring slot the dropping worker currently owns, within the current
--       semester; mid-shift / past / not-owned / embedded-break / float-committed
--       occurrences are excluded; the SM of the house is notified in-app),
--     §8.4.2 (SM/HM-initiated permanent removal — same scope; the affected
--       worker also receives an in-app notification identifying the operator),
--     §8.4.3 (permanent pickup — atomic bulk-assign; on submit the rows are
--       claimed only while still vacant+permanent_drop (race-safe); the slot is
--       removed from the permanent openings feed regardless of completeness),
--     §8.4.4 (boundary: a worker may drop then re-pick-up the same slot while it
--       is still in the feed and unclaimed by another);
--   ARCHITECTURE.md §7.1
--     (the `scheduling_periods.end_date` point lookup → `semester_end_date`;
--      "if the lookup returns no row … raise an application-layer error" — the
--      drop must NOT silently proceed unbounded; the exact bulk-UPDATE predicate;
--      the no-takeback trailing clause `status NOT IN ('floated_out',
--      'pending_float_out')`; the SM + SW notification inserts),
--   ARCHITECTURE.md §7.2
--     (the race-safe submit predicate `status='vacant' AND
--      vacancy_origin='permanent_drop'`; the cross-house `is_cross_house_pickup`
--      / `source_house_id` fields; the Harnwell-training precheck),
--   ARCHITECTURE.md §7.3 (re-permanent-drop after pickup — identical procedure).
--   AGENTS.md hard invariants #1 (Harnwell training — enforced at the pickup
--     write point), #3 (no-takeback), #5 (30-minute blocks), #6 (NY timestamptz).
-- Run with: supabase test db
--
-- WHAT THIS SUITE COVERS
-- ----------------------
--   A. Function existence — `permanent_drop_slot`, `permanent_pickup_slot`.
--   B. PERMANENT DROP (worker self-initiated) — one recurring slot with eight
--      weekly occurrences exercises every exclusion at once: only the FUTURE ∧
--      in-semester ∧ regular ∧ owned ∧ not-float-committed weeks are vacated;
--      the SM is notified; the self-dropping worker is NOT sent a removal alert.
--   C. SM/HM-INITIATED REMOVAL — same scope; the worker receives an
--      sw_permanent_removal_alert naming the operator.
--   D. SEMESTER-BOUNDARY ERROR — a drop whose date no scheduling_periods row
--      covers throws rather than vacating an unbounded range (ARCH §7.1).
--   E. PERMANENT PICKUP — race-safe partial pickup (a week claimed away between
--      popup and submit is silently skipped), cross-house field-setting,
--      Harnwell-training rejection, and permanent-feed removal.
--   F. RE-DROP + RE-PICKUP — a worker drops then re-picks-up the same slot.
--
-- TDD-RED: the phase-10 migration (`permanent_drop_slot` / `permanent_pickup_slot`)
-- is not yet written; this suite pins their contract and turns GREEN when the
-- migration lands — the same TDD discipline phase-09 used for its not-yet-existing
-- swap RPCs. The pure affected/skipped PARTITION and the per-week CONFLICT/CAP
-- evaluation those RPCs feed on are the pure-function surfaces tested in
-- packages/core/tests/phase-10/*.test.ts; this suite tests the DB-side
-- transaction atomicity, the race-safe predicate, and the notification inserts.

BEGIN;

SELECT plan(46);

-- ============================================================
-- 0. Fixtures: users, the SM-of-house-05 role, the recurring-slot blocks, the
--    operating calendar + scheduling period.
--
--    Anchor: a FIXED Thursday-evening NY-local timestamp in July 2027 — chosen
--    DST-stable (EDT throughout July/August, so every weekly occurrence shares
--    the same UTC offset and the recurring-slot pattern (DOW + local time)
--    matches cleanly across all eight weeks, AGENTS invariant #6). All block
--    local times are <= 19:30 so each block's UTC-slice date equals its NY-local
--    calendar date, keeping the semester-boundary + operating_calendar joins
--    robust to whichever timezone form the implementation uses.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('0a000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p10-dropper@test.local'),
  ('0a000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p10-other@test.local'),
  ('0a000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p10-picker@test.local'),
  ('0a000001-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p10-sm05@test.local'),
  ('0a000001-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p10-worker2@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('0a000001-0000-0000-0000-000000000001', 'Dropper (house-05)', 'p10-dropper@test.local', 'house-05', true),
  ('0a000001-0000-0000-0000-000000000002', 'Other (house-05)',   'p10-other@test.local',   'house-05', true),
  ('0a000001-0000-0000-0000-000000000003', 'Picker (house-05)',  'p10-picker@test.local',  'house-05', true),
  ('0a000001-0000-0000-0000-000000000004', 'SM (house-05)',      'p10-sm05@test.local',    'house-05', true),
  ('0a000001-0000-0000-0000-000000000005', 'Worker2 (house-05)', 'p10-worker2@test.local', 'house-05', true);

-- SM of house-05 — the recipient of the sm_permanent_drop_alert (§10 / §8.4.1).
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('0a000001-0000-0000-0000-000000000004', 'sm', 'house-05')
ON CONFLICT DO NOTHING;

-- Anchor: 2027-07-01 19:00 America/New_York (EDT). Stored as timestamptz.
-- (Was 2026-07-02; bumped +52 weeks — same Thursday, same EDT/DST-stable window —
-- to clear the seed's Jun–Aug 2026 "Summer 2026" e2e period, which overlaps this
-- suite's anchor-derived scheduling_periods row and would trip the no-overlap
-- exclusion. Everything else here is anchor-relative, so the suite just shifts.)
SELECT set_config(
  'test.p10.anchor',
  ('2027-07-01 19:00'::timestamp AT TIME ZONE 'America/New_York')::text,
  false
);

-- Operating profiles (self-contained; no-op if seeded). The permanent-drop
-- regular_school_year predicate reads operating_calendar; the cap default lives
-- on the profile.
INSERT INTO public.operating_profiles
  (profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
   default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
   claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset)
VALUES
  ('regular_school_year', '08:00', '00:00', 20, 'soft', 'sm_built',    true,  '[]'::jsonb,
   NULL, NULL, NULL),
  ('short_break',         '08:00', '00:00', 40, 'hard', 'claim_based', false, '[]'::jsonb,
   '-14 days'::interval, '-3 days'::interval, '-1 day'::interval)
ON CONFLICT (profile_name) DO NOTHING;

-- Operating calendar: every block date is regular_school_year, EXCEPT the
-- anchor+28d week, which is an embedded short break (claim-based, no slot).
INSERT INTO public.operating_calendar (date, profile_name)
SELECT g::date, 'regular_school_year'
FROM generate_series(
  ((current_setting('test.p10.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date - 8)::timestamp,
  ((current_setting('test.p10.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date + 44)::timestamp,
  interval '1 day'
) AS g
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

INSERT INTO public.operating_calendar (date, profile_name)
VALUES (
  ((current_setting('test.p10.anchor')::timestamptz + interval '28 days')
    AT TIME ZONE 'America/New_York')::date,
  'short_break'
)
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

-- Scheduling period: the semester boundary the drop reads. end_date = anchor+38d
-- so the anchor+35d week (w4) is in-semester and the anchor+42d week (w_next) is
-- next semester (out of scope). Covers the drop date (the anchor's date).
INSERT INTO public.scheduling_periods (period_name, profile_name, start_date, end_date)
VALUES (
  'Fall 2027', 'regular_school_year',
  ((current_setting('test.p10.anchor')::timestamptz AT TIME ZONE 'America/New_York')::date - 8),
  ((current_setting('test.p10.anchor')::timestamptz + interval '38 days')
    AT TIME ZONE 'America/New_York')::date
);

-- The recurring slot: house-05, Thursdays, 19:00, eight consecutive weeks.
-- Plus three single-week blocks for the SM-initiated (17:00), re-pickup (18:00)
-- and cross-house (house-07 17:00) / Harnwell (16:00) scenarios.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('0a000002-0000-0000-0000-0000000000a0', 'house-05', current_setting('test.p10.anchor')::timestamptz - interval '7 days',  1),
  ('0a000002-0000-0000-0000-0000000000a1', 'house-05', current_setting('test.p10.anchor')::timestamptz,                       1),
  ('0a000002-0000-0000-0000-0000000000a2', 'house-05', current_setting('test.p10.anchor')::timestamptz + interval '7 days',   1),
  ('0a000002-0000-0000-0000-0000000000a3', 'house-05', current_setting('test.p10.anchor')::timestamptz + interval '14 days',  1),
  ('0a000002-0000-0000-0000-0000000000a4', 'house-05', current_setting('test.p10.anchor')::timestamptz + interval '21 days',  1),
  ('0a000002-0000-0000-0000-0000000000a5', 'house-05', current_setting('test.p10.anchor')::timestamptz + interval '28 days',  1),
  ('0a000002-0000-0000-0000-0000000000a6', 'house-05', current_setting('test.p10.anchor')::timestamptz + interval '35 days',  1),
  ('0a000002-0000-0000-0000-0000000000a7', 'house-05', current_setting('test.p10.anchor')::timestamptz + interval '42 days',  1),
  -- C: WORKER2's single-week house-05 17:00 slot, SM/HM-removed.
  ('0a000002-0000-0000-0000-0000000000b1', 'house-05',
   (current_setting('test.p10.anchor')::timestamptz + interval '7 days') - interval '2 hours', 1),
  -- F: Dropper's single-week house-05 18:00 slot, dropped then re-picked-up.
  ('0a000002-0000-0000-0000-0000000000c1', 'house-05',
   (current_setting('test.p10.anchor')::timestamptz + interval '7 days') - interval '1 hour',  1),
  -- E cross-house: a house-07 17:00 vacant+permanent_drop slot.
  ('0a000002-0000-0000-0000-0000000000d1', 'house-07',
   (current_setting('test.p10.anchor')::timestamptz + interval '7 days') - interval '2 hours', 1),
  -- E Harnwell: a harnwell 16:00 vacant+permanent_drop slot (training-gated).
  ('0a000002-0000-0000-0000-0000000000e1', 'harnwell',
   (current_setting('test.p10.anchor')::timestamptz + interval '7 days') - interval '3 hours', 1),
  -- E6 partial-pickup feed removal: a house-05 19:30 two-week slot. Both weeks are
  -- dropped; w1 gets picked up and w2 is cap/conflict-skipped (19:30 <= the
  -- fixture's 19:30 ceiling, so UTC-slice date == NY-local date).
  ('0a000002-0000-0000-0000-0000000000f1', 'house-05',
   current_setting('test.p10.anchor')::timestamptz + interval '7 days'  + interval '30 minutes', 1),
  ('0a000002-0000-0000-0000-0000000000f2', 'house-05',
   current_setting('test.p10.anchor')::timestamptz + interval '14 days' + interval '30 minutes', 1);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id)
VALUES
  -- Main recurring slot occurrences.
  ('0a000003-0000-0000-0000-0000000000a0', '0a000002-0000-0000-0000-0000000000a0',
   '0a000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),     -- w_past (owned, past)
  ('0a000003-0000-0000-0000-0000000000a1', '0a000002-0000-0000-0000-0000000000a1',
   '0a000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),     -- w_now (owned, == drop moment)
  ('0a000003-0000-0000-0000-0000000000a2', '0a000002-0000-0000-0000-0000000000a2',
   '0a000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),     -- w1 (owned) -> AFFECTED
  ('0a000003-0000-0000-0000-0000000000a3', '0a000002-0000-0000-0000-0000000000a3',
   '0a000001-0000-0000-0000-000000000002', 'scheduled', 'none', false, NULL),     -- w2 (other owner) -> not_owned
  ('0a000003-0000-0000-0000-0000000000a4', '0a000002-0000-0000-0000-0000000000a4',
   '0a000001-0000-0000-0000-000000000001', 'floated_out', 'none', false, NULL),   -- w3 (owned, float-committed) -> no-takeback
  ('0a000003-0000-0000-0000-0000000000a5', '0a000002-0000-0000-0000-0000000000a5',
   '0a000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),     -- w_break (owned, break date) -> break_profile
  ('0a000003-0000-0000-0000-0000000000a6', '0a000002-0000-0000-0000-0000000000a6',
   '0a000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),     -- w4 (owned) -> AFFECTED
  ('0a000003-0000-0000-0000-0000000000a7', '0a000002-0000-0000-0000-0000000000a7',
   '0a000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),     -- w_next (owned, next semester) -> beyond_semester
  -- C: WORKER2 owns the 17:00 single-week slot.
  ('0a000003-0000-0000-0000-0000000000b1', '0a000002-0000-0000-0000-0000000000b1',
   '0a000001-0000-0000-0000-000000000005', 'scheduled', 'none', false, NULL),
  -- F: Dropper owns the 18:00 single-week slot.
  ('0a000003-0000-0000-0000-0000000000c1', '0a000002-0000-0000-0000-0000000000c1',
   '0a000001-0000-0000-0000-000000000001', 'scheduled', 'none', false, NULL),
  -- E cross-house: an already-dropped house-07 slot (vacant+permanent_drop).
  ('0a000003-0000-0000-0000-0000000000d1', '0a000002-0000-0000-0000-0000000000d1',
   NULL, 'vacant', 'permanent_drop', false, NULL),
  -- E Harnwell: an already-dropped harnwell slot (vacant+permanent_drop).
  ('0a000003-0000-0000-0000-0000000000e1', '0a000002-0000-0000-0000-0000000000e1',
   NULL, 'vacant', 'permanent_drop', false, NULL),
  -- E6: the house-05 19:30 two-week dropped slot (both vacant+permanent_drop).
  ('0a000003-0000-0000-0000-0000000000f1', '0a000002-0000-0000-0000-0000000000f1',
   NULL, 'vacant', 'permanent_drop', false, NULL),
  ('0a000003-0000-0000-0000-0000000000f2', '0a000002-0000-0000-0000-0000000000f2',
   NULL, 'vacant', 'permanent_drop', false, NULL);

-- ============================================================
-- A. FUNCTION EXISTENCE.
-- ============================================================

SELECT has_function(
  'public', 'permanent_drop_slot',
  ARRAY['uuid', 'text', 'integer', 'text[]', 'timestamptz', 'uuid'],
  'permanent_drop_slot(dropping_user, house, dow, block_locals[], drop_at, operator) exists (ARCH §7.1)'
);
SELECT has_function(
  'public', 'permanent_pickup_slot',
  ARRAY['uuid', 'uuid[]', 'uuid[]'],
  'permanent_pickup_slot(picking_user, assigned_block_ids[], skipped_block_ids[]) exists (ARCH §7.2)'
);

-- ============================================================
-- B. PERMANENT DROP — worker self-initiated (operator = NULL). One call, the
--    result captured so the eight exclusion outcomes are asserted against a
--    single atomic transaction.
-- ============================================================

SELECT set_config(
  'test.p10.drop_result',
  (public.permanent_drop_slot(
     '0a000001-0000-0000-0000-000000000001'::uuid,                       -- dropper
     'house-05',
     EXTRACT(DOW FROM current_setting('test.p10.anchor')::timestamptz
                       AT TIME ZONE 'America/New_York')::integer,        -- slot day-of-week
     ARRAY['19:00'],                                                     -- slot block-start local time
     current_setting('test.p10.anchor')::timestamptz,                    -- drop_initiated_at
     NULL                                                                -- operator: self-initiated
   ))::text,
  false
);

SELECT is(
  current_setting('test.p10.drop_result')::jsonb ->> 'affected_count',
  '2',
  'drop: exactly 2 weeks vacated (w1 + w4) — every other occurrence is excluded'
);
SELECT is(
  current_setting('test.p10.drop_result')::jsonb ->> 'semester_end_date',
  (((current_setting('test.p10.anchor')::timestamptz + interval '38 days')
    AT TIME ZONE 'America/New_York')::date)::text,
  'drop: semester_end_date came from scheduling_periods.end_date (ARCH §7.1)'
);

-- w1 (anchor+7d, owned, regular, in-semester) — VACATED.
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a2'),
  'vacant',
  'drop: w1 (future, owned, regular) is vacated'
);
SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a2'),
  'permanent_drop',
  'drop: w1 vacancy_origin = permanent_drop (so it enters the permanent feed)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a2'),
  NULL::uuid,
  'drop: w1 user_id cleared'
);
-- w4 (anchor+35d, owned, regular, in-semester) — VACATED.
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a6'),
  'vacant',
  'drop: w4 (future, owned, regular, in-semester) is vacated'
);

-- w_past (anchor-7d) and w_now (== drop moment) — NOT touched (strictly future).
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a0'),
  'scheduled',
  'drop: a past occurrence is untouched (strictly-future scope)'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a1'),
  'scheduled',
  'drop: the in-progress occurrence (starts exactly at the drop moment) is untouched'
);

-- w2 (other owner) — NOT touched (ownership predicate).
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a3'),
  '0a000001-0000-0000-0000-000000000002'::uuid,
  'drop: a week now owned by another worker is skipped (ownership predicate)'
);

-- w3 (float-committed) — NOT touched (no-takeback, invariant #3).
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a4'),
  'floated_out',
  'drop: a float-committed week is NOT vacated — no-takeback (invariant #3, ARCH §7.1)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a4'),
  '0a000001-0000-0000-0000-000000000001'::uuid,
  'drop: the float commitment stays owned by the dropping worker'
);

-- w_break (embedded short break) — NOT touched (regular_school_year predicate).
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a5'),
  'scheduled',
  'drop: an embedded break-date occurrence is excluded (regular_school_year predicate)'
);

-- w_next (next semester) — NOT touched (semester_end_date boundary).
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a7'),
  'scheduled',
  'drop: a next-semester occurrence is excluded (semester_end_date boundary)'
);

-- SM of house-05 notified; the self-dropping worker is NOT sent a removal alert.
SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE recipient_user_id = '0a000001-0000-0000-0000-000000000004'
     AND type = 'sm_permanent_drop_alert'),
  1,
  'drop: the SM of the affected house receives one sm_permanent_drop_alert (§8.4.1 / §10)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE recipient_user_id = '0a000001-0000-0000-0000-000000000001'
     AND type = 'sw_permanent_removal_alert'),
  0,
  'drop: a worker-initiated drop does NOT notify the worker of a removal (§8.4.1)'
);

-- ============================================================
-- C. SM/HM-INITIATED REMOVAL (§8.4.2). Same scope; the affected worker (WORKER2)
--    also receives an sw_permanent_removal_alert that names the operator.
-- ============================================================

SELECT set_config(
  'test.p10.removal_result',
  (public.permanent_drop_slot(
     '0a000001-0000-0000-0000-000000000005'::uuid,                       -- worker being removed (WORKER2)
     'house-05',
     EXTRACT(DOW FROM current_setting('test.p10.anchor')::timestamptz
                       AT TIME ZONE 'America/New_York')::integer,
     ARRAY['17:00'],                                                     -- WORKER2's 17:00 slot
     current_setting('test.p10.anchor')::timestamptz,
     '0a000001-0000-0000-0000-000000000004'::uuid                        -- operator: the SM
   ))::text,
  false
);

SELECT is(
  current_setting('test.p10.removal_result')::jsonb ->> 'affected_count',
  '1',
  'sm-removal: the worker''s single future week is vacated'
);
SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000b1'),
  'permanent_drop',
  'sm-removal: the removed week is vacant+permanent_drop (enters the feed)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE recipient_user_id = '0a000001-0000-0000-0000-000000000005'
     AND type = 'sw_permanent_removal_alert'),
  1,
  'sm-removal: the affected worker receives an sw_permanent_removal_alert (§8.4.2)'
);
SELECT is(
  (SELECT payload ->> 'operator_user_id' FROM public.notifications
   WHERE recipient_user_id = '0a000001-0000-0000-0000-000000000005'
     AND type = 'sw_permanent_removal_alert'
   LIMIT 1),
  '0a000001-0000-0000-0000-000000000004',
  'sm-removal: the removal alert identifies the operator who initiated it (§8.4.2)'
);

-- ============================================================
-- D. SEMESTER-BOUNDARY ERROR (ARCH §7.1). A drop whose date is covered by NO
--    scheduling_periods row must throw, not vacate an unbounded range.
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.permanent_drop_slot(
       '0a000001-0000-0000-0000-000000000001'::uuid,
       'house-05',
       EXTRACT(DOW FROM current_setting('test.p10.anchor')::timestamptz
                         AT TIME ZONE 'America/New_York')::integer,
       ARRAY['19:00'],
       current_setting('test.p10.anchor')::timestamptz + interval '100 days',  -- past end_date; no period covers it
       NULL) $$,
  'P0001', 'semester_boundary_not_found',
  'drop: a drop date no scheduling_periods row covers throws (does NOT proceed unbounded, ARCH §7.1)'
);

-- ============================================================
-- E. PERMANENT PICKUP (§8.4.3 / ARCH §7.2). The two weeks vacated in section B
--    (w1, w4 — house-05 19:00) are the permanently-dropped slot. PICKER picks it
--    up; a stale-popup race claims w4 away first; cross-house + Harnwell are
--    exercised on their dedicated dropped slots.
-- ============================================================

-- E0. Before pickup the permanent feed shows the 19:00 slot with both weeks.
SELECT is(
  (SELECT weeks_remaining::integer FROM public.permanent_openings_feed('house-05', current_setting('test.p10.anchor')::timestamptz)
   WHERE block_start_time = '19:00'),
  2,
  'pickup feed: the dropped 19:00 slot shows 2 remaining weeks before pickup'
);

-- E1. Race: another worker temporarily claims w4 between popup and submit.
UPDATE public.shift_block_assignments
SET user_id = '0a000001-0000-0000-0000-000000000002', status = 'claimed', vacancy_origin = 'none'
WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a6';

-- E2. PICKER submits the pickup for BOTH weeks; only the still-vacant one applies.
SELECT set_config(
  'test.p10.pickup_result',
  (public.permanent_pickup_slot(
     '0a000001-0000-0000-0000-000000000003'::uuid,                       -- picker (house-05)
     ARRAY['0a000002-0000-0000-0000-0000000000a2',
           '0a000002-0000-0000-0000-0000000000a6']::uuid[]               -- w1 + (raced-away) w4
   ))::text,
  false
);

SELECT is(
  current_setting('test.p10.pickup_result')::jsonb ->> 'assigned_count',
  '1',
  'pickup: only w1 is assigned — w4 was claimed away and the race-safe predicate skips it (ARCH §7.2)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a2'),
  '0a000001-0000-0000-0000-000000000003'::uuid,
  'pickup: w1 now belongs to the picker'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a2'),
  'claimed',
  'pickup: w1 status -> claimed'
);
SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a2'),
  'none',
  'pickup: w1 vacancy_origin cleared to none'
);
SELECT is(
  (SELECT is_cross_house_pickup FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a2'),
  false,
  'pickup: an in-house pickup is not flagged cross-house'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000a6'),
  '0a000001-0000-0000-0000-000000000002'::uuid,
  'pickup: the raced-away w4 still belongs to the other worker (no stale-state overwrite)'
);

-- E3. After pickup the slot is removed from the permanent feed regardless of
--     completeness (w1 claimed, w4 claimed away → 0 vacant+permanent_drop left).
SELECT is(
  (SELECT count(*)::integer FROM public.permanent_openings_feed('house-05', current_setting('test.p10.anchor')::timestamptz)
   WHERE block_start_time = '19:00'),
  0,
  'pickup feed: the 19:00 slot is removed from the permanent feed after pickup (§8.4.3)'
);

-- E4. Cross-house pickup: PICKER (house-05) picks up the house-07 dropped slot.
SELECT set_config(
  'test.p10.xhouse_result',
  (public.permanent_pickup_slot(
     '0a000001-0000-0000-0000-000000000003'::uuid,
     ARRAY['0a000002-0000-0000-0000-0000000000d1']::uuid[]
   ))::text,
  false
);
SELECT is(
  current_setting('test.p10.xhouse_result')::jsonb ->> 'assigned_count',
  '1',
  'cross-house pickup: the house-07 slot is assigned to the house-05 picker'
);
SELECT is(
  (SELECT is_cross_house_pickup FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000d1'),
  true,
  'cross-house pickup: is_cross_house_pickup is set (ARCH §7.2)'
);
SELECT is(
  (SELECT source_house_id FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000d1'),
  'house-05',
  'cross-house pickup: source_house_id is the picker''s home house'
);

-- E5. Harnwell training gate: a non-Harnwell picker cannot pick up a Harnwell
--     slot — the whole request is rejected (invariant #1, ARCH §7.2 step 1).
SELECT throws_ok(
  $$ SELECT public.permanent_pickup_slot(
       '0a000001-0000-0000-0000-000000000003'::uuid,
       ARRAY['0a000002-0000-0000-0000-0000000000e1']::uuid[]) $$,
  'P0001', 'harnwell_training_required',
  'pickup: a non-Harnwell-home picker is rejected for a Harnwell slot (invariant #1)'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000e1'),
  'vacant',
  'pickup: the rejected Harnwell slot is untouched (atomic — no partial write)'
);

-- E6. PARTIAL-PICKUP FEED REMOVAL (§8.4.3 / ARCH §7.2 step 8). A two-week dropped
--     slot (house-05 19:30): PICKER takes w1 and the evaluator SKIPS w2 (cap or
--     time conflict). The skip set is re-flagged OFF permanent_drop in the same
--     transaction, so the slot leaves the permanent feed REGARDLESS of
--     completeness and the skipped week routes to the weekly feed — it is NOT
--     permanently re-pickable ("partial pickups are final"). This is the case the
--     status-change-only E3 check cannot exercise: w2's ownership never changes,
--     so before this fix it would have lingered in the permanent feed.
SELECT set_config(
  'test.p10.partial_result',
  (public.permanent_pickup_slot(
     '0a000001-0000-0000-0000-000000000003'::uuid,                        -- picker (house-05)
     ARRAY['0a000002-0000-0000-0000-0000000000f1']::uuid[],               -- assigned: w1
     ARRAY['0a000002-0000-0000-0000-0000000000f2']::uuid[]                -- skipped:  w2 (cap/conflict)
   ))::text,
  false
);
SELECT is(
  current_setting('test.p10.partial_result')::jsonb ->> 'assigned_count',
  '1',
  'partial pickup: w1 (19:30) is assigned'
);
SELECT is(
  current_setting('test.p10.partial_result')::jsonb ->> 'skipped_count',
  '1',
  'partial pickup: w2 (19:30) is re-flagged out of the permanent-drop vacancy'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000f1'),
  'claimed',
  'partial pickup: the assigned w1 is claimed'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000f2'),
  'vacant',
  'partial pickup: the skipped w2 stays vacant (still claimable via the weekly feed)'
);
SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000f2'),
  'temporary_drop',
  'partial pickup: the skipped w2 leaves permanent_drop -> temporary_drop (§8.4.3)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.permanent_openings_feed('house-05', current_setting('test.p10.anchor')::timestamptz)
   WHERE block_start_time = '19:30'),
  0,
  'partial pickup: the 19:30 slot leaves the permanent feed REGARDLESS of completeness (§8.4.3 / ARCH §7.2.8)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.weekly_open_shifts_feed('house-05', current_setting('test.p10.anchor')::timestamptz)
   WHERE block_id = '0a000002-0000-0000-0000-0000000000f2'),
  1,
  'partial pickup: the skipped w2 surfaces in the WEEKLY feed instead (§8.4.3)'
);

-- ============================================================
-- F. RE-DROP + RE-PICKUP (§8.4.4 / ARCH §7.3). The dropper drops the 18:00 slot,
--    then immediately re-picks-up the same slot (still in the feed, unclaimed).
-- ============================================================

SELECT set_config(
  'test.p10.redrop_result',
  (public.permanent_drop_slot(
     '0a000001-0000-0000-0000-000000000001'::uuid,
     'house-05',
     EXTRACT(DOW FROM current_setting('test.p10.anchor')::timestamptz
                       AT TIME ZONE 'America/New_York')::integer,
     ARRAY['18:00'],
     current_setting('test.p10.anchor')::timestamptz,
     NULL
   ))::text,
  false
);
SELECT is(
  current_setting('test.p10.redrop_result')::jsonb ->> 'affected_count',
  '1',
  're-drop: the dropper vacates their own 18:00 slot'
);
SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000c1'),
  'permanent_drop',
  're-drop: the slot is back in the permanent feed (vacant+permanent_drop)'
);

SELECT set_config(
  'test.p10.repickup_result',
  (public.permanent_pickup_slot(
     '0a000001-0000-0000-0000-000000000001'::uuid,                       -- the SAME worker re-picks-up
     ARRAY['0a000002-0000-0000-0000-0000000000c1']::uuid[]
   ))::text,
  false
);
SELECT is(
  current_setting('test.p10.repickup_result')::jsonb ->> 'assigned_count',
  '1',
  're-pickup: the worker re-picks-up their own dropped slot (§8.4.4 — allowed while still in the feed)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '0a000003-0000-0000-0000-0000000000c1'),
  '0a000001-0000-0000-0000-000000000001'::uuid,
  're-pickup: the worker owns the slot again'
);

SELECT finish();
ROLLBACK;
