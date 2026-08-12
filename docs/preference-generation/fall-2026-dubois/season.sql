-- PROPOSAL — add Du Bois to the Fall 2026 season, alongside the Harnwell pilot.
--
-- NOT APPLIED. This adds ONE season_house_windows row to the SAME Fall 2026 season
-- proposed in ../fall-2026-harnwell/season.sql (season_id
-- fa112026-0000-4000-8000-000000000001). It does not create a new season, and it does
-- not touch the Harnwell window. Run this alongside (before or after; order does not
-- matter) ../fall-2026-harnwell/season.sql, then apply_compiled_season materializes
-- both houses' blocks together.
--
-- Parameters and why:
--
--   House       du-bois, headcount 1, all day, both day types — the AGENTS.md default
--               single-staff posture (unlike Harnwell's 2).
--   Dates       Same as Harnwell: 2026-08-24 (Mon) .. 2026-12-20 (Sun).
--   Desk        08:00 to 00:00, matching `regular_school_year`'s bounds (same as Harnwell).
--   Cap/deadline Inherited from the season row itself (20h soft, deadline
--               2026-08-13 23:59 America/New_York) — this file only adds the window.
--
-- If ../fall-2026-harnwell/season.sql has not been run yet, run it FIRST (it creates the
-- operating_seasons row this depends on via FK).

BEGIN;

INSERT INTO season_house_windows (
  window_id, season_id, house_id, start_date, end_date, weekday_bands, weekend_bands
) VALUES (
  'fa112026-0000-4000-8000-00000000000b',
  'fa112026-0000-4000-8000-000000000001',
  'du-bois',
  '2026-08-24',
  '2026-12-20',
  '[{"block_start": "08:00", "block_end": "00:00", "headcount": 1}]'::jsonb,
  '[{"block_start": "08:00", "block_end": "00:00", "headcount": 1}]'::jsonb
)
ON CONFLICT (window_id) DO NOTHING;

COMMIT;

-- rollback (only valid while the season is still UNAPPLIED):
-- DELETE FROM season_house_windows WHERE window_id = 'fa112026-0000-4000-8000-00000000000b';
