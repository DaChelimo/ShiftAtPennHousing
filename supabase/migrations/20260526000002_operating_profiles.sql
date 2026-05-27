-- Migration: operating_profiles
-- Layer 2: rules per operating season. FK target for operating_calendar, staffing_patterns, etc.
-- Architecture §2.2

CREATE TYPE cap_enforcement_enum AS ENUM ('soft', 'hard');
CREATE TYPE scheduling_mode_enum AS ENUM ('sm_built', 'claim_based');

CREATE TABLE operating_profiles (
  profile_name             text PRIMARY KEY,
  shift_start_bound        time        NOT NULL,
  -- shift_end_bound stored as 00:00 (midnight = start of next day) for 24:00 semantics
  shift_end_bound          time        NOT NULL,
  default_hours_cap        integer     NOT NULL,
  default_cap_enforcement  cap_enforcement_enum NOT NULL,
  scheduling_mode          scheduling_mode_enum NOT NULL,
  float_enabled            boolean     NOT NULL,
  -- ordered list of chain steps: [{step, offset, trigger?}]
  escalation_chain         jsonb       NOT NULL,
  -- null for sm_built profiles
  claim_phase_open_offset  interval,
  claim_phase_alert_offset interval,
  claim_phase_close_offset interval
);

ALTER TABLE operating_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON operating_profiles
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS: user-scoped policies added in phase-2 when auth is introduced.

-- rollback:
-- DROP TABLE IF EXISTS operating_profiles CASCADE;
-- DROP TYPE IF EXISTS scheduling_mode_enum;
-- DROP TYPE IF EXISTS cap_enforcement_enum;
