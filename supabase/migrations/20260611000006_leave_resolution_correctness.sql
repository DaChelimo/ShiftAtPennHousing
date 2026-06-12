-- Migration: T2-12b — HM/BM leave §2.6 resolution correctness.
--
-- Three §2.6 resolution concerns, investigated against the existing leave path
-- (20260528000012 resolve_hm_for_user / resolve_hmod_on_duty, 20260601000003
-- submit_hm_leave):
--
--   (1) HMOD-interval transfer (#136-138) — ALREADY CORRECT, no code change here.
--       resolve_hmod_on_duty(p_at) already calls
--         resolve_hm_for_user(v_hmod_user_id, p_at, hmod_interval_start_date(p_at))
--       so the on-duty HMOD is resolved through hm_leave anchored to the interval's
--       START date (hmod_interval_start_date), profile-agnostic. A pinning pgTAP
--       (leave-hmod-interval-transfer.sql) locks it; this migration does not touch it.
--
--   (2) Same-day dual HM+BM coverage guard (#162) — NEW. submit_hm_leave previously
--       had no uncovered-house guard. A house must never end up with NEITHER its HM
--       nor BM (nor a different-house designated replacement) active on an operating
--       day. We reject the submission when the proposed leave would, on any operating
--       date in its window, leave the leaving user's home house uncovered.
--
--   (3) Depth-10 resolution-walk limit (#148) — NEW semantics. The walk in
--       resolve_hm_for_user already caps at depth 10 and returns NULL, but §2.6 #148
--       requires that HITTING the limit FLAG a configuration error and notify the
--       project administrator + every HM in the detected chain + the HMOD on duty
--       (exactly once each), and route the house's notifications to the HMOD until
--       manually resolved. submit_hm_leave's prior 64-step stop was only a generic
--       pre-existing-cycle guard. We add a leave_config_errors flag table and a
--       detection routine that submit_hm_leave runs after insert; on a depth-10 hit
--       it flags + notifies.
--
-- Pure resolution shape mirrors packages/core where the codebase already keeps it;
-- the membership/notify side effects are inherently DB state so they live in the
-- SECURITY DEFINER RPC. NY tz everywhere (invariant #6); leave/HMOD semantics per
-- §2.5/§2.6. Idempotent re-application; RLS in-file.

-- ============================================================
-- (3a) Config-error flag table for depth-10 resolution failures (§2.6 #148).
-- One open flag per (house, leaving user) until manually resolved. While an
-- unresolved flag exists for a house, that house's notifications route to HMOD.
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_config_errors (
  error_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id          text        NOT NULL REFERENCES houses (id),
  -- the user whose leave submission tripped the depth-10 walk
  leaving_user_id   uuid        NOT NULL REFERENCES users (user_id),
  -- the chain of user_ids walked when the limit was hit (for audit / notify)
  chain_user_ids    uuid[]      NOT NULL DEFAULT '{}',
  detected_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_by       uuid        REFERENCES users (user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS leave_config_errors_open_house_idx
  ON leave_config_errors (house_id)
  WHERE resolved_at IS NULL;

ALTER TABLE leave_config_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service-role bypass" ON leave_config_errors;
CREATE POLICY "service-role bypass" ON leave_config_errors
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Read: house admins (HM/BM) of the affected house, and the leaving user.
-- user_has_house_admin_role(uuid, text) is the established hm/bm-admin helper.
DROP POLICY IF EXISTS "house admins and leaver read leave config errors"
  ON leave_config_errors;
CREATE POLICY "house admins and leaver read leave config errors"
  ON leave_config_errors
  FOR SELECT
  TO authenticated
  USING (
    leaving_user_id = auth.uid()
    OR user_has_house_admin_role(auth.uid(), house_id)
  );

-- Helper: is there an OPEN (unresolved) leave config error for a house?
-- The notification-routing layer consults this to force a house's escalation to
-- the HMOD on duty (§2.6 #148) until the error is manually cleared.
CREATE OR REPLACE FUNCTION house_has_open_leave_config_error(p_house_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM leave_config_errors
    WHERE house_id = p_house_id
      AND resolved_at IS NULL
  );
$$;

-- ============================================================
-- (3b) Depth-10 walk that captures the chain and a depth-exceeded flag.
-- Mirrors resolve_hm_for_user's forward walk but, instead of returning the
-- terminal acting user, returns whether the bounded walk hit depth 10 without
-- terminating, plus the chain of user_ids it traversed. Pure read; no writes.
-- ============================================================
CREATE OR REPLACE FUNCTION leave_resolution_walk(
  p_user_id          uuid,
  p_resolution_date  date,
  OUT depth_exceeded boolean,
  OUT chain          uuid[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current   uuid := p_user_id;
  v_next      uuid;
  v_iteration integer := 0;
BEGIN
  depth_exceeded := false;
  chain := ARRAY[]::uuid[];

  -- Same bound as resolve_hm_for_user (< 10). If the walk is still on an active
  -- leave record at the bound, the chain is too deep / cyclic for this date.
  WHILE v_iteration < 10 AND v_current IS NOT NULL LOOP
    chain := chain || v_current;

    SELECT replacement_user_id
      INTO v_next
    FROM hm_leave
    WHERE user_id     = v_current
      AND status      = 'active'
      AND start_date  <= p_resolution_date
      AND end_date    >= p_resolution_date
    LIMIT 1;

    IF NOT FOUND THEN
      -- Terminated at someone not on leave for this date: healthy.
      RETURN;
    END IF;

    v_current   := v_next;
    v_iteration := v_iteration + 1;
  END LOOP;

  -- Fell out of the loop while still chained (or hit a NULL terminal exactly at
  -- the bound). depth_exceeded iff we are still pointing at an active-leave user.
  IF v_current IS NOT NULL THEN
    PERFORM 1
    FROM hm_leave
    WHERE user_id     = v_current
      AND status      = 'active'
      AND start_date  <= p_resolution_date
      AND end_date    >= p_resolution_date
    LIMIT 1;
    depth_exceeded := FOUND;
    IF depth_exceeded THEN
      chain := chain || v_current;
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- (3c) Flag + notify on a depth-10 hit (§2.6 #148). Idempotent per open flag:
-- if an unresolved flag already exists for (house, leaving user) it is reused and
-- no duplicate notifications are sent. Notifies, exactly once each: the project
-- administrator (system_config terminal), every HM in the detected chain, and the
-- HMOD on duty. Routes the house's notifications to HMOD via the open flag
-- (house_has_open_leave_config_error).
-- ============================================================
CREATE OR REPLACE FUNCTION flag_leave_depth_error(
  p_house_id        text,
  p_leaving_user_id uuid,
  p_chain           uuid[],
  p_now             timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_error_id    uuid;
  v_admin_id    uuid;
  v_recipients  uuid[];
  v_recipient   uuid;
  v_hmod        uuid;
BEGIN
  -- Reuse an existing OPEN flag (idempotent — do not re-notify on re-trip).
  SELECT error_id INTO v_error_id
  FROM leave_config_errors
  WHERE house_id = p_house_id
    AND leaving_user_id = p_leaving_user_id
    AND resolved_at IS NULL
  LIMIT 1;

  IF v_error_id IS NOT NULL THEN
    RETURN v_error_id;
  END IF;

  INSERT INTO leave_config_errors (house_id, leaving_user_id, chain_user_ids, detected_at)
  VALUES (p_house_id, p_leaving_user_id, COALESCE(p_chain, '{}'), p_now)
  RETURNING error_id INTO v_error_id;

  -- Build the distinct recipient set: project administrator + every HM in the
  -- chain + the HMOD on duty. Each notified exactly once.
  v_recipients := ARRAY[]::uuid[];

  SELECT config_value::uuid INTO v_admin_id
  FROM system_config
  WHERE config_key = 'project_administrator_user_id';
  IF v_admin_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM users WHERE user_id = v_admin_id AND is_active) THEN
    v_recipients := v_recipients || v_admin_id;
  END IF;

  -- Every active HM (role = 'hm') appearing in the detected chain.
  SELECT v_recipients || COALESCE(array_agg(DISTINCT ur2.user_id), '{}')
    INTO v_recipients
  FROM unnest(p_chain) AS c(user_id)
  JOIN user_roles ur2 ON ur2.user_id = c.user_id AND ur2.role = 'hm'
  JOIN users u ON u.user_id = ur2.user_id AND u.is_active;

  v_hmod := resolve_hmod_on_duty(p_now);
  IF v_hmod IS NOT NULL THEN
    v_recipients := v_recipients || v_hmod;
  END IF;

  -- Distinct, exactly-once notify (filter NULLs and de-dupe).
  FOR v_recipient IN
    SELECT DISTINCT r FROM unnest(v_recipients) AS r WHERE r IS NOT NULL
  LOOP
    INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
    VALUES (
      v_recipient,
      'hmod_urgent'::notification_type,
      p_now,
      jsonb_build_object(
        'kind',            'leave_config_error',
        'reason',          'leave_resolution_depth_limit',
        'error_id',        v_error_id,
        'house_id',        p_house_id,
        'leaving_user_id', p_leaving_user_id,
        'chain',           to_jsonb(p_chain),
        'message',         'Leave delegation chain for this house exceeded the '
                           || 'depth-10 resolution limit; notifications route to the '
                           || 'HMOD on duty until an administrator resolves it.'
      )
    );
  END LOOP;

  RETURN v_error_id;
END;
$$;

-- ============================================================
-- (2) Same-day dual HM+BM coverage guard (§2.6 #162). A house is "uncovered" on
-- a date when NEITHER its HM-role holders NOR its BM-role holders resolve to an
-- active acting person for that date (resolve_hm_for_user walks leave to a
-- not-on-leave active user; a same-house counterpart who is themselves on leave
-- contributes nothing). Returns the first uncovered operating date in the window,
-- or NULL if the house stays covered every operating day.
--
-- Profile-agnostic on operating dates: only operating_calendar dates are checked
-- (closed/summer dates need no coverage, §3.1).
-- ============================================================
CREATE OR REPLACE FUNCTION first_uncovered_date_for_house(
  p_house_id   text,
  p_start_date date,
  p_end_date   date
)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date      date;
  v_hm_acting uuid;
  v_bm_acting uuid;
  v_role_user uuid;
BEGIN
  FOR v_date IN
    SELECT oc.date
    FROM operating_calendar oc
    WHERE oc.date BETWEEN p_start_date AND p_end_date
    ORDER BY oc.date
  LOOP
    v_hm_acting := NULL;
    v_bm_acting := NULL;

    -- HM-role holders of the house: does any resolve to an active acting person?
    FOR v_role_user IN
      SELECT user_id FROM user_roles
      WHERE role = 'hm' AND scope_house_id = p_house_id
    LOOP
      v_hm_acting := resolve_hm_for_user(v_role_user, v_date::timestamp AT TIME ZONE 'America/New_York', v_date);
      EXIT WHEN v_hm_acting IS NOT NULL;
    END LOOP;

    FOR v_role_user IN
      SELECT user_id FROM user_roles
      WHERE role = 'bm' AND scope_house_id = p_house_id
    LOOP
      v_bm_acting := resolve_hm_for_user(v_role_user, v_date::timestamp AT TIME ZONE 'America/New_York', v_date);
      EXIT WHEN v_bm_acting IS NOT NULL;
    END LOOP;

    -- Uncovered: neither the HM slot nor the BM slot resolves to anyone active.
    IF v_hm_acting IS NULL AND v_bm_acting IS NULL THEN
      RETURN v_date;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- ============================================================
-- Re-create submit_hm_leave to add (2) the dual-coverage guard and (3) the
-- depth-10 flag+notify, preserving the existing cycle re-check (§2.6 #146).
-- The guard/flag run AFTER the cycle check and the INSERT so they see the
-- proposed leave's effect on resolution (the new row participates in the walk).
-- ============================================================
CREATE OR REPLACE FUNCTION submit_hm_leave(
  p_user_id            uuid,
  p_start_date         date,
  p_end_date           date,
  p_replacement_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leave_id        uuid;
  v_cursor          uuid;
  v_steps           integer := 0;
  v_house_id        text;
  v_uncovered_date  date;
  v_walk            record;
  v_scan_date       date;
BEGIN
  LOCK TABLE hm_leave IN SHARE ROW EXCLUSIVE MODE;

  -- §2.6 #146 — submission-time cycle re-check (unchanged). The 64-step bound is
  -- a generic safety stop against a pre-existing data cycle; the §2.6 depth-10
  -- resolution limit is handled separately below (the two are distinct concerns).
  IF p_replacement_user_id IS NOT NULL THEN
    v_cursor := p_replacement_user_id;
    WHILE v_cursor IS NOT NULL AND v_steps < 64 LOOP
      IF v_cursor = p_user_id THEN
        RAISE EXCEPTION
          'Selected replacement is now in your incoming delegation chain (cycle); please re-select'
          USING ERRCODE = 'check_violation';
      END IF;

      SELECT replacement_user_id
        INTO v_cursor
      FROM hm_leave
      WHERE user_id = v_cursor
        AND status = 'active'
      ORDER BY start_date DESC, leave_id
      LIMIT 1;

      v_steps := v_steps + 1;
    END LOOP;
  END IF;

  INSERT INTO hm_leave (user_id, start_date, end_date, replacement_user_id, status)
  VALUES (p_user_id, p_start_date, p_end_date, p_replacement_user_id, 'active')
  RETURNING leave_id INTO v_leave_id;

  SELECT home_house_id INTO v_house_id FROM users WHERE user_id = p_user_id;

  -- (3) §2.6 #148 — depth-10 resolution walk runs FIRST. A depth-10 hit is a
  -- CONFIG-ERROR DEGRADE, not a hard reject: it flags the error, notifies
  -- admin/chain/HMOD (once), and routes the house's notifications to the HMOD on
  -- duty until manually resolved. Because HMOD then covers the house, we do NOT
  -- additionally hard-reject on the coverage guard below for the same submission
  -- (the depth-exceeded walk would necessarily read as "uncovered" too). Scan
  -- each operating date in the window; flag on the first date that overflows.
  FOR v_scan_date IN
    SELECT oc.date
    FROM operating_calendar oc
    WHERE oc.date BETWEEN p_start_date AND p_end_date
    ORDER BY oc.date
  LOOP
    SELECT * INTO v_walk FROM leave_resolution_walk(p_user_id, v_scan_date);
    IF v_walk.depth_exceeded THEN
      PERFORM flag_leave_depth_error(
        COALESCE(v_house_id, '(unknown)'),
        p_user_id,
        v_walk.chain,
        (p_start_date::timestamp AT TIME ZONE 'America/New_York')
      );
      -- Degraded accept: leave stands, house routes to HMOD. Skip the coverage
      -- guard (HMOD now covers) and return.
      RETURN v_leave_id;
    END IF;
  END LOOP;

  -- (2) §2.6 #162 — no house left with neither HM nor BM (nor cross-house
  -- replacement) active on any operating day of the window. The just-inserted
  -- row participates in resolution, so this sees the proposed effect. Only
  -- reached when the resolution walk did NOT overflow (otherwise HMOD covers).
  IF v_house_id IS NOT NULL THEN
    v_uncovered_date := first_uncovered_date_for_house(v_house_id, p_start_date, p_end_date);
    IF v_uncovered_date IS NOT NULL THEN
      RAISE EXCEPTION
        'This leave would leave house % with neither its HM nor BM (nor a different-house replacement) active on %; designate a replacement from a different house'
        , v_house_id, v_uncovered_date
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN v_leave_id;
END;
$$;

-- Grants (mirror 20260601000003: SECURITY DEFINER, service-role-only; the web
-- calls them via the service client after authz).
REVOKE ALL ON FUNCTION house_has_open_leave_config_error(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION leave_resolution_walk(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION flag_leave_depth_error(text, uuid, uuid[], timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION first_uncovered_date_for_house(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_hm_leave(uuid, date, date, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION house_has_open_leave_config_error(text) TO service_role;
GRANT EXECUTE ON FUNCTION leave_resolution_walk(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION flag_leave_depth_error(text, uuid, uuid[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION first_uncovered_date_for_house(text, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION submit_hm_leave(uuid, date, date, uuid) TO service_role;

-- rollback:
-- (restore submit_hm_leave body from 20260601000003)
-- DROP FUNCTION IF EXISTS first_uncovered_date_for_house(text, date, date);
-- DROP FUNCTION IF EXISTS flag_leave_depth_error(text, uuid, uuid[], timestamptz);
-- DROP FUNCTION IF EXISTS leave_resolution_walk(uuid, date);
-- DROP FUNCTION IF EXISTS house_has_open_leave_config_error(text);
-- DROP TABLE IF EXISTS leave_config_errors CASCADE;
