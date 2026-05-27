-- pgTAP behavioral tests for Phase 03: Calendar Generation
-- Spec sources: BEHAVIORAL §1.4, §1.5; ARCHITECTURE §1.6, §1.7, §3.2
-- Run with: supabase test db
--
-- These tests describe the observable behavior of the
--   generate_blocks_for_date(target_date date) → void
-- function. The function reads operating_calendar + operating_profiles +
-- staffing_patterns and produces the corresponding shift_blocks and
-- shift_block_assignments rows. It is idempotent: a second call for
-- the same date must produce no duplicates and must not change counts.
--
-- The America/New_York time zone is the operational anchor for all
-- wall-clock reasoning. The tests cast literal "YYYY-MM-DD HH:MM
-- America/New_York" timestamps so that what we assert here matches
-- what the spec describes in wall-clock terms.

BEGIN;

SELECT plan(44);

-- ============================================================
-- 0. Operating calendar fixtures
--
-- We insert calendar rows covering the dates this file exercises:
--   2026-02-02 Mon — regular_school_year (weekday)
--   2026-02-07 Sat — regular_school_year (weekend)
--   2025-12-22 Mon — winter_break        (weekday)
--   2026-03-08 Sun — regular_school_year (weekend, DST spring-forward)
--   2025-11-02 Sun — regular_school_year (weekend, DST fall-back)
--   2026-07-15 Wed — SUMMER, no row     (deliberate omission)
-- ============================================================

INSERT INTO public.operating_calendar (date, profile_name) VALUES
  ('2026-02-02', 'regular_school_year'),
  ('2026-02-07', 'regular_school_year'),
  ('2025-12-22', 'winter_break'),
  ('2026-03-08', 'regular_school_year'),
  ('2025-11-02', 'regular_school_year')
ON CONFLICT (date) DO NOTHING;

-- ============================================================
-- 1. The function exists with the expected signature
-- ============================================================

SELECT has_function('public', 'generate_blocks_for_date',
                    ARRAY['date'],
                    'generate_blocks_for_date(date) function exists');

-- ============================================================
-- 2. Headcount and row counts for a regular_school_year weekday
--
-- shift_start_bound = 08:00, shift_end_bound = 24:00 → 32 blocks.
-- Harnwell headcount 2 → 64 assignments.
-- Quad     headcount 3 → 96 assignments.
-- A single-staff house headcount 1 → 32 assignments.
-- ============================================================

SELECT generate_blocks_for_date('2026-02-02');

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE house_id = 'harnwell'
      AND block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz),
  32,
  'regular weekday: Harnwell has 32 shift_blocks rows on 2026-02-02'
);

SELECT is(
  (SELECT count(*)::int FROM public.shift_block_assignments a
    JOIN public.shift_blocks b USING (block_id)
   WHERE b.house_id = 'harnwell'
     AND b.block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
     AND b.block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz),
  64,
  'regular weekday: Harnwell has 64 assignment rows (32 × 2 headcount)'
);

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE house_id = 'quad'
      AND block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz),
  32,
  'regular weekday: Quad has 32 shift_blocks rows'
);

SELECT is(
  (SELECT count(*)::int FROM public.shift_block_assignments a
    JOIN public.shift_blocks b USING (block_id)
   WHERE b.house_id = 'quad'
     AND b.block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
     AND b.block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz),
  96,
  'regular weekday: Quad has 96 assignment rows (32 × 3 headcount)'
);

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE house_id = 'house-03'
      AND block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz),
  32,
  'regular weekday: single-staff house-03 has 32 shift_blocks rows'
);

SELECT is(
  (SELECT count(*)::int FROM public.shift_block_assignments a
    JOIN public.shift_blocks b USING (block_id)
   WHERE b.house_id = 'house-03'
     AND b.block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
     AND b.block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz),
  32,
  'regular weekday: single-staff house-03 has 32 assignment rows (32 × 1)'
);

-- All 13 houses are operational under regular_school_year, so 13 × 32 = 416 blocks.
SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz),
  13 * 32,
  'regular weekday: all 13 houses produce blocks (13 × 32 = 416)'
);

-- ============================================================
-- 3. Status invariants on newly generated rows
-- ============================================================

