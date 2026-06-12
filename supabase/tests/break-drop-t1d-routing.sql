-- pgTAP: §4.4 — the BREAK-SHIFT DROP T-1d routing, exercised explicitly through
-- the generic drop path (drop_shift, the RPC the drop-shift Edge Function calls).
--
-- Chunk T2-2c contract:
--   * A CLAIMED break shift dropped BEFORE the start-anchored T-1d returns to the
--     break CALENDAR claim pool (claimable in-window) and does NOT appear in the
--     open-shifts feed.
--   * A break shift dropped AFTER T-1d surfaces in the OPEN-SHIFTS feed and is NOT
--     in the calendar pool (the picker is closed).
--   * A normal (non-break) drop is UNCHANGED — it lands in the open-shifts feed
--     exactly as today, regardless of break phase.
--
-- Mechanism note (why drop_shift needs no break branch): the routing is
-- PHASE-DRIVEN at the view layer, not at the drop write point. drop_shift sets
-- status = 'vacant' (vacancy_origin = 'temporary_drop'); both display surfaces
-- gate purely on status = 'vacant' PLUS the start-anchored break_claim_phase(...)
-- — neither inspects vacancy_origin — so a temporary_drop break seat routes
-- identically to a never_assigned one, and a non-break date satisfies neither the
-- pool's break-period join nor the feed's break-phase exclusion. This suite pins
-- that contract against future drift (it complements section G of
-- phase-11-break-transitions.sql by dropping an EXPLICITLY-claimed break shift and
-- asserting the non-break drop is unaffected in the same fixture).
--
-- Spec: BEHAVIORAL_SPECIFICATION.md §4.4 (T-14d→T-1d claim window; the T-1d cutoff;
-- "Dropped break shifts during this window return to the calendar claim pool, not
-- to the open-shifts feed"; "A worker who drops a previously-claimed break shift
-- during the T-1d-to-T-2h window sends that shift into the open-shifts feed").
-- Invariants: #5 (30-minute blocks on boundaries), #6 (timestamptz America/New_York;
-- all offsets anchor to break_periods.start_date at NY-local midnight, DST-safe).
--
-- Anchors: Thanksgiving 2026-11-25 (Wed) → 2026-11-29 (Sun), entirely in EST
-- (DST ended 2026-11-01). Start-anchored T-1d = 2026-11-24 00:00 EST. Blocks at
-- 18:00 NY-local keep their UTC slice on the same calendar date. "in_window" =
-- 2026-11-15 12:00 (inside [T-14d, T-1d)); "after_close" = 2026-11-25 12:00 (after
-- the start-anchored T-1d, INSIDE the break — proving the whole break has one
-- close).
--
-- Run with: supabase test db

BEGIN;

SELECT plan(9);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- short_break profile (seeded; re-asserted ON CONFLICT so the suite stands alone).
INSERT INTO public.operating_profiles
  (profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
   default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain,
   claim_phase_open_offset, claim_phase_alert_offset, claim_phase_close_offset)
VALUES
  ('regular_school_year', '08:00', '00:00', 20, 'soft', 'sm_built',    true,  '[]'::jsonb,
   NULL, NULL, NULL),
  ('short_break',         '08:00', '00:00', 40, 'hard', 'claim_based', true,  '[]'::jsonb,
   '-14 days'::interval, '-3 days'::interval, '-1 day'::interval)
ON CONFLICT (profile_name) DO NOTHING;

INSERT INTO public.break_periods (break_id, break_name, break_type, start_date, end_date, profile_name)
VALUES ('d2000004-0000-0000-0000-0000000000c1', 'T2-2c TG', 'thanksgiving', '2026-11-25', '2026-11-29', 'short_break');

