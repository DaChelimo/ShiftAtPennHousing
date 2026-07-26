-- Fix: effective_weekly_cap() ignores operating_profiles.
--
-- 20260528000011_batch_b_cap.sql replaced the original operating_profiles join
-- with a hardcoded winter_break / break_periods.break_type classification that
-- always falls back to 20h/soft otherwise. That silently ignores:
--   * every operating_profiles row's actual default_hours_cap/default_cap_enforcement
--     (regular_school_year=20/soft, winter_break=40/hard, short_break=40/hard per
--     seed.sql -- short_break was never in the old hardcoded break_type list either)
--   * operating_seasons phases materialized by apply_compiled_season, which write
--     into operating_profiles + retarget operating_calendar to the season's profile
--     (20260702000006_apply_compiled_season.sql) -- so a season's configured cap
--     (e.g. Summer 2026 at 40h/hard) was never honored.
--
-- author_break_period (20260709000001) confirms operating_calendar.profile_name
-- is the single source of truth for which profile governs a date; this restores
-- the join instead of re-deriving hard/soft from break_type.
CREATE OR REPLACE FUNCTION effective_weekly_cap(
  p_week_start_date date,
  p_block_start_at  timestamptz   -- retained for signature compatibility; unused
)
RETURNS TABLE (hours_cap integer, cap_enforcement cap_enforcement_enum)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH days AS (
    SELECT oc.date, oc.profile_name
    FROM operating_calendar oc
    WHERE oc.date BETWEEN p_week_start_date AND (p_week_start_date + 6)
  ),
  profiled AS (
    SELECT op.default_hours_cap, op.default_cap_enforcement
    FROM days d
    JOIN operating_profiles op ON op.profile_name = d.profile_name
  ),
  agg AS (
    SELECT
      bool_or(default_cap_enforcement = 'hard') AS any_hard,
      -- most protective cap on a mixed-profile week: the tightest hard cap if any
      -- day is hard, else the tightest cap among the (all-soft) days present.
      min(default_hours_cap) FILTER (WHERE default_cap_enforcement = 'hard') AS min_hard_cap,
      min(default_hours_cap) AS min_any_cap
    FROM profiled
  )
  SELECT
    COALESCE(wco.hours_cap,
             CASE WHEN agg.any_hard THEN agg.min_hard_cap ELSE agg.min_any_cap END,
             20),
    COALESCE(wco.cap_enforcement,
             CASE WHEN agg.any_hard THEN 'hard' ELSE 'soft' END::cap_enforcement_enum,
             'soft'::cap_enforcement_enum)
  FROM agg
  LEFT JOIN weekly_cap_overrides wco ON wco.week_start_date = p_week_start_date;
$$;
