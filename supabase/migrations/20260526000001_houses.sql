-- Migration: houses
-- Layer 0: the 13 college houses. All other config tables FK into this.

CREATE TABLE houses (
  id    text PRIMARY KEY,
  name  text NOT NULL
);

ALTER TABLE houses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON houses
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS: user-scoped policies added in phase-2 when auth is introduced.

-- rollback:
-- DROP TABLE IF EXISTS houses CASCADE;
