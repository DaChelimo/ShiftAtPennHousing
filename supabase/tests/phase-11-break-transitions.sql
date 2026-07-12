-- pgTAP tests for Phase 11: Claim-Based Scheduling for Breaks — the DB-side
-- surface (the T-14d calendar clearing, the calendar-claim-pool ↔ open-shifts-feed
-- transition at the start-anchored T-1d, and the first-come-first-served calendar
-- claim).
--
-- Spec sources:
--   BEHAVIORAL_SPECIFICATION.md
--     §4.4 (claim-based scheduling — ALL offsets (T-14d/T-3d/T-1d) anchor to
--       break_periods.start_date, NOT to each date in the break; T-14d clears the
--       calendar for the whole break and highlights it; T-14d→T-1d the picker is
--       open and claims are FCFS, dropped shifts return to the CALENDAR CLAIM
--       POOL; at the EXACT T-1d moment the picker closes for the WHOLE break and
--       unclaimed shifts move to the OPEN-SHIFTS FEED; from then a drop goes to
--       the feed, the T-2h cutoff applies; break shifts do NOT appear in the feed
--       during the claim phase),
--     §3.2 (cap by break: 40h hard for thanksgiving/fall/spring/winter, 20h soft
--       for spring fling; only Harnwell operates in winter break — all other
--       houses closed),
--     §3.4 (closed houses have no shifts; their workers cannot opt in elsewhere);
--   ARCHITECTURE.md §2.9 (break_periods.start_date is the anchor; the offset
--     durations live on operating_profiles.claim_phase_{open,alert,close}_offset;
--     break_type distinguishes spring fling from the 40h breaks), §2.11 step 7
--     (the claim-phase deadline lookup joins date → break_period by range);
--   AGENTS.md hard invariants #1 (Harnwell training — enforced at EVERY assignment
--     write point, the calendar claim included), #5 (30-minute blocks),
--     #6 (timestamptz in America/New_York; calendar-day offsets, not 24h×N).
-- Run with: supabase test db
--
-- WHAT THIS SUITE COVERS
-- ----------------------
--   A. Function existence — break_claim_phase, break_is_highlighted,
--      open_break_claim_calendar, break_claim_calendar_pool, claim_break_shift,
--      the break_optouts table, and worker_opted_out_of_break.
--   B. PHASE BOUNDARIES anchored to start_date — pre_open / claim_window /
--      open_feed transitions at NY-local midnight of (start − 14/3/1), the
--      half-open [open, close) window, and the T-14d highlight.
--   C. ANCHORED-TO-START — a claim for the break's LAST day is closed once the
--      START-anchored T-1d passes (NOT the last day's own T-1d): every date in
--      the break shares one close.
--   D. DST — a break starting the day after spring-forward anchors open to
--      NY-local midnight of (start − 14d), not start_instant − 14×24h.
--   E. T-14d CLEARING — open_break_claim_calendar vacates the existing break
--      assignments for the house (calendar wiped to a clean claim pool).
--   F. CALENDAR POOL ↔ OPEN-SHIFTS FEED — during the window a vacant break shift
--      is in the calendar pool and NOT in the open-shifts feed; at/after T-1d it
--      leaves the pool and enters the feed; a regular vacant shift is always in
--      the feed. FCFS: the second claim of a just-claimed shift is rejected; a
--      claim at the exact T-1d instant is rejected (window closed).
--   G. DROP DESTINATION — a break shift dropped DURING the window returns to the
--      calendar pool (not the feed); a break shift dropped AFTER T-1d enters the
--      feed (not the pool).
--   H. CLOSED-HOUSE / HARNWELL — in winter break a closed house's calendar pool
--      is empty (no blocks); Harnwell's pool is populated; a non-Harnwell worker
--      is rejected at the calendar-claim write point (invariant #1).
--   I. CAP BY BREAK_TYPE — effective_weekly_cap is 40/hard for a Thanksgiving
--      week and 20/soft for a spring-fling week (§3.2 / §9.3, batch_b-aware).
--   J. ZERO-HOURS OPT-OUT — a per-(break,worker) break_optouts row, read via
--      worker_opted_out_of_break, fills the T-3d-nag opt-out flag; per-break
--      scoped (Thanksgiving opt-out ≠ spring-break opt-out).
--
-- TDD-RED: the phase-11 migration (break_claim_phase / break_is_highlighted /
-- open_break_claim_calendar / break_claim_calendar_pool / claim_break_shift, plus
-- the break-aware rewrite of weekly_open_shifts_feed) is not yet written; this
-- suite pins their contract and turns GREEN when the migration lands — the same
-- TDD discipline phase-09/10 used for their not-yet-existing RPCs. The PURE phase
-- math (boundaries, phase classification, the T-3d nag set, the cap-by-type) is
-- the surface tested in packages/core/tests/phase-11/break-phase-timing.test.ts;
-- this suite tests the DB-side state transitions, the FCFS claim, and the
-- feed/pool routing.

BEGIN;

SELECT plan(48);

-- ============================================================
-- 0. Fixtures: harrison workers, four break periods (Thanksgiving / spring break
--    / spring fling / winter break), the operating calendar, and the break blocks.
--
--    Houses (harnwell, harrison) come from seed.sql. The break profiles
--    (short_break / winter_break, with the -14d/-3d/-1d claim offsets) are seeded;
--    re-asserted here ON CONFLICT DO NOTHING so the suite is self-contained.
--
--    Anchor dates are FIXED. The canonical Thanksgiving break is 2026-11-25
--    (Wed) → 2026-11-29 (Sun), living entirely in EST (DST ended 2026-11-01), so
--    T-14d/T-3d/T-1d = 2026-11-11/22/24 at NY-local midnight, all -05:00. All
--    break blocks start at 18:00–19:00 NY-local so their UTC slice stays on the
--    same calendar date regardless of EST/EDT.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('0c000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p11-workerA@test.local'),
  ('0c000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p11-workerB@test.local'),
  ('0c000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p11-workerC@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('0c000001-0000-0000-0000-000000000001', 'WorkerA (harrison)', 'p11-workerA@test.local', 'harrison', true),
  ('0c000001-0000-0000-0000-000000000002', 'WorkerB (harrison)', 'p11-workerB@test.local', 'harrison', true),
  ('0c000001-0000-0000-0000-000000000003', 'WorkerC (harrison)', 'p11-workerC@test.local', 'harrison', true);

-- Break profiles (self-contained; no-op if seeded). claim_phase offsets are the
-- offset DURATIONS; break_periods.start_date is the anchor (ARCH §2.9).
INSERT INTO public.operating_profiles
  (profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
   default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
   claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset)
VALUES
  ('regular_school_year', '08:00', '00:00', 20, 'soft', 'sm_built',    true,  '[]'::jsonb,
   NULL, NULL, NULL),
  ('short_break',         '08:00', '00:00', 40, 'hard', 'claim_based', true,  '[]'::jsonb,
   '-14 days'::interval, '-3 days'::interval, '-1 day'::interval),
  ('winter_break',        '08:00', '00:00', 40, 'hard', 'claim_based', false, '[]'::jsonb,
   '-14 days'::interval, '-3 days'::interval, '-1 day'::interval)
ON CONFLICT (profile_name) DO NOTHING;

-- Break periods (disjoint date ranges — satisfies break_periods_no_overlap).
INSERT INTO public.break_periods (break_id, break_name, break_type, start_date, end_date, profile_name)
VALUES
  ('0c000004-0000-0000-0000-0000000000a1', 'Thanksgiving 2026', 'thanksgiving', '2026-11-25', '2026-11-29', 'short_break'),
  ('0c000004-0000-0000-0000-0000000000a2', 'Spring Break 2026',  'spring_break', '2026-03-09', '2026-03-13', 'short_break'),
  ('0c000004-0000-0000-0000-0000000000a3', 'Spring Fling 2026',  'spring_fling', '2026-04-13', '2026-04-17', 'short_break'),
  ('0c000004-0000-0000-0000-0000000000a4', 'Winter Break 2026',  'winter_break', '2026-12-21', '2027-01-04', 'winter_break');

-- Operating calendar. Regular days surround the Thanksgiving break; the break
-- dates carry their break profile (date → profile → break_period by range).
INSERT INTO public.operating_calendar (date, profile_name)
VALUES
  ('2026-11-20', 'regular_school_year'),  -- reg1's date (always-in-feed control)
  ('2026-11-23', 'regular_school_year'),
  ('2026-11-24', 'regular_school_year'),
  ('2026-11-25', 'short_break'),
  ('2026-11-26', 'short_break'),
  ('2026-11-27', 'short_break'),
  ('2026-11-28', 'short_break'),
  ('2026-11-29', 'short_break'),
  ('2026-03-09', 'short_break'),          -- spring break (DST phase test)
  ('2026-03-10', 'short_break'),
  ('2026-03-11', 'short_break'),
  ('2026-03-12', 'short_break'),
  ('2026-03-13', 'short_break'),
  ('2026-04-13', 'short_break'),          -- spring fling (cap-by-type test)
  ('2026-04-14', 'short_break'),
  ('2026-04-15', 'short_break'),
  ('2026-04-16', 'short_break'),
  ('2026-04-17', 'short_break'),
  ('2026-12-21', 'winter_break')          -- wb_harn's date (Harnwell winter)
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

-- Break blocks. tg* = harrison Thanksgiving; reg1 = harrison regular; wb_harn =
-- Harnwell winter. All 18:00/19:00 NY-local.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  -- tg1: scheduled (by workerA) → cleared at T-14d, then re-claimed (FCFS).
  ('0c000002-0000-0000-0000-000000000011', 'harrison', ('2026-11-25 18:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- tg2: scheduled (by workerB) → cleared at T-14d (clearing count = 2).
  ('0c000002-0000-0000-0000-000000000012', 'harrison', ('2026-11-26 18:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- tg3: vacant claim-pool seat → pool/feed phase visibility.
  ('0c000002-0000-0000-0000-000000000013', 'harrison', ('2026-11-27 18:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- tg_last: vacant seat on the break's LAST day → anchored-to-start close.
  ('0c000002-0000-0000-0000-000000000014', 'harrison', ('2026-11-29 18:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- tgDropWin: claimed-during-window then dropped → returns to calendar pool.
  ('0c000002-0000-0000-0000-000000000015', 'harrison', ('2026-11-28 18:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- tgDropFeed: claimed-during-window, dropped AFTER close → enters the feed.
  ('0c000002-0000-0000-0000-000000000016', 'harrison', ('2026-11-27 19:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- reg1: regular (non-break) vacant shift → always in the open-shifts feed.
  ('0c000002-0000-0000-0000-000000000020', 'harrison', ('2026-11-20 18:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- wb_harn: a Harnwell winter-break seat (training-gated, closed-house control).
  ('0c000002-0000-0000-0000-000000000030', 'harnwell', ('2026-12-21 18:00'::timestamp AT TIME ZONE 'America/New_York'), 1);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  -- tg1, tg2: existing SCHEDULED assignments that T-14d clearing must vacate.
  ('0c000003-0000-0000-0000-000000000011', '0c000002-0000-0000-0000-000000000011',
   '0c000001-0000-0000-0000-000000000001', 'scheduled', 'none'),
  ('0c000003-0000-0000-0000-000000000012', '0c000002-0000-0000-0000-000000000012',
   '0c000001-0000-0000-0000-000000000002', 'scheduled', 'none'),
  -- tg3, tg_last, tgDropWin, tgDropFeed: empty calendar-pool seats.
  ('0c000003-0000-0000-0000-000000000013', '0c000002-0000-0000-0000-000000000013',
   NULL, 'vacant', 'never_assigned'),
  ('0c000003-0000-0000-0000-000000000014', '0c000002-0000-0000-0000-000000000014',
   NULL, 'vacant', 'never_assigned'),
  ('0c000003-0000-0000-0000-000000000015', '0c000002-0000-0000-0000-000000000015',
   NULL, 'vacant', 'never_assigned'),
  ('0c000003-0000-0000-0000-000000000016', '0c000002-0000-0000-0000-000000000016',
   NULL, 'vacant', 'never_assigned'),
  -- reg1: a normal vacant (temporary-drop) shift in the open-shifts feed.
  ('0c000003-0000-0000-0000-000000000020', '0c000002-0000-0000-0000-000000000020',
   NULL, 'vacant', 'temporary_drop'),
  -- wb_harn: an empty Harnwell winter seat.
  ('0c000003-0000-0000-0000-000000000030', '0c000002-0000-0000-0000-000000000030',
   NULL, 'vacant', 'never_assigned');

-- Reusable "now" anchors (timestamptz, NY-local).
SELECT set_config('test.p11.tg_open',    (('2026-11-25'::date - 14)::timestamp AT TIME ZONE 'America/New_York')::text, false);  -- 2026-11-11 00:00 EST
SELECT set_config('test.p11.tg_alert',   (('2026-11-25'::date -  3)::timestamp AT TIME ZONE 'America/New_York')::text, false);  -- 2026-11-22 00:00 EST
SELECT set_config('test.p11.tg_close',   (('2026-11-25'::date -  1)::timestamp AT TIME ZONE 'America/New_York')::text, false);  -- 2026-11-24 00:00 EST
SELECT set_config('test.p11.window_now', ('2026-11-15 12:00'::timestamp AT TIME ZONE 'America/New_York')::text, false);          -- inside [open, close)
SELECT set_config('test.p11.closed_now', ('2026-11-25 12:00'::timestamp AT TIME ZONE 'America/New_York')::text, false);          -- after close, INSIDE the break
SELECT set_config('test.p11.sp_open',    (('2026-03-09'::date - 14)::timestamp AT TIME ZONE 'America/New_York')::text, false);   -- 2026-02-23 00:00 EST
SELECT set_config('test.p11.winter_now', ('2026-12-10 12:00'::timestamp AT TIME ZONE 'America/New_York')::text, false);          -- inside winter [open, close)

-- ============================================================
-- A. FUNCTION EXISTENCE.
-- ============================================================

SELECT has_function(
  'public', 'break_claim_phase', ARRAY['uuid', 'timestamptz'],
  'break_claim_phase(break_id, as_of) exists (§4.4 — anchored to start_date)'
);
SELECT has_function(
  'public', 'break_is_highlighted', ARRAY['uuid', 'timestamptz'],
  'break_is_highlighted(break_id, as_of) exists (§4.4 — distinct calendar background)'
);
SELECT has_function(
  'public', 'open_break_claim_calendar', ARRAY['uuid', 'text'],
  'open_break_claim_calendar(break_id, house) exists (§4.4 — T-14d clearing)'
);
SELECT has_function(
  'public', 'break_claim_calendar_pool', ARRAY['text', 'timestamptz'],
  'break_claim_calendar_pool(house, as_of) exists (§4.4 — the calendar picker pool)'
);
SELECT has_function(
  'public', 'claim_break_shift', ARRAY['uuid', 'uuid', 'timestamptz'],
  'claim_break_shift(assignment, user, as_of) exists (§4.4 — FCFS calendar claim)'
);
SELECT has_table(
  'public', 'break_optouts',
  'break_optouts table exists (§4.4 zero-hours opt-out / ARCH §2.9)'
);
SELECT has_function(
  'public', 'worker_opted_out_of_break', ARRAY['uuid', 'uuid'],
  'worker_opted_out_of_break(user, break) exists (the T-3d-nag opt-out read)'
);

-- ============================================================
-- B. PHASE BOUNDARIES — anchored to start_date, half-open [open, close).
-- ============================================================

SELECT is(
  break_claim_phase('0c000004-0000-0000-0000-0000000000a1', current_setting('test.p11.tg_open')::timestamptz - interval '1 second'),
  'pre_open',
  'phase: one second before T-14d is pre_open'
);
SELECT is(
  break_claim_phase('0c000004-0000-0000-0000-0000000000a1', current_setting('test.p11.tg_open')::timestamptz),
  'claim_window',
  'phase: EXACTLY at T-14d the picker opens (claim_window) — open boundary inclusive'
);
SELECT is(
  break_claim_phase('0c000004-0000-0000-0000-0000000000a1', current_setting('test.p11.tg_alert')::timestamptz),
  'claim_window',
  'phase: at the T-3d alert moment still claim_window (the nag does not change the phase)'
);
SELECT is(
  break_claim_phase('0c000004-0000-0000-0000-0000000000a1', current_setting('test.p11.tg_close')::timestamptz - interval '1 second'),
  'claim_window',
  'phase: one second before T-1d is still claim_window'
);
SELECT is(
  break_claim_phase('0c000004-0000-0000-0000-0000000000a1', current_setting('test.p11.tg_close')::timestamptz),
  'open_feed',
  'phase: EXACTLY at T-1d the picker is closed (open_feed) — close boundary exclusive (§4.4)'
);

SELECT is(
  break_is_highlighted('0c000004-0000-0000-0000-0000000000a1', current_setting('test.p11.tg_open')::timestamptz - interval '1 second'),
  false,
  'highlight: off before T-14d'
);
SELECT is(
  break_is_highlighted('0c000004-0000-0000-0000-0000000000a1', current_setting('test.p11.tg_open')::timestamptz),
  true,
  'highlight: on EXACTLY at T-14d (the clearing/highlight moment, §4.4)'
);

-- ============================================================
-- D. DST — a break starting the day after spring-forward (2026-03-08) anchors
--    open to NY-local midnight of (start − 14d) = 2026-02-23 00:00 EST, NOT
--    start_instant − 14×24h (which would land an hour early, invariant #6).
-- ============================================================

SELECT is(
  break_claim_phase('0c000004-0000-0000-0000-0000000000a2', current_setting('test.p11.sp_open')::timestamptz - interval '1 second'),
  'pre_open',
  'DST: one second before the calendar-day-anchored open is pre_open (spring break)'
);
SELECT is(
  break_claim_phase('0c000004-0000-0000-0000-0000000000a2', current_setting('test.p11.sp_open')::timestamptz),
  'claim_window',
  'DST: open anchors to NY-local midnight of (start − 14d), not start − 14×24h (invariant #6)'
);

-- ============================================================
-- E. T-14d CLEARING — open_break_claim_calendar vacates the house''s existing
--    break assignments (the calendar is wiped to a clean claim pool).
-- ============================================================

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0c000003-0000-0000-0000-000000000011'),
  'scheduled',
  'clearing: tg1 is scheduled BEFORE the T-14d clearing'
);

SELECT is(
  public.open_break_claim_calendar('0c000004-0000-0000-0000-0000000000a1', 'harrison'),
  2,
  'clearing: open_break_claim_calendar reports 2 existing assignments cleared (tg1, tg2)'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0c000003-0000-0000-0000-000000000011'),
  'vacant',
  'clearing: tg1 is now vacant (assignment removed, §4.4)'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '0c000003-0000-0000-0000-000000000011'),
  NULL::uuid,
  'clearing: tg1 user_id cleared'
);
SELECT is(
  (SELECT vacancy_origin::text FROM public.shift_block_assignments WHERE assignment_id = '0c000003-0000-0000-0000-000000000011'),
  'never_assigned',
  'clearing: tg1 vacancy_origin = never_assigned (wiped to a clean claim-pool seat)'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0c000003-0000-0000-0000-000000000012'),
  'vacant',
  'clearing: tg2 is also vacated'
);

-- ============================================================
-- C. ANCHORED-TO-START — every date in the break shares ONE close. A claim for
--    the break''s LAST day (2026-11-29) is rejected once the START-anchored T-1d
--    (2026-11-24) has passed, even though the last day''s OWN T-1d (2026-11-28)
--    has not — proving the close is per-break, not per-date (§4.4).
-- ============================================================

SELECT throws_ok(
  $$ SELECT public.claim_break_shift(
       '0c000003-0000-0000-0000-000000000014'::uuid,                 -- tg_last (2026-11-29)
       '0c000001-0000-0000-0000-000000000001'::uuid,                 -- workerA
       current_setting('test.p11.closed_now')::timestamptz) $$,      -- 2026-11-25 (after start-anchored close)
  'P0001', 'break_claim_window_closed',
  'anchored: a last-day claim is closed once the START-anchored T-1d passes (§4.4)'
);
SELECT is(
  break_claim_phase('0c000004-0000-0000-0000-0000000000a1', current_setting('test.p11.closed_now')::timestamptz),
  'open_feed',
  'anchored: a moment inside the break is open_feed — the whole break closed at the start-anchored T-1d'
);

-- ============================================================
-- F. CALENDAR POOL ↔ OPEN-SHIFTS FEED + FCFS.
--    During the claim window: vacant break shifts are in the calendar pool and
--    NOT in the open-shifts feed; a regular vacant shift IS in the feed.
-- ============================================================

SELECT is(
  (SELECT count(*)::integer FROM public.break_claim_calendar_pool('harrison', current_setting('test.p11.window_now')::timestamptz)
   WHERE block_id = '0c000002-0000-0000-0000-000000000013'),
  1,
  'pool: during the window the vacant break shift tg3 is in the calendar claim pool (§4.4)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.weekly_open_shifts_feed('harrison', current_setting('test.p11.window_now')::timestamptz)
   WHERE block_id = '0c000002-0000-0000-0000-000000000013'),
  0,
  'feed: during the window tg3 does NOT appear in the open-shifts feed (§4.4 — avoid clutter)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.weekly_open_shifts_feed('harrison', current_setting('test.p11.window_now')::timestamptz)
   WHERE block_id = '0c000002-0000-0000-0000-000000000020'),
  1,
  'feed: a regular (non-break) vacant shift is always in the open-shifts feed'
);

-- FCFS: workerA claims the cleared tg1 via the calendar picker; a second claim of
-- the same shift is rejected (first-come-first-served).
SELECT lives_ok(
  $$ SELECT public.claim_break_shift(
       '0c000003-0000-0000-0000-000000000011'::uuid,
       '0c000001-0000-0000-0000-000000000001'::uuid,
       current_setting('test.p11.window_now')::timestamptz) $$,
  'claim: workerA claims tg1 from the calendar picker during the window'
);
SELECT is(
  (SELECT status::text FROM public.shift_block_assignments WHERE assignment_id = '0c000003-0000-0000-0000-000000000011'),
  'claimed',
  'claim: tg1 status -> claimed'
);
SELECT is(
  (SELECT user_id FROM public.shift_block_assignments WHERE assignment_id = '0c000003-0000-0000-0000-000000000011'),
  '0c000001-0000-0000-0000-000000000001'::uuid,
  'claim: tg1 now belongs to workerA'
);
SELECT throws_ok(
  $$ SELECT public.claim_break_shift(
       '0c000003-0000-0000-0000-000000000011'::uuid,
       '0c000001-0000-0000-0000-000000000002'::uuid,                 -- workerB, too late
       current_setting('test.p11.window_now')::timestamptz) $$,
  'P0001', 'shift_unavailable',
  'FCFS: a second worker claiming the already-claimed tg1 is rejected (§4.4)'
);

-- At/after T-1d: tg3 leaves the calendar pool and enters the open-shifts feed.
SELECT is(
  (SELECT count(*)::integer FROM public.break_claim_calendar_pool('harrison', current_setting('test.p11.closed_now')::timestamptz)
   WHERE block_id = '0c000002-0000-0000-0000-000000000013'),
  0,
  'pool: at/after T-1d the calendar pool is closed — tg3 is no longer in it'
);
SELECT is(
  (SELECT count(*)::integer FROM public.weekly_open_shifts_feed('harrison', current_setting('test.p11.closed_now')::timestamptz)
   WHERE block_id = '0c000002-0000-0000-0000-000000000013'),
  1,
  'feed: at/after T-1d the unclaimed tg3 enters the open-shifts feed (§4.4)'
);

-- A claim submitted at the EXACT T-1d instant is rejected (the picker is closed).
SELECT throws_ok(
  $$ SELECT public.claim_break_shift(
       '0c000003-0000-0000-0000-000000000014'::uuid,                 -- tg_last
       '0c000001-0000-0000-0000-000000000001'::uuid,
       current_setting('test.p11.tg_close')::timestamptz) $$,        -- EXACTLY T-1d
  'P0001', 'break_claim_window_closed',
  'close: a calendar claim at the EXACT T-1d instant is rejected (§4.4 — closes simultaneously)'
);

-- ============================================================
-- G. DROP DESTINATION — a drop DURING the window returns the shift to the
--    calendar pool (not the feed); a drop AFTER T-1d sends it to the feed.
-- ============================================================

-- Setup: workerC claims tgDropWin and tgDropFeed during the window.
SELECT set_config('test.p11.setup1',
  (public.claim_break_shift('0c000003-0000-0000-0000-000000000015'::uuid,
     '0c000001-0000-0000-0000-000000000003'::uuid, current_setting('test.p11.window_now')::timestamptz))::text, false);
SELECT set_config('test.p11.setup2',
  (public.claim_break_shift('0c000003-0000-0000-0000-000000000016'::uuid,
     '0c000001-0000-0000-0000-000000000003'::uuid, current_setting('test.p11.window_now')::timestamptz))::text, false);

-- Drop tgDropWin DURING the window → returns to the calendar pool.
SELECT set_config('test.p11.dropwin',
  (SELECT 'done' FROM public.drop_shift(ARRAY['0c000003-0000-0000-0000-000000000015']::uuid[],
     '0c000001-0000-0000-0000-000000000003'::uuid, current_setting('test.p11.window_now')::timestamptz) LIMIT 1), false);

SELECT is(
  (SELECT count(*)::integer FROM public.break_claim_calendar_pool('harrison', current_setting('test.p11.window_now')::timestamptz)
   WHERE block_id = '0c000002-0000-0000-0000-000000000015'),
  1,
  'drop-in-window: a dropped break shift returns to the CALENDAR claim pool (§4.4)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.weekly_open_shifts_feed('harrison', current_setting('test.p11.window_now')::timestamptz)
   WHERE block_id = '0c000002-0000-0000-0000-000000000015'),
  0,
  'drop-in-window: the dropped break shift does NOT go to the open-shifts feed (§4.4)'
);

-- Drop tgDropFeed AFTER T-1d → enters the open-shifts feed.
SELECT set_config('test.p11.dropfeed',
  (SELECT 'done' FROM public.drop_shift(ARRAY['0c000003-0000-0000-0000-000000000016']::uuid[],
     '0c000001-0000-0000-0000-000000000003'::uuid, current_setting('test.p11.closed_now')::timestamptz) LIMIT 1), false);

SELECT is(
  (SELECT count(*)::integer FROM public.break_claim_calendar_pool('harrison', current_setting('test.p11.closed_now')::timestamptz)
   WHERE block_id = '0c000002-0000-0000-0000-000000000016'),
  0,
  'drop-after-close: the calendar picker is closed — the dropped shift is NOT in the pool (§4.4)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.weekly_open_shifts_feed('harrison', current_setting('test.p11.closed_now')::timestamptz)
   WHERE block_id = '0c000002-0000-0000-0000-000000000016'),
  1,
  'drop-after-close: a break shift dropped after T-1d enters the open-shifts feed (§4.4)'
);

-- ============================================================
-- H. CLOSED-HOUSE / HARNWELL (winter break). Only Harnwell operates; closed
--    houses have no break blocks, so their calendar pool is empty. A non-Harnwell
--    worker is rejected at the calendar-claim write point (invariant #1).
-- ============================================================

SELECT is(
  (SELECT count(*)::integer FROM public.break_claim_calendar_pool('harrison', current_setting('test.p11.winter_now')::timestamptz)),
  0,
  'closed-house: harrison''s winter calendar pool is empty — closed houses have no break shifts (§3.4)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.break_claim_calendar_pool('harnwell', current_setting('test.p11.winter_now')::timestamptz)
   WHERE block_id = '0c000002-0000-0000-0000-000000000030'),
  1,
  'winter: Harnwell''s winter calendar pool is populated (the one operational house)'
);
SELECT throws_ok(
  $$ SELECT public.claim_break_shift(
       '0c000003-0000-0000-0000-000000000030'::uuid,                 -- wb_harn (Harnwell)
       '0c000001-0000-0000-0000-000000000001'::uuid,                 -- workerA (home harrison)
       current_setting('test.p11.winter_now')::timestamptz) $$,
  'P0001', 'harnwell_training_required',
  'Harnwell training: a non-Harnwell worker is rejected at the calendar-claim write point (invariant #1)'
);

-- ============================================================
-- I. CAP BY BREAK_TYPE (§3.2 / §9.3). effective_weekly_cap is break_type-aware
--    (batch_b): a Thanksgiving week is 40h hard; a spring-fling week is 20h soft.
-- ============================================================

SELECT is(
  (SELECT hours_cap FROM public.effective_weekly_cap('2026-11-23'::date,
     ('2026-11-25 18:00'::timestamp AT TIME ZONE 'America/New_York'))),
  40,
  'cap: a Thanksgiving week resolves to a 40-hour cap (§3.2 — hard ceiling)'
);
SELECT is(
  (SELECT cap_enforcement::text FROM public.effective_weekly_cap('2026-11-23'::date,
     ('2026-11-25 18:00'::timestamp AT TIME ZONE 'America/New_York'))),
  'hard',
  'cap: the Thanksgiving cap is HARD (not overridable, §3.2)'
);
SELECT is(
  (SELECT hours_cap FROM public.effective_weekly_cap('2026-04-13'::date,
     ('2026-04-13 18:00'::timestamp AT TIME ZONE 'America/New_York'))),
  20,
  'cap: a spring-fling week resolves to a 20-hour cap (§3.2 — distinguished by break_type)'
);
SELECT is(
  (SELECT cap_enforcement::text FROM public.effective_weekly_cap('2026-04-13'::date,
     ('2026-04-13 18:00'::timestamp AT TIME ZONE 'America/New_York'))),
  'soft',
  'cap: the spring-fling cap is SOFT (overridable, §3.2)'
);

-- ============================================================
-- J. ZERO-HOURS OPT-OUT (§4.4 / ARCH §2.9). The break analogue of the §4.1
--    "no hours" button, stored per (break, worker) in break_optouts and read by
--    the T-3d nag (via worker_opted_out_of_break) to fill the
--    has_indicated_zero_hours flag the pure selectBreakClaimNagRecipients
--    consumes. Per-break scoped; advisory only (never gates claiming).
-- ============================================================

-- WorkerC indicates zero hours for the Thanksgiving break.
INSERT INTO public.break_optouts (break_id, user_id, opted_out_at)
VALUES (
  '0c000004-0000-0000-0000-0000000000a1',
  '0c000001-0000-0000-0000-000000000003',
  current_setting('test.p11.window_now')::timestamptz
);

SELECT is(
  public.worker_opted_out_of_break(
    '0c000001-0000-0000-0000-000000000003', '0c000004-0000-0000-0000-0000000000a1'),
  true,
  'opt-out: a worker who indicated zero hours reads as opted-out → suppresses the T-3d nag (§4.4)'
);
SELECT is(
  public.worker_opted_out_of_break(
    '0c000001-0000-0000-0000-000000000001', '0c000004-0000-0000-0000-0000000000a1'),
  false,
  'opt-out: a worker with no opt-out row is NOT opted-out (would be nagged if unclaimed, §4.4)'
);
SELECT is(
  public.worker_opted_out_of_break(
    '0c000001-0000-0000-0000-000000000003', '0c000004-0000-0000-0000-0000000000a2'),
  false,
  'opt-out: the opt-out is PER-BREAK — opting out of Thanksgiving does NOT opt out of spring break (§4.4)'
);

SELECT finish();
ROLLBACK;