SELECT is(
  (SELECT count(*)::int FROM public.shift_block_assignments a
    JOIN public.shift_blocks b USING (block_id)
   WHERE b.block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
     AND b.block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz
     AND a.status = 'vacant'
     AND a.vacancy_origin = 'never_assigned'
     AND a.user_id IS NULL
     AND a.is_float = false
     AND a.is_cross_house_pickup = false
     AND a.source_house_id IS NULL
     AND a.parent_float_id IS NULL),
  (SELECT count(*)::int FROM public.shift_block_assignments a
    JOIN public.shift_blocks b USING (block_id)
   WHERE b.block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
     AND b.block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz),
  'every newly generated assignment is vacant/never_assigned with NULL user_id and no float/pickup flags'
);

-- ============================================================
-- 4. Multi-headcount blocks produce distinct assignment_ids per seat
-- ============================================================

SELECT is(
  (SELECT count(*)::int FROM (
     SELECT block_id, count(DISTINCT assignment_id) AS seats
       FROM public.shift_block_assignments
      WHERE block_id IN (
        SELECT block_id FROM public.shift_blocks
         WHERE house_id = 'harnwell'
           AND block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
           AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz)
      GROUP BY block_id
      HAVING count(DISTINCT assignment_id) = 2
   ) seat_counts),
  32,
  'every Harnwell block on 2026-02-02 has exactly 2 distinct seat assignment_ids'
);

SELECT is(
  (SELECT count(*)::int FROM (
     SELECT block_id, count(DISTINCT assignment_id) AS seats
       FROM public.shift_block_assignments
      WHERE block_id IN (
        SELECT block_id FROM public.shift_blocks
         WHERE house_id = 'quad'
           AND block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
           AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz)
      GROUP BY block_id
      HAVING count(DISTINCT assignment_id) = 3
   ) seat_counts),
  32,
  'every Quad block on 2026-02-02 has exactly 3 distinct seat assignment_ids'
);

-- ============================================================
-- 5. Block start-time boundaries (ARCH §1.7, BEH §1.5)
-- ============================================================

-- All block_start_at values land on a 30-min boundary in America/New_York.
SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz
      AND NOT (
        EXTRACT(MINUTE FROM block_start_at AT TIME ZONE 'America/New_York') IN (0, 30)
        AND EXTRACT(SECOND FROM block_start_at AT TIME ZONE 'America/New_York') = 0
      )),
  0,
  'every block_start_at is on a 30-minute boundary in America/New_York'
);

-- No block_start_at is before the profile's shift_start_bound (08:00).
SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz
      AND (block_start_at AT TIME ZONE 'America/New_York')::time < '08:00'),
  0,
  'no block_start_at is before shift_start_bound (08:00)'
);

-- No block_start_at is at or after the next-day midnight (24:00 = next-day 00:00).
SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE block_start_at >= '2026-02-03 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-03 08:00 America/New_York'::timestamptz),
  0,
  'no block_start_at spills into next-day pre-08:00 territory'
);

-- The last block of a Harnwell day starts at 23:30 — not 00:00 of the next day.
SELECT is(
  (SELECT max(block_start_at) FROM public.shift_blocks
    WHERE house_id = 'harnwell'
      AND block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz),
  '2026-02-02 23:30 America/New_York'::timestamptz,
  'last Harnwell block on 2026-02-02 starts at 23:30 local'
);

-- The first block of a Harnwell day starts at 08:00 — not earlier.
SELECT is(
  (SELECT min(block_start_at) FROM public.shift_blocks
    WHERE house_id = 'harnwell'
      AND block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz),
  '2026-02-02 08:00 America/New_York'::timestamptz,
  'first Harnwell block on 2026-02-02 starts at 08:00 local'
);

-- ============================================================
-- 6. Date attribution at block boundaries (BEH §1.4)
--
-- A 23:30 block on date N belongs to date N (block_start_at is on N).
-- A 00:00 block of the next day belongs to N+1 — i.e. generating N
-- alone never produces a 00:00 row dated N+1.
-- ============================================================

-- 23:30 block exists with block_start_at on date N in local zone.
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.shift_blocks
     WHERE house_id = 'harnwell'
       AND block_start_at = '2026-02-02 23:30 America/New_York'::timestamptz
  ),
  'date attribution: 23:30 block belongs to date N (Harnwell 2026-02-02 23:30 exists)'
);

