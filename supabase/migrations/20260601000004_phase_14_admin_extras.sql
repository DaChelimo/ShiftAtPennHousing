-- Phase 14: global weekly-cap administration, project-admin config writes, and
-- basic orchestrator health persistence.

ALTER TABLE weekly_cap_overrides
  ADD COLUMN IF NOT EXISTS notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'system_config_modified_by_fkey'
      AND conrelid = 'system_config'::regclass
  ) THEN
    ALTER TABLE system_config
      ADD CONSTRAINT system_config_modified_by_fkey
      FOREIGN KEY (modified_by) REFERENCES users (user_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION is_project_administrator(check_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM system_config
    WHERE config_key = 'project_administrator_user_id'
      AND config_value = check_user_id::text
  );
$$;

DROP POLICY IF EXISTS "authenticated users can select weekly cap overrides" ON weekly_cap_overrides;
CREATE POLICY "authenticated users can select weekly cap overrides" ON weekly_cap_overrides
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "hm bm can insert weekly cap overrides" ON weekly_cap_overrides;
CREATE POLICY "hm bm can insert weekly cap overrides" ON weekly_cap_overrides
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role IN ('hm', 'bm')
    )
    AND modified_by = auth.uid()
  );

DROP POLICY IF EXISTS "hm bm can update weekly cap overrides" ON weekly_cap_overrides;
CREATE POLICY "hm bm can update weekly cap overrides" ON weekly_cap_overrides
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role IN ('hm', 'bm')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role IN ('hm', 'bm')
    )
    AND modified_by = auth.uid()
  );

DROP POLICY IF EXISTS "project administrator can select system config" ON system_config;
CREATE POLICY "project administrator can select system config" ON system_config
  FOR SELECT TO authenticated
  USING (is_project_administrator(auth.uid()));

DROP POLICY IF EXISTS "project administrator can update system config" ON system_config;
CREATE POLICY "project administrator can update system config" ON system_config
  FOR UPDATE TO authenticated
  USING (is_project_administrator(auth.uid()))
  WITH CHECK (is_project_administrator(auth.uid()));

CREATE TABLE IF NOT EXISTS orchestrator_health (
  singleton     boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_tick_at  timestamptz NOT NULL,
  blocks_scanned integer NOT NULL DEFAULT 0 CHECK (blocks_scanned >= 0),
  steps_fired   integer NOT NULL DEFAULT 0 CHECK (steps_fired >= 0),
  floats_voided integer NOT NULL DEFAULT 0 CHECK (floats_voided >= 0),
  swaps_expired integer NOT NULL DEFAULT 0 CHECK (swaps_expired >= 0),
  errors        text[] NOT NULL DEFAULT '{}'
);

ALTER TABLE orchestrator_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service-role bypass" ON orchestrator_health;
CREATE POLICY "service-role bypass" ON orchestrator_health
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "admins can select orchestrator health" ON orchestrator_health;
CREATE POLICY "admins can select orchestrator health" ON orchestrator_health
  FOR SELECT TO authenticated
  USING (
    is_project_administrator(auth.uid())
    OR EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role IN ('hm', 'bm')
    )
  );

-- rollback:
-- DROP TABLE IF EXISTS orchestrator_health;
-- DROP POLICY IF EXISTS "project administrator can update system config" ON system_config;
-- DROP POLICY IF EXISTS "project administrator can select system config" ON system_config;
-- DROP POLICY IF EXISTS "hm bm can update weekly cap overrides" ON weekly_cap_overrides;
-- DROP POLICY IF EXISTS "hm bm can insert weekly cap overrides" ON weekly_cap_overrides;
-- DROP POLICY IF EXISTS "authenticated users can select weekly cap overrides" ON weekly_cap_overrides;
-- DROP FUNCTION IF EXISTS is_project_administrator(uuid);
-- ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_modified_by_fkey;
-- ALTER TABLE weekly_cap_overrides DROP COLUMN IF EXISTS notes;
