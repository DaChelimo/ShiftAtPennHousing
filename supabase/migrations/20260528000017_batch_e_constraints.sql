-- Batch E (constraints subset): schema-hardening CHECKs/triggers that conform
-- to the committed seed.
--   E1       — shift_block_assignments invariants (F-03-004/005).
--   E3       — operating_profiles claim-phase null pairing (F-01-006).
--   E7       — F-02-009 user_roles sw-scope, F-02-010 users.email UNIQUE,
--              F-01-010 hm_leave self-replacement, F-01-014 houses.id format,
--              F-01-013 set_modified_at() trigger on the modified_at tables.

-- ============================================================
-- E1 — shift_block_assignments invariants.
-- user_id is present exactly when the seat is filled (not vacant/allied).
ALTER TABLE shift_block_assignments
  ADD CONSTRAINT sba_user_id_matches_status
  CHECK ((status IN ('vacant', 'allied')) = (user_id IS NULL));

-- NOTE (F-03-005): a CHECK tying is_float to parent_float_id is intentionally
-- NOT added. is_float is a standalone flag set independently in pre-Phase-6
-- fixtures and flows; parent_float_id was introduced in Phase 6 and is
-- maintained by the float RPCs. A schema CHECK either direction conflicts with
-- legitimate intermediate states, so the linkage stays an RPC-level invariant.

-- ============================================================
-- E3 — claim-phase offsets are all-NULL for sm_built, all-set for claim_based.
ALTER TABLE operating_profiles
  ADD CONSTRAINT operating_profiles_claim_phase_pairing_check
  CHECK (
    (scheduling_mode = 'sm_built'
       AND claim_phase_open_offset  IS NULL
       AND claim_phase_alert_offset IS NULL
       AND claim_phase_close_offset IS NULL)
    OR
    (scheduling_mode = 'claim_based'
       AND claim_phase_open_offset  IS NOT NULL
       AND claim_phase_alert_offset IS NOT NULL
       AND claim_phase_close_offset IS NOT NULL)
  );

-- ============================================================
-- E7 — F-02-009: sw roles must have NULL scope; sm/hm/bm must have a scope.
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_scope_required_check;
ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_scope_required_check
  CHECK (
    (role = 'sw' AND scope_house_id IS NULL)
    OR (role IN ('sm', 'hm', 'bm') AND scope_house_id IS NOT NULL)
  );

-- E7 — F-02-010: unique email.
ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);

-- E7 — F-01-010: an HM/BM cannot name themselves as their own replacement.
ALTER TABLE hm_leave
  ADD CONSTRAINT hm_leave_no_self_replacement
  CHECK (replacement_user_id IS NULL OR replacement_user_id <> user_id);

-- E7 — F-01-014: house ids are non-empty lowercase/digit/hyphen slugs.
ALTER TABLE houses
  ADD CONSTRAINT houses_id_format_check
  CHECK (id ~ '^[a-z0-9-]+$');

-- E7 — F-01-013: maintain modified_at on UPDATE.
CREATE OR REPLACE FUNCTION set_modified_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.modified_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ack_cadence_config_set_modified_at
  BEFORE UPDATE ON ack_cadence_config
  FOR EACH ROW EXECUTE FUNCTION set_modified_at();

CREATE TRIGGER system_config_set_modified_at
  BEFORE UPDATE ON system_config
  FOR EACH ROW EXECUTE FUNCTION set_modified_at();

CREATE TRIGGER weekly_cap_overrides_set_modified_at
  BEFORE UPDATE ON weekly_cap_overrides
  FOR EACH ROW EXECUTE FUNCTION set_modified_at();
