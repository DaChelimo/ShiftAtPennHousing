-- Migration: float_routing
-- Layer 4: source→destination float precedence per profile. Architecture §2.4
--
-- float_routing governs floating only, not cross-house pickup.
-- The float lookup algorithm ALSO enforces absolute rules (§1.5) independent of this table.

CREATE TABLE float_routing (
  profile_name         text    NOT NULL REFERENCES operating_profiles (profile_name),
  source_house_id      text    NOT NULL REFERENCES houses (id),
  destination_house_id text    NOT NULL REFERENCES houses (id),
  -- lower precedence_order = checked first
  precedence_order     integer NOT NULL,
  PRIMARY KEY (profile_name, source_house_id, destination_house_id)
);

ALTER TABLE float_routing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON float_routing
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS: user-scoped policies added in phase-2 when auth is introduced.

-- rollback:
-- DROP TABLE IF EXISTS float_routing CASCADE;
