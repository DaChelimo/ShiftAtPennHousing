-- Migration: add reminder_6h_enabled / reminder_2h_enabled to ack_cadence_config
-- Fixes DRIFTED finding from phase-01 audit: ARCHITECTURE §2.8 specifies three states
-- (system default, custom offset, disabled) but the interval column alone can only encode two.
--
-- Semantics with both columns:
--   enabled = false                       → reminder suppressed ("disabled")
--   enabled = true, offset = NULL         → system default (-6h / -2h before ack deadline)
--   enabled = true, offset = <interval>   → custom configured offset

ALTER TABLE ack_cadence_config
  ADD COLUMN reminder_6h_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN reminder_2h_enabled boolean NOT NULL DEFAULT true;

-- rollback:
-- ALTER TABLE ack_cadence_config
--   DROP COLUMN reminder_6h_enabled,
--   DROP COLUMN reminder_2h_enabled;
