-- Closing a coverage request as "Allied secured" or "I can cover it" now writes the
-- schedule, not just the request row.
--
-- Stakeholder decision (2026-08-07). Before this, `close_allied_coverage_request` only
-- ever touched `allied_coverage_requests` itself (closed_at/outcome/close_note) -- the
-- desk's `shift_block_assignments` rows stayed exactly as they were, still vacant, no
-- matter which outcome was recorded. A manager who tapped "Allied secured" had to then
-- separately go build the schedule by hand, and a self-covering RSM was never actually
-- put on the desk at all.
--
-- Two of the four outcomes now auto-staff the request's window:
--   - allied_secured        -> the Allied contractor account is assigned every
--                              currently-vacant block in the window.
--   - covered_internally,
--     ONLY when p_assign_self -> the ACTING manager (p_user_id) is assigned every
--                              currently-vacant block in the window. p_assign_self is a
--                              new, separate flag from the outcome itself: the mobile
--                              Coverage sheet's dedicated "I can cover it" action passes
--                              true; the generic "Covered internally" outcome row (used
--                              when someone else covered it, or on web, which has no
--                              distinct self-cover control) passes the default false and
--                              leaves the schedule untouched, exactly like desk_unstaffed
--                              and no_longer_needed always do.
--
-- SCOPE: every block in [window_start_at, window_end_at) at the request's house that is
-- CURRENTLY status = 'vacant'. A block a float or another claim already covered since the
-- request opened is left alone -- this mirrors the coverage-floor philosophy already in
-- this system (AGENTS.md "[Coverage]"): fill what is actually empty, touch nothing that
-- is not.
--
-- MECHANISM: delegates the actual write to `admin_assign_worker` (this_week scope,
-- p_override_advisories = true -- the manager already committed by tapping the action;
-- there is no confirm-dialog step in this flow) rather than reimplementing seat-picking,
-- concurrency handling, or authorization here. This is deliberate and load-bearing:
-- `admin_assign_worker` already carries the exact two invariants this feature must
-- respect and must NOT reimplement with a looser check:
--   1. The Harnwell training invariant (`enforce_harnwell_assignment_training`, fires as
--      a trigger on the write itself, so it holds no matter which caller reaches it).
--   2. An RSM assigned to a desk may only ever be assigned to THEIR OWN house's desk
--      (`v_is_rsm` is scoped to the RSM role's OWN house, not `home_house_id`, and is
--      NOT the same as `user_can_build_schedule`, which is cross-house for hm/bm/rsm).
--      Stakeholder note (2026-08-07): "You can never have an RSM of one house covering
--      for another." Routing the self-assign write through `admin_assign_worker` is what
--      makes this hold for free -- do not replace this call with a direct
--      `shift_block_assignments` UPDATE gated only on `user_can_build_schedule`, which
--      would silently reopen exactly that gap for the covered_internally path.
-- The Allied contractor is exempt from both of the above (`user_is_allied_contractor`),
-- by design (20260805000002): a procured vendor has no home desk and no training
-- requirement, so it may be assigned to any house, including Harnwell.
--
-- FAILURE MODE: if `admin_assign_worker` raises (e.g. `cross_house_not_supported` for a
-- self-cover attempt outside the acting manager's own house), the whole close aborts and
-- the coverage request stays open -- deliberately atomic. Recording an outcome without
-- the schedule actually reflecting it would be worse than a rejected close: it would read
-- as done to a manager checking the Archive tab and to hours approval.

DROP FUNCTION IF EXISTS close_allied_coverage_request(uuid, uuid, allied_coverage_outcome, text, timestamptz);

CREATE OR REPLACE FUNCTION close_allied_coverage_request(
  p_request_id  uuid,
  p_user_id     uuid,
  p_outcome     allied_coverage_outcome,
  p_note        text,
  p_now         timestamptz,
  p_assign_self boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req             allied_coverage_requests;
  v_assignee_id     uuid;
  v_target_block_ids uuid[];
  -- The Allied contractor's fixed account id (20260805000002). Load-bearing constant;
  -- do not change without changing every other reference to it.
  v_allied_user_id  CONSTANT uuid := 'a111ed00-0000-4000-8000-000000000001';
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_req FROM allied_coverage_requests
  WHERE request_id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF NOT (user_can_build_schedule(p_user_id, v_req.house_id)
          OR user_is_admin(p_user_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_req.closed_at IS NOT NULL THEN
    RETURN jsonb_build_object('closed', false, 'reason', 'already_closed');
  END IF;

  -- A desk that went empty is an incident. Force the reporter to say what happened;
  -- an unexplained 'desk_unstaffed' is the row nobody can act on later.
  IF p_outcome = 'desk_unstaffed'::allied_coverage_outcome
     AND (p_note IS NULL OR btrim(p_note) = '') THEN
    RAISE EXCEPTION 'note_required';
  END IF;

  -- ---- Auto-staff the schedule for the two "someone now covers this" cases ----------
  v_assignee_id :=
    CASE
      WHEN p_outcome = 'allied_secured'::allied_coverage_outcome THEN v_allied_user_id
      WHEN p_outcome = 'covered_internally'::allied_coverage_outcome AND p_assign_self THEN p_user_id
      ELSE NULL
    END;

  IF v_assignee_id IS NOT NULL THEN
    SELECT array_agg(sb.block_id)
      INTO v_target_block_ids
    FROM shift_blocks sb
    WHERE sb.house_id = v_req.house_id
      AND sb.block_start_at >= v_req.window_start_at
      AND sb.block_start_at < v_req.window_end_at
      AND sb.voided_at IS NULL
      AND EXISTS (
        SELECT 1 FROM shift_block_assignments sba
        WHERE sba.block_id = sb.block_id AND sba.status = 'vacant'
      );

    -- Every block in the window may already be covered by something else (a float, a
    -- claim, another manager) since the request opened -- nothing to assign, and that is
    -- fine; the outcome still records below. admin_assign_worker itself re-checks under
    -- lock at write time (SKIP LOCKED + re-asserted predicate), so this pre-filter is an
    -- optimization, not the only guard against overwriting someone else's seat.
    IF v_target_block_ids IS NOT NULL AND array_length(v_target_block_ids, 1) > 0 THEN
      PERFORM admin_assign_worker(
        p_user_id,          -- operator: the acting manager, already authorized above
        v_target_block_ids,
        v_assignee_id,
        'this_week',
        true,                -- override advisories: the manager already committed
        p_now
      );
    END IF;
  END IF;

  UPDATE allied_coverage_requests
  SET closed_at  = p_now,
      closed_by  = p_user_id,
      outcome    = p_outcome,
      close_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
      -- Closing implies acknowledgement if it had not happened yet.
      acknowledged_at = COALESCE(acknowledged_at, p_now),
      acknowledged_by = COALESCE(acknowledged_by, p_user_id)
  WHERE request_id = p_request_id;

  UPDATE notifications
  SET acknowledged_at = p_now
  WHERE type = 'hmod_urgent'::notification_type
    AND payload ->> 'request_id' = p_request_id::text
    AND acknowledged_at IS NULL;

  RETURN jsonb_build_object('closed', true);
END;
$$;

REVOKE ALL ON FUNCTION close_allied_coverage_request(uuid, uuid, allied_coverage_outcome, text, timestamptz, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION close_allied_coverage_request(uuid, uuid, allied_coverage_outcome, text, timestamptz, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION close_allied_coverage_request(uuid, uuid, allied_coverage_outcome, text, timestamptz, boolean) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS close_allied_coverage_request(uuid, uuid, allied_coverage_outcome, text, timestamptz, boolean);
-- Restore close_allied_coverage_request(uuid, uuid, allied_coverage_outcome, text, timestamptz) from 20260729000010_allied_coverage_ladder.sql.
