-- pgTAP behavioral tests for Phase 05: Open Shifts Feed Queries
-- Spec sources: BEHAVIORAL_SPECIFICATION §5.1 (weekly + permanent feeds),
--               §5.4 (T-2h unpickable cutoff), §5.6 (3-tab layout),
--               §8.4 (permanent_drop semantics);
--               ARCHITECTURE §3.2 (shift_block_assignments status enum),
--               §3.3 (vacancy_origin enum — permanent_drop powers the
--               permanent openings feed).
-- Run with: supabase test db
--
-- The open-shifts feed is implemented as two query surfaces:
--
--   public.weekly_open_shifts_feed(p_house_id text, p_as_of timestamptz)
--     RETURNS SETOF shift_block_assignments
--   — vacant assignments at the house with block_start_at strictly within
--     [p_as_of, p_as_of + 30 days]. Unpickable rows (block_start_at within
--     T-2h of p_as_of) STAY in the result; visibility is independent of
--     claimability (BEH §5.1: "remain in the feed until... unpickable").
--
--   public.is_assignment_claimable(p_assignment_id uuid, p_as_of timestamptz)
--     RETURNS boolean
--   — true iff the assignment is vacant AND block_start_at > p_as_of + 2h
--     (strictly — at-or-after T-2h is unclaimable per BEH §5.4).
--
--   public.permanent_openings_feed(p_house_id text,
--                                   p_as_of timestamptz DEFAULT now())
--     RETURNS TABLE (house_id text, day_of_week int, block_start_time time,
--                    weeks_remaining bigint)
--   — recurring slot view: rows with status='vacant' AND
--     vacancy_origin='permanent_drop' at the house whose block_start_at
--     is >= p_as_of, grouped by (house_id, day_of_week,
--     block_start_time_of_day_in_NY). One row per distinct (day-of-week,
--     block-start-time) tuple. p_as_of has DEFAULT now() so production
--     callers can omit it; tests pass an explicit anchor for determinism.
--
-- TDD-first: functions do not yet exist. These tests pin observable behavior.

BEGIN;

SELECT plan(35);

-- ============================================================
-- 0. Setup: minimal fixture across a 60-day window.
-- "now" is anchored to a fixed test moment via a CTE; the functions
-- take p_as_of so tests are deterministic regardless of wall clock.
-- ============================================================

