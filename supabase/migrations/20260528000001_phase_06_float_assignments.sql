-- Migration: Phase 06 float assignment records and float exclusions.

CREATE TABLE IF NOT EXISTS float_assignments (
  float_id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES users (user_id),
  source_assignment_ids       uuid[] NOT NULL,
  destination_assignment_ids  uuid[] NOT NULL,
  status                      text NOT NULL CHECK (
    status IN ('pending', 'acknowledged', 'declined', 'voided', 'completed')
  ),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  acknowledged_at             timestamptz,
  declined_at                 timestamptz,
  initiated_by                text NOT NULL CHECK (initiated_by IN ('automated', 'force_triggered')),
  force_triggered_by          uuid REFERENCES users (user_id),
  expires_for_cleanup_at      timestamptz NOT NULL,
  CONSTRAINT float_assignments_source_assignment_ids_nonempty
    CHECK (cardinality(source_assignment_ids) > 0),
  CONSTRAINT float_assignments_destination_assignment_ids_nonempty
    CHECK (cardinality(destination_assignment_ids) > 0),
  CONSTRAINT float_assignments_force_triggered_by_check
    CHECK (
      (initiated_by = 'automated' AND force_triggered_by IS NULL) OR
      (initiated_by = 'force_triggered' AND force_triggered_by IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS float_exclusions (
  exclusion_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES users (user_id),
  window_start_at       timestamptz NOT NULL,
  window_end_at         timestamptz NOT NULL,
  destination_house_id  text        NOT NULL REFERENCES houses (id),
  reason                text        NOT NULL CHECK (reason IN ('declined', 'no_acknowledgment')),
  excluded_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT float_exclusions_window_order_check
    CHECK (window_start_at < window_end_at)
);

CREATE INDEX IF NOT EXISTS float_assignments_user_status_idx
  ON float_assignments (user_id, status);

CREATE INDEX IF NOT EXISTS float_assignments_cleanup_idx
  ON float_assignments (expires_for_cleanup_at);

CREATE INDEX IF NOT EXISTS float_assignments_source_assignment_ids_gin_idx
  ON float_assignments USING gin (source_assignment_ids);

CREATE INDEX IF NOT EXISTS float_assignments_destination_assignment_ids_gin_idx
  ON float_assignments USING gin (destination_assignment_ids);

CREATE INDEX IF NOT EXISTS float_exclusions_lookup_idx
  ON float_exclusions (user_id, destination_house_id, window_start_at, window_end_at);

CREATE INDEX IF NOT EXISTS float_exclusions_cleanup_window_idx
  ON float_exclusions (window_end_at);

CREATE INDEX IF NOT EXISTS shift_block_assignments_parent_float_id_idx
  ON shift_block_assignments (parent_float_id);

CREATE OR REPLACE FUNCTION enforce_float_assignment_assignment_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  missing_source_assignment_id uuid;
  missing_destination_assignment_id uuid;
BEGIN
  SELECT source_ids.assignment_id
  INTO missing_source_assignment_id
  FROM unnest(NEW.source_assignment_ids) AS source_ids(assignment_id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM shift_block_assignments sba
    WHERE sba.assignment_id = source_ids.assignment_id
  )
  LIMIT 1;

  IF missing_source_assignment_id IS NOT NULL THEN
    RAISE EXCEPTION 'source assignment id % does not exist', missing_source_assignment_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT destination_ids.assignment_id
  INTO missing_destination_assignment_id
  FROM unnest(NEW.destination_assignment_ids) AS destination_ids(assignment_id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM shift_block_assignments sba
    WHERE sba.assignment_id = destination_ids.assignment_id
  )
  LIMIT 1;

  IF missing_destination_assignment_id IS NOT NULL THEN
    RAISE EXCEPTION 'destination assignment id % does not exist', missing_destination_assignment_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS float_assignments_enforce_assignment_ids ON float_assignments;
CREATE TRIGGER float_assignments_enforce_assignment_ids
  BEFORE INSERT OR UPDATE OF source_assignment_ids, destination_assignment_ids ON float_assignments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_float_assignment_assignment_ids();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shift_block_assignments_parent_float_id_fkey'
      AND conrelid = 'shift_block_assignments'::regclass
  ) THEN
    ALTER TABLE shift_block_assignments
      ADD CONSTRAINT shift_block_assignments_parent_float_id_fkey
      FOREIGN KEY (parent_float_id)
      REFERENCES float_assignments (float_id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END;
$$;

ALTER TABLE float_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE float_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service-role bypass" ON float_assignments;
CREATE POLICY "service-role bypass" ON float_assignments
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "users can select own float assignments" ON float_assignments;
CREATE POLICY "users can select own float assignments" ON float_assignments
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "house admins can select related float assignments" ON float_assignments;
CREATE POLICY "house admins can select related float assignments" ON float_assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM unnest(source_assignment_ids || destination_assignment_ids) AS related(assignment_id)
      JOIN shift_block_assignments sba
        ON sba.assignment_id = related.assignment_id
      JOIN shift_blocks sb
        ON sb.block_id = sba.block_id
      WHERE user_has_house_admin_role(auth.uid(), sb.house_id)
    )
  );

DROP POLICY IF EXISTS "service-role bypass" ON float_exclusions;
CREATE POLICY "service-role bypass" ON float_exclusions
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "users can select own float exclusions" ON float_exclusions;
CREATE POLICY "users can select own float exclusions" ON float_exclusions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "house admins can select destination float exclusions" ON float_exclusions;
CREATE POLICY "house admins can select destination float exclusions" ON float_exclusions
  FOR SELECT
  TO authenticated
  USING (user_has_house_admin_role(auth.uid(), destination_house_id));

-- rollback:
-- ALTER TABLE shift_block_assignments DROP CONSTRAINT IF EXISTS shift_block_assignments_parent_float_id_fkey;
-- DROP POLICY IF EXISTS "house admins can select destination float exclusions" ON float_exclusions;
-- DROP POLICY IF EXISTS "users can select own float exclusions" ON float_exclusions;
-- DROP POLICY IF EXISTS "service-role bypass" ON float_exclusions;
-- DROP POLICY IF EXISTS "house admins can select related float assignments" ON float_assignments;
-- DROP POLICY IF EXISTS "users can select own float assignments" ON float_assignments;
-- DROP POLICY IF EXISTS "service-role bypass" ON float_assignments;
-- DROP TRIGGER IF EXISTS float_assignments_enforce_assignment_ids ON float_assignments;
-- DROP FUNCTION IF EXISTS enforce_float_assignment_assignment_ids();
-- DROP TABLE IF EXISTS float_exclusions;
-- DROP TABLE IF EXISTS float_assignments;
