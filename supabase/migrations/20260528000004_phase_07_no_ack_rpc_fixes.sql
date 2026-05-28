-- Migration: Phase 07 atomic no-ack handler RPC — audit fixes A-1, A-2, B-3.
--
-- This migration CREATE OR REPLACEs process_no_ack_float() to address
-- three findings from the phase-07 strict audit. The fixes are
-- intentionally bundled because they all live inside the same plpgsql
-- function body. The migration also introduces two recipient-
-- resolution helpers (resolve_hm_for_user, resolve_hm_for_house) that
-- the no-ack RPC uses for the HMOD notification insert, and which the
-- broadcast / hmod chain-step RPCs in migrations 20260528000006 and
-- 20260528000007 reuse.
--
-- ----------------------------------------------------------------------
-- Fix A-1 — Source-side reconciliation branch
--
--     IF v_gap_rows_total > 0 AND v_gap_rows_still_vacant = v_gap_rows_total THEN
--       -- restore
--     ELSE
--       -- displace
--     END IF;
--
--   incorrectly DISPLACES the floater whenever `v_gap_rows_total = 0`
--   (force-trigger that did NOT drop the source below required
--   headcount and therefore created no compensation rows). Per ARCH
--   §4.5 #2 — "If still vacant: revert the floater's row from
--   pending_float_out back to scheduled" — a non-existent compensation
--   row is logically "still vacant"; nothing has been disrupted and
--   the floater must be restored. New condition:
--
--     IF v_gap_rows_total = 0 OR v_gap_rows_still_vacant = v_gap_rows_total THEN
--       -- restore
--     ELSE
--       -- displace
--     END IF;
-- ----------------------------------------------------------------------
-- Fix A-2 — Destination vacancy_origin
--
--   The destination block UPDATE set `vacancy_origin = 'displaced_decliner'`.
--   Per BSpec §3.3 the `displaced_decliner` enum value describes the
--   floater's now-vacant source seat (force-trigger + claimed-gap
--   case). The destination block on no-ack is the original gap
--   re-opening — `temporary_drop` is the correct value.
-- ----------------------------------------------------------------------
-- Fix B-3 — Compensation rows locked under FOR UPDATE
--
--   The compensation-row count query did NOT take row locks. A
--   concurrent claim between the SELECT and the IF branch could leave
--   the source over-staffed (floater restored + claimer in place).
--   The fix wraps the SELECT in a subquery with FOR UPDATE so the
--   IF/ELSE decision is taken against locked state.
-- ----------------------------------------------------------------------
-- Fix B-1 (no-ack path) — Hmod notification inside the same transaction
--
--   The original RPC returned `hmod_step_claimed` and let the Edge
--   Function send the notification. A crash between RPC commit and
--   notification INSERT silently lost the notification because the
--   chain step was already marked 'fired'. The fix moves the
--   recipient resolution and the notification INSERT inside the RPC
--   so all writes commit together. The Edge Function no longer needs
--   to send the notification.

-- ============================================================
-- Recipient resolution helpers used by the no-ack RPC and the
-- chain-step RPCs in subsequent migrations.
-- ============================================================