-- A baseline auth user (we only need one — the feed query doesn't read users).
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('e0000005-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p05-sm@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('e0000005-0000-0000-0000-000000000099', 'P05 SM', 'p05-sm@test.local',
   'harnwell', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('e0000005-0000-0000-0000-000000000099', 'sm', 'harnwell');

-- Anchor moment: hour-aligned NY timestamp 30 days from now(). Using a
-- future-relative anchor (rather than a hard-coded literal) makes the test
-- deterministic across machine clocks; every relative date is computed off
-- the same anchor. The 30-day forward offset guarantees all generated
-- block_start_at values remain in the future for is_assignment_claimable
-- and any now()-anchored implementation choice.
SELECT set_config(
  'test.phase05.as_of',
  ((date_trunc('hour', now() AT TIME ZONE 'America/New_York')
    + interval '30 days') AT TIME ZONE 'America/New_York')::text,
  false
);

-- Blocks at Harnwell across the lookahead window:
--   B_far    : start at as_of + 45 days (outside 30-day horizon)
--   B_in_30d : start at as_of + 10 days (well within horizon)
--   B_t3h    : start at as_of + 3 hours (within horizon, still pickable, > T-2h)
--   B_t2h_eq : start at as_of + 2 hours exactly (at the T-2h boundary → UNclaimable)
--   B_t1h    : start at as_of + 1 hour (within T-2h cutoff → UNclaimable)
--   B_quad   : a Quad block at as_of + 7 days (different house — must not appear in Harnwell feed)
--   B_pastdrop_oneoccurrence : Harnwell block at as_of + 5 days with vacancy_origin='permanent_drop'
--   B_pastdrop_recurrence_w2 : same day-of-week/time-of-day as the above but 7 days later
--                              (recurring-slot pair; grouping test exercises both)

INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  -- Note: required_headcount > 0; the test only creates one assignment per block.
  ('f0000005-0000-0000-0000-0000000000a1', 'harnwell',
   ((current_setting('test.phase05.as_of')::timestamptz) + interval '45 days'), 2),
  ('f0000005-0000-0000-0000-0000000000a2', 'harnwell',
   ((current_setting('test.phase05.as_of')::timestamptz) + interval '10 days'), 2),
  ('f0000005-0000-0000-0000-0000000000a3', 'harnwell',
   ((current_setting('test.phase05.as_of')::timestamptz) + interval '3 hours'), 2),
  ('f0000005-0000-0000-0000-0000000000a4', 'harnwell',
   ((current_setting('test.phase05.as_of')::timestamptz) + interval '2 hours'), 2),
  ('f0000005-0000-0000-0000-0000000000a5', 'harnwell',
   ((current_setting('test.phase05.as_of')::timestamptz) + interval '1 hour'), 2),
  ('f0000005-0000-0000-0000-0000000000b1', 'quad',
   ((current_setting('test.phase05.as_of')::timestamptz) + interval '7 days'), 3),
  ('f0000005-0000-0000-0000-0000000000c1', 'harnwell',
   ((current_setting('test.phase05.as_of')::timestamptz) + interval '5 days'), 2),
  ('f0000005-0000-0000-0000-0000000000c2', 'harnwell',
   ((current_setting('test.phase05.as_of')::timestamptz) + interval '12 days'), 2);

-- Vacant assignments (one per block — the missing seat).
-- B_far uses vacancy_origin='never_assigned' (SM left it empty).
-- B_in_30d uses vacancy_origin='temporary_drop'.
-- B_t3h, B_t2h_eq, B_t1h all use 'temporary_drop' (worker dropped close to start).
-- B_quad uses 'temporary_drop'.
-- B_pastdrop_oneoccurrence and B_pastdrop_recurrence_w2 use 'permanent_drop'.

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('e0000005-1000-0000-0000-0000000000a1',
   'f0000005-0000-0000-0000-0000000000a1', NULL, 'vacant', 'never_assigned'),
  ('e0000005-1000-0000-0000-0000000000a2',
   'f0000005-0000-0000-0000-0000000000a2', NULL, 'vacant', 'temporary_drop'),
  ('e0000005-1000-0000-0000-0000000000a3',
   'f0000005-0000-0000-0000-0000000000a3', NULL, 'vacant', 'temporary_drop'),
  ('e0000005-1000-0000-0000-0000000000a4',
   'f0000005-0000-0000-0000-0000000000a4', NULL, 'vacant', 'temporary_drop'),
  ('e0000005-1000-0000-0000-0000000000a5',
   'f0000005-0000-0000-0000-0000000000a5', NULL, 'vacant', 'temporary_drop'),
  ('e0000005-1000-0000-0000-0000000000b1',
   'f0000005-0000-0000-0000-0000000000b1', NULL, 'vacant', 'temporary_drop'),
  ('e0000005-1000-0000-0000-0000000000c1',
   'f0000005-0000-0000-0000-0000000000c1', NULL, 'vacant', 'permanent_drop'),
  ('e0000005-1000-0000-0000-0000000000c2',
   'f0000005-0000-0000-0000-0000000000c2', NULL, 'vacant', 'permanent_drop');

-- ============================================================
-- 1. Function existence
-- ============================================================

SELECT has_function(
  'public', 'weekly_open_shifts_feed', ARRAY['text', 'timestamptz'],
  'weekly_open_shifts_feed(text, timestamptz) function exists'
);

SELECT has_function(
  'public', 'is_assignment_claimable', ARRAY['uuid', 'timestamptz'],
  'is_assignment_claimable(uuid, timestamptz) function exists'
);

SELECT has_function(
  'public', 'permanent_openings_feed', ARRAY['text', 'timestamptz'],
  'permanent_openings_feed(text, timestamptz) function exists '
  || '(second arg has DEFAULT now(); existing call sites use 1-arg form)'
);

-- ============================================================
-- 2. Weekly feed: 30-day horizon (BEH §5.1)
-- ============================================================

SELECT is(
  (SELECT count(*) FROM public.weekly_open_shifts_feed(
    'harnwell', (current_setting('test.phase05.as_of')::timestamptz))
    WHERE block_id = 'f0000005-0000-0000-0000-0000000000a1')::integer,
  0,
  'block 45 days away (outside 30-day horizon) is NOT in weekly feed'
);

SELECT is(
  (SELECT count(*) FROM public.weekly_open_shifts_feed(
    'harnwell', (current_setting('test.phase05.as_of')::timestamptz))
    WHERE block_id = 'f0000005-0000-0000-0000-0000000000a2')::integer,
  1,
  'block 10 days away (within 30-day horizon) IS in weekly feed'
);

SELECT is(
  (SELECT count(*) FROM public.weekly_open_shifts_feed(
    'harnwell', (current_setting('test.phase05.as_of')::timestamptz))
    WHERE block_id = 'f0000005-0000-0000-0000-0000000000a3')::integer,
  1,
  'block 3 hours away (within horizon, > T-2h) IS in weekly feed (still pickable)'
);

-- BEH §5.1: "Open shifts in the weekly feed remain claimable until the
-- T-2 hour escalation point of that shift, at which point they become
-- unpickable." — the feed still SHOWS unpickable rows, but the
-- is_assignment_claimable check filters them at claim time.
SELECT is(
  (SELECT count(*) FROM public.weekly_open_shifts_feed(
    'harnwell', (current_setting('test.phase05.as_of')::timestamptz))
    WHERE block_id IN (
      'f0000005-0000-0000-0000-0000000000a4',
      'f0000005-0000-0000-0000-0000000000a5'))::integer,
  2,
  'blocks at or after T-2h still APPEAR in feed (visibility is independent of claimability)'
);

-- ============================================================
-- 3. Weekly feed: per-house scoping (BEH §5.1, §5.6 Tab 2 vs Tab 3)
-- ============================================================

SELECT is(
  (SELECT count(*) FROM public.weekly_open_shifts_feed(
    'harnwell', (current_setting('test.phase05.as_of')::timestamptz))
    WHERE block_id = 'f0000005-0000-0000-0000-0000000000b1')::integer,
  0,
  'Quad block does NOT appear in Harnwell-house feed'
);

SELECT is(
  (SELECT count(*) FROM public.weekly_open_shifts_feed(
    'quad', (current_setting('test.phase05.as_of')::timestamptz))
    WHERE block_id = 'f0000005-0000-0000-0000-0000000000b1')::integer,
  1,
  'Quad block IS in Quad-house feed'
);

SELECT is(
  (SELECT count(*) FROM public.weekly_open_shifts_feed(
    'quad', (current_setting('test.phase05.as_of')::timestamptz))
    WHERE block_id IN (
      'f0000005-0000-0000-0000-0000000000a2',
      'f0000005-0000-0000-0000-0000000000a3'))::integer,
  0,
  'Harnwell blocks do NOT appear in Quad-house feed'
);

-- ============================================================
-- 4. Weekly feed: only status='vacant' rows (BEH §5.1, ARCH §3.3)
-- ============================================================

-- Add a scheduled (non-vacant) assignment on B_in_30d's block. The feed
-- must continue to return only the vacant row, not the scheduled one.
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('e0000005-2000-0000-0000-0000000000a2',
   'f0000005-0000-0000-0000-0000000000a2',
   'e0000005-0000-0000-0000-000000000099',
   'scheduled', 'none');

SELECT is(
  (SELECT count(*) FROM public.weekly_open_shifts_feed(
    'harnwell', (current_setting('test.phase05.as_of')::timestamptz))
    WHERE block_id = 'f0000005-0000-0000-0000-0000000000a2')::integer,
  1,
  'feed returns only the vacant row for a block that has both scheduled and vacant assignments'
);

SELECT is(
  (SELECT status FROM public.weekly_open_shifts_feed(
    'harnwell', (current_setting('test.phase05.as_of')::timestamptz))
    WHERE block_id = 'f0000005-0000-0000-0000-0000000000a2')::text,
  'vacant',
  'the returned row has status=vacant'
);

-- ============================================================
-- 5. Permanent-drop occurrences appear in BOTH feeds (BEH §5.1)
-- "A permanently-dropped slot's individual weekly occurrences still
--  surface in the weekly feed as they cross the 30-day horizon."
-- ============================================================

SELECT is(
  (SELECT count(*) FROM public.weekly_open_shifts_feed(
    'harnwell', (current_setting('test.phase05.as_of')::timestamptz))
    WHERE block_id IN (
      'f0000005-0000-0000-0000-0000000000c1',
      'f0000005-0000-0000-0000-0000000000c2'))::integer,
  2,
  'both permanent_drop occurrences (5d and 12d out) appear in the weekly feed'
);

SELECT is(
  (SELECT vacancy_origin FROM public.weekly_open_shifts_feed(
    'harnwell', (current_setting('test.phase05.as_of')::timestamptz))
    WHERE block_id = 'f0000005-0000-0000-0000-0000000000c1')::text,
  'permanent_drop',
  'permanent_drop vacancy_origin is preserved on weekly-feed rows'
);

-- ============================================================
-- 6. is_assignment_claimable: T-2h boundary (BEH §5.4)
-- "any claim attempt strictly after T-2 hours fails. If a claim is in
--  progress at exactly T-2 hours, it fails. Only claims completed
--  strictly before T-2 hours succeed."
-- ============================================================

SELECT is(
  public.is_assignment_claimable(
    'e0000005-1000-0000-0000-0000000000a3'::uuid,
    (current_setting('test.phase05.as_of')::timestamptz)),
  true,
  'block 3 hours away (> T-2h) is claimable'
);

-- Edge case from prompt: "Claim at T-2h minus 1 second: succeeds."
SELECT is(
  public.is_assignment_claimable(
    'e0000005-1000-0000-0000-0000000000a4'::uuid,
    -- 1 second before the T-2h boundary at a4 (a4 starts at as_of + 2h)
    ((current_setting('test.phase05.as_of')::timestamptz) - interval '1 second')),
  true,
  'block at T-2h boundary, evaluated 1 second before T-2h, is still claimable'
);

-- Edge case from prompt: "Claim at exactly T-2h (boundary): rejected."
SELECT is(
  public.is_assignment_claimable(
    'e0000005-1000-0000-0000-0000000000a4'::uuid,
    (current_setting('test.phase05.as_of')::timestamptz)),
  false,
  'block at exactly T-2h boundary is NOT claimable (the moment T-2h hits)'
);

SELECT is(
  public.is_assignment_claimable(
    'e0000005-1000-0000-0000-0000000000a5'::uuid,
    (current_setting('test.phase05.as_of')::timestamptz)),
  false,
  'block 1 hour away (well inside T-2h cutoff) is NOT claimable'
);

-- Non-vacant assignments are never claimable.
SELECT is(
  public.is_assignment_claimable(
    'e0000005-2000-0000-0000-0000000000a2'::uuid,
    (current_setting('test.phase05.as_of')::timestamptz)),
  false,
  'a scheduled (non-vacant) assignment is never claimable'
);

-- ============================================================
-- 6b. Coverage-conditional T-2h lock (BEH §5.4/§5.5)
-- A vacant seat within T-2h stays claimable while a REAL co-worker is
-- still on the desk (block_has_present_worker); a one-way coverage lock
-- (coverage_locked_at) makes it unpickable even when covered.
-- ============================================================

-- D_covered: Harnwell block 90 min out (inside T-2h), double-staffed — one
-- vacant seat plus one scheduled sibling, so the desk is still covered. (90m,
-- not 60m, to stay distinct from a5's as_of+1h block.)
INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000005-0000-0000-0000-0000000000d1', 'harnwell',
   ((current_setting('test.phase05.as_of')::timestamptz) + interval '90 minutes'), 2);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('e0000005-1000-0000-0000-0000000000d1',
   'f0000005-0000-0000-0000-0000000000d1', NULL, 'vacant', 'temporary_drop'),
  ('e0000005-3000-0000-0000-0000000000d1',
   'f0000005-0000-0000-0000-0000000000d1',
   'e0000005-0000-0000-0000-000000000099', 'scheduled', 'none');

SELECT is(
  public.is_assignment_claimable(
    'e0000005-1000-0000-0000-0000000000d1'::uuid,
    (current_setting('test.phase05.as_of')::timestamptz)),
  true,
  'vacant seat within T-2h on a STILL-STAFFED desk is claimable (coverage-conditional)'
);

-- One-way lock the block: now unpickable even though a sibling is still on.
SELECT public.lock_block_coverage(
  'f0000005-0000-0000-0000-0000000000d1'::uuid,
  (current_setting('test.phase05.as_of')::timestamptz));

SELECT is(
  public.is_assignment_claimable(
    'e0000005-1000-0000-0000-0000000000d1'::uuid,
    (current_setting('test.phase05.as_of')::timestamptz)),
  false,
  'a coverage-locked block is unpickable even while a sibling worker is present (one-way §5.5)'
);

-- Control: a5 (1h out, single-seat, no present sibling) stays NOT claimable —
-- confirms the within-T-2h exemption requires real coverage, not just any block.
SELECT is(
  public.is_assignment_claimable(
    'e0000005-1000-0000-0000-0000000000a5'::uuid,
    (current_setting('test.phase05.as_of')::timestamptz)),
  false,
  'vacant seat within T-2h on an EMPTY desk is NOT claimable (coverage floor)'
);

-- ============================================================
-- 7. Permanent openings feed: only permanent_drop rows (BEH §5.1)
-- ============================================================

SELECT is(
  (SELECT count(*) FROM public.permanent_openings_feed('harnwell'))::integer,
  -- B_pastdrop_oneoccurrence and B_pastdrop_recurrence_w2 both belong to
  -- the same (day-of-week, block-start-time) tuple — they're occurrences
  -- of the same recurring slot. Grouped result: 1 row.
  1,
  'permanent_openings_feed groups by (day_of_week, block_start_time): two occurrences of the same recurring slot → 1 grouped row'
);

SELECT is(
  (SELECT weeks_remaining FROM public.permanent_openings_feed('harnwell')
    LIMIT 1)::integer,
  2,
  'grouped row reports weeks_remaining=2 (two future occurrences of the slot)'
);

-- The temporary-drop block on a2 must NOT leak into the permanent openings feed.
-- Match on the block's specific (day_of_week, time-of-day): the permanent_drop
-- fixture blocks share as_of's time-of-day but sit on a different day_of_week,
-- so a temporary_drop slot identified by both must be absent from the feed.
SELECT is(
  (SELECT count(*) FROM public.permanent_openings_feed('harnwell')
    WHERE day_of_week = EXTRACT(DOW FROM
            ((current_setting('test.phase05.as_of')::timestamptz) + interval '10 days')
              AT TIME ZONE 'America/New_York')::integer
      AND block_start_time = (
        (((current_setting('test.phase05.as_of')::timestamptz) + interval '10 days')
          AT TIME ZONE 'America/New_York')::time))::integer,
  0,
  'temporary_drop vacancies do NOT appear in the permanent openings feed'
);

-- The never_assigned vacancy 45 days out must NOT appear either.
SELECT is(
  (SELECT count(*) FROM public.permanent_openings_feed('harnwell')
    WHERE day_of_week = EXTRACT(DOW FROM
            ((current_setting('test.phase05.as_of')::timestamptz) + interval '45 days')
              AT TIME ZONE 'America/New_York')::integer
      AND block_start_time = (
        (((current_setting('test.phase05.as_of')::timestamptz) + interval '45 days')
          AT TIME ZONE 'America/New_York')::time))::integer,
  0,
  'never_assigned vacancies do NOT appear in the permanent openings feed'
);

-- ============================================================
-- 8. Permanent openings feed: per-house scoping
-- ============================================================

-- Insert a Quad permanent_drop block to verify it does not leak into Harnwell.
INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000005-0000-0000-0000-0000000000d1', 'quad',
   ((current_setting('test.phase05.as_of')::timestamptz) + interval '8 days'), 3);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('e0000005-1000-0000-0000-0000000000d1',
   'f0000005-0000-0000-0000-0000000000d1', NULL, 'vacant', 'permanent_drop');

SELECT is(
  (SELECT count(*) FROM public.permanent_openings_feed('harnwell'))::integer,
  1,
  'Quad permanent_drop does NOT appear in Harnwell permanent openings feed'
);

SELECT is(
  (SELECT count(*) FROM public.permanent_openings_feed('quad'))::integer,
  1,
  'Quad permanent_drop appears in Quad permanent openings feed'
);

-- ============================================================
-- 9. Held-until-horizon semantics for far-future drops (BEH §5.1, §5.2)
-- "A dropped regular-schedule shift more than 30 days in the future
--  remains in the system but is hidden from the weekly feed until its
--  start time crosses the 30-day horizon."
-- ============================================================

-- Re-confirm that B_far (45 days out, never_assigned) is hidden today.
-- Then advance the as_of by 20 days — B_far is now 25 days out and MUST
-- surface in the feed.
SELECT is(
  (SELECT count(*) FROM public.weekly_open_shifts_feed(
    'harnwell',
    (current_setting('test.phase05.as_of')::timestamptz) + interval '20 days')
    WHERE block_id = 'f0000005-0000-0000-0000-0000000000a1')::integer,
  1,
  'block 45 days out today surfaces in the weekly feed once 20 days have elapsed (now 25 days out, within horizon)'
);

-- ============================================================
-- 10. Past blocks (block_start_at <= as_of) are filtered out
-- ============================================================

-- A block that already started should not appear in the feed regardless
-- of vacancy_origin (the system is forward-looking only).
INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f0000005-0000-0000-0000-0000000000e1', 'harnwell',
   ((current_setting('test.phase05.as_of')::timestamptz) - interval '2 hours'), 2);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('e0000005-1000-0000-0000-0000000000e1',
   'f0000005-0000-0000-0000-0000000000e1', NULL, 'vacant', 'temporary_drop');

