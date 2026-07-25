-- Migration: permanent_pickup_slot takes ONE seat per block (ARCH §7.2 step 6).
--
-- BUG. The pickup claim was a bare set-update:
--
--   UPDATE shift_block_assignments sba ... FROM shift_blocks sb
--   WHERE sba.block_id = sb.block_id
--     AND sba.block_id = ANY (p_assigned_block_ids)
--     AND sba.status = 'vacant'
--     AND sba.vacancy_origin = 'permanent_drop';
--
-- with no per-block LIMIT. On a multi-staff desk (Harnwell required_headcount 2, Quad 3) a
-- single block can hold SEVERAL permanent-drop vacancies at once: two owners of the same
-- recurring slot (same house, same day-of-week, same 30-minute start) each permanently drop
-- it, and permanent_drop_slot vacates one seat per owner. The pickup then matched both
-- seats of that block and assigned BOTH to the picker, so one worker held two seats on one
-- 30-minute block. Nothing else catches it: there is no unique index on
-- (block_id, user_id), and enforce_block_occupied_headcount (20260614000004) only counts
-- occupied seats against required_headcount, which two seats on a headcount-2 block
-- satisfy. Reproduced on the local DB (harnwell headcount 2, two permanent_drop seats,
-- one pickup call -> assigned_count 2, both seats on the same user).
--
-- The counts were wrong for the same reason. permanent-pickup/index.ts derives its scope
-- from evaluatePermanentPickup, which reasons in BLOCKS (0.5h each) and returns one entry
-- per candidate; a ROW_COUNT that can exceed one per block does not answer "how many
-- occurrences did I get", and 'assigned_count' is exactly what the EF hands back to the UI.
--
-- FIX. Pick at most one seat per block, the pattern already used everywhere else a seat is
-- claimed:
--   * claim_open_shift        (20260724000003) -- one seat per block, FOR UPDATE SKIP LOCKED
--   * claim_break_blocks      (20260615000001) -- one seat per block, SKIP LOCKED
--   * admin_permanent_assign  (20260622000001) -- DISTINCT ON (sba.block_id)
-- DISTINCT ON cannot carry the lock itself ("FOR UPDATE is not allowed with DISTINCT
-- clause"), so the one-per-block pick is a LATERAL subquery with LIMIT 1 FOR UPDATE SKIP
-- LOCKED over the distinct candidate blocks. That locks exactly ONE seat per block, so two
-- workers picking up the two dropped slots concurrently split the seats (each skips over
-- the other's locked row) instead of one of them blocking and then finding nothing. The
-- outer UPDATE keeps the status/vacancy_origin predicates, so the §10.9 race guard and the
-- partial-success semantics are unchanged.
--
-- The skipped pass gets the same treatment. Re-flagging EVERY permanent_drop seat on a
-- skipped block to 'temporary_drop' retired the OTHER owner's still-unpicked drop from the
-- permanent feed as collateral, stranding it: nobody could permanently pick it up again
-- (§8.4.3 "partial pickups are final" applies to the slot being picked up, not to a
-- co-tenant's independent drop). One seat per block also makes 'skipped_count' a count of
-- occurrences, matching the evaluator.
--
-- Single-seat blocks -- every house at required_headcount 1, which is all of them but
-- Harnwell and Quad -- behave exactly as before.
--
-- Everything else is byte-identical to 20260531000001: the active-user check, the Harnwell
-- training invariant (#1) over both id arrays, is_cross_house_pickup / source_house_id, and
-- the returned jsonb shape.

CREATE OR REPLACE FUNCTION permanent_pickup_slot(
  p_picking_user_id uuid,
  p_assigned_block_ids uuid[],
  p_skipped_block_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_home_house_id text;
  v_assigned_count integer;
  v_skipped_count integer;
BEGIN
  SELECT home_house_id
    INTO v_home_house_id
  FROM users
  WHERE user_id = p_picking_user_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  -- Harnwell training invariant (AGENTS #1) guards every block this call
  -- touches — both the seats being claimed and the seats being re-flagged.
  IF EXISTS (
    SELECT 1
    FROM shift_blocks sb
    WHERE sb.block_id = ANY (
        COALESCE(p_assigned_block_ids, ARRAY[]::uuid[])
        || COALESCE(p_skipped_block_ids, ARRAY[]::uuid[])
      )
      AND sb.house_id = 'harnwell'
      AND v_home_house_id <> 'harnwell'
  ) THEN
    RAISE EXCEPTION 'harnwell_training_required';
  END IF;

  -- Assigned weeks: claim ONE seat per block. Invariant #5 — a worker occupies at most one
  -- seat of a 30-minute block, so a block with two permanent-drop vacancies yields one seat
  -- here and leaves the other in the permanent feed for the next picker.
  --
  -- Race-safe on two levels (ARCH §7.2 step 6, §10.9): SKIP LOCKED steps over a seat a
  -- concurrent pickup/claim already holds uncommitted, and the status/vacancy_origin
  -- predicates (re-checked when the lock is taken, and again by the outer UPDATE) drop a
  -- seat that a committed transaction has since taken. Either way the loser of the race
  -- gets a smaller assigned_count, never someone else's seat.
  WITH candidate_blocks AS MATERIALIZED (
    SELECT DISTINCT sba.block_id
    FROM shift_block_assignments sba
    WHERE sba.block_id = ANY (COALESCE(p_assigned_block_ids, ARRAY[]::uuid[]))
      AND sba.status = 'vacant'
      AND sba.vacancy_origin = 'permanent_drop'
  ),
  chosen AS MATERIALIZED (
    SELECT seat.assignment_id
    FROM candidate_blocks cb
    CROSS JOIN LATERAL (
      SELECT a.assignment_id
      FROM shift_block_assignments a
      WHERE a.block_id = cb.block_id
        AND a.status = 'vacant'
        AND a.vacancy_origin = 'permanent_drop'
      ORDER BY a.assignment_id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) seat
  )
  UPDATE shift_block_assignments sba
  SET
    user_id = p_picking_user_id,
    status = 'claimed',
    vacancy_origin = 'none',
    is_cross_house_pickup = (sb.house_id <> v_home_house_id),
    source_house_id = CASE
      WHEN sb.house_id <> v_home_house_id THEN v_home_house_id
      ELSE NULL
    END
  FROM chosen, shift_blocks sb
  WHERE sba.assignment_id = chosen.assignment_id
    AND sb.block_id = sba.block_id
    AND sba.status = 'vacant'
    AND sba.vacancy_origin = 'permanent_drop';

  GET DIAGNOSTICS v_assigned_count = ROW_COUNT;

  -- Skipped weeks (hours-cap / time-conflict): re-flag ONE seat per block OFF
  -- permanent_drop in the SAME transaction. It stays vacant (so weekly_open_shifts_feed
  -- still surfaces it within the 30-day horizon and it undergoes standard weekly
  -- escalation), but it leaves permanent_openings_feed (which filters
  -- vacancy_origin = 'permanent_drop') and can no longer be permanently re-picked-up. This
  -- is the §8.4.3 / ARCH §7.2-step-8 guarantee: after any pickup the slot leaves the
  -- permanent feed regardless of completeness, and "partial pickups are final." One seat
  -- per block scopes that retirement to the slot actually being picked up — a co-tenant's
  -- independent permanent drop on the same block stays in the permanent feed. Same
  -- SKIP LOCKED + predicate race guards as the assigned pass.
  WITH candidate_blocks AS MATERIALIZED (
    SELECT DISTINCT sba.block_id
    FROM shift_block_assignments sba
    WHERE sba.block_id = ANY (COALESCE(p_skipped_block_ids, ARRAY[]::uuid[]))
      AND sba.status = 'vacant'
      AND sba.vacancy_origin = 'permanent_drop'
  ),
  chosen AS MATERIALIZED (
    SELECT seat.assignment_id
    FROM candidate_blocks cb
    CROSS JOIN LATERAL (
      SELECT a.assignment_id
      FROM shift_block_assignments a
      WHERE a.block_id = cb.block_id
        AND a.status = 'vacant'
        AND a.vacancy_origin = 'permanent_drop'
      ORDER BY a.assignment_id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ) seat
  )
  UPDATE shift_block_assignments sba
  SET vacancy_origin = 'temporary_drop'
  FROM chosen
  WHERE sba.assignment_id = chosen.assignment_id
    AND sba.status = 'vacant'
    AND sba.vacancy_origin = 'permanent_drop';

  GET DIAGNOSTICS v_skipped_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'assigned_count', v_assigned_count,
    'skipped_count', v_skipped_count
  );
END;
$$;

COMMENT ON FUNCTION permanent_pickup_slot(uuid, uuid[], uuid[]) IS
  'BSpec §8.4.3 / ARCH §7.2 permanent pickup commit. Claims at most ONE still-vacant '
  'permanent_drop seat per block (LATERAL LIMIT 1 FOR UPDATE SKIP LOCKED), so a multi-staff '
  'desk holding two permanently dropped seats on the same 30-minute block never puts the '
  'picker on both (invariant #5) and concurrent pickers split the seats. Re-flags one seat '
  'per skipped block to temporary_drop, leaving a co-tenant''s independent drop in the '
  'permanent feed. assigned_count / skipped_count are therefore counts of OCCURRENCES, '
  'which is what the pickup evaluator and the UI summary assume. Raises user_inactive, '
  'harnwell_training_required.';

-- rollback:
-- (re-apply the permanent_pickup_slot body from 20260531000001 — bare set-updates on
--  block_id = ANY(...) with no per-block LIMIT)
