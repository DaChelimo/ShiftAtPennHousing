-- Migration: off-hours Allied-page escalation ladder (staggered-rollout pilot).
--
-- Context (stakeholder decision 2026-07-13): during the staggered pilot the HMODs
-- are not yet on the app, so the existing off-hours terminal — a single `hmod_urgent`
-- notification to `resolve_hmod_on_duty` (then the project-administrator terminal) —
-- would page someone who cannot receive it. Until HMOD adoption, a coverage-lock
-- (T-2h) event OFF HM working hours instead runs a human LADDER of app users who CAN
-- receive it and who bridge to the desk phone / HMOD page:
--
--     rung 1  responsible worker (the SW who dropped the seat)
--     rung 2  the SM of that house
--     rung 3  every worker currently on that house's desk
--
-- Each rung is an ackable "call the desk" alert. If no one acknowledges within
-- `allied_page_rung_timeout_minutes` (default 10, customizable), the orchestrator
-- advances to the next rung. An acknowledgment ("I've called the desk") resolves the
-- ladder so the chain never double-pages: exactly one owner holds the duty at a time,
-- and rung 3 (co-located desk workers) is deliberately multi-recipient — shared
-- visibility, not duplication. The desk rung is terminal.
--
-- Gating: a single master switch `system_config('offhours_ladder_enabled')` (mirrors
-- `staggered_launch_enabled`). Default OFF, so every existing dev seed / test / prod
-- environment keeps the historical HMOD-direct behavior and the suite is unchanged.
-- The project admin flips it ON for the pilot and OFF again once HMODs are on the app,
-- reverting to the proper HMOD-direct off-hours routing with no code change.
--
-- ON HM working hours the routing is UNCHANGED (the RSM path from 20260617000006); the
-- pilot policy that an RSM must always name a leave replacement is enforced at the web
-- layer (Option 1), not here.
--
-- NY tz throughout (invariant #6). Idempotent re-application; RLS in-file.

-- ============================================================
-- 0. New notification type for the ladder alerts. Referenced only inside function
--    bodies below (never at migration-apply time), so adding the value in the same
--    migration is safe on PG12+ (the value is usable once this migration commits).
-- ============================================================
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'allied_page';

-- ============================================================
-- 1. Master switch. STABLE + SECURITY DEFINER so any client/EF can consult it without
--    a direct system_config read grant. Absent row => disabled (historical behavior).
-- ============================================================
CREATE OR REPLACE FUNCTION is_offhours_ladder_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT config_value = 'true'
       FROM system_config
      WHERE config_key = 'offhours_ladder_enabled'),
    false
  );
$$;

REVOKE ALL ON FUNCTION is_offhours_ladder_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_offhours_ladder_enabled() TO authenticated, service_role;