INSERT INTO public.operating_calendar (date, profile_name)
VALUES
  ('2026-11-20', 'regular_school_year'),   -- non-break control date
  ('2026-11-27', 'short_break'),           -- break date for the claimed-drop seat
  ('2026-11-28', 'short_break')            -- break date for the after-close seat
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('d2000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 't22c-worker@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES ('d2000001-0000-0000-0000-000000000001', 'T2-2c Worker', 't22c-worker@test.local', 'house-05', true)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  -- breakWin: claimed-in-window, dropped-in-window → returns to calendar pool.
  ('d2000002-0000-0000-0000-000000000013', 'house-05', ('2026-11-27 18:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- breakFeed: vacant break seat dropped/evaluated after T-1d → open-shifts feed.
  ('d2000002-0000-0000-0000-000000000014', 'house-05', ('2026-11-28 18:00'::timestamp AT TIME ZONE 'America/New_York'), 1),
  -- reg: a normal (non-break) seat, owned then dropped → always in the feed.
  ('d2000002-0000-0000-0000-000000000020', 'house-05', ('2026-11-20 18:00'::timestamp AT TIME ZONE 'America/New_York'), 1);

INSERT INTO public.shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('d2000003-0000-0000-0000-000000000013', 'd2000002-0000-0000-0000-000000000013', NULL, 'vacant', 'never_assigned'),
  ('d2000003-0000-0000-0000-000000000014', 'd2000002-0000-0000-0000-000000000014', NULL, 'vacant', 'never_assigned'),
  -- reg seat starts OWNED by the worker (a regular scheduled assignment to drop).
  ('d2000003-0000-0000-0000-000000000020', 'd2000002-0000-0000-0000-000000000020',
   'd2000001-0000-0000-0000-000000000001', 'scheduled', 'none');

SELECT set_config('t22c.in_window',  ('2026-11-15 12:00'::timestamp AT TIME ZONE 'America/New_York')::text, false);
SELECT set_config('t22c.after_close',('2026-11-25 12:00'::timestamp AT TIME ZONE 'America/New_York')::text, false);

-- ── 1. Pre-T-1d: a CLAIMED break shift, dropped in-window, is claimable via the
--       calendar pool (and absent from the open-shifts feed). ──────────────────
SELECT lives_ok(
  $$ SELECT public.claim_break_shift(
       'd2000003-0000-0000-0000-000000000013'::uuid,
       'd2000001-0000-0000-0000-000000000001'::uuid,
       current_setting('t22c.in_window')::timestamptz) $$,
  'setup: worker claims the break shift during the window'
);

SELECT is(
  (SELECT status::text FROM public.shift_block_assignments
    WHERE assignment_id = 'd2000003-0000-0000-0000-000000000013'),
  'claimed',
  'setup: the break shift is now claimed (drop will exercise a claimed-break drop)'
);

SELECT lives_ok(
  $$ SELECT public.drop_shift(
       ARRAY['d2000003-0000-0000-0000-000000000013']::uuid[],
       'd2000001-0000-0000-0000-000000000001'::uuid,
       current_setting('t22c.in_window')::timestamptz) $$,
  'drop: the generic drop path accepts a claimed break shift dropped in-window'
);

SELECT is(
  (SELECT count(*)::integer FROM public.break_claim_calendar_pool(
       'house-05', current_setting('t22c.in_window')::timestamptz)
    WHERE block_id = 'd2000002-0000-0000-0000-000000000013'),
  1,
  'pre-T-1d: a dropped claimed break shift returns to the CALENDAR claim pool (§4.4)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.weekly_open_shifts_feed(
       'house-05', current_setting('t22c.in_window')::timestamptz)
    WHERE block_id = 'd2000002-0000-0000-0000-000000000013'),
  0,
  'pre-T-1d: the dropped break shift does NOT appear in the open-shifts feed (§4.4)'
);

-- ── 2. Post-T-1d: a break shift surfaces in the open-shifts feed (not the pool). ──
-- breakFeed is dropped (here: evaluated as a vacant break seat) after the
-- start-anchored T-1d; the picker is closed for the whole break.
SELECT is(
  (SELECT count(*)::integer FROM public.break_claim_calendar_pool(
       'house-05', current_setting('t22c.after_close')::timestamptz)
    WHERE block_id = 'd2000002-0000-0000-0000-000000000014'),
  0,
  'post-T-1d: the calendar picker is closed — the break shift is NOT in the pool (§4.4)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.weekly_open_shifts_feed(
       'house-05', current_setting('t22c.after_close')::timestamptz)
    WHERE block_id = 'd2000002-0000-0000-0000-000000000014'),
  1,
  'post-T-1d: the break shift enters the OPEN-SHIFTS feed (§4.4)'
);

-- ── 3. Non-break drop is UNCHANGED: it lands in the open-shifts feed as today,
--       and never appears in any break calendar pool. ──────────────────────────
SELECT lives_ok(
  $$ SELECT public.drop_shift(
       ARRAY['d2000003-0000-0000-0000-000000000020']::uuid[],
       'd2000001-0000-0000-0000-000000000001'::uuid,
       current_setting('t22c.in_window')::timestamptz) $$,
  'no-regression: a normal (non-break) drop is accepted exactly as today'
);

SELECT is(
  (SELECT count(*)::integer FROM public.weekly_open_shifts_feed(
       'house-05', current_setting('t22c.in_window')::timestamptz)
    WHERE block_id = 'd2000002-0000-0000-0000-000000000020'),
  1,
  'no-regression: the dropped non-break shift is in the open-shifts feed (drop path unchanged)'
);

SELECT finish();
ROLLBACK;
