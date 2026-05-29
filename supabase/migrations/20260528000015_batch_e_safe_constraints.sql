-- Batch E (safe subset): schema hardening that conforms to existing seed/data.
--   E2        — pin scheduling_periods.profile_name to 'regular_school_year'
--               (F-01-003); the schedule builder only operates on the regular
--               school year.
--   F-01-015  — weekly_cap_overrides.week_start_date must be a Monday (the cap
--               week is Mon..Sun). (The hmod_rotor Friday CHECK shipped in
--               20260528000008.)
--
-- Other E-series constraints (E1 sba invariants, E3 claim-phase-null, E4 JSON
-- shape, E5 daterange exclusion, E6 enums, and the remaining E7 items) are held
-- back pending a per-constraint check against seed.sql so a reset does not fail
-- on pre-existing data.

ALTER TABLE scheduling_periods
  ADD CONSTRAINT scheduling_periods_profile_check
  CHECK (profile_name = 'regular_school_year');

ALTER TABLE weekly_cap_overrides
  ADD CONSTRAINT weekly_cap_overrides_week_start_monday_check
  CHECK (extract(isodow FROM week_start_date) = 1);
