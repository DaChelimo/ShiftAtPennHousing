-- Migration: give the orchestrator set-based, launch-gated discovery queries
-- (cost audit F-04, F-06, F-10, F-18).
--
-- The orchestrator-tick Edge Function runs every minute, forever. It was the one
-- function in the system with an N+1, and its discovery queries did the cheap filtering
-- LAST. Three separate problems, all fixed here in SQL so the Edge Function becomes the
-- thin wrapper every other function already is.
--
-- ---------------------------------------------------------------------------
-- F-04 -- the vacant-seat scan had no house-launch filter.
--
-- `grep -n "launch" supabase/functions/orchestrator-tick/index.ts` returned nothing.
-- The staggered-launch gate (houses.launch_state, house_is_live, is_staggered_launch_
-- enabled -- 20260712000001) existed and the orchestrator never consulted it. Under a
-- staggered launch every not-yet-live house still has generated blocks whose seats are
-- 100% vacant, so the scan returned them, paid three round trips per row, and fired
-- broadcast -> float_lookup -> hmod_notify_allied against desks nobody has opened.
--
-- That second consequence is the reason this is not purely a cost fix: an Allied page
-- for a dark desk is a real page to a real person. PRODUCT DECISION (2026-07-26): skip
-- pre-launch houses ENTIRELY rather than run the chain and suppress notifications. A
-- desk that is not launched has nobody to page.
--
-- The gate is `house_is_live(house_id)`, which is already the single source of truth
-- both platforms consult. Its master switch means this is a NO-OP in every existing
-- environment: when system_config('staggered_launch_enabled') is absent or false --
-- the default, and what every dev seed and the whole test suite sees -- house_is_live
-- returns true for every real house and the scan behaves exactly as before.
--
-- ---------------------------------------------------------------------------
-- F-06 -- processNoAckFloats scanned every pending float, then N+1'd over them.
--
-- The Edge Function selected EVERY pending, unacknowledged, undeclined float with no
-- time bound at all, then issued one loadAssignmentBlocks round trip PER float, and
-- only THEN applied the lookahead filter client-side. The cheap temporal filter that
-- eliminates almost every row was being applied after paying a round trip for each one.
-- The code comment claimed it was a "pre-filter by lookahead", which the query did not
-- do.
--
-- pending_floats_due_for_no_ack pushes the whole thing into one indexed query: it joins
-- destination_assignment_ids through to shift_blocks and returns only floats whose
-- EARLIEST destination block starts within the lookahead. Same set the loop computed,
-- one round trip instead of 1 + N.
--
-- This does NOT touch the no-takeback invariant. process_no_ack_float still re-validates
-- everything under FOR UPDATE; only the DISCOVERY of candidates gets cheaper.
--
-- ---------------------------------------------------------------------------
-- F-10 -- swap expiry ran twice a minute from two independent schedulers.
--
-- The `swap-expiry` cron (20260530000001, re-registered against app_now() by
-- 20260611000007) and orchestrator-tick's own expirePendingSwaps do the identical
-- UPDATE every minute; whichever runs second updates zero rows. The Edge Function copy
-- is also strictly more expensive, because its .select('swap_id') forces a RETURNING
-- and ships the rows back purely to populate a counter.
--
-- Deleting the Edge Function copy outright is wrong: pg_cron is NOT installed on the
-- local stack (verified -- cron.job does not exist), so in development the Edge
-- Function copy is the ONLY thing that expires a swap, and manual orchestration depends
-- on it. So the function below self-configures: it expires swaps only when the cron job
-- is absent, and reports that it skipped otherwise. Production (with pg_cron) pays one
-- cheap catalogue lookup instead of a redundant UPDATE + RETURNING; development keeps
-- working unchanged.

-- ---------------------------------------------------------------------------
-- 1. Indexes for the every-minute predicates (F-18).
--
-- float_assignments' only index is (user_id, status) -- leading column user_id, which
-- the no-ack query does not constrain, so it was a seq scan every 60 seconds. This
-- partial index matches the predicate exactly and stays small: it indexes only the
-- live pending set, not the table's history.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS float_assignments_pending_unacked_idx
  ON float_assignments (float_id)
  WHERE status = 'pending'
    AND acknowledged_at IS NULL
    AND declined_at IS NULL;

-- Retention sweep support (see 20260726000005).
CREATE INDEX IF NOT EXISTS float_assignments_cleanup_idx
  ON float_assignments (expires_for_cleanup_at);

