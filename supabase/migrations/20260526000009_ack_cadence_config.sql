-- Migration: ack_cadence_config
-- Layer 8: per-house 6h and 2h reminder offsets (HM/BM-configurable). Architecture §2.8
--
-- The 1h, 30m, and 5m reminders are mandatory and not stored here.
-- modified_by FK to users added in phase-2.

CREATE TABLE ack_cadence_config (
  house_id           text        PRIMARY KEY REFERENCES houses (id),
  -- null = system default (-6h before ack deadline)
  reminder_6h_offset interval,
  -- null = system default (-2h before ack deadline)
  reminder_2h_offset interval,
  -- FK to users added in phase-2
  modified_by        uuid,
  modified_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ack_cadence_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON ack_cadence_config
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS: user-scoped policies added in phase-2 when auth is introduced.

-- rollback:
-- DROP TABLE IF EXISTS ack_cadence_config CASCADE;
