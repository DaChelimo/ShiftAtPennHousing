-- Migration: scheduling_periods
-- Layer 10: SM-built scheduling periods (regular_school_year only). Architecture §2.10

CREATE TABLE scheduling_periods (
  period_id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  period_name         text        NOT NULL,
  -- always 'regular_school_year'
  profile_name        text        NOT NULL REFERENCES operating_profiles (profile_name),
  -- first operating date of the semester (inclusive)
  start_date          date        NOT NULL,
  -- last operating date of the semester (inclusive); used by permanent-drop boundary algorithm
  end_date            date        NOT NULL,
  -- set by SM when opening preference submission; null until then
  preference_deadline timestamptz,
  -- null until SM publishes the schedule; workers' calendars only show this period once NOT NULL
  published_at        timestamptz,
  CONSTRAINT scheduling_periods_dates_check CHECK (end_date >= start_date)
);

ALTER TABLE scheduling_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON scheduling_periods
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS: user-scoped policies added in phase-2 when auth is introduced.

-- rollback:
-- DROP TABLE IF EXISTS scheduling_periods CASCADE;
