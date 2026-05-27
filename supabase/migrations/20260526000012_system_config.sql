-- Migration: system_config
-- System-wide configurable parameters (profile-independent). Architecture §3.10

CREATE TYPE value_type_enum AS ENUM ('integer', 'interval', 'time_of_day', 'enum');

CREATE TABLE system_config (
  config_key   text             PRIMARY KEY,
  config_value text             NOT NULL,
  value_type   value_type_enum  NOT NULL,
  -- FK to users added in phase-2; stores the project administrator's user_id
  modified_by  uuid,
  modified_at  timestamptz      NOT NULL DEFAULT now(),
  -- optional: reason for last change
  notes        text
);

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON system_config
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS: user-scoped policies added in phase-2 when auth is introduced.

-- rollback:
-- DROP TABLE IF EXISTS system_config CASCADE;
-- DROP TYPE IF EXISTS value_type_enum;
