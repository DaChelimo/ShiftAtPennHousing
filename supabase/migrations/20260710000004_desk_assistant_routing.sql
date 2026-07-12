-- Desk Assistant v1 — Phase E: escalation routing rules (V1_SCOPE §4.2, §10.1).
--
-- routing_rules is the DATA behind the routing engine (packages/core routing.ts).
-- The engine matches (issue_type, season, day_type, window) -> tier, then resolves
-- the tier to a live person via existing duty-state SQL. This migration seeds a
-- PLACEHOLDER ladder; the real ladder + windows + leave fallbacks (§10.1, the single
-- most important design input) replace the seed rows without any code change.
--
-- The student-manager tier is CSMOD (not "ASMOD", which does not exist).

CREATE TABLE routing_rules (
  rule_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type   text NOT NULL,   -- placeholder taxonomy; real values arrive with §10.1
  tier         text NOT NULL CHECK (tier IN ('desk_sm', 'csmod', 'rsm', 'hmod', 'project_admin')),
  day_type     text NOT NULL DEFAULT 'any' CHECK (day_type IN ('any', 'weekday', 'weekend')),
  window_start time,             -- NULL = all day; NY wall-clock
  window_end   time,
  season_scope text NOT NULL DEFAULT 'any' CHECK (season_scope IN ('any', 'academic', 'summer')),
  priority     int  NOT NULL DEFAULT 0,   -- lower wins among matches
  active       boolean NOT NULL DEFAULT true,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX routing_rules_issue_idx ON routing_rules (issue_type) WHERE active;

ALTER TABLE routing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON routing_rules
  TO service_role USING (true) WITH CHECK (true);

-- Authenticated staff may read the rules (they are not sensitive).
CREATE POLICY "authenticated read" ON routing_rules
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- PLACEHOLDER seed (V1_SCOPE §10.1 seam). Replace wholesale with the real ladder.
-- Intent captured from scope: access issues route to the student-manager tier
-- (CSMOD) first; equipment routes to the RSM; everything else defaults to HMOD.
-- ---------------------------------------------------------------------------
INSERT INTO routing_rules (issue_type, tier, day_type, season_scope, priority, notes) VALUES
  ('access',     'csmod', 'any', 'any', 10, 'PLACEHOLDER: access issues to the student-manager (CSMOD) tier first'),
  ('equipment',  'rsm',   'any', 'any', 10, 'PLACEHOLDER: equipment/IC issues to the RSM'),
  ('facilities', 'hmod',  'any', 'any', 20, 'PLACEHOLDER: facilities to HMOD'),
  ('general',    'hmod',  'any', 'any', 50, 'PLACEHOLDER: default catch-all to HMOD');