-- No 00:00 next-day block was generated by the N-only call.
SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE house_id = 'harnwell'
      AND block_start_at = '2026-02-03 00:00 America/New_York'::timestamptz),
  0,
  'date attribution: generating N alone never produces a 00:00 N+1 block'
);

-- ============================================================
-- 7. Weekend behavior on regular_school_year (2026-02-07)
-- Same headcount per ARCH §3.3 (regular weekend = regular weekday).
-- ============================================================

SELECT generate_blocks_for_date('2026-02-07');

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE block_start_at >= '2026-02-07 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-08 00:00 America/New_York'::timestamptz),
  13 * 32,
  'regular weekend (2026-02-07): all 13 houses produce 32 blocks each'
);

-- ============================================================
-- 8. Winter break: Harnwell only, headcount 1
-- ============================================================

SELECT generate_blocks_for_date('2025-12-22');

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE house_id = 'harnwell'
      AND block_start_at >= '2025-12-22 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2025-12-23 00:00 America/New_York'::timestamptz),
  32,
  'winter_break: Harnwell still has 32 blocks'
);

SELECT is(
  (SELECT count(*)::int FROM public.shift_block_assignments a
    JOIN public.shift_blocks b USING (block_id)
   WHERE b.house_id = 'harnwell'
     AND b.block_start_at >= '2025-12-22 00:00 America/New_York'::timestamptz
     AND b.block_start_at <  '2025-12-23 00:00 America/New_York'::timestamptz),
  32,
  'winter_break: Harnwell has 32 assignment rows (32 × 1 headcount)'
);

-- Every Harnwell winter assignment has required_headcount=1 on its block.
SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE house_id = 'harnwell'
      AND block_start_at >= '2025-12-22 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2025-12-23 00:00 America/New_York'::timestamptz
      AND required_headcount = 1),
  32,
  'winter_break: all Harnwell blocks carry required_headcount = 1'
);

-- Quad and every single-staff house have ZERO rows on a winter date.
SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE house_id = 'quad'
      AND block_start_at >= '2025-12-22 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2025-12-23 00:00 America/New_York'::timestamptz),
  0,
  'winter_break: Quad has zero blocks (house closed)'
);

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE house_id <> 'harnwell'
      AND block_start_at >= '2025-12-22 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2025-12-23 00:00 America/New_York'::timestamptz),
  0,
  'winter_break: all 12 non-Harnwell houses have zero blocks'
);

-- ============================================================
-- 9. Summer date (no operating_calendar row) generates nothing
-- ============================================================

SELECT lives_ok(
  $$ SELECT generate_blocks_for_date('2026-07-15') $$,
  'summer date with no calendar row is accepted without error'
);

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE block_start_at >= '2026-07-15 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-07-16 00:00 America/New_York'::timestamptz),
  0,
  'summer: zero blocks generated for a date with no operating_calendar row'
);

-- ============================================================
-- 10. House with no staffing pattern under a profile → 0 blocks
--
-- Construct the case explicitly: insert an extra operating_calendar
-- row whose profile is winter_break; all houses except Harnwell have
-- no staffing_patterns row → no blocks.
-- (We already covered §8; here we restate the invariant per-house.)
-- ============================================================

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE house_id IN ('quad','house-03','house-04','house-05','house-06',
                       'house-07','house-08','house-09','house-10','house-11',
                       'house-12','house-13')
      AND block_start_at >= '2025-12-22 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2025-12-23 00:00 America/New_York'::timestamptz),
  0,
  'no staffing_patterns row ⇒ no blocks generated, per-house verification'
);

-- ============================================================
-- 11. DST spring-forward (2026-03-08 — second Sunday of March)
--
-- The wall clock jumps 02:00 → 03:00. Our shift window starts at
-- 08:00 so no block straddles the transition itself, but the rule
-- to verify is that:
--   (a) the count is still 32 per house (no double-counting or skip),
--   (b) every block's duration is exactly 30 minutes of UTC elapsed time,
--   (c) every (house, block_start_at) pair is unique.
-- ============================================================

