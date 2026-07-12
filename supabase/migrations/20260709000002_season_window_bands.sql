-- Migration: Operating Seasons — per-house staffing BANDS on season_house_windows.
--
-- A house window used to carry ONE headcount + one desk-hours span + one day-type
-- (all/weekdays/weekends). That cannot express intraday-varying staffing (e.g.
-- Harnwell single-staffed 05:30-12:00 then double-staffed 12:00-00:00 on weekdays,
-- double all weekend) and, because season_house_windows_no_overlap keys on
-- (season_id, house_id, daterange) alone, it also forbids stacking a second window
-- to model that. So a window now holds two band lists — weekday_bands / weekend_bands
-- — mirroring staffing_patterns.block_headcounts and the compiler's CompiledHouse
-- shape. One editable window per house per date range; the overlap constraint is
-- unchanged. An empty band list for a day type means the house is closed that day
-- type (weekdays-only => weekend_bands = []).
--
-- Each band element is {block_start:'HH:MM', block_end:'HH:MM', headcount:int}
-- ('00:00' end = 24:00, repo convention). This REPLACES headcount/band_headcounts/
-- shift_start/shift_end/days, which are dropped after backfill.

-- New columns (idempotent). Default [] so existing rows are valid before backfill.
ALTER TABLE season_house_windows
  ADD COLUMN IF NOT EXISTS weekday_bands jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS weekend_bands jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill from the legacy scalar shape, then drop it. Guarded on the legacy column
-- so re-application (after the drop) is a clean no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'season_house_windows'
      AND column_name = 'headcount'
  ) THEN
    UPDATE season_house_windows w
    SET
      weekday_bands = CASE
        WHEN w.days = 'weekends' THEN '[]'::jsonb
        ELSE jsonb_build_array(jsonb_build_object(
          'block_start', to_char(COALESCE(w.shift_start, s.shift_start_bound), 'HH24:MI'),
          'block_end',   to_char(COALESCE(w.shift_end,   s.shift_end_bound),   'HH24:MI'),
          'headcount',   w.headcount))
      END,
      weekend_bands = CASE
        WHEN w.days = 'weekdays' THEN '[]'::jsonb
        ELSE jsonb_build_array(jsonb_build_object(
          'block_start', to_char(COALESCE(w.shift_start, s.shift_start_bound), 'HH24:MI'),
          'block_end',   to_char(COALESCE(w.shift_end,   s.shift_end_bound),   'HH24:MI'),
          'headcount',   w.headcount))
      END
    FROM operating_seasons s
    WHERE s.season_id = w.season_id;

    ALTER TABLE season_house_windows
      DROP COLUMN IF EXISTS headcount,
      DROP COLUMN IF EXISTS band_headcounts,
      DROP COLUMN IF EXISTS shift_start,
      DROP COLUMN IF EXISTS shift_end,
      DROP COLUMN IF EXISTS days;
  END IF;
END $$;

-- A window must open the house for at least one day type (a window that opens nothing
-- is meaningless — closure is the ABSENCE of a window). Band-level validity (30-min
-- boundaries, start<end, headcount>=1, no intra-day overlap) is enforced by the pure
-- compiler and the server action; the DB guard is just the emptiness floor.
ALTER TABLE season_house_windows DROP CONSTRAINT IF EXISTS season_house_windows_open_check;
ALTER TABLE season_house_windows ADD CONSTRAINT season_house_windows_open_check
  CHECK (jsonb_array_length(weekday_bands) > 0 OR jsonb_array_length(weekend_bands) > 0);

-- rollback:
-- ALTER TABLE season_house_windows DROP CONSTRAINT IF EXISTS season_house_windows_open_check;
-- ALTER TABLE season_house_windows
--   ADD COLUMN IF NOT EXISTS headcount integer,
--   ADD COLUMN IF NOT EXISTS band_headcounts jsonb,
--   ADD COLUMN IF NOT EXISTS shift_start time,
--   ADD COLUMN IF NOT EXISTS shift_end time,
--   ADD COLUMN IF NOT EXISTS days text NOT NULL DEFAULT 'all';
-- ALTER TABLE season_house_windows DROP COLUMN IF EXISTS weekday_bands, DROP COLUMN IF EXISTS weekend_bands;
