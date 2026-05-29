-- Post-verification remediation: make the C3a project-administrator terminal
-- representable. The terminal is stored as system_config('project_administrator_user_id')
-- and read with config_value::uuid by process_no_ack_float /
-- process_hmod_notify_allied_step, but value_type_enum had no 'uuid' member, so
-- the row could not be inserted with a correct value_type. Add it.
--
-- OPERATIONAL REQUIREMENT (documented in AGENTS.md): every deployed environment
-- MUST set
--   INSERT INTO system_config (config_key, config_value, value_type)
--   VALUES ('project_administrator_user_id', '<active admin users.user_id>', 'uuid');
-- Until set, an urgent notification that resolves past HM and HMOD has no terminal
-- (BSpec §2.6) and is logged via RAISE WARNING (20260528000025) rather than
-- silently dropped. seed.sql intentionally does not set it (the local seed has no
-- users); the pgTAP suite exercises the configured path in phase-07-admin-terminal.sql.

ALTER TYPE value_type_enum ADD VALUE IF NOT EXISTS 'uuid';