-- ---------------------------------------------------------------------------
-- 2. F-04 -- launch-gated vacant-seat discovery.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION orchestrator_vacant_seats(
  p_after timestamptz,
  p_through timestamptz
)
RETURNS TABLE (
  assignment_id uuid,
  block_id uuid,
  block_start_at timestamptz,
  house_id text,
  desk_covered boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sba.assignment_id,
    sb.block_id,
    sb.block_start_at,
    sb.house_id,
    -- Desk presence for the ESCALATION present-set. NOTE this includes 'allied' --
    -- unlike the pickup-lock present-set, which excludes it. The two sets are
    -- deliberately different and must not be collapsed (supabase/AGENTS.md, "Coverage
    -- lock"). Returned alongside the row so the Edge Function no longer needs a
    -- separate loadCoveredBlockIds round trip for the scan window; the CHECK itself is
    -- unchanged and still enforces the coverage-floor-of-one invariant (BSpec §5.4).
    EXISTS (
      SELECT 1
      FROM shift_block_assignments present
      WHERE present.block_id = sb.block_id
        AND present.status IN (
          'scheduled', 'claimed', 'floated_in', 'pending_float_in', 'allied'
        )
    ) AS desk_covered
  FROM shift_block_assignments sba
  JOIN shift_blocks sb USING (block_id)
  WHERE sba.status = 'vacant'
    -- Blocks retired by an admin config change are inert (20260702000007).
    AND sb.voided_at IS NULL
    AND sb.block_start_at > p_after
    AND sb.block_start_at <= p_through
    -- F-04: the launch gate. No-op when staggered launch is disabled.
    AND house_is_live(sb.house_id)
  ORDER BY sb.block_start_at ASC;
$$;

REVOKE ALL ON FUNCTION orchestrator_vacant_seats(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION orchestrator_vacant_seats(timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION orchestrator_vacant_seats(timestamptz, timestamptz) IS
  'Vacant seats the orchestrator should consider this tick, in [p_after, p_through]. '
  'Excludes voided blocks and -- cost audit F-04 -- houses that are not live under the '
  'staggered-launch gate, so the chain never escalates a desk nobody has opened. '
  'desk_covered carries the ESCALATION present-set (includes ''allied''); it is NOT the '
  'pickup-lock present-set. Service-role only.';

-- ---------------------------------------------------------------------------
-- 3. F-06 -- pending floats actually due for the no-ack pass.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pending_floats_due_for_no_ack(
  p_now timestamptz,
  p_lookahead_minutes integer
)
RETURNS TABLE (
  float_id uuid,
  earliest_destination_start timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fa.float_id,
    min(sb.block_start_at) AS earliest_destination_start
  FROM float_assignments fa
  JOIN shift_block_assignments sba
    ON sba.assignment_id = ANY (fa.destination_assignment_ids)
  JOIN shift_blocks sb
    ON sb.block_id = sba.block_id
  WHERE fa.status = 'pending'
    AND fa.acknowledged_at IS NULL
    AND fa.declined_at IS NULL
  GROUP BY fa.float_id
  -- The lookahead filter the Edge Function used to apply client-side, AFTER paying a
  -- round trip per float. Same comparison, same >: a float whose earliest destination
  -- block starts beyond the no-ack horizon is not yet due.
  HAVING min(sb.block_start_at) <= p_now + make_interval(mins => p_lookahead_minutes);
$$;

REVOKE ALL ON FUNCTION pending_floats_due_for_no_ack(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pending_floats_due_for_no_ack(timestamptz, integer) TO service_role;

COMMENT ON FUNCTION pending_floats_due_for_no_ack(timestamptz, integer) IS
  'Pending, unacknowledged, undeclined floats whose EARLIEST destination block starts '
  'within the no-ack lookahead. Cost audit F-06: replaces an unbounded scan plus one '
  'round trip per float with a single indexed query. process_no_ack_float still '
  're-validates under FOR UPDATE, so the no-takeback invariant is untouched. '
  'Service-role only.';

-- ---------------------------------------------------------------------------
-- 4. F-10 -- one swap-expiry owner, chosen automatically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION swap_expiry_is_cron_scheduled()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scheduled boolean := false;
BEGIN
  -- pg_cron may not be installed at all (it is not, on the local stack), in which case
  -- cron.job does not exist and this must not raise.
  IF to_regclass('cron.job') IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = $1)'
    INTO v_scheduled
    USING 'swap-expiry';
  RETURN COALESCE(v_scheduled, false);
EXCEPTION
  WHEN insufficient_privilege OR undefined_table OR invalid_schema_name THEN
    RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION expire_pending_swaps_if_uncronned(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired integer := 0;
BEGIN
  -- The cron owns this when it exists; running it here too is pure duplicated cost
  -- (F-10). Returning -1 lets the caller report "skipped" rather than "0 expired".
  IF swap_expiry_is_cron_scheduled() THEN
    RETURN -1;
  END IF;

  UPDATE swap_requests
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at <= p_now;

  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
EXCEPTION
  -- swap_requests is specified in the architecture but may not exist on a partially
  -- migrated branch. Keep the tick alive, as the Edge Function copy did.
  WHEN undefined_table THEN
    RETURN 0;
END;
$$;

REVOKE ALL ON FUNCTION swap_expiry_is_cron_scheduled() FROM PUBLIC;
REVOKE ALL ON FUNCTION expire_pending_swaps_if_uncronned(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION swap_expiry_is_cron_scheduled() TO service_role;
GRANT EXECUTE ON FUNCTION expire_pending_swaps_if_uncronned(timestamptz) TO service_role;

COMMENT ON FUNCTION expire_pending_swaps_if_uncronned(timestamptz) IS
  'Expire pending swaps, but ONLY when the swap-expiry pg_cron job is absent. Cost audit '
  'F-10: the cron and orchestrator-tick were both running the identical UPDATE every '
  'minute. The cron is the better owner (pure SQL, no EF invocation, no RETURNING '
  'egress); this keeps development working, where pg_cron is not installed. Returns -1 '
  'when it deferred to the cron, otherwise the number of rows expired.';

-- rollback:
-- DROP FUNCTION IF EXISTS expire_pending_swaps_if_uncronned(timestamptz);
-- DROP FUNCTION IF EXISTS swap_expiry_is_cron_scheduled();
-- DROP FUNCTION IF EXISTS pending_floats_due_for_no_ack(timestamptz, integer);
-- DROP FUNCTION IF EXISTS orchestrator_vacant_seats(timestamptz, timestamptz);
-- DROP INDEX IF EXISTS float_assignments_cleanup_idx;
-- DROP INDEX IF EXISTS float_assignments_pending_unacked_idx;
