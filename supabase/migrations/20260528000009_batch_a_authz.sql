-- Batch A (part 1 of 2): release-blocking authorization hardening.
--   A1  — lock the block generators to service_role (F-03-001).
--   A2  — revoke PUBLIC execute on the mutating/data RPCs that take a
--          p_user_id / p_published_by and are SECURITY DEFINER, closing the
--          "any JWT can act as another user via direct PostgREST" hole
--          (F-04-001/002 + Phase-5 extension).
--   A2b — defense-in-depth identity check inside submit_preferences (F-04-002).
--
-- A3 (per-house publish + publish/generate UPSERT reconciliation) is a
-- separate forward migration.
--
-- Read-only feeds are intentionally LEFT PUBLIC: weekly_open_shifts_feed /
-- weekly_feed_for_house / is_assignment_claimable are SECURITY INVOKER and the
-- underlying shift_blocks / shift_block_assignments tables carry authenticated
-- SELECT RLS policies, so those feeds are the intended RLS-protected direct
-- read API. The two DEFINER feeds (permanent_openings_feed, effective_weekly_cap)
-- expose only vacancy / cap-policy data. Feed-routing hardening is deferred to
-- Phase 13 when the client's access pattern is concrete.

-- ============================================================
-- A1 — block generators are orchestrator-only.
-- ============================================================
REVOKE ALL ON FUNCTION generate_blocks_for_date(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_blocks_for_date(date) TO service_role;

REVOKE ALL ON FUNCTION generate_blocks_for_range(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_blocks_for_range(date, date) TO service_role;

-- ============================================================
-- A2b — identity check in submit_preferences (must precede the REVOKE so the
-- replaced body is what ends up with the narrowed ACL).
-- auth.uid() is NULL under service_role, so the Edge Function path — which
-- already verifies identity — is unaffected.
-- ============================================================
CREATE OR REPLACE FUNCTION submit_preferences(
  p_user_id uuid,
  p_period_id uuid,
  p_preferences jsonb,
  p_target_hours integer,
  p_opted_out boolean DEFAULT false
)
RETURNS TABLE (
  preferences_upserted integer,
  target_upserted integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preferences_upserted integer := 0;
  v_target_upserted integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'cannot submit preferences for another user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF jsonb_typeof(COALESCE(p_preferences, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'preferences must be an array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT preference_deadline_is_open(p_period_id) THEN
    RAISE EXCEPTION 'preference deadline has passed for period %', p_period_id
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO preferences (user_id, block_id, period_id, status)
  SELECT
    p_user_id,
    (entry.value ->> 'block_id')::uuid,
    p_period_id,
    (entry.value ->> 'status')::preference_status_enum
  FROM jsonb_array_elements(COALESCE(p_preferences, '[]'::jsonb)) AS entry(value)
  ON CONFLICT (user_id, block_id, period_id)
  DO UPDATE SET status = EXCLUDED.status;

  GET DIAGNOSTICS v_preferences_upserted = ROW_COUNT;

  INSERT INTO period_targets (user_id, period_id, target_hours, opted_out)
  VALUES (p_user_id, p_period_id, p_target_hours, COALESCE(p_opted_out, false))
  ON CONFLICT (user_id, period_id)
  DO UPDATE SET
    target_hours = EXCLUDED.target_hours,
    opted_out = EXCLUDED.opted_out;

  GET DIAGNOSTICS v_target_upserted = ROW_COUNT;

  RETURN QUERY SELECT v_preferences_upserted, v_target_upserted;
END;
$$;

-- ============================================================
-- A2 — revoke PUBLIC on the mutating RPCs; grant only service_role. The
-- Edge Functions (service_role) verify caller identity before invoking these.
-- ============================================================

-- Phase 4
REVOKE ALL ON FUNCTION publish_schedule(uuid) FROM PUBLIC;            -- null-operator bypass; A3 removes this overload
REVOKE ALL ON FUNCTION publish_schedule(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION publish_schedule_impl(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publish_schedule(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION submit_preferences(uuid, uuid, jsonb, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_preferences(uuid, uuid, jsonb, integer, boolean) TO service_role;

-- Phase 5
REVOKE ALL ON FUNCTION claim_open_shift(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_open_shift(uuid, uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION drop_shift(uuid[], uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION drop_shift(uuid[], uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION claim_hours_projection(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_hours_projection(uuid, uuid) TO service_role;

-- rollback:
-- GRANT EXECUTE ON FUNCTION generate_blocks_for_date(date) TO PUBLIC;  -- etc.
-- (and restore submit_preferences without the identity guard from 20260527000005)
