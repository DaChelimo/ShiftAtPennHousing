-- Migration: Operating Seasons — runtime guardrails (P3, part 2 of 2).
--
-- Three defensive changes that make the reconciler (migration 20260702000006) and
-- the relaxed float rules (P4) safe:
--   1. float_routing legality trigger — no Harnwell destination, no self-route.
--      P4 removes the hardcoded class-based source check in the pure algorithm, so
--      routing rows become the enforced source of truth. Per BSpec §1.2's rationale
--      ("data-entry errors must not create illegal routes") this backstops the two
--      absolute destination rules at the config-write layer, complementing the
--      algorithm's own Harnwell-destination short-circuit.
--   2. shift_blocks.voided_at — marks a block as retired by a config change (house
--      closed / desk hours shrank). Every live read path filters voided_at IS NULL
--      (migration 20260702000007).
--   3. enforce_block_occupied_headcount grandfathering — when a headcount DECREASE
--      leaves a block with more occupied seats than the new required_headcount, the
--      existing occupants are grandfathered. The trigger must then NOT fail a later
--      status-preserving update (swap, no-op) on those rows: only writes that
--      INCREASE the occupied count on a block are checked.

-- ============================================================
-- 1. float_routing legality trigger.
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_float_routing_legality()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.destination_house_id = 'harnwell' THEN
    RAISE EXCEPTION 'float_routing: Harnwell can never be a float destination (block %)', NEW.source_house_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.source_house_id = NEW.destination_house_id THEN
    RAISE EXCEPTION 'float_routing: a house cannot float to itself (%)', NEW.source_house_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS float_routing_enforce_legality ON float_routing;
CREATE TRIGGER float_routing_enforce_legality
  BEFORE INSERT OR UPDATE OF source_house_id, destination_house_id ON float_routing
  FOR EACH ROW
  EXECUTE FUNCTION enforce_float_routing_legality();

-- ============================================================
-- 2. shift_blocks.voided_at.
-- ============================================================
ALTER TABLE shift_blocks
  ADD COLUMN IF NOT EXISTS voided_at timestamptz;

COMMENT ON COLUMN shift_blocks.voided_at IS
  'Set by apply_compiled_season when an admin config change retires this block '
  '(house closed or desk hours shrank on this future date). Live read/write paths '
  'filter voided_at IS NULL. History is preserved (rows are never deleted).';

-- Supports the orchestrator scan and feed queries that only want live blocks.
CREATE INDEX IF NOT EXISTS shift_blocks_live_idx
  ON shift_blocks (block_start_at)
  WHERE voided_at IS NULL;

-- ============================================================
-- 3. enforce_block_occupied_headcount — grandfathering-aware. A status-preserving
-- update on an already-occupied seat of the SAME block does not raise the block's
-- occupied count, so it must never trip the capacity check (else a headcount
-- decrease would freeze the grandfathered seats). Only INSERTs and transitions
-- INTO occupied (or block moves) are checked.
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_block_occupied_headcount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_required integer;
  v_others   integer;
  v_occupied text[] := ARRAY['scheduled', 'claimed', 'floated_in', 'pending_float_in'];
BEGIN
  -- Only writes that OCCUPY the seat can over-staff a block.
  IF NEW.status <> ALL (v_occupied::shift_status_enum[]) THEN
    RETURN NEW;
  END IF;

  -- Grandfathering: an UPDATE that keeps an already-occupied seat occupied ON THE
  -- SAME block does not increase the block's occupied count. Skip the check so a
  -- swap / no-op on a block whose required_headcount was later reduced still works.
  IF TG_OP = 'UPDATE'
     AND OLD.status = ANY (v_occupied::shift_status_enum[])
     AND OLD.block_id = NEW.block_id THEN
    RETURN NEW;
  END IF;

  SELECT required_headcount INTO v_required
  FROM shift_blocks
  WHERE block_id = NEW.block_id;

  IF v_required IS NULL THEN
    RETURN NEW;  -- no parent block (should be impossible via FK); don't second-guess.
  END IF;

  SELECT count(*) INTO v_others
  FROM shift_block_assignments
  WHERE block_id = NEW.block_id
    AND assignment_id <> NEW.assignment_id
    AND status = ANY (v_occupied::shift_status_enum[]);

  IF v_others + 1 > v_required THEN
    RAISE EXCEPTION
      'block_over_capacity: block % already has % occupied seat(s); house headcount is %',
      NEW.block_id, v_others, v_required
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- rollback:
-- DROP TRIGGER IF EXISTS float_routing_enforce_legality ON float_routing;
-- DROP FUNCTION IF EXISTS enforce_float_routing_legality();
-- ALTER TABLE shift_blocks DROP COLUMN IF EXISTS voided_at;  (drops shift_blocks_live_idx)
-- (restore enforce_block_occupied_headcount from 20260614000004)
