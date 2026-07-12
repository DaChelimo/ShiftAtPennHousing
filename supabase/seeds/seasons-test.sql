-- ============================================================================
-- Seasons manual-test seed — a ready-to-explore Summer + Fall world for testing
-- the admin "operating seasons" feature alongside the regular academic year.
--
-- House names + ids now live in the base seed (supabase/seed.sql): Harnwell,
-- Upper Quad, Lower Quad, Van Pelt / Gregory, Harrison, Hill, Kings Court English,
-- Lauder, Mayer, Du Bois, Gutmann, Radian, Rodin.
--
-- What this adds (idempotent — safe to re-run):
--   * FALL SEMESTER: 2026-08-23 .. 2026-12-20 = regular_school_year, with blocks
--     generated for a two-week test window (Aug 24 .. Sep 6) and one staffed Upper
--     Quad shift so there is a real school-year scenario to time-travel into.
--   * SUMMER 2026 season: 2026-06-01 .. 2026-08-20, pre-configured with the real
--     summer dynamics: ten open houses (Harnwell, Rodin, Harrison, Gutmann, Mayer,
--     Van Pelt / Gregory, Lauder, Du Bois, Hill, Kings Court English) at 5:30am to
--     midnight; Upper Quad, Lower Quad, and Radian are CLOSED for the summer. Rodin
--     single->double mid-June, Harrison opens June 8 single->double late June, Kings
--     Court runs a short 5:30am-5pm weekdays-only desk through June 13 then switches
--     to the standard 5:30am-midnight/7-day hours; floating on only the second half.
--     This script AUTHORS it but does NOT apply it — log in as the admin and hit
--     Preview / Apply in /admin/operations. (The cast helper below applies it
--     programmatically.)
--   * Defensive base-table GRANTs so login always works after a reset.
--
-- Run AFTER `supabase db reset` (which loads the base seed first):
--   pnpm db:reset:seasons        (reset + this script + seasons-cast.ts: applies the
--                                 season and adds a heavy cast + partial preferences,
--                                 for a fully-primed preference-testable summer world)
--   pnpm seed:seasons            (this script only — authors, does not apply)
--   pnpm seed:seasons:cast       (the TS helper only, against a running DB)
--
-- Admin login:  admin@upenn.edu  /  abc123     (seeded by supabase/seed.sql)
-- ============================================================================

-- Defensive grants (a bare container restart has been seen to drop these, breaking
-- login before RLS even runs). Harmless — RLS still governs every row.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

BEGIN;

-- ============================================================================
-- FALL SEMESTER — 2026-08-23 .. 2026-12-20 = regular_school_year. Start from a
-- clean calendar so the base seed's now-relative academic week cannot collide with
-- the summer range, then lay down the semester.
-- ============================================================================
DELETE FROM operating_calendar;

INSERT INTO operating_calendar (date, profile_name)
SELECT d::date, 'regular_school_year'
FROM generate_series('2026-08-23'::date, '2026-12-20'::date, interval '1 day') d
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

-- Two-week test window of school-year blocks (Aug 24 .. Sep 6). Extend any time:
--   SELECT generate_blocks_for_range('2026-09-07','2026-09-20');
SELECT generate_blocks_for_range('2026-08-24', '2026-09-06');

-- One staffed Upper Quad shift on Mon Aug 24, 10:00 (a real scenario to test drops
-- / float lookup against), using a seeded Quad worker (Alice Quad).
UPDATE shift_block_assignments sba
SET status = 'scheduled', user_id = 'a0000000-0000-4000-8000-000000000002', vacancy_origin = 'none'
WHERE sba.assignment_id = (
  SELECT a.assignment_id
  FROM shift_block_assignments a
  JOIN shift_blocks b USING (block_id)
  WHERE b.house_id = 'quad'
    AND (b.block_start_at AT TIME ZONE 'America/New_York') = '2026-08-24 10:00'
    AND a.status = 'vacant'
  ORDER BY a.assignment_id
  LIMIT 1
);

-- ============================================================================
-- SUMMER 2026 season — 2026-06-01 .. 2026-08-20, pre-configured but NOT applied.
-- Fixed season_id so re-runs are idempotent; clear any other seasons first so the
-- no-overlap constraint can't trip on a non-reset DB (a fresh reset has none).
-- ============================================================================
DELETE FROM operating_seasons WHERE season_id <> '5ea50000-0000-4000-8000-000000000001';

INSERT INTO operating_seasons
  (season_id, season_name, slug, start_date, end_date, scheduling_mode, hours_cap, cap_enforcement, shift_start_bound, shift_end_bound, created_by)
VALUES
  ('5ea50000-0000-4000-8000-000000000001', 'Summer 2026', 'summer2026', '2026-06-01', '2026-08-20',
   'sm_built', 40, 'hard', '05:30', '00:00', 'a0000000-0000-4000-8000-00000000000b')
ON CONFLICT (season_id) DO UPDATE SET
  season_name = EXCLUDED.season_name, slug = EXCLUDED.slug,
  start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
  hours_cap = EXCLUDED.hours_cap, cap_enforcement = EXCLUDED.cap_enforcement,
  shift_start_bound = EXCLUDED.shift_start_bound, shift_end_bound = EXCLUDED.shift_end_bound,
  last_applied_at = NULL;

