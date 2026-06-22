-- Dev convenience: a CLAIMABLE short break so the break calendar has real, persistable
-- data to test against. The base seed (seed.sql) defines the break PROFILES + staffing
-- patterns but never SCHEDULES a break, so `break_periods` is empty and the worker app's
-- live build has nothing to claim (it falls back to the honest "no break" state).
--
-- This is anchored to CURRENT_DATE so the break is always in its claim window
-- (T-14d → T-1d): start = today+3 → window opened today-11, closes today+2 → open NOW.
--
-- NON-DESTRUCTIVE + idempotent: it re-profiles a few existing operating_calendar dates to
-- `short_break` and upserts ONE `break_periods` row (fixed id). It DELETES nothing — the
-- existing (vacant) blocks on those dates simply become claimable break shifts, and any
-- already-scheduled shifts show as read-only occupied seats. Re-running it just re-anchors
-- the dates to "now". Reversal is at the bottom.
--
-- Run:  psql "$LOCAL_DB_URL" -f supabase/seeds/demo_break.sql
--   (or against any environment you want a test break in).

-- 1. Mark the next 5 days as a short break in the operating calendar.
INSERT INTO operating_calendar (date, profile_name)
SELECT d::date, 'short_break'
FROM generate_series(CURRENT_DATE + 3, CURRENT_DATE + 7, interval '1 day') AS d
ON CONFLICT (date) DO UPDATE SET profile_name = 'short_break';

-- 2. The break period itself (fixed id → idempotent; 'thanksgiving' = 40h hard cap).
INSERT INTO break_periods (break_id, break_name, break_type, start_date, end_date, profile_name)
VALUES ('d3300000-0000-0000-0000-000000000001', 'Test Break (dev)', 'thanksgiving',
        CURRENT_DATE + 3, CURRENT_DATE + 7, 'short_break')
ON CONFLICT (break_id) DO UPDATE
  SET start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date,
      profile_name = EXCLUDED.profile_name;

-- 3. Sanity: the break's phase + how many seats are claimable right now.
SELECT 'phase' AS k, public.break_claim_phase('d3300000-0000-0000-0000-000000000001', now()) AS v
UNION ALL
SELECT 'claimable_vacant_seats',
       count(*)::text
FROM shift_block_assignments sba
JOIN shift_blocks sb USING (block_id)
JOIN operating_calendar oc ON oc.date = (sb.block_start_at AT TIME ZONE 'America/New_York')::date
JOIN break_periods bp ON oc.date BETWEEN bp.start_date AND bp.end_date AND oc.profile_name = bp.profile_name
WHERE sba.status = 'vacant'
  AND bp.break_id = 'd3300000-0000-0000-0000-000000000001';

-- ── Reversal (restore the dates to the regular school year + remove the break) ──
-- DELETE FROM break_periods WHERE break_id = 'd3300000-0000-0000-0000-000000000001';
-- UPDATE operating_calendar SET profile_name = 'regular_school_year'
-- WHERE date BETWEEN CURRENT_DATE + 3 AND CURRENT_DATE + 7;
