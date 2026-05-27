-- Migration: weekly_cap_overrides
-- Layer 5: per-week hours cap modifications by HMs/BMs. Architecture §2.5
--
-- modified_by is a placeholder FK; the users table is created in a later phase.

CREATE TABLE weekly_cap_overrides (
  -- the Monday of the affected calendar week
  week_start_date date                 PRIMARY KEY,
  hours_cap       integer              NOT NULL CHECK (hours_cap IN (20, 40)),
  cap_enforcement cap_enforcement_enum NOT NULL,
  -- FK to users.user_id added in phase-2 when users table exists
  modified_by     uuid,
  modified_at     timestamptz          NOT NULL DEFAULT now()
);

ALTER TABLE weekly_cap_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON weekly_cap_overrides
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS: user-scoped policies added in phase-2 when auth is introduced.

-- rollback:
-- DROP TABLE IF EXISTS weekly_cap_overrides CASCADE;
