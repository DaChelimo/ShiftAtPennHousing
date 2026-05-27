-- Migration: break_periods
-- Layer 9: named break periods — anchors T-14d/T-3d/T-1d claim-phase offsets. Architecture §2.9

CREATE TYPE break_type_enum AS ENUM (
  'thanksgiving',
  'fall_break',
  'spring_break',
  'spring_fling',
  'winter_break',
  'other'
);

CREATE TABLE break_periods (
  break_id     uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  break_name   text             NOT NULL,
  break_type   break_type_enum  NOT NULL,
  -- inclusive; anchor used for T-14d/T-3d/T-1d offsets
  start_date   date             NOT NULL,
  end_date     date             NOT NULL,
  profile_name text             NOT NULL REFERENCES operating_profiles (profile_name),
  CONSTRAINT break_periods_dates_check CHECK (end_date >= start_date)
);

ALTER TABLE break_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON break_periods
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS: user-scoped policies added in phase-2 when auth is introduced.

-- rollback:
-- DROP TABLE IF EXISTS break_periods CASCADE;
-- DROP TYPE IF EXISTS break_type_enum;
