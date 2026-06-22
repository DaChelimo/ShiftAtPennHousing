-- Migration: RSM role — powers, visibility, routing (part 2 of 2).
--
-- The enum value 'rsm' is added (committed) by 20260617000005. This file wires it
-- into the authorization model. An RSM (Residential Services Manager, BSpec §2.3a):
--   * is a university employee BELOW the HM and ABOVE the SM;
--   * holds EVERY power an HM holds within their own house — schedule build /
--     override, people admin, leave, weekly-cap, force-trigger — EXCEPT serving
--     as HMOD (the rotor stays hm/bm-only; this file never touches it);
--   * holds shifts like an HM (claim pool + builder roster), but like an HM is
--     never auto-floated and never receives broadcast (admin, not a broadcast SW);
--   * can VIEW every house's live schedule read-only (cross-house visibility),
--     while every WRITE remains scoped to their own house (own-house gate via
--     user_can_build_schedule / user_has_house_admin_role, both of which match on
--     scope_house_id, so an RSM scoped to house A can never write house B).
--
-- Routing change (BSpec §10.1, per stakeholder decision): during HM working hours
-- a coverage/Allied-procurement notification now routes to the house's RSM, not
-- the HM. The HM only receives such notifications in their HMOD capacity (off
-- hours / weekends). resolve_rsm_for_house walks the RSM's leave chain, so when
-- the RSM is on leave their designated replacement (the HM, then BM) covers; if
-- the house has no acting RSM at all, the notification falls back to the HMOD on
-- duty (unchanged terminal: project administrator).
--
-- NY tz throughout (invariant #6). Idempotent re-application; RLS in-file.

-- ============================================================
-- 0. Scope constraint — an RSM role row must be house-scoped, like sm/hm/bm.
-- Without this, inserting ('…','rsm','<house>') fails the original CHECK (which
-- listed only sm/hm/bm), and a NULL scope is (correctly) rejected.
-- ============================================================
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_scope_required_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_scope_required_check
  CHECK (
    role = 'sw' OR
    (role IN ('sm', 'hm', 'bm', 'rsm') AND scope_house_id IS NOT NULL)
  );

-- ============================================================
-- 1. Own-house admin gate — RSM joins hm/bm. Gates people admin (users /
-- user_roles SELECT), preference / period-target writes, weekly-cap, leave UI.
-- Scoped: matches only the RSM's own scope_house_id.
-- ============================================================
CREATE OR REPLACE FUNCTION user_has_house_admin_role(
  check_user_id uuid,
  check_house_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = check_user_id
      AND role IN ('hm', 'bm', 'rsm')
      AND scope_house_id = check_house_id
  );
$$;

-- ============================================================
-- 2. Schedule-builder gate — RSM joins sm/hm/bm. Gates build / publish /
-- override and the destination-house inbound-float READ surfaces. Scoped.
-- ============================================================
CREATE OR REPLACE FUNCTION user_can_build_schedule(check_user_id uuid, check_house_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = check_user_id
      AND role IN ('sm', 'hm', 'bm', 'rsm')
      AND scope_house_id = check_house_id
  );
$$;

-- ============================================================
-- 3. Cross-house read predicate — does this user hold an RSM role anywhere?
-- An RSM may READ every house's live schedule (BSpec §2.3a). Used by the
-- schedule-visibility SELECT policies below as an additive, read-only OR clause.
-- House-agnostic by design: the RSM's view spans all houses; their WRITE gates
-- (1 + 2) remain scope-matched, so this never widens write authority.
-- ============================================================
CREATE OR REPLACE FUNCTION user_is_rsm(check_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = check_user_id
      AND role = 'rsm'
  );
$$;

REVOKE ALL ON FUNCTION user_is_rsm(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_is_rsm(uuid) TO authenticated, service_role;

-- ============================================================
-- 4. Broadcast exclusion — RSM is admin, not a broadcast SW (like hm/bm). Keep
-- them out of broadcast subscription at both write points.
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_hm_bm_broadcast_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_active = false AND NEW.broadcast_subscribed = true THEN
    NEW.broadcast_subscribed = false;
  END IF;

  IF NEW.broadcast_subscribed = true AND EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = NEW.user_id
      AND role IN ('hm', 'bm', 'rsm')
  ) THEN
    RAISE EXCEPTION 'HMs, RSMs and BMs cannot subscribe to broadcast notifications'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION clear_broadcast_subscription_on_admin_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role IN ('hm', 'bm', 'rsm') THEN
    UPDATE users
    SET broadcast_subscribed = false
    WHERE user_id = NEW.user_id
      AND broadcast_subscribed = true;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 5. Cross-house schedule visibility (read-only) — add an `OR user_is_rsm(...)`
-- branch to the live-schedule / float SELECT policies so an RSM sees every
-- house's assignments and floats. The shift_blocks SELECT policy is already
-- `USING (true)` for all authenticated users, so it needs no change. Writes are
-- untouched (service-role RPCs + scope-matched gates), so this is read-only.
-- ============================================================
DROP POLICY IF EXISTS "authenticated users can select accessible assignments" ON shift_block_assignments;
CREATE POLICY "authenticated users can select accessible assignments" ON shift_block_assignments
  FOR SELECT
  TO authenticated
  USING (
    user_is_rsm(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = shift_block_assignments.block_id
        AND (
          EXISTS (
            SELECT 1
            FROM users
            WHERE users.user_id = auth.uid()
              AND users.home_house_id = shift_blocks.house_id
          )
          OR user_can_build_schedule(auth.uid(), shift_blocks.house_id)
        )
    )
  );

DROP POLICY IF EXISTS "builders can select related float assignments" ON float_assignments;
CREATE POLICY "builders can select related float assignments" ON float_assignments
  FOR SELECT
  TO authenticated
  USING (
    user_is_rsm(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM unnest(source_assignment_ids || destination_assignment_ids) AS related(assignment_id)
      JOIN shift_block_assignments sba
        ON sba.assignment_id = related.assignment_id
      JOIN shift_blocks sb
        ON sb.block_id = sba.block_id
      WHERE user_can_build_schedule(auth.uid(), sb.house_id)
    )
  );

DROP POLICY IF EXISTS "builders can select destination float exclusions" ON float_exclusions;
CREATE POLICY "builders can select destination float exclusions" ON float_exclusions
  FOR SELECT
  TO authenticated
  USING (
    user_is_rsm(auth.uid())
    OR user_can_build_schedule(auth.uid(), destination_house_id)
  );

-- ============================================================
-- 6. resolve_rsm_for_house — the acting RSM for a house at a moment, walking the
-- RSM's leave chain (RSM → HM → BM …) exactly as resolve_hm_for_house does for
-- the HM. Returns NULL when the house has no RSM role holder or the whole chain
-- resolves out (on leave with no active terminal).
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_rsm_for_house(
  p_house_id text,
  p_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rsm_user_id uuid;
  v_resolved    uuid;
BEGIN
  FOR v_rsm_user_id IN
    SELECT user_id
    FROM user_roles
    WHERE role = 'rsm'
      AND scope_house_id = p_house_id
  LOOP
    v_resolved := resolve_hm_for_user(v_rsm_user_id, p_at);
    IF v_resolved IS NOT NULL THEN
      RETURN v_resolved;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION resolve_rsm_for_house(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_rsm_for_house(text, timestamptz) TO service_role;

-- ============================================================
-- 7. In-hours notification routing → RSM, not HM (BSpec §10.1, stakeholder
-- decision). Both urgent paths (the normal escalation tick + the no-ack
-- handler) change ONLY their in-HM-hours branch: resolve_rsm_for_house with
-- target 'rsm', falling back to the HMOD on duty when the house has no acting
-- RSM. Everything else (the rolled-back/claim bookkeeping, source-side
-- reconciliation, the C3a project-administrator terminal + RAISE WARNING) is
-- preserved verbatim from 20260528000025.
-- ============================================================
CREATE OR REPLACE FUNCTION process_hmod_notify_allied_step(
  p_block_id uuid,
  p_house_id text,
  p_block_start_at timestamptz,
  p_now timestamptz,
  p_reason text DEFAULT 'escalation_chain'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed_count       integer;
  v_recipient_user_id   uuid;
  v_target              text;
  v_admin_id            uuid;
BEGIN
  INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
  VALUES (p_block_id, 'hmod_notify_allied', 'fired', p_now, p_now)
  ON CONFLICT (block_id, step_name) DO NOTHING;

  GET DIAGNOSTICS v_claimed_count = ROW_COUNT;

  IF v_claimed_count = 0 THEN
    UPDATE block_step_status
    SET status     = 'fired',
        fired_at   = p_now,
        updated_at = p_now
    WHERE block_id  = p_block_id
      AND step_name = 'hmod_notify_allied'
      AND status    = 'rolled_back';

    GET DIAGNOSTICS v_claimed_count = ROW_COUNT;
  END IF;

  IF v_claimed_count = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'recipient_user_id', NULL, 'target', NULL);
  END IF;

  -- BSpec §10.1: during HM working hours the in-house contact is the RSM, not the
  -- HM. The HM is only reached in their HMOD capacity (the ELSE branch). When the
  -- house has no acting RSM, fall back to the HMOD on duty.
  IF is_hm_working_time(p_now) AND is_hm_working_time(p_block_start_at) THEN
    v_recipient_user_id := resolve_rsm_for_house(p_house_id, p_now);
    v_target := 'rsm';
    IF v_recipient_user_id IS NULL THEN
      v_recipient_user_id := resolve_hmod_on_duty(p_now);
      v_target := 'hmod';
    END IF;
  ELSE
    v_recipient_user_id := resolve_hmod_on_duty(p_now);
    v_target := 'hmod';
  END IF;

  IF v_recipient_user_id IS NULL THEN
    -- C3a: fall back to the project administrator terminal.
    SELECT config_value::uuid INTO v_admin_id
    FROM system_config
    WHERE config_key = 'project_administrator_user_id';

    IF v_admin_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM users WHERE user_id = v_admin_id AND is_active) THEN
      v_recipient_user_id := v_admin_id;
      v_target := 'project_admin';
    ELSE
      -- BSpec §2.6: surface the missing terminal rather than dropping it.
      RAISE WARNING 'process_hmod_notify_allied_step: no recipient for block % (house %); set system_config.project_administrator_user_id to an active admin user_id',
        p_block_id, p_house_id;
      RETURN jsonb_build_object('claimed', true, 'recipient_user_id', NULL, 'target', v_target);
    END IF;
  END IF;

  INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
  VALUES (
    v_recipient_user_id,
    'hmod_urgent'::notification_type,
    p_now,
    jsonb_build_object(
      'target',         v_target,
      'reason',         p_reason,
      'block_id',       p_block_id,
      'house_id',       p_house_id,
      'block_start_at', p_block_start_at
    )
  );

  RETURN jsonb_build_object('claimed', true, 'recipient_user_id', v_recipient_user_id, 'target', v_target);
END;
$$;

REVOKE ALL ON FUNCTION process_hmod_notify_allied_step(uuid, text, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_hmod_notify_allied_step(uuid, text, timestamptz, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION process_no_ack_float(
  p_float_id uuid,
  p_now timestamptz,
  p_lookahead_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_float                            record;
  v_first_destination_block_id       uuid;
  v_first_destination_block_start_at timestamptz;
  v_destination_house_id             text;
  v_float_start_at                   timestamptz;
  v_float_end_at                     timestamptz;
  v_gap_rows_total                   integer;
  v_gap_rows_still_vacant            integer;
  v_hmod_rows                        integer;
  v_recipient_user_id                uuid;
  v_recipient_target                 text;
  v_admin_id                         uuid;
BEGIN
  SELECT * INTO v_float
  FROM float_assignments
  WHERE float_id = p_float_id
    AND status = 'pending'
    AND acknowledged_at IS NULL
    AND declined_at IS NULL
    AND no_ack_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('processed', false, 'reason', 'not_pending');
  END IF;

  SELECT min(sb.block_start_at), max(sb.block_start_at) + interval '30 minutes'
    INTO v_float_start_at, v_float_end_at
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids);

  IF v_float_start_at IS NULL THEN
    RETURN jsonb_build_object('processed', false, 'reason', 'no_destination_blocks');
  END IF;

  IF v_float_start_at > p_now + (p_lookahead_minutes || ' minutes')::interval THEN
    RETURN jsonb_build_object('processed', false, 'reason', 'outside_lookahead');
  END IF;

  SELECT sba.block_id, sb.block_start_at, sb.house_id
    INTO v_first_destination_block_id, v_first_destination_block_start_at, v_destination_house_id
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids)
  ORDER BY sb.block_start_at ASC
  LIMIT 1;

  -- 1. Void the float (recorded as a no-ack, NOT a decline).
  UPDATE float_assignments
  SET status = 'voided', no_ack_at = p_now
  WHERE float_id = p_float_id;

  -- 2. Destination blocks return to vacant (the original gap re-opens).
  UPDATE shift_block_assignments
  SET user_id = NULL, status = 'vacant', vacancy_origin = 'temporary_drop',
      is_float = false, source_house_id = NULL, parent_float_id = NULL
  WHERE assignment_id = ANY(v_float.destination_assignment_ids);

  -- 3. Exclude the unresponsive worker for this gap window.
  INSERT INTO float_exclusions (user_id, window_start_at, window_end_at, destination_house_id, reason)
  VALUES (v_float.user_id, v_float_start_at, v_float_end_at, v_destination_house_id, 'no_acknowledgment');

  -- 4. Roll back force-trigger pre-marks so the chain re-evaluates.
  IF v_float.initiated_by = 'force_triggered' THEN
    UPDATE block_step_status
    SET status = 'rolled_back', updated_at = p_now
    WHERE block_id IN (
      SELECT block_id FROM shift_block_assignments
      WHERE assignment_id = ANY(v_float.destination_assignment_ids)
    )
      AND step_name IN ('broadcast', 'float_lookup');
  END IF;

  -- 5. Source-side reconciliation.
  IF v_float.initiated_by = 'force_triggered' THEN
    SELECT count(*) FILTER (WHERE status = 'vacant'), count(*)
      INTO v_gap_rows_still_vacant, v_gap_rows_total
    FROM (
      SELECT status FROM shift_block_assignments
      WHERE parent_float_id = p_float_id
        AND assignment_id != ALL(v_float.source_assignment_ids)
        AND assignment_id != ALL(v_float.destination_assignment_ids)
      FOR UPDATE
    ) compensation;

    IF v_gap_rows_total = 0 OR v_gap_rows_still_vacant = v_gap_rows_total THEN
      UPDATE shift_block_assignments
      SET user_id = v_float.user_id, status = 'scheduled', vacancy_origin = 'none',
          is_float = false, source_house_id = NULL, parent_float_id = NULL
      WHERE assignment_id = ANY(v_float.source_assignment_ids);

      DELETE FROM shift_block_assignments
      WHERE parent_float_id = p_float_id
        AND status = 'vacant'
        AND assignment_id != ALL(v_float.source_assignment_ids)
        AND assignment_id != ALL(v_float.destination_assignment_ids);
    ELSE
      UPDATE shift_block_assignments
      SET user_id = NULL, status = 'vacant', vacancy_origin = 'displaced_decliner',
          is_float = false, source_house_id = NULL, parent_float_id = NULL
      WHERE assignment_id = ANY(v_float.source_assignment_ids);
    END IF;
  ELSE
    UPDATE shift_block_assignments
    SET user_id = v_float.user_id, status = 'scheduled', vacancy_origin = 'none',
        is_float = false, source_house_id = NULL, parent_float_id = NULL
    WHERE assignment_id = ANY(v_float.source_assignment_ids);
  END IF;

  -- 6. Claim hmod_notify_allied for EVERY destination block of the gap (one
  --    contiguous float => one notification, no per-block re-fire later).
  INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
  SELECT DISTINCT sb.block_id, 'hmod_notify_allied',
         'fired'::block_step_status_enum, p_now, p_now
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids)
  ON CONFLICT (block_id, step_name) DO NOTHING;

  GET DIAGNOSTICS v_hmod_rows = ROW_COUNT;

  IF v_hmod_rows > 0 THEN
    -- BSpec §10.1: in HM hours the contact is the RSM (HM only when HMOD).
    IF is_hm_working_time(p_now) AND is_hm_working_time(v_first_destination_block_start_at) THEN
      v_recipient_user_id := resolve_rsm_for_house(v_destination_house_id, p_now);
      v_recipient_target  := 'rsm';
      IF v_recipient_user_id IS NULL THEN
        v_recipient_user_id := resolve_hmod_on_duty(p_now);
        v_recipient_target  := 'hmod';
      END IF;
    ELSE
      v_recipient_user_id := resolve_hmod_on_duty(p_now);
      v_recipient_target  := 'hmod';
    END IF;

    -- C3a: project-administrator terminal fallback.
    IF v_recipient_user_id IS NULL THEN
      SELECT config_value::uuid INTO v_admin_id FROM system_config
      WHERE config_key = 'project_administrator_user_id';
      IF v_admin_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE user_id = v_admin_id AND is_active) THEN
        v_recipient_user_id := v_admin_id;
        v_recipient_target  := 'project_admin';
      END IF;
    END IF;

    IF v_recipient_user_id IS NOT NULL THEN
      INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
      VALUES (
        v_recipient_user_id, 'hmod_urgent'::notification_type, p_now,
        jsonb_build_object(
          'target', v_recipient_target, 'reason', 'float_no_acknowledgment',
          'block_id', v_first_destination_block_id, 'house_id', v_destination_house_id,
          'block_start_at', v_first_destination_block_start_at
        )
      );
    ELSE
      -- BSpec §2.6: the project administrator is the guaranteed terminal. If
      -- nothing resolved, surface it instead of silently dropping the event.
      RAISE WARNING 'process_no_ack_float: no notification recipient for block % (house %); set system_config.project_administrator_user_id to an active admin user_id',
        v_first_destination_block_id, v_destination_house_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'processed', true,
    'block_id', v_first_destination_block_id,
    'block_start_at', v_first_destination_block_start_at,
    'house_id', v_destination_house_id,
    'hmod_step_claimed', (v_hmod_rows > 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION process_no_ack_float(uuid, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_no_ack_float(uuid, timestamptz, integer) TO service_role;

-- rollback:
-- (restore the function/policy/constraint bodies from 20260527000003,
--  20260528000010, 20260528000025, 20260528000027, 20260527000004; drop
--  resolve_rsm_for_house and user_is_rsm; this migration is additive/idempotent)
