-- Migration: operating_calendar
-- Layer 1: maps each operating date to exactly one profile. Architecture §2.1

CREATE TABLE operating_calendar (
  date         date PRIMARY KEY,
  profile_name text NOT NULL REFERENCES operating_profiles (profile_name)
);

ALTER TABLE operating_calendar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON operating_calendar
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS: user-scoped policies added in phase-2 when auth is introduced.

-- rollback:
-- DROP TABLE IF EXISTS operating_calendar CASCADE;
