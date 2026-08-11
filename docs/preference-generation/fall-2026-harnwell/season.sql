-- PROPOSAL — Fall 2026 operating season, Harnwell-only pilot.
--
-- NOT APPLIED. This file is the season draft for sign-off. Nothing here has run against
-- any database. Review the parameters below, then follow README.md.
--
-- Writes AUTHORING tables only. operating_profiles, staffing_patterns, operating_calendar,
-- float_routing and shift_blocks are DERIVED — `apply_compiled_season` produces them
-- (dry-run first), exactly as the summer season did.
--
-- Parameters and why:
--
--   Dates       2026-08-24 (Mon) .. 2026-12-20 (Sun). Deliberately Monday-to-Sunday: the
--               preference painter and this generator both anchor on the Monday of the
--               period's first week, so a mid-week start would give a 3-day template week
--               and a board with nothing painted Mon-Thu. 17 whole weeks.
--               CONFIRM against Penn's published Fall 2026 academic calendar.
--   Cap         20h, soft. The school-year norm (`regular_school_year` carries 20/soft);
--               summer's 40/hard is a summer-only posture.
--   Desk        08:00 to 00:00, matching `regular_school_year`'s bounds.
--   Harnwell    headcount 2, all day, both day types. This is Harnwell's seeded
--               school-year pattern, not summer's 1-then-2 weekday split.
--   Houses      Harnwell only. Every other house is absent from season_house_windows,
--               which is how a season expresses "closed".
--   Floats      No season_float_windows row. Harnwell is never a float DESTINATION
--               (hard invariant), and with no other house open there is nowhere to
--               source from either, so float routing is vacuous this season.
--   Deadline    2026-08-13 23:59 America/New_York.
--
-- The `scheduling_periods_no_overlap` exclusion applies only to periods whose profile is
-- `regular_school_year`. This season compiles to `s_fall2026_*`, so it does not collide
-- with the existing Summer 2026 rows (one of which runs to 2026-08-31).

BEGIN;

INSERT INTO operating_seasons (
  season_id, season_name, slug, start_date, end_date,
  scheduling_mode, hours_cap, cap_enforcement,
  shift_start_bound, shift_end_bound, created_by, preference_deadline
) VALUES (
  'fa112026-0000-4000-8000-000000000001',
  'Fall 2026',
  'fall2026',
  '2026-08-24',
  '2026-12-20',
  'sm_built'::scheduling_mode_enum,
  20,
  'soft'::cap_enforcement_enum,
  '08:00:00',
  '00:00:00',
  -- REPLACE with the administrator's user_id before running.
  '00000000-0000-0000-0000-000000000000',
  '2026-08-14 03:59:00+00'
)
ON CONFLICT (season_id) DO NOTHING;

INSERT INTO season_house_windows (
  window_id, season_id, house_id, start_date, end_date, weekday_bands, weekend_bands
) VALUES (
  'fa112026-0000-4000-8000-00000000000a',
  'fa112026-0000-4000-8000-000000000001',
  'harnwell',
  '2026-08-24',
  '2026-12-20',
  '[{"block_start": "08:00", "block_end": "00:00", "headcount": 2}]'::jsonb,
  '[{"block_start": "08:00", "block_end": "00:00", "headcount": 2}]'::jsonb
)
ON CONFLICT (window_id) DO NOTHING;

COMMIT;

-- rollback (only valid while the season is still UNAPPLIED — once
-- apply_compiled_season has run, derived profiles/blocks exist and must be reconciled):
-- DELETE FROM season_house_windows WHERE season_id = 'fa112026-0000-4000-8000-000000000001';
-- DELETE FROM operating_seasons    WHERE season_id = 'fa112026-0000-4000-8000-000000000001';
