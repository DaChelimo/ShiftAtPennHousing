-- Batch B — hours-cap correctness.
--   B1 — rewrite effective_weekly_cap to classify the whole Mon..Sun week per
--        BSpec §9.3 and be spring-fling-aware (F-05-001/002). The default cap is
--        derived from the days in the week, not from a single block's profile:
--        any break day (thanksgiving/fall_break/spring_break/winter_break, or a
--        winter_break-profile day) makes the week hard-40; otherwise soft-20
--        (regular_school_year and spring_fling are both soft-20). A manual
--        weekly_cap_overrides row still wins.
--   B2 — re-add the weekly_cap_overrides value-pairing CHECK (F-01-001/002):
--        20<->soft, 40<->hard. Strictly stronger than the dropped IN(20,40).

-- ============================================================
-- B1
-- ============================================================
CREATE OR REPLACE FUNCTION effective_weekly_cap(
  p_week_start_date date,
  p_block_start_at  timestamptz   -- retained for signature compatibility; unused by the default
)
RETURNS TABLE (hours_cap integer, cap_enforcement cap_enforcement_enum)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH days AS (
    SELECT oc.date, oc.profile_name
    FROM operating_calendar oc
    WHERE oc.date BETWEEN p_week_start_date AND (p_week_start_date + 6)
  ),
  classified AS (
    SELECT
      CASE
        WHEN days.profile_name = 'winter_break' THEN 'hard'
        WHEN EXISTS (
          SELECT 1 FROM break_periods bp
          WHERE days.date BETWEEN bp.start_date AND bp.end_date
            AND bp.break_type IN ('thanksgiving', 'fall_break', 'spring_break', 'winter_break')
        ) THEN 'hard'
        ELSE 'soft'   -- regular_school_year and spring_fling both -> soft 20
      END AS day_enforcement
    FROM days
  ),
  agg AS (
    SELECT bool_or(day_enforcement = 'hard') AS any_hard FROM classified
  )
  SELECT
    COALESCE(wco.hours_cap,
             CASE WHEN agg.any_hard THEN 40 ELSE 20 END),
    COALESCE(wco.cap_enforcement,
             CASE WHEN agg.any_hard THEN 'hard' ELSE 'soft' END::cap_enforcement_enum)
  FROM agg
  LEFT JOIN weekly_cap_overrides wco ON wco.week_start_date = p_week_start_date;
$$;

-- ============================================================
-- B2
-- ============================================================
ALTER TABLE weekly_cap_overrides
  ADD CONSTRAINT weekly_cap_overrides_value_pairing_check
  CHECK ((hours_cap = 20 AND cap_enforcement = 'soft')
      OR (hours_cap = 40 AND cap_enforcement = 'hard'));

-- rollback:
-- ALTER TABLE weekly_cap_overrides DROP CONSTRAINT IF EXISTS weekly_cap_overrides_value_pairing_check;
-- (restore effective_weekly_cap body from 20260527000006)
