-- Migration: drop IN(20,40) check constraint from weekly_cap_overrides.hours_cap
-- Fixes AMBIGUOUS finding from phase-01 audit: ARCHITECTURE §1.1 classifies the weekly cap
-- as a configurable rule — a hard-coded CHECK forces a schema migration whenever the housing
-- committee revises the allowed values. Application layer is responsible for validation.

ALTER TABLE weekly_cap_overrides
  DROP CONSTRAINT IF EXISTS weekly_cap_overrides_hours_cap_check;

-- rollback:
-- ALTER TABLE weekly_cap_overrides
--   ADD CONSTRAINT weekly_cap_overrides_hours_cap_check CHECK (hours_cap IN (20, 40));
