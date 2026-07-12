-- Migration: Rename house 'stouffer' -> 'du-bois' (data-entry correction).
--
-- Stouffer was never the correct name for this house's front desk; the real Penn house is
-- Du Bois College House. This corrects the id AND display name everywhere. Per AGENTS.md
-- Phase 00, this id is one of the "other 11" (not harnwell/quad) — safe to rename: it is
-- never hardcoded in core business logic, only referenced in seed.sql, tests, and docs
-- (handled by a separate mechanical sweep of those files, not migration-managed). Du Bois
-- remains ACTIVE for the regular school year exactly as Stouffer was; this is a rename, not
-- a closure. Summer participation is decided per-season in the operating-seasons authoring
-- tables (season_house_windows), unaffected by this migration.
--
-- Every FK referencing houses(id) is NO ACTION (no cascade) — see AGENTS.md Phase 00 / this
-- migration's own audit (`ack_cadence_config`, `float_exclusions`, `float_routing` x2,
-- `leave_config_errors`, `period_house_publications`, `season_house_windows`,
-- `shift_block_assignments`, `shift_blocks`, `staffing_patterns`, `user_roles`, `users`).
-- A straight `UPDATE houses SET id = 'du-bois'` would violate every one of those FKs the
-- instant it ran (rows still pointing at 'stouffer' would reference a vanished parent), and
-- repointing children to 'du-bois' first would fail too (no 'du-bois' parent exists yet). So
-- the safe order is: INSERT the new 'du-bois' row (parent exists, valid target) -> repoint
-- every child row 'stouffer' -> 'du-bois' (always references an existing parent) -> DELETE
-- the now-unreferenced 'stouffer' row. Idempotent (guarded on the old row still existing).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM houses WHERE id = 'stouffer') THEN
    INSERT INTO houses (id, name, desk_phone)
    SELECT 'du-bois', 'Du Bois', desk_phone FROM houses WHERE id = 'stouffer'
    ON CONFLICT (id) DO NOTHING;

    UPDATE shift_blocks SET house_id = 'du-bois' WHERE house_id = 'stouffer';
    UPDATE staffing_patterns SET house_id = 'du-bois' WHERE house_id = 'stouffer';
    UPDATE float_routing SET source_house_id = 'du-bois' WHERE source_house_id = 'stouffer';
    UPDATE float_routing SET destination_house_id = 'du-bois' WHERE destination_house_id = 'stouffer';
    UPDATE season_house_windows SET house_id = 'du-bois' WHERE house_id = 'stouffer';
    UPDATE user_roles SET scope_house_id = 'du-bois' WHERE scope_house_id = 'stouffer';
    UPDATE users SET home_house_id = 'du-bois' WHERE home_house_id = 'stouffer';
    UPDATE ack_cadence_config SET house_id = 'du-bois' WHERE house_id = 'stouffer';
    UPDATE float_exclusions SET destination_house_id = 'du-bois' WHERE destination_house_id = 'stouffer';
    UPDATE leave_config_errors SET house_id = 'du-bois' WHERE house_id = 'stouffer';
    UPDATE period_house_publications SET house_id = 'du-bois' WHERE house_id = 'stouffer';
    UPDATE shift_block_assignments SET source_house_id = 'du-bois' WHERE source_house_id = 'stouffer';

    DELETE FROM houses WHERE id = 'stouffer';
  END IF;
END $$;

-- rollback (same insert -> repoint -> delete pattern, reversed):
-- INSERT INTO houses (id, name, desk_phone)
--   SELECT 'stouffer', 'Stouffer', desk_phone FROM houses WHERE id = 'du-bois';
-- (repoint every child table 'du-bois' -> 'stouffer', mirroring the UPDATEs above)
-- DELETE FROM houses WHERE id = 'du-bois';
