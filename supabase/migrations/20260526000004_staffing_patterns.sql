-- Migration: staffing_patterns
-- Layer 3: headcount requirements per (profile, house, day_type). Architecture §2.3
--
-- block_headcounts is stored in compressed range format:
--   [{"block_start": "HH:MM", "block_end": "HH:MM", "headcount": N}, ...]
-- The application layer expands these to per-30-minute blocks at read time.

CREATE TYPE day_type_enum AS ENUM ('weekday', 'weekend');

CREATE TABLE staffing_patterns (
  profile_name     text         NOT NULL REFERENCES operating_profiles (profile_name),
  house_id         text         NOT NULL REFERENCES houses (id),
  day_type         day_type_enum NOT NULL,
  -- compressed ranges; expanded by application layer at read time
  block_headcounts jsonb        NOT NULL,
  PRIMARY KEY (profile_name, house_id, day_type)
);

ALTER TABLE staffing_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON staffing_patterns
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS: user-scoped policies added in phase-2 when auth is introduced.

-- rollback:
-- DROP TABLE IF EXISTS staffing_patterns CASCADE;
-- DROP TYPE IF EXISTS day_type_enum;