CREATE OR REPLACE FUNCTION resolve_hm_for_user(
  p_user_id uuid,
  p_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_user_id uuid := p_user_id;
  v_leave_date date;
  v_replacement_user_id uuid;
  v_is_active boolean;
  v_iteration integer := 0;
BEGIN
  v_leave_date := (p_at AT TIME ZONE 'America/New_York')::date;

  WHILE v_iteration < 10 AND v_current_user_id IS NOT NULL LOOP
    SELECT replacement_user_id
      INTO v_replacement_user_id
    FROM hm_leave
    WHERE user_id     = v_current_user_id
      AND status      = 'active'
      AND start_date  <= v_leave_date
      AND end_date    >= v_leave_date
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT is_active INTO v_is_active
      FROM users
      WHERE user_id = v_current_user_id;

      RETURN CASE WHEN v_is_active THEN v_current_user_id ELSE NULL END;
    END IF;

    v_current_user_id := v_replacement_user_id;
    v_iteration       := v_iteration + 1;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_hm_for_house(
  p_house_id text,
  p_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hm_user_id uuid;
  v_resolved   uuid;
BEGIN
  FOR v_hm_user_id IN
    SELECT user_id
    FROM user_roles
    WHERE role = 'hm'
      AND scope_house_id = p_house_id
  LOOP
    v_resolved := resolve_hm_for_user(v_hm_user_id, p_at);
    IF v_resolved IS NOT NULL THEN
      RETURN v_resolved;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- Predicate: is the given moment within HM working hours
-- (Mon-Fri 08:00 inclusive .. 17:00 exclusive, NY-local).
CREATE OR REPLACE FUNCTION is_hm_working_time(p_at timestamptz)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    extract(isodow from p_at AT TIME ZONE 'America/New_York') BETWEEN 1 AND 5
    AND (
      extract(hour from p_at AT TIME ZONE 'America/New_York') >= 8
      AND extract(hour from p_at AT TIME ZONE 'America/New_York') < 17
    );
$$;

-- Resolve the on-duty HMOD via hmod_rotor for the week containing the
-- given moment, walking hm_leave on the rotor's HMOD if applicable.
CREATE OR REPLACE FUNCTION resolve_hmod_on_duty(p_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_week_start_date date;
  v_hmod_user_id    uuid;
BEGIN
  v_week_start_date := (
    date_trunc(
      'week',
      p_at AT TIME ZONE 'America/New_York'
    )
  )::date;

  SELECT hmod_user_id
    INTO v_hmod_user_id
  FROM hmod_rotor
  WHERE week_start_date = v_week_start_date;

  IF v_hmod_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN resolve_hm_for_user(v_hmod_user_id, p_at);
END;
$$;

-- ============================================================
-- The no-ack RPC.
-- ============================================================

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
  v_hmod_step_claimed                boolean;
  v_recipient_user_id                uuid;
  v_recipient_target                 text;
BEGIN
  SELECT *
    INTO v_float
  FROM float_assignments
  WHERE float_id = p_float_id
    AND status = 'pending'
    AND acknowledged_at IS NULL
    AND declined_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('processed', false, 'reason', 'not_pending');
  END IF;

  SELECT
    min(sb.block_start_at),
    max(sb.block_start_at) + interval '30 minutes'
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
    INTO v_first_destination_block_id,
         v_first_destination_block_start_at,
         v_destination_house_id
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  WHERE sba.assignment_id = ANY(v_float.destination_assignment_ids)
  ORDER BY sb.block_start_at ASC
  LIMIT 1;

  -- 1. Void the float.
  UPDATE float_assignments
  SET status      = 'voided',
      declined_at = p_now
  WHERE float_id = p_float_id;

  -- 2. Destination blocks return to vacant. A-2: use 'temporary_drop'
  -- (BSpec §3.3 — destination is the original gap re-opening, not a
  -- floater displacement).
  UPDATE shift_block_assignments
  SET user_id         = NULL,
      status          = 'vacant',
      vacancy_origin  = 'temporary_drop',
      is_float        = false,
      source_house_id = NULL,
      parent_float_id = NULL
  WHERE assignment_id = ANY(v_float.destination_assignment_ids);

  -- 3. Exclude the unresponsive worker for this gap window (BSpec §7.3).
  INSERT INTO float_exclusions (
    user_id,
    window_start_at,
    window_end_at,
    destination_house_id,
    reason
  )
  VALUES (
    v_float.user_id,
    v_float_start_at,
    v_float_end_at,
    v_destination_house_id,
    'no_acknowledgment'
  );

  -- 4. Roll back the force-trigger pre-marks so the chain re-evaluates
  --    (ARCH §4.5 "Rollback procedure"). Automated floats have nothing
  --    to roll back — their chain steps were never pre-marked.
  IF v_float.initiated_by = 'force_triggered' THEN
    UPDATE block_step_status
    SET status     = 'rolled_back',
        updated_at = p_now
    WHERE block_id IN (
      SELECT block_id
      FROM shift_block_assignments
      WHERE assignment_id = ANY(v_float.destination_assignment_ids)
    )
      AND step_name IN ('broadcast', 'float_lookup');
  END IF;

  -- 5. Source-side reconciliation (ARCH §4.5 #2-#3).
  IF v_float.initiated_by = 'force_triggered' THEN
    -- B-3: lock compensation rows BEFORE deciding restore-vs-displace
    -- so the decision is taken against a state that cannot change
    -- under our feet. Concurrent claim/Allied handlers serialise on
    -- these row locks.
    SELECT
      count(*) FILTER (WHERE status = 'vacant'),
      count(*)
      INTO v_gap_rows_still_vacant, v_gap_rows_total
    FROM (
      SELECT status
      FROM shift_block_assignments
      WHERE parent_float_id = p_float_id
        AND assignment_id != ALL(v_float.source_assignment_ids)
        AND assignment_id != ALL(v_float.destination_assignment_ids)
      FOR UPDATE
    ) compensation;

    -- A-1: the restore branch must also fire when no compensation
    -- rows were ever created (force-trigger that did NOT drop source
    -- below required headcount). v_gap_rows_total = 0 is logically
    -- "all still vacant" — nothing to reclaim, no displacement
    -- possible.
    IF v_gap_rows_total = 0 OR v_gap_rows_still_vacant = v_gap_rows_total THEN
      UPDATE shift_block_assignments
      SET user_id         = v_float.user_id,
          status          = 'scheduled',
          vacancy_origin  = 'none',
          is_float        = false,
          source_house_id = NULL,
          parent_float_id = NULL
      WHERE assignment_id = ANY(v_float.source_assignment_ids);

      DELETE FROM shift_block_assignments
      WHERE parent_float_id = p_float_id
        AND status = 'vacant'
        AND assignment_id != ALL(v_float.source_assignment_ids)
        AND assignment_id != ALL(v_float.destination_assignment_ids);
    ELSE
      UPDATE shift_block_assignments
      SET user_id         = NULL,
          status          = 'vacant',
          vacancy_origin  = 'displaced_decliner',
          is_float        = false,
          source_house_id = NULL,
          parent_float_id = NULL
      WHERE assignment_id = ANY(v_float.source_assignment_ids);
    END IF;
  ELSE
    UPDATE shift_block_assignments
    SET user_id         = v_float.user_id,
        status          = 'scheduled',
        vacancy_origin  = 'none',
        is_float        = false,
        source_house_id = NULL,
        parent_float_id = NULL
    WHERE assignment_id = ANY(v_float.source_assignment_ids);
  END IF;

  -- 6. Claim the hmod_notify_allied step + send the notification in
  --    the same transaction. B-1 fix: previously the Edge Function
  --    sent the notification AFTER this RPC committed; a crash in
  --    between silently lost it. Now claim + notify commit together.
  INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
  VALUES (v_first_destination_block_id, 'hmod_notify_allied', 'fired', p_now, p_now)
  ON CONFLICT (block_id, step_name) DO NOTHING;

  GET DIAGNOSTICS v_hmod_step_claimed = ROW_COUNT;

  IF v_hmod_step_claimed THEN
    -- Routing per ARCH §4.6: HM only when BOTH the fire time AND the
    -- block start time are in HM hours. Otherwise HMOD.
    IF is_hm_working_time(p_now) AND is_hm_working_time(v_first_destination_block_start_at) THEN
      v_recipient_user_id := resolve_hm_for_house(v_destination_house_id, p_now);
      v_recipient_target  := 'hm';
      IF v_recipient_user_id IS NULL THEN
        v_recipient_user_id := resolve_hmod_on_duty(p_now);
        v_recipient_target  := 'hmod';
      END IF;
    ELSE
      v_recipient_user_id := resolve_hmod_on_duty(p_now);
      v_recipient_target  := 'hmod';
    END IF;

    IF v_recipient_user_id IS NOT NULL THEN
      INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
      VALUES (
        v_recipient_user_id,
        'hmod_urgent'::notification_type,
        p_now,
        jsonb_build_object(
          'target',         v_recipient_target,
          'reason',         'float_no_acknowledgment',
          'block_id',       v_first_destination_block_id,
          'house_id',       v_destination_house_id,
          'block_start_at', v_first_destination_block_start_at
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'processed',         true,
    'block_id',          v_first_destination_block_id,
    'block_start_at',    v_first_destination_block_start_at,
    'house_id',          v_destination_house_id,
    'hmod_step_claimed', v_hmod_step_claimed
  );
END;
$$;

REVOKE ALL ON FUNCTION resolve_hm_for_user(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_hm_for_user(uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION resolve_hm_for_house(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_hm_for_house(text, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION resolve_hmod_on_duty(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_hmod_on_duty(timestamptz) TO service_role;

REVOKE ALL ON FUNCTION is_hm_working_time(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_hm_working_time(timestamptz) TO service_role;

-- rollback:
-- Restore the original function body from migration 20260528000003;
-- DROP FUNCTION IF EXISTS resolve_hm_for_user(uuid, timestamptz);
-- DROP FUNCTION IF EXISTS resolve_hm_for_house(text, timestamptz);
-- DROP FUNCTION IF EXISTS resolve_hmod_on_duty(timestamptz);
-- DROP FUNCTION IF EXISTS is_hm_working_time(timestamptz);
