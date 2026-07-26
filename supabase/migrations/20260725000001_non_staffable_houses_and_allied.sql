-- Non-staffable houses, and the Allied contractor's home house.
--
-- `users.home_house_id` is NOT NULL, so any account needs a house. The Allied
-- contractor is not a residential desk: it must never be scheduled, floated,
-- launched, or offered as a transfer destination, yet the Allied *user* must
-- still be assignable to other houses' blocks and appear on their calendars.
--
-- Rather than hardcode the id at the ~15 sites that enumerate houses, houses
-- carry `is_staffable`. Enumerators filter on it and the SQL layer backstops it,
-- so a future house-listing feature cannot silently reintroduce the pseudo-house.
--
-- The id is `allied-house`, deliberately NOT `allied`: `allied` is already a
-- `shift_status_enum` value and appears in the hmod_notify_allied ladder, so a
-- house of that id would be a confusing homonym in every query that touches both.

ALTER TABLE houses
  ADD COLUMN IF NOT EXISTS is_staffable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN houses.is_staffable IS
  'False for pseudo-houses that exist only to own a non-worker account (Allied). '
  'Never scheduled, floated, launched, or offered as a transfer destination.';

INSERT INTO houses (id, name, is_staffable, launch_state)
VALUES ('allied-house', 'Allied', false, 'pre_launch')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_staffable = false;

CREATE OR REPLACE FUNCTION house_is_staffable(p_house_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((SELECT is_staffable FROM houses WHERE id = p_house_id), false);
$$;

-- Worker-facing house list: a non-staffable house is not a place anyone works,
-- so it never reaches the cross-house switcher on web or mobile.
CREATE OR REPLACE VIEW worker_visible_houses AS
  SELECT id, name, desk_phone, launch_state
    FROM houses
   WHERE house_is_live(id)
     AND is_staffable;

-- Backstop: the four tables that would turn a house into a staffed desk.
CREATE OR REPLACE FUNCTION reject_non_staffable_house()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_house_id text;
BEGIN
  -- Read the column named by TG_ARGV[0] through jsonb: a plpgsql CASE over
  -- NEW.<field> resolves EVERY branch at compile time, so naming a column that
  -- this table lacks would fail on every row rather than only the wrong ones.
  v_house_id := to_jsonb(NEW) ->> TG_ARGV[0];

  IF v_house_id IS NOT NULL AND NOT house_is_staffable(v_house_id) THEN
    RAISE EXCEPTION 'House % is not staffable and cannot be scheduled or floated', v_house_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staffing_patterns_reject_non_staffable ON staffing_patterns;
CREATE TRIGGER staffing_patterns_reject_non_staffable
  BEFORE INSERT OR UPDATE ON staffing_patterns
  FOR EACH ROW EXECUTE FUNCTION reject_non_staffable_house('house_id');

DROP TRIGGER IF EXISTS season_house_windows_reject_non_staffable ON season_house_windows;
CREATE TRIGGER season_house_windows_reject_non_staffable
  BEFORE INSERT OR UPDATE ON season_house_windows
  FOR EACH ROW EXECUTE FUNCTION reject_non_staffable_house('house_id');

DROP TRIGGER IF EXISTS shift_blocks_reject_non_staffable ON shift_blocks;
CREATE TRIGGER shift_blocks_reject_non_staffable
  BEFORE INSERT OR UPDATE ON shift_blocks
  FOR EACH ROW EXECUTE FUNCTION reject_non_staffable_house('house_id');

DROP TRIGGER IF EXISTS float_routing_reject_non_staffable_source ON float_routing;
CREATE TRIGGER float_routing_reject_non_staffable_source
  BEFORE INSERT OR UPDATE ON float_routing
  FOR EACH ROW EXECUTE FUNCTION reject_non_staffable_house('source_house_id');

DROP TRIGGER IF EXISTS float_routing_reject_non_staffable_destination ON float_routing;
CREATE TRIGGER float_routing_reject_non_staffable_destination
  BEFORE INSERT OR UPDATE ON float_routing
  FOR EACH ROW EXECUTE FUNCTION reject_non_staffable_house('destination_house_id');
