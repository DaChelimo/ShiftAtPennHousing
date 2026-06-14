-- Enforce the per-house concurrent staffing limit at every write point.
--
-- The number of workers who may STAFF one 30-minute block at once is the block's
-- `required_headcount` (1 for regular houses, 2 for Harnwell, 3 for Quad — derived
-- from staffing_patterns by the block generator). Until now this was enforced only
-- inside individual RPCs (publish guards drafts; claim/override update a single seat),
-- with NO database-level backstop. Any unguarded write path — or a future one — could
-- push a block past its headcount, which is exactly how DuBois (headcount 1) ended up
-- double-staffed.
--
-- This adds the missing backstop, mirroring the Harnwell-training trigger pattern
-- (a BEFORE trigger on BOTH the live and the draft assignment tables):
--
--   * shift_block_assignments — reject any INSERT/UPDATE that would leave a block with
--     more OCCUPIED seats than required_headcount. "Occupied" = a worker is actually
--     staffing the seat: scheduled / claimed / floated_in / pending_float_in. It
--     deliberately EXCLUDES pending_float_out & floated_out (the worker is LEAVING that
--     seat — the float source-gap pattern transiently keeps that row plus a fresh vacant
--     gap, and must not be blocked), vacant, and allied. This covers every live write
--     path: publish, claim, admin override/replace, float lookup, force-trigger, swap,
--     permanent pickup, fire — without breaking the legitimate transient states.
--
--   * draft_block_assignments — reject drafting more workers onto one block than its
--     headcount, so the schedule builder enforces the limit AT CREATION TIME (BSpec:
--     "enforce at every assignment write point, not only in config tables") instead of
--     only failing later at publish.
--
-- Idempotent. Service-role does NOT bypass triggers, so this holds for Edge Functions
-- and the orchestrator too. No existing block violates the rule (verified before the
-- migration), so applying it rejects nothing already in the table.

-- ----------------------------------------------------------------------------
-- Live assignments: occupied-seat count must not exceed required_headcount.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_block_occupied_headcount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_required integer;
  v_others   integer;
BEGIN
  -- Only writes that OCCUPY the seat can over-staff a block. A move to
  -- vacant / pending_float_out / floated_out / allied frees or relocates a seat
  -- and can never push the occupied count up.
  IF NEW.status NOT IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in') THEN
    RETURN NEW;
  END IF;

  SELECT required_headcount INTO v_required
  FROM shift_blocks
  WHERE block_id = NEW.block_id;

  IF v_required IS NULL THEN
    RETURN NEW;  -- no parent block (should be impossible via FK); don't second-guess.
  END IF;

  -- Count the OTHER occupied seats on this block (exclude the row being written).
  SELECT count(*) INTO v_others
  FROM shift_block_assignments
  WHERE block_id = NEW.block_id
    AND assignment_id <> NEW.assignment_id
    AND status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in');

  IF v_others + 1 > v_required THEN
    RAISE EXCEPTION
      'block_over_capacity: block % already has % occupied seat(s); house headcount is %',
      NEW.block_id, v_others, v_required
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shift_block_assignments_enforce_headcount ON shift_block_assignments;
CREATE TRIGGER shift_block_assignments_enforce_headcount
  BEFORE INSERT OR UPDATE OF status, user_id, block_id ON shift_block_assignments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_block_occupied_headcount();

-- ----------------------------------------------------------------------------
-- Draft assignments: drafts per block must not exceed required_headcount, so the
-- builder cannot stage an over-staffed schedule in the first place.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_draft_block_headcount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_required integer;
  v_others   integer;
BEGIN
  SELECT required_headcount INTO v_required
  FROM shift_blocks
  WHERE block_id = NEW.block_id;

  IF v_required IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_others
  FROM draft_block_assignments
  WHERE period_id = NEW.period_id
    AND block_id = NEW.block_id
    AND draft_assignment_id <> NEW.draft_assignment_id;

  IF v_others + 1 > v_required THEN
    RAISE EXCEPTION
      'block_over_capacity: block % already has % draft(s) for this period; house headcount is %',
      NEW.block_id, v_others, v_required
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS draft_block_assignments_enforce_headcount ON draft_block_assignments;
CREATE TRIGGER draft_block_assignments_enforce_headcount
  BEFORE INSERT OR UPDATE OF block_id, user_id, period_id ON draft_block_assignments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_draft_block_headcount();