SELECT is(
  (SELECT count(*) FROM public.weekly_open_shifts_feed(
    'harnwell', (current_setting('test.phase05.as_of')::timestamptz))
    WHERE block_id = 'f0000005-0000-0000-0000-0000000000e1')::integer,
  0,
  'past-start blocks (block_start_at < as_of) are NOT in the weekly feed'
);

SELECT is(
  public.is_assignment_claimable(
    'e0000005-1000-0000-0000-0000000000e1'::uuid,
    (current_setting('test.phase05.as_of')::timestamptz)),
  false,
  'past-start vacant assignment is NOT claimable'
);

-- ============================================================
-- 11. Closed-house behavior (BEH §3.4, §5.6)
-- A house with no operating presence (no rows in staffing_patterns,
-- no shift_blocks) has an empty feed. We assert the feed function
-- handles "house with zero vacant blocks" gracefully — empty result.
-- ============================================================

SELECT is(
  (SELECT count(*) FROM public.weekly_open_shifts_feed(
    'mayer', (current_setting('test.phase05.as_of')::timestamptz)))::integer,
  0,
  'house with no vacant blocks returns empty weekly feed (no error)'
);

SELECT is(
  (SELECT count(*) FROM public.permanent_openings_feed('mayer'))::integer,
  0,
  'house with no permanent_drop blocks returns empty permanent openings feed (no error)'
);

-- ============================================================
-- 12. Negative: non-vacant statuses are filtered from the permanent feed
-- ============================================================

-- A previously permanent_drop block that has been picked up by another
-- worker (status -> 'claimed') must vanish from the permanent openings feed.
UPDATE public.shift_block_assignments
   SET status = 'claimed',
       vacancy_origin = 'none',
       user_id = 'e0000005-0000-0000-0000-000000000099'
 WHERE assignment_id = 'e0000005-1000-0000-0000-0000000000c1';

SELECT is(
  (SELECT count(*) FROM public.permanent_openings_feed('harnwell'))::integer,
  -- c2 is still vacant + permanent_drop → 1 grouped row remains.
  1,
  'after one of two permanent_drop occurrences is claimed, the feed still surfaces the remaining occurrence (weeks_remaining drops to 1)'
);

SELECT is(
  (SELECT weeks_remaining FROM public.permanent_openings_feed('harnwell')
    LIMIT 1)::integer,
  1,
  'after a permanent_drop occurrence is claimed, weeks_remaining reflects only the remaining vacant occurrences'
);

SELECT finish();
ROLLBACK;
