-- Migration: claim_open_shift picks ANY still-open seat on the block (BSpec §5.3 FCFS).
--
-- BUG. A multi-staff desk (Harnwell 2, Quad 3) can have several seats vacant for the same
-- span. `worker_open_shifts` returns one row per vacant SEAT, and the client coalesces
-- same-span lanes into a single "N open" card carrying ONE representative lane's
-- assignment_ids (Coalesce.kt: `sameSpan.first()`). Every client coalesces the same
-- snapshot the same way, so two workers tapping Claim on a "2 open" card both send the
-- SAME assignment_id. The first won; the second got `shift_unavailable` even though a
-- seat on that block was still open. Reproduced on the local DB (Harnwell Sat 05:30, two
-- vacant seats, second claimer rejected).
--
-- FIX. The claim is addressed at a SEAT but is really a claim on the BLOCK: which lane a
-- worker lands on carries no meaning (the seats of a block are interchangeable). So
-- resolve the block from p_assignment_id, run the guards (all of which are block-scoped
-- already), then pick any still-open seat on that block with FOR UPDATE SKIP LOCKED and
-- claim that one. Consequences:
--   * 2 seats + 2 concurrent claimers → both succeed, one seat each.
--   * 1 seat + 2 concurrent claimers → the first to lock the row wins; the loser gets
--     `shift_unavailable` ("Someone else picked up this shift first"), unchanged.
--   * a claim against a stale snapshot (the named seat was taken, another is free) now
--     lands instead of failing.
-- SKIP LOCKED is what makes it true FCFS under real concurrency: a competing
-- transaction's uncommitted seat is skipped rather than waited on, so claimer 2 takes the
-- free seat immediately instead of blocking and then failing. Same mechanism as
-- claim_break_blocks (20260615000001).
--
-- The candidate set is restricted to seats of the SAME FEED as the requested one
-- (`vacancy_origin = 'permanent_drop'` → the §5.1 permanent-openings feed, everything
-- else → the weekly feed), because that is exactly what the card's "N open" badge counts
-- (the client merge key includes `feed`). A weekly claim therefore never silently
-- consumes a permanent opening's seat.
--
-- The RPC returns the assignment_id it ACTUALLY claimed, which may differ from the one
-- requested. Both callers already propagate the returned id (claim-shift EF response →
-- web `claimedId`; mobile re-reads its snapshot), so no client change is needed.
--
-- Everything else is byte-identical to 20260627000001: the coverage-conditional T-2h gate
-- (§5.4/§5.5), Harnwell training (#1), per-block time conflict, weekly hard cap (§9.2).

CREATE OR REPLACE FUNCTION claim_open_shift(
  p_assignment_id uuid,
  p_user_id uuid,
  p_as_of timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target record;
  v_claimer record;
  v_week_start_date date;
  v_week_start_at timestamptz;
  v_week_end_at timestamptz;
  v_current_blocks integer;
  v_cap record;
  v_seat uuid;
  v_claimed_assignment_id uuid;
BEGIN
  -- The requested seat only names the BLOCK and the FEED; it need not still be vacant.
  SELECT
    sba.assignment_id,
    sba.status,
    (sba.vacancy_origin = 'permanent_drop') AS permanent_feed,
    sb.block_id,
    sb.house_id,
    sb.block_start_at,
    sb.coverage_locked_at
  INTO v_target
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.assignment_id = p_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_unavailable';
  END IF;

  SELECT user_id, home_house_id, is_active
  INTO v_claimer
  FROM users
  WHERE user_id = p_user_id;

  IF NOT FOUND OR v_claimer.is_active = false THEN
    RAISE EXCEPTION 'user_inactive';
  END IF;

  IF v_target.block_start_at <= p_as_of THEN
    RAISE EXCEPTION 'past_t2h_cutoff';
  END IF;

  -- §5.4/§5.5 coverage-conditional lock: a one-way locked block is never claimable; an
  -- unlocked block within T-2h is claimable only while a real worker is still on the desk
  -- (block_has_present_worker, allied excluded).
  IF v_target.coverage_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'past_t2h_cutoff';
  END IF;

  IF v_target.block_start_at <= p_as_of + interval '2 hours'
     AND NOT block_has_present_worker(v_target.block_id) THEN
    RAISE EXCEPTION 'past_t2h_cutoff';
  END IF;

  IF v_target.house_id = 'harnwell' AND v_claimer.home_house_id <> 'harnwell' THEN
    RAISE EXCEPTION 'cross_house_ineligible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM shift_block_assignments existing
    JOIN shift_blocks existing_block USING (block_id)
    WHERE existing.user_id = p_user_id
      AND existing.status <> 'vacant'
      AND existing.status <> 'allied'
      AND existing_block.block_start_at = v_target.block_start_at
  ) THEN
    RAISE EXCEPTION 'time_conflict';
  END IF;

  -- §9.2: calendar week (Monday 00:00 → Sunday 23:59) in America/New_York.
  v_week_start_date := date_trunc(
    'week',
    v_target.block_start_at AT TIME ZONE 'America/New_York'
  )::date;
  v_week_start_at := v_week_start_date::timestamp AT TIME ZONE 'America/New_York';
  v_week_end_at := (v_week_start_date + 7)::timestamp AT TIME ZONE 'America/New_York';

  SELECT COUNT(*)::integer
  INTO v_current_blocks
  FROM shift_block_assignments existing
  JOIN shift_blocks existing_block USING (block_id)
  WHERE existing.user_id = p_user_id
    AND existing.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
    AND existing_block.block_start_at >= v_week_start_at
    AND existing_block.block_start_at < v_week_end_at;

  SELECT *
  INTO v_cap
  FROM effective_weekly_cap(v_week_start_date, v_target.block_start_at);

  IF v_cap.cap_enforcement = 'hard'
     AND ((v_current_blocks + 1)::numeric * 0.5) > v_cap.hours_cap THEN
    RAISE EXCEPTION 'hard_cap_exceeded';
  END IF;

  -- Any still-open seat of the same feed on this block. The requested seat is preferred
  -- (so a single-seat block behaves exactly as before); SKIP LOCKED steps over a seat a
  -- competing claim already holds, so concurrent claimers split the seats.
  SELECT a.assignment_id
  INTO v_seat
  FROM shift_block_assignments a
  WHERE a.block_id = v_target.block_id
    AND a.status = 'vacant'
    AND (a.vacancy_origin = 'permanent_drop') = v_target.permanent_feed
  ORDER BY (a.assignment_id = p_assignment_id) DESC, a.assignment_id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_seat IS NULL THEN
    RAISE EXCEPTION 'shift_unavailable';
  END IF;

  UPDATE shift_block_assignments
  SET status = 'claimed',
      user_id = p_user_id,
      vacancy_origin = 'none',
      is_cross_house_pickup = (v_claimer.home_house_id <> v_target.house_id),
      source_house_id = CASE
        WHEN v_claimer.home_house_id <> v_target.house_id THEN v_claimer.home_house_id
        ELSE NULL
      END
  WHERE assignment_id = v_seat
    AND status = 'vacant'
  RETURNING assignment_id INTO v_claimed_assignment_id;

  IF v_claimed_assignment_id IS NULL THEN
    RAISE EXCEPTION 'shift_unavailable';
  END IF;

  RETURN v_claimed_assignment_id;
END;
$$;

COMMENT ON FUNCTION claim_open_shift(uuid, uuid, timestamptz) IS
  'BSpec §5.3 temporary claim. The assignment_id names the BLOCK and the feed; the RPC '
  'claims any still-open seat of that feed on the block (FOR UPDATE SKIP LOCKED = FCFS), '
  'so concurrent claimers on a multi-staff desk split the open seats instead of colliding '
  'on the coalesced card''s representative lane. Guards: active user, coverage-conditional '
  'T-2h lock (§5.4/§5.5), Harnwell training (#1), per-block time conflict, weekly hard cap '
  '(§9.2). Returns the assignment_id actually claimed, which may differ from the one '
  'requested. Raises shift_unavailable when the block has no open seat left.';

-- rollback:
-- (re-apply the claim_open_shift body from 20260627000001 — seat-scoped UPDATE on
--  p_assignment_id, no block-scoped seat pick)
