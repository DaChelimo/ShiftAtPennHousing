-- Migration: per-house desk hours + operating days on a season house window.
--
-- The runtime already supports per-house time bands and a weekday/weekend split
-- (staffing_patterns.block_headcounts + day_type; the generator reads them). This
-- surfaces that in the season authoring layer so an admin can say, per house:
--   * custom desk hours (e.g. Kings Court 05:30 to 17:00, or an office house
--     08:00 to 17:00) instead of inheriting the season envelope; and
--   * which days it operates (every day / weekdays only / weekends only), so a
--     weekday-only house generates no weekend blocks (closed on weekends).
-- Single continuous band per day (no split shifts in v1). NULL hours inherit the
-- season's shift_start_bound / shift_end_bound.

ALTER TABLE season_house_windows
  ADD COLUMN IF NOT EXISTS shift_start time,
  ADD COLUMN IF NOT EXISTS shift_end   time,
  ADD COLUMN IF NOT EXISTS days        text NOT NULL DEFAULT 'all'
    CHECK (days IN ('all', 'weekdays', 'weekends'));

COMMENT ON COLUMN season_house_windows.shift_start IS
  'Desk open time for this house in this window; NULL inherits the season shift_start_bound. Must fall on a 30-minute boundary.';
COMMENT ON COLUMN season_house_windows.shift_end IS
  'Desk close time; NULL inherits the season shift_end_bound. 00:00 = midnight end-of-day.';
COMMENT ON COLUMN season_house_windows.days IS
  'Which days the house operates: all / weekdays / weekends. weekdays-only means no weekend shifts.';

-- rollback:
-- ALTER TABLE season_house_windows DROP COLUMN IF EXISTS days;
-- ALTER TABLE season_house_windows DROP COLUMN IF EXISTS shift_end;
-- ALTER TABLE season_house_windows DROP COLUMN IF EXISTS shift_start;