DELETE FROM season_house_windows WHERE season_id = '5ea50000-0000-4000-8000-000000000001';
DELETE FROM season_float_windows WHERE season_id = '5ea50000-0000-4000-8000-000000000001';

-- Open windows modelling the real summer. Ten houses are open (Upper Quad, Lower
-- Quad, and Radian are CLOSED — no window rows for them):
--   Harnwell open all summer: weekdays single-staffed 05:30-12:00 then double-staffed
--     12:00-00:00; weekends double-staffed 05:30-00:00 (intraday band demo).
--   Gutmann, Mayer, Van Pelt / Gregory, Lauder, Du Bois, Hill (1) open all summer,
--     standard hours.
--   Rodin single-staffed Jun 1-16, double-staffed Jun 17 onward (single -> double phase).
--   Harrison closed until June 8, single-staffed Jun 8-24, double-staffed Jun 25 onward.
--   Kings Court English: office-hours desk 05:30 to 17:00, weekdays only (closed
--     weekends) through June 13, then switches to the standard 05:30-00:00/all-days
--     hours — demonstrates per-house hours + a mid-season phase change.
-- Each window carries per-day-type staffing bands. '00:00' end = midnight (24:00).
-- Harnwell demonstrates an intraday split: single-staffed morning, double-staffed
-- evening on weekdays, double all day on weekends.
INSERT INTO season_house_windows (season_id, house_id, start_date, end_date, weekday_bands, weekend_bands) VALUES
  ('5ea50000-0000-4000-8000-000000000001', 'harnwell',    '2026-06-01', '2026-08-20',
     '[{"block_start":"05:30","block_end":"12:00","headcount":1},{"block_start":"12:00","block_end":"00:00","headcount":2}]'::jsonb,
     '[{"block_start":"05:30","block_end":"00:00","headcount":2}]'::jsonb),
  ('5ea50000-0000-4000-8000-000000000001', 'rodin',       '2026-06-01', '2026-06-16',  -- single
     '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb, '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb),
  ('5ea50000-0000-4000-8000-000000000001', 'rodin',       '2026-06-17', '2026-08-20',  -- double
     '[{"block_start":"05:30","block_end":"00:00","headcount":2}]'::jsonb, '[{"block_start":"05:30","block_end":"00:00","headcount":2}]'::jsonb),
  ('5ea50000-0000-4000-8000-000000000001', 'harrison',    '2026-06-08', '2026-06-24',  -- opens Jun 8, single
     '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb, '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb),
  ('5ea50000-0000-4000-8000-000000000001', 'harrison',    '2026-06-25', '2026-08-20',  -- double
     '[{"block_start":"05:30","block_end":"00:00","headcount":2}]'::jsonb, '[{"block_start":"05:30","block_end":"00:00","headcount":2}]'::jsonb),
  ('5ea50000-0000-4000-8000-000000000001', 'gutmann',     '2026-06-01', '2026-08-20',
     '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb, '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb),
  ('5ea50000-0000-4000-8000-000000000001', 'mayer',       '2026-06-01', '2026-08-20',
     '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb, '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb),
  ('5ea50000-0000-4000-8000-000000000001', 'gregory',     '2026-06-01', '2026-08-20',
     '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb, '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb),
  ('5ea50000-0000-4000-8000-000000000001', 'lauder',      '2026-06-01', '2026-08-20',
     '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb, '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb),
  ('5ea50000-0000-4000-8000-000000000001', 'du-bois',     '2026-06-01', '2026-08-20',
     '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb, '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb),
  ('5ea50000-0000-4000-8000-000000000001', 'hill',        '2026-06-01', '2026-08-20',
     '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb, '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb),
  ('5ea50000-0000-4000-8000-000000000001', 'kings-court', '2026-06-01', '2026-06-13',  -- office hours, weekdays only
     '[{"block_start":"05:30","block_end":"17:00","headcount":1}]'::jsonb, '[]'::jsonb),
  ('5ea50000-0000-4000-8000-000000000001', 'kings-court', '2026-06-14', '2026-08-20',  -- standard hours
     '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb, '[{"block_start":"05:30","block_end":"00:00","headcount":1}]'::jsonb);

-- Floating: off the first half of summer, on from July 1.
INSERT INTO season_float_windows (season_id, start_date, end_date) VALUES
  ('5ea50000-0000-4000-8000-000000000001', '2026-07-01', '2026-08-20');

COMMIT;

-- ============================================================================
-- Quick sanity read-out.
-- ============================================================================
SELECT 'houses named'   AS what, count(*) FROM houses WHERE name !~ '^House-'
UNION ALL SELECT 'fall calendar days', count(*) FROM operating_calendar WHERE profile_name = 'regular_school_year'
UNION ALL SELECT 'fall blocks (test window)', count(*) FROM shift_blocks WHERE (block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN '2026-08-24' AND '2026-09-06'
UNION ALL SELECT 'summer house windows', count(*) FROM season_house_windows WHERE season_id = '5ea50000-0000-4000-8000-000000000001'
UNION ALL SELECT 'summer float windows', count(*) FROM season_float_windows WHERE season_id = '5ea50000-0000-4000-8000-000000000001';
