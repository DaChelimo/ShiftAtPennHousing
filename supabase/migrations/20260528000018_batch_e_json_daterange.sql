-- Batch E (continued): E4 JSON-shape CHECKs + E5 date-range overlap exclusions.

-- ============================================================
-- E4 — validate the shape of the two config JSONB columns (F-01-008a/b).
-- CHECK constraints cannot contain subqueries, so the per-element validation
-- lives in IMMUTABLE helper functions.
-- ============================================================
CREATE OR REPLACE FUNCTION is_valid_block_headcounts(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p) e
      WHERE jsonb_typeof(e) <> 'object'
         OR jsonb_typeof(e -> 'block_start') IS DISTINCT FROM 'string'
         OR jsonb_typeof(e -> 'block_end')   IS DISTINCT FROM 'string'
         OR jsonb_typeof(e -> 'headcount')   IS DISTINCT FROM 'number'
         OR (e ->> 'headcount')::numeric < 0
    );
$$;

CREATE OR REPLACE FUNCTION is_valid_escalation_chain(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p) e
      WHERE jsonb_typeof(e) <> 'object'
         OR jsonb_typeof(e -> 'step')   IS DISTINCT FROM 'string'
         OR jsonb_typeof(e -> 'offset') IS DISTINCT FROM 'string'
         -- guard against a typo'd step silently no-opping (e.g. "float_lockup")
         OR (e ->> 'step') NOT IN ('broadcast', 'float_lookup', 'hmod_notify_allied')
         OR (e ? 'trigger' AND jsonb_typeof(e -> 'trigger') IS DISTINCT FROM 'string')
    );
$$;

ALTER TABLE staffing_patterns
  ADD CONSTRAINT staffing_patterns_block_headcounts_shape_check
  CHECK (is_valid_block_headcounts(block_headcounts));

ALTER TABLE operating_profiles
  ADD CONSTRAINT operating_profiles_escalation_chain_shape_check
  CHECK (is_valid_escalation_chain(escalation_chain));

-- ============================================================
-- E5 — no overlapping date ranges (F-01-009a/b).
-- ============================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE break_periods
  ADD CONSTRAINT break_periods_no_overlap
  EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&);

ALTER TABLE scheduling_periods
  ADD CONSTRAINT scheduling_periods_no_overlap
  EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)
  WHERE (profile_name = 'regular_school_year');