SELECT generate_blocks_for_date('2026-03-08');

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE house_id = 'harnwell'
      AND block_start_at >= '2026-03-08 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-03-09 00:00 America/New_York'::timestamptz),
  32,
  'DST spring-forward: Harnwell still has 32 blocks on 2026-03-08'
);

-- block_end = block_start + 30 min as DURATION arithmetic — ARCH §1.6.
-- Use lead() in UTC to confirm consecutive blocks are 30 min apart.
SELECT is(
  (WITH ordered AS (
     SELECT block_start_at,
            lead(block_start_at) OVER (ORDER BY block_start_at) AS next_start
       FROM public.shift_blocks
      WHERE house_id = 'harnwell'
        AND block_start_at >= '2026-03-08 00:00 America/New_York'::timestamptz
        AND block_start_at <  '2026-03-09 00:00 America/New_York'::timestamptz
   )
   SELECT count(*)::int FROM ordered
    WHERE next_start IS NOT NULL
      AND (next_start - block_start_at) <> interval '30 minutes'),
  0,
  'DST spring-forward: every adjacent block pair is 30 min apart in UTC'
);

-- Total UTC span for the 32 blocks = 16 hours (start[0]..start[31]+30m).
SELECT is(
  (SELECT (max(block_start_at) + interval '30 minutes') - min(block_start_at)
     FROM public.shift_blocks
    WHERE house_id = 'harnwell'
      AND block_start_at >= '2026-03-08 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-03-09 00:00 America/New_York'::timestamptz),
  interval '16 hours',
  'DST spring-forward: 32 blocks span exactly 16 hours of UTC elapsed time'
);

-- No duplicate block_start_at for the same house on a DST date.
SELECT is(
  (SELECT count(*)::int FROM (
     SELECT house_id, block_start_at, count(*) AS c
       FROM public.shift_blocks
      WHERE block_start_at >= '2026-03-08 00:00 America/New_York'::timestamptz
        AND block_start_at <  '2026-03-09 00:00 America/New_York'::timestamptz
      GROUP BY house_id, block_start_at
      HAVING count(*) > 1
   ) dup),
  0,
  'DST spring-forward: no duplicate (house_id, block_start_at) on the DST date'
);

-- ============================================================
-- 12. DST fall-back (2025-11-02 — first Sunday of November)
--
-- The wall clock falls back 02:00 → 01:00. Outside our shift window,
-- but we still verify the invariants in case a future profile opens
-- the window earlier. With current bounds, generation runs cleanly:
--   - 32 blocks per house
--   - no duplicate (house, block_start_at)
--   - adjacent blocks 30 min apart in UTC
-- ============================================================

SELECT generate_blocks_for_date('2025-11-02');

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE house_id = 'harnwell'
      AND block_start_at >= '2025-11-02 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2025-11-03 00:00 America/New_York'::timestamptz),
  32,
  'DST fall-back: Harnwell still has 32 blocks on 2025-11-02'
);

SELECT is(
  (SELECT count(*)::int FROM (
     SELECT house_id, block_start_at, count(*) AS c
       FROM public.shift_blocks
      WHERE block_start_at >= '2025-11-02 00:00 America/New_York'::timestamptz
        AND block_start_at <  '2025-11-03 00:00 America/New_York'::timestamptz
      GROUP BY house_id, block_start_at
      HAVING count(*) > 1
   ) dup),
  0,
  'DST fall-back: no duplicate (house_id, block_start_at) on the DST date'
);

SELECT is(
  (WITH ordered AS (
     SELECT block_start_at,
            lead(block_start_at) OVER (ORDER BY block_start_at) AS next_start
       FROM public.shift_blocks
      WHERE house_id = 'harnwell'
        AND block_start_at >= '2025-11-02 00:00 America/New_York'::timestamptz
        AND block_start_at <  '2025-11-03 00:00 America/New_York'::timestamptz
   )
   SELECT count(*)::int FROM ordered
    WHERE next_start IS NOT NULL
      AND (next_start - block_start_at) <> interval '30 minutes'),
  0,
  'DST fall-back: every adjacent block pair is 30 min apart in UTC'
);

-- ============================================================
-- 13. Idempotency — calling the function twice produces no change
-- ============================================================