-- Admin mutation: flip the master switch (mirrors set_staggered_launch_enabled).
CREATE OR REPLACE FUNCTION set_offhours_ladder_enabled(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT user_is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'only the project administrator may change the off-hours ladder switch';
  END IF;
  INSERT INTO system_config (config_key, config_value, value_type, modified_by, modified_at)
  VALUES (
    'offhours_ladder_enabled',
    CASE WHEN p_enabled THEN 'true' ELSE 'false' END,
    'enum',
    auth.uid(),
    now()
  )
  ON CONFLICT (config_key) DO UPDATE
    SET config_value = EXCLUDED.config_value,
        value_type   = 'enum',
        modified_by  = EXCLUDED.modified_by,
        modified_at  = EXCLUDED.modified_at;
END;
$$;

REVOKE ALL ON FUNCTION set_offhours_ladder_enabled(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_offhours_ladder_enabled(boolean) TO authenticated, service_role;

-- Per-rung no-ack timeout (minutes). Read at runtime with a COALESCE fallback so an
-- unset environment uses 10. Customizable via system_config without a code change.
CREATE OR REPLACE FUNCTION offhours_ladder_timeout_minutes()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF((SELECT config_value FROM system_config
             WHERE config_key = 'allied_page_rung_timeout_minutes'), '')::integer,
    10
  );
$$;

REVOKE ALL ON FUNCTION offhours_ladder_timeout_minutes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION offhours_ladder_timeout_minutes() TO authenticated, service_role;

-- ============================================================
-- 2. Ladder state table. One row per coverage-locked block whose off-hours escalation
--    is running the ladder. Orchestrator-internal: written only by SECURITY DEFINER
--    RPCs; RLS-enabled with no authenticated policy so only the service role (which
--    bypasses RLS) and the DEFINER RPCs touch it.
-- ============================================================
CREATE TABLE IF NOT EXISTS allied_page_ladder (
  block_id            uuid PRIMARY KEY REFERENCES shift_blocks (block_id) ON DELETE CASCADE,
  house_id            text        NOT NULL REFERENCES houses (id),
  block_start_at      timestamptz NOT NULL,
  current_rung        text        NOT NULL CHECK (current_rung IN ('dropper', 'sm', 'desk')),
  rung_fired_at       timestamptz NOT NULL,
  dropped_by_user_id  uuid        REFERENCES users (user_id),
  acknowledged_at     timestamptz,
  acknowledged_by     uuid        REFERENCES users (user_id),
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Advance/cleanup scan predicate: unresolved + unacknowledged rows.
CREATE INDEX IF NOT EXISTS allied_page_ladder_active_idx
  ON allied_page_ladder (rung_fired_at)
  WHERE acknowledged_at IS NULL AND resolved_at IS NULL;

ALTER TABLE allied_page_ladder ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. Rung recipient resolvers.
-- ============================================================

-- The active SM(s) scoped to a house. SMs are not in the hm_leave delegation model
-- (that is hm/bm/rsm), so this is a straight active-role lookup. A house normally has
-- one SM; returns all active ones if more.
CREATE OR REPLACE FUNCTION resolve_sm_for_house(p_house_id text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id
  FROM user_roles ur
  JOIN users u ON u.user_id = ur.user_id
  WHERE ur.role = 'sm'
    AND ur.scope_house_id = p_house_id
    AND u.is_active;
$$;

REVOKE ALL ON FUNCTION resolve_sm_for_house(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_sm_for_house(text) TO service_role;

-- Every worker physically on a house's desk right now: occupants of the 30-minute
-- block in progress at p_now, in a real-worker present status (scheduled / claimed /
-- floated_in / pending_float_in). `allied` is NOT a person, and float-OUT rows are the
-- worker staffing elsewhere. Mirrors the pickup-lock "real worker" set.
CREATE OR REPLACE FUNCTION resolve_present_desk_workers(p_house_id text, p_now timestamptz)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT sba.user_id
  FROM shift_block_assignments sba
  JOIN shift_blocks sb ON sb.block_id = sba.block_id
  JOIN users u ON u.user_id = sba.user_id
  WHERE sb.house_id = p_house_id
    AND sb.voided_at IS NULL
    AND sb.block_start_at <= p_now
    AND p_now < sb.block_start_at + interval '30 minutes'
    AND sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
    AND sba.user_id IS NOT NULL
    AND u.is_active;
$$;

REVOKE ALL ON FUNCTION resolve_present_desk_workers(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_present_desk_workers(text, timestamptz) TO service_role;

-- Recipients for a given rung, as an array (possibly empty). p_dropper is the
-- snapshotted responsible worker for the block (already validated active by the
-- caller); it is passed rather than re-derived so the ladder is stable even if the
-- vacant seat is later mutated.
CREATE OR REPLACE FUNCTION resolve_allied_ladder_recipients(
  p_rung          text,
  p_house_id      text,
  p_now           timestamptz,
  p_dropper       uuid
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipients uuid[];
BEGIN
  IF p_rung = 'dropper' THEN
    IF p_dropper IS NOT NULL
       AND EXISTS (SELECT 1 FROM users WHERE user_id = p_dropper AND is_active) THEN
      RETURN ARRAY[p_dropper];
    END IF;
    RETURN ARRAY[]::uuid[];
  ELSIF p_rung = 'sm' THEN
    SELECT COALESCE(array_agg(t.uid), ARRAY[]::uuid[])
      INTO v_recipients FROM resolve_sm_for_house(p_house_id) AS t(uid);
    RETURN v_recipients;
  ELSIF p_rung = 'desk' THEN
    SELECT COALESCE(array_agg(t.uid), ARRAY[]::uuid[])
      INTO v_recipients FROM resolve_present_desk_workers(p_house_id, p_now) AS t(uid);
    RETURN v_recipients;
  END IF;
  RETURN ARRAY[]::uuid[];
END;
$$;

REVOKE ALL ON FUNCTION resolve_allied_ladder_recipients(text, text, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_allied_ladder_recipients(text, text, timestamptz, uuid) TO service_role;

-- The next rung after p_rung, or NULL if p_rung is terminal ('desk').
CREATE OR REPLACE FUNCTION allied_ladder_next_rung(p_rung text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_rung WHEN 'dropper' THEN 'sm' WHEN 'sm' THEN 'desk' ELSE NULL END;
$$;

-- Insert one allied_page notification per recipient for a rung.
CREATE OR REPLACE FUNCTION emit_allied_page_notifications(
  p_recipients     uuid[],
  p_rung           text,
  p_block_id       uuid,
  p_house_id       text,
  p_block_start_at timestamptz,
  p_reason         text,
  p_now            timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_desk_phone text;
BEGIN
  SELECT desk_phone INTO v_desk_phone FROM houses WHERE id = p_house_id;

  INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
  SELECT
    recipient,
    'allied_page'::notification_type,
    p_now,
    jsonb_build_object(
      'rung',           p_rung,
      'reason',         p_reason,
      'block_id',       p_block_id,
      'house_id',       p_house_id,
      'block_start_at', p_block_start_at,
      'desk_phone',     v_desk_phone,
      'priority',       'critical'
    )
  FROM unnest(p_recipients) AS recipient;
END;
$$;

REVOKE ALL ON FUNCTION emit_allied_page_notifications(uuid[], text, uuid, text, timestamptz, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION emit_allied_page_notifications(uuid[], text, uuid, text, timestamptz, text, timestamptz) TO service_role;

-- ============================================================
-- 4. start_offhours_allied_ladder — entered from the off-hours terminal (chain or
--    no-ack) after that step is claimed, when the master switch is on. Snapshots the
--    responsible worker, picks the first rung that has a recipient (dropper -> sm ->
--    desk), records the ladder row, and emits the first alerts. Idempotent per block.
-- ============================================================
CREATE OR REPLACE FUNCTION start_offhours_allied_ladder(
  p_block_id       uuid,
  p_house_id       text,
  p_block_start_at timestamptz,
  p_now            timestamptz,
  p_reason         text DEFAULT 'escalation_chain'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dropper     uuid;
  v_rung        text;
  v_recipients  uuid[];
BEGIN
  -- One ladder per block. If it already exists (idempotent re-entry), do nothing.
  IF EXISTS (SELECT 1 FROM allied_page_ladder WHERE block_id = p_block_id) THEN
    RETURN jsonb_build_object('started', false, 'reason', 'already_running');
  END IF;

  -- Responsible worker: the most recent dropper of a vacant seat on this block, if
  -- still active. NULL for a never-assigned open shift -> ladder starts at the SM.
  SELECT sba.dropped_by_user_id INTO v_dropper
  FROM shift_block_assignments sba
  JOIN users u ON u.user_id = sba.dropped_by_user_id
  WHERE sba.block_id = p_block_id
    AND sba.status = 'vacant'
    AND sba.dropped_by_user_id IS NOT NULL
    AND u.is_active
  ORDER BY sba.dropped_at DESC NULLS LAST
  LIMIT 1;

  -- Find the first rung with at least one recipient.
  v_rung := CASE WHEN v_dropper IS NOT NULL THEN 'dropper' ELSE 'sm' END;
  LOOP
    v_recipients := resolve_allied_ladder_recipients(v_rung, p_house_id, p_now, v_dropper);
    EXIT WHEN array_length(v_recipients, 1) > 0 OR v_rung = 'desk';
    v_rung := allied_ladder_next_rung(v_rung);
  END LOOP;

  INSERT INTO allied_page_ladder (
    block_id, house_id, block_start_at, current_rung, rung_fired_at, dropped_by_user_id
  ) VALUES (
    p_block_id, p_house_id, p_block_start_at, v_rung, p_now, v_dropper
  )
  ON CONFLICT (block_id) DO NOTHING;

  IF array_length(v_recipients, 1) > 0 THEN
    PERFORM emit_allied_page_notifications(
      v_recipients, v_rung, p_block_id, p_house_id, p_block_start_at, p_reason, p_now);
  ELSE
    -- Out of scope per stakeholder decision (the desk is never truly empty), but never
    -- drop the event: surface it so a deployer notices rather than a silent gap.
    RAISE WARNING 'start_offhours_allied_ladder: no recipient on any rung for block % (house %)',
      p_block_id, p_house_id;
  END IF;

  RETURN jsonb_build_object('started', true, 'rung', v_rung,
                            'recipients', COALESCE(array_length(v_recipients, 1), 0));
END;
$$;

REVOKE ALL ON FUNCTION start_offhours_allied_ladder(uuid, text, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_offhours_allied_ladder(uuid, text, timestamptz, timestamptz, text) TO service_role;

-- ============================================================
-- 5. advance_offhours_allied_ladder — the orchestrator tick pass. Resolves rows whose
--    gap is now moot (block started, or desk covered by a real worker), then advances
--    any unacknowledged non-terminal rung whose timeout has elapsed to the next rung
--    that has a recipient. Returns the number of rows advanced.
-- ============================================================
CREATE OR REPLACE FUNCTION advance_offhours_allied_ladder(
  p_now             timestamptz,
  p_timeout_minutes integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_timeout     integer := COALESCE(p_timeout_minutes, offhours_ladder_timeout_minutes());
  v_row         record;
  v_next        text;
  v_recipients  uuid[];
  v_advanced    integer := 0;
BEGIN
  -- Cleanup: a gap that started or got covered no longer needs escalation.
  UPDATE allied_page_ladder l
  SET resolved_at = p_now
  WHERE l.acknowledged_at IS NULL
    AND l.resolved_at IS NULL
    AND (
      l.block_start_at <= p_now
      OR EXISTS (
        SELECT 1 FROM shift_block_assignments sba
        WHERE sba.block_id = l.block_id
          AND sba.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in', 'allied')
      )
    );

  -- Advance due rows. FOR UPDATE SKIP LOCKED so concurrent ticks don't double-fire.
  FOR v_row IN
    SELECT *
    FROM allied_page_ladder
    WHERE acknowledged_at IS NULL
      AND resolved_at IS NULL
      AND current_rung <> 'desk'
      AND rung_fired_at <= p_now - make_interval(mins => v_timeout)
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Walk to the next rung that has a recipient (a rung with none is skipped, e.g.
    -- an sm rung when the house has no active SM).
    v_next := allied_ladder_next_rung(v_row.current_rung);
    v_recipients := ARRAY[]::uuid[];
    WHILE v_next IS NOT NULL LOOP
      v_recipients := resolve_allied_ladder_recipients(
        v_next, v_row.house_id, p_now, v_row.dropped_by_user_id);
      EXIT WHEN array_length(v_recipients, 1) > 0;
      v_next := allied_ladder_next_rung(v_next);
    END LOOP;

    IF v_next IS NULL THEN
      -- No further rung has anyone. Park at 'desk' so the row stops re-firing; surface
      -- the dead end rather than looping.
      UPDATE allied_page_ladder
      SET current_rung = 'desk', rung_fired_at = p_now
      WHERE block_id = v_row.block_id;
      RAISE WARNING 'advance_offhours_allied_ladder: no recipient beyond rung % for block %',
        v_row.current_rung, v_row.block_id;
      CONTINUE;
    END IF;

    UPDATE allied_page_ladder
    SET current_rung = v_next, rung_fired_at = p_now
    WHERE block_id = v_row.block_id;

    PERFORM emit_allied_page_notifications(
      v_recipients, v_next, v_row.block_id, v_row.house_id, v_row.block_start_at,
      'ladder_no_acknowledgment', p_now);

    v_advanced := v_advanced + 1;
  END LOOP;

  RETURN v_advanced;
END;
$$;

REVOKE ALL ON FUNCTION advance_offhours_allied_ladder(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION advance_offhours_allied_ladder(timestamptz, integer) TO service_role;

-- ============================================================
-- 6. acknowledge_allied_page — "I've called the desk". Service-role only; the EF
--    passes the AUTHENTICATED user's id (mirrors acknowledge_float under no-takeback).
--    Any recipient of an allied_page alert for the block may ack; the ack resolves the
--    ladder so no further rung fires, and marks that recipient's notification handled.
-- ============================================================
CREATE OR REPLACE FUNCTION acknowledge_allied_page(
  p_block_id uuid,
  p_user_id  uuid,
  p_now      timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ladder allied_page_ladder;
BEGIN
  SELECT * INTO v_ladder FROM allied_page_ladder WHERE block_id = p_block_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('acknowledged', false, 'reason', 'not_found');
  END IF;

  IF v_ladder.acknowledged_at IS NOT NULL OR v_ladder.resolved_at IS NOT NULL THEN
    RETURN jsonb_build_object('acknowledged', false, 'reason', 'already_resolved');
  END IF;

  -- The caller must actually be a recipient of an allied_page alert for this block.
  IF NOT EXISTS (
    SELECT 1 FROM notifications
    WHERE recipient_user_id = p_user_id
      AND type = 'allied_page'
      AND (payload->>'block_id')::uuid = p_block_id
  ) THEN
    RETURN jsonb_build_object('acknowledged', false, 'reason', 'not_a_recipient');
  END IF;

  UPDATE allied_page_ladder
  SET acknowledged_at = p_now, acknowledged_by = p_user_id, resolved_at = p_now
  WHERE block_id = p_block_id;

  -- Mark this recipient's outstanding allied_page notifications for the block handled.
  UPDATE notifications
  SET acknowledged_at = p_now
  WHERE recipient_user_id = p_user_id
    AND type = 'allied_page'
    AND (payload->>'block_id')::uuid = p_block_id
    AND acknowledged_at IS NULL;

  RETURN jsonb_build_object('acknowledged', true, 'block_id', p_block_id);
END;
$$;

REVOKE ALL ON FUNCTION acknowledge_allied_page(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acknowledge_allied_page(uuid, uuid, timestamptz) TO service_role;

-- ============================================================
-- 7. Wire the two off-hours terminals to start the ladder when the switch is on.
--    Both functions are reproduced verbatim from 20260617000006 EXCEPT their
--    off-hours branch, which — when is_offhours_ladder_enabled() — starts the ladder
--    and skips the single hmod_urgent insert. The ON-hours (RSM) path is UNCHANGED,
--    and with the switch OFF both functions behave exactly as before.
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
    -- Off-hours pilot ladder (2026-07-13): while the HMODs are not on the app, run
    -- the human ladder (responsible worker -> SM -> desk) instead of paging HMOD.
    -- The step is already claimed above, so the chain will not re-fire; the ladder
    -- owns the escalation from here. Switch OFF -> unchanged HMOD-direct path below.
    IF is_offhours_ladder_enabled() THEN
      PERFORM start_offhours_allied_ladder(p_block_id, p_house_id, p_block_start_at, p_now, p_reason);
      RETURN jsonb_build_object('claimed', true, 'recipient_user_id', NULL, 'target', 'offhours_ladder');
    END IF;
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
    IF NOT (is_hm_working_time(p_now) AND is_hm_working_time(v_first_destination_block_start_at))
       AND is_offhours_ladder_enabled() THEN
      -- Off-hours pilot ladder (2026-07-13): responsible worker -> SM -> desk instead
      -- of a single HMOD page. The gap re-opened above; the ladder owns escalation.
      PERFORM start_offhours_allied_ladder(
        v_first_destination_block_id, v_destination_house_id,
        v_first_destination_block_start_at, p_now, 'float_no_acknowledgment');
    ELSE
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
        RAISE WARNING 'process_no_ack_float: no notification recipient for block % (house %); set system_config.project_administrator_user_id to an active admin user_id',
          v_first_destination_block_id, v_destination_house_id;
      END IF;
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
-- (restore process_hmod_notify_allied_step + process_no_ack_float bodies from
--  20260617000006 to remove the ladder branch.)
-- DROP FUNCTION IF EXISTS acknowledge_allied_page(uuid, uuid, timestamptz);
-- DROP FUNCTION IF EXISTS advance_offhours_allied_ladder(timestamptz, integer);
-- DROP FUNCTION IF EXISTS start_offhours_allied_ladder(uuid, text, timestamptz, timestamptz, text);
-- DROP FUNCTION IF EXISTS emit_allied_page_notifications(uuid[], text, uuid, text, timestamptz, text, timestamptz);
-- DROP FUNCTION IF EXISTS allied_ladder_next_rung(text);
-- DROP FUNCTION IF EXISTS resolve_allied_ladder_recipients(text, text, timestamptz, uuid);
-- DROP FUNCTION IF EXISTS resolve_present_desk_workers(text, timestamptz);
-- DROP FUNCTION IF EXISTS resolve_sm_for_house(text);
-- DROP TABLE IF EXISTS allied_page_ladder;
-- DROP FUNCTION IF EXISTS offhours_ladder_timeout_minutes();
-- DROP FUNCTION IF EXISTS set_offhours_ladder_enabled(boolean);
-- DROP FUNCTION IF EXISTS is_offhours_ladder_enabled();
-- (notification_type value 'allied_page' is retained; enum values cannot be dropped.)
