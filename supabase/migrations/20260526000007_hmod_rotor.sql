-- Migration: hmod_rotor
-- Layer 6: who is HMOD for each weekly slot. Architecture §2.6
--
-- hmod_user_id FK to users added in phase-2 when users table exists.

CREATE TABLE hmod_rotor (
  -- the Monday 08:00 of the HMOD week (stored as date; time resolved by application layer)
  week_start_date date PRIMARY KEY,
  -- must hold hm or bm role; FK added in phase-2
  hmod_user_id    uuid NOT NULL
);

ALTER TABLE hmod_rotor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON hmod_rotor
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS: user-scoped policies added in phase-2 when auth is introduced.

-- rollback:
-- DROP TABLE IF EXISTS hmod_rotor CASCADE;