-- Snapshot total counts for 2026-02-02 before re-running.
DO $$
DECLARE
  v_blocks_before      int;
  v_assignments_before int;
BEGIN
  SELECT count(*) INTO v_blocks_before
    FROM public.shift_blocks
   WHERE block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
     AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz;
  SELECT count(*) INTO v_assignments_before
    FROM public.shift_block_assignments a
    JOIN public.shift_blocks b USING (block_id)
   WHERE b.block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
     AND b.block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz;
  PERFORM set_config('test.phase03.blocks_before',      v_blocks_before::text,      true);
  PERFORM set_config('test.phase03.assignments_before', v_assignments_before::text, true);
END $$;

-- Re-run the generator on the same date.
SELECT lives_ok(
  $$ SELECT generate_blocks_for_date('2026-02-02') $$,
  'idempotency: re-running generate_blocks_for_date on the same date does not error'
);

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz),
  current_setting('test.phase03.blocks_before')::int,
  'idempotency: shift_blocks count is unchanged after a second call'
);

SELECT is(
  (SELECT count(*)::int FROM public.shift_block_assignments a
    JOIN public.shift_blocks b USING (block_id)
   WHERE b.block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
     AND b.block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz),
  current_setting('test.phase03.assignments_before')::int,
  'idempotency: shift_block_assignments count is unchanged after a second call'
);

-- Sanity: no (house, block_start_at) is duplicated globally after idempotent re-run.
SELECT is(
  (SELECT count(*)::int FROM (
     SELECT house_id, block_start_at, count(*) AS c
       FROM public.shift_blocks
      GROUP BY house_id, block_start_at
      HAVING count(*) > 1
   ) dup),
  0,
  'idempotency: no (house_id, block_start_at) is duplicated after re-run'
);

-- ============================================================
-- 14. Generated assignments link back to live houses
-- (FK integrity check expressed as a behavioral assertion)
-- ============================================================

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks b
    LEFT JOIN public.houses h ON h.id = b.house_id
   WHERE b.block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
     AND b.block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz
     AND h.id IS NULL),
  0,
  'every generated block references a real house'
);

-- ============================================================
-- 15. Cross-date sanity — generating one date does not leak rows
-- into adjacent dates
-- ============================================================

-- 2026-02-01 is a Sunday with no operating_calendar row yet.
SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE block_start_at >= '2026-02-01 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-02 00:00 America/New_York'::timestamptz),
  0,
  'no leakage: the day before 2026-02-02 has zero blocks'
);

SELECT is(
  (SELECT count(*)::int FROM public.shift_blocks
    WHERE block_start_at >= '2026-02-03 00:00 America/New_York'::timestamptz
      AND block_start_at <  '2026-02-04 00:00 America/New_York'::timestamptz),
  0,
  'no leakage: the day after 2026-02-02 has zero blocks'
);

-- ============================================================
-- 16. Every assignment status is a valid enum member
-- (defensive — catches a future migration adding bogus default state)
-- ============================================================

SELECT is(
  (SELECT count(*)::int FROM public.shift_block_assignments
    WHERE status NOT IN ('scheduled','claimed','floated_in','floated_out',
                         'pending_float_in','pending_float_out','allied','vacant')),
  0,
  'every shift_block_assignments.status is a recognized enum member'
);

SELECT is(
  (SELECT count(*)::int FROM public.shift_block_assignments
    WHERE vacancy_origin NOT IN ('none','temporary_drop','permanent_drop',
                                 'never_assigned','expired_claim','displaced_decliner')),
  0,
  'every shift_block_assignments.vacancy_origin is a recognized enum member'
);

-- ============================================================
-- 17. block_step_status is empty post-generation (no chain has fired yet)
-- ============================================================

SELECT is(
  (SELECT count(*)::int FROM public.block_step_status
    WHERE block_id IN (
      SELECT block_id FROM public.shift_blocks
       WHERE block_start_at >= '2026-02-02 00:00 America/New_York'::timestamptz
         AND block_start_at <  '2026-02-03 00:00 America/New_York'::timestamptz
    )),
  0,
  'no block_step_status rows are created at generation time (orchestrator owns them)'
);

SELECT finish();
ROLLBACK;
