-- Batch E (E6): convert the Phase-6 text+CHECK columns to enums (X-5/F-06-002).
-- No rows exist in these tables outside per-test transactions, so the in-place
-- type change is safe. database.types.ts is regenerated after this migration.

CREATE TYPE float_status_enum         AS ENUM ('pending', 'acknowledged', 'declined', 'voided', 'completed');
CREATE TYPE float_initiated_by_enum   AS ENUM ('automated', 'force_triggered');
CREATE TYPE float_exclusion_reason_enum AS ENUM ('declined', 'no_acknowledgment');

-- Drop the now-redundant text IN (...) checks (the enum enforces membership),
-- and the force_triggered_by check which embeds `initiated_by = <text>` and
-- would otherwise fail re-validation against the new enum type.
ALTER TABLE float_assignments DROP CONSTRAINT IF EXISTS float_assignments_status_check;
ALTER TABLE float_assignments DROP CONSTRAINT IF EXISTS float_assignments_initiated_by_check;
ALTER TABLE float_assignments DROP CONSTRAINT IF EXISTS float_assignments_force_triggered_by_check;
ALTER TABLE float_exclusions  DROP CONSTRAINT IF EXISTS float_exclusions_reason_check;

ALTER TABLE float_assignments
  ALTER COLUMN status TYPE float_status_enum USING status::float_status_enum;
ALTER TABLE float_assignments
  ALTER COLUMN initiated_by TYPE float_initiated_by_enum USING initiated_by::float_initiated_by_enum;
ALTER TABLE float_exclusions
  ALTER COLUMN reason TYPE float_exclusion_reason_enum USING reason::float_exclusion_reason_enum;

-- Recreate the force_triggered_by invariant against the enum column.
ALTER TABLE float_assignments
  ADD CONSTRAINT float_assignments_force_triggered_by_check
  CHECK (
    (initiated_by = 'automated' AND force_triggered_by IS NULL) OR
    (initiated_by = 'force_triggered' AND force_triggered_by IS NOT NULL)
  );
