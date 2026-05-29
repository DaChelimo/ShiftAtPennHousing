-- pgTAP tests for Batch B (B3): effective_weekly_cap default-path coverage.
-- Spec: BEHAVIORAL_SPECIFICATION §9.3 (per-week cap classification).
-- Exercises the path with NO weekly_cap_overrides row, so the cap is derived
-- from the operating_calendar / break_periods days in the Mon..Sun week:
--   * any break day (thanksgiving/fall_break/spring_break/winter_break) or a
--     winter_break-profile day  -> hard 40
--   * regular_school_year and spring_fling                                -> soft 20
-- and that a manual override still wins.

BEGIN;

SELECT plan(8);

-- Ensure the profiles referenced below exist (self-contained; no-op if seeded).
INSERT INTO public.operating_profiles
  (profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
   default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain)
-- scheduling_mode sm_built keeps claim-phase offsets NULL (E3 pairing CHECK);
-- the cap test only needs these profile_names to exist for the calendar FK and
-- day classification, not their scheduling mode.
VALUES
  ('regular_school_year', '08:00', '00:00', 20, 'soft', 'sm_built', true, '[]'::jsonb),
  ('short_break',         '08:00', '00:00', 40, 'hard', 'sm_built', true, '[]'::jsonb),
  ('spring_fling',        '08:00', '00:00', 20, 'soft', 'sm_built', true, '[]'::jsonb)
ON CONFLICT (profile_name) DO NOTHING;

-- Three distinct, far-future Mondays (avoids colliding with seeded calendar).
SELECT set_config('test.capw.straddle', date_trunc('week', DATE '2031-11-24')::text, false);
SELECT set_config('test.capw.fling',    date_trunc('week', DATE '2031-04-21')::text, false);
SELECT set_config('test.capw.regular',  date_trunc('week', DATE '2031-09-15')::text, false);

-- Straddling week: Mon-Wed regular_school_year, Thu-Sun thanksgiving (short_break profile).
INSERT INTO public.operating_calendar (date, profile_name)
SELECT current_setting('test.capw.straddle')::date + n,
       CASE WHEN n <= 2 THEN 'regular_school_year' ELSE 'short_break' END
FROM generate_series(0, 6) n
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

INSERT INTO public.break_periods (break_name, break_type, start_date, end_date, profile_name)
VALUES ('Thanksgiving 2031', 'thanksgiving',
        current_setting('test.capw.straddle')::date + 3,
        current_setting('test.capw.straddle')::date + 6,
        'short_break');

-- Spring-fling week: all 7 days spring_fling.
INSERT INTO public.operating_calendar (date, profile_name)
SELECT current_setting('test.capw.fling')::date + n, 'spring_fling'
FROM generate_series(0, 6) n
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

INSERT INTO public.break_periods (break_name, break_type, start_date, end_date, profile_name)
VALUES ('Spring Fling 2031', 'spring_fling',
        current_setting('test.capw.fling')::date,
        current_setting('test.capw.fling')::date + 6,
        'spring_fling');

-- Plain regular week: all 7 days regular_school_year.
INSERT INTO public.operating_calendar (date, profile_name)
SELECT current_setting('test.capw.regular')::date + n, 'regular_school_year'
FROM generate_series(0, 6) n
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

-- 1-2. Straddling week -> hard 40 (most-restrictive day wins).
SELECT is(
  (SELECT hours_cap FROM effective_weekly_cap(
     current_setting('test.capw.straddle')::date,
     current_setting('test.capw.straddle')::timestamptz)),
  40, 'straddling regular+thanksgiving week -> hours_cap 40');

SELECT is(
  (SELECT cap_enforcement::text FROM effective_weekly_cap(
     current_setting('test.capw.straddle')::date,
     current_setting('test.capw.straddle')::timestamptz)),
  'hard', 'straddling week -> hard enforcement');

-- 3-4. Spring-fling week -> soft 20.
SELECT is(
  (SELECT hours_cap FROM effective_weekly_cap(
     current_setting('test.capw.fling')::date,
     current_setting('test.capw.fling')::timestamptz)),
  20, 'spring-fling week -> hours_cap 20');

SELECT is(
  (SELECT cap_enforcement::text FROM effective_weekly_cap(
     current_setting('test.capw.fling')::date,
     current_setting('test.capw.fling')::timestamptz)),
  'soft', 'spring-fling week -> soft enforcement');

-- 5-6. Plain regular week -> soft 20.
SELECT is(
  (SELECT hours_cap FROM effective_weekly_cap(
     current_setting('test.capw.regular')::date,
     current_setting('test.capw.regular')::timestamptz)),
  20, 'regular week -> hours_cap 20');

SELECT is(
  (SELECT cap_enforcement::text FROM effective_weekly_cap(
     current_setting('test.capw.regular')::date,
     current_setting('test.capw.regular')::timestamptz)),
  'soft', 'regular week -> soft enforcement');

-- 7-8. A manual override still wins over the derived default.
INSERT INTO public.weekly_cap_overrides (week_start_date, hours_cap, cap_enforcement)
VALUES (current_setting('test.capw.regular')::date, 40, 'hard');

SELECT is(
  (SELECT hours_cap FROM effective_weekly_cap(
     current_setting('test.capw.regular')::date,
     current_setting('test.capw.regular')::timestamptz)),
  40, 'override beats derived default (hours_cap 40)');

SELECT is(
  (SELECT cap_enforcement::text FROM effective_weekly_cap(
     current_setting('test.capw.regular')::date,
     current_setting('test.capw.regular')::timestamptz)),
  'hard', 'override beats derived default (hard)');

SELECT finish();
ROLLBACK;
