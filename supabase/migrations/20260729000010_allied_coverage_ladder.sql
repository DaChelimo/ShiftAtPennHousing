-- Migration: Allied coverage escalation ladder (RSM -> HM -> HMOD) with required
-- human close-out.
--
-- Plan: docs/allied-coverage-alerting/PLAN.md
-- Spec: BEHAVIORAL_SPECIFICATION §5.4 / §10.1 / §13 / §14; ARCHITECTURE §4.2 / §4.6.
--
-- WHY THIS EXISTS
-- ---------------
-- Before this migration, exhausting the escalation chain produced exactly ONE
-- `hmod_urgent` notification, to exactly ONE person, once, and then the system
-- considered its job done:
--
--   * `block_step_status` ON CONFLICT DO NOTHING retires the step, so no reminder and
--     no second recipient are ever possible. Verified live 2026-07-29: three
--     escalation calls 90 minutes and 4 hours apart produced 1 notification and 1
--     distinct recipient.
--   * The recipient has no push devices (only the worker mobile app registers
--     `push_tokens`), so `dispatch-push` returns
--     {"delivered":true,"attemptedDevices":0} and stamps `delivered_at`. The system
--     records the alert as delivered having contacted no human. Verified live.
--   * The alert then archived itself at the coverage-window end whether or not anyone
--     acted, and was discarded 24h later, leaving no record that a desk went empty.
--
-- This migration replaces that one-shot with a tracked request that escalates through
-- three named rungs, reminds within a rung, and can only leave the active view when a
-- human records what actually happened.
--
-- LADDER (stakeholder decision 2026-07-29)
-- ----------------------------------------
--   rung 1  rsm    resolve_rsm_for_house(house, now)
--   rung 2  hm     resolve_hm_for_house(house, now)   -- walks the hm_leave chain
--   rung 3  hmod   resolve_hmod_on_duty(now)          -- campus rotor, TERMINAL
--   (rung 4 admin  system_config('project_administrator_user_id') -- last resort only)
--
-- Never fanned out to any other manager, and never to other RSMs. A rung whose
-- resolver returns NULL is SKIPPED immediately rather than burning its timeout on an
-- unreachable seat.
--
-- !! SUPERSEDES A DOCUMENTED RULE. BSpec §10.1 previously made the first contact
-- !! hours-dependent: the RSM during HM working hours, the HMOD outside them. The
-- !! ladder now starts at the RSM UNCONDITIONALLY and reaches the HMOD as rung 3.
-- !! This was explicitly requested. The off-hours pilot ladder
-- !! (`is_offhours_ladder_enabled()`, default false) is UNCHANGED and still pre-empts
-- !! this ladder off-hours when switched on.
--
-- TIMING. `allied_ladder_rung_timeout_minutes` defaults to 60 per stakeholder
-- instruction. Escalation reaches this step at roughly T-2h, so at 60 minutes the HMOD
-- is first contacted around T-0. A shorter value (20) was recommended and declined for
-- now; it is a `system_config` row, changeable without a deploy.

-- ============================================================
-- 1. Outcome vocabulary. A request cannot be closed without one.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'allied_coverage_outcome') THEN
    CREATE TYPE allied_coverage_outcome AS ENUM (
      'allied_secured',      -- Allied was booked for the window
      'covered_internally',  -- a worker picked it up or was assigned
      'desk_unstaffed',      -- nobody covered it; the desk was empty. An incident.
      'no_longer_needed'     -- block voided, or the desk regained a present worker
    );
  END IF;
END;
$$;

-- ============================================================
-- 2. The request. One open row per contiguous uncovered stretch per house.
-- ============================================================
CREATE TABLE IF NOT EXISTS allied_coverage_requests (
  request_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The FIRST block of the stretch. Anchor only: the window below is authoritative,
  -- because adjacent blocks coalesce into one request (see open_allied_coverage_request).
  block_id          uuid        NOT NULL REFERENCES shift_blocks (block_id) ON DELETE CASCADE,
  house_id          text        NOT NULL REFERENCES houses (id),
  window_start_at   timestamptz NOT NULL,
  window_end_at     timestamptz NOT NULL,
  reason            text        NOT NULL,
  current_rung      text        NOT NULL CHECK (current_rung IN ('rsm', 'hm', 'hmod', 'admin')),
  rung_fired_at     timestamptz NOT NULL,
  last_reminder_at  timestamptz,
  current_recipient uuid        REFERENCES users (user_id),
  acknowledged_at   timestamptz,
  acknowledged_by   uuid        REFERENCES users (user_id),
  closed_at         timestamptz,
  closed_by         uuid        REFERENCES users (user_id),
  outcome           allied_coverage_outcome,
  close_note        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allied_coverage_requests_window_order CHECK (window_end_at > window_start_at),
  -- Closed and outcome are set together, always.
  CONSTRAINT allied_coverage_requests_closed_has_outcome
    CHECK ((closed_at IS NULL) = (outcome IS NULL)),
  CONSTRAINT allied_coverage_requests_ack_pair
    CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL))
);

-- One OPEN request per anchor block. A closed request must not block a genuine
-- re-escalation of the same block later, hence the partial predicate.
CREATE UNIQUE INDEX IF NOT EXISTS allied_coverage_requests_one_open_per_block
  ON allied_coverage_requests (block_id) WHERE closed_at IS NULL;

-- The ladder scan: open, unacknowledged, ordered by when the current rung fired.
CREATE INDEX IF NOT EXISTS allied_coverage_requests_ladder_scan
  ON allied_coverage_requests (rung_fired_at)
  WHERE acknowledged_at IS NULL AND closed_at IS NULL;

-- The manager's list, and the coalescing lookup.
CREATE INDEX IF NOT EXISTS allied_coverage_requests_open_by_house
  ON allied_coverage_requests (house_id, window_end_at) WHERE closed_at IS NULL;

COMMENT ON TABLE allied_coverage_requests IS
  'One Allied-procurement escalation, tracked from first page to human close-out. '
  'Never auto-clears: an open request past its window is overdue, not archived.';

ALTER TABLE allied_coverage_requests ENABLE ROW LEVEL SECURITY;

-- READ: the same audience that already sees the Action Inbox and inbound floats
-- (sm/hm/bm/rsm via user_can_build_schedule), plus an unconditional admin clause.
-- There is deliberately NO client INSERT/UPDATE/DELETE policy: every write goes
-- through a SECURITY DEFINER RPC below, which re-checks authorization itself.
DROP POLICY IF EXISTS "schedule admins can select coverage requests" ON allied_coverage_requests;
CREATE POLICY "schedule admins can select coverage requests"
  ON allied_coverage_requests FOR SELECT
  USING (
    user_can_build_schedule(auth.uid(), house_id)
    OR user_is_admin(auth.uid())
  );

-- An RLS POLICY IS NOT ENOUGH. Table-level privileges are checked BEFORE any policy,
-- and a table created by a migration does not inherit a SELECT grant here, so without
-- the line below every signed-in manager gets a bare "permission denied for table"
-- and the Action Inbox renders an empty state while real requests sit unactioned.
-- Caught in browser verification on 2026-07-29; the pgTAP suite missed it because
-- pgTAP runs as a superuser, for which neither grants nor RLS apply.
--
-- SELECT only, and to `authenticated` ONLY. Deliberately NOT to `anon`: this project
-- has regressed an accidental `GRANT ... TO anon` three separate times on view
-- migrations, which is why scripts/hooks/anon-grant-guard.js exists. Writes stay
-- closed to clients entirely; they go through the SECURITY DEFINER RPCs.
GRANT SELECT ON allied_coverage_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON allied_coverage_requests TO service_role;

-- ============================================================
-- 3. Configuration (BSpec §14).
-- ============================================================
CREATE OR REPLACE FUNCTION allied_ladder_rung_timeout_minutes()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF((SELECT config_value FROM system_config
             WHERE config_key = 'allied_ladder_rung_timeout_minutes'), '')::integer,
    60
  );
$$;

REVOKE ALL ON FUNCTION allied_ladder_rung_timeout_minutes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION allied_ladder_rung_timeout_minutes() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION allied_ladder_rung_timeout_minutes() TO service_role;

CREATE OR REPLACE FUNCTION allied_ladder_reminder_minutes()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF((SELECT config_value FROM system_config
             WHERE config_key = 'allied_ladder_reminder_minutes'), '')::integer,
    15
  );
$$;

REVOKE ALL ON FUNCTION allied_ladder_reminder_minutes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION allied_ladder_reminder_minutes() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION allied_ladder_reminder_minutes() TO service_role;

-- ============================================================
-- 4. Rung resolution.
-- ============================================================

-- The next rung after p_rung, or NULL when p_rung is terminal.
-- 'admin' is NOT part of the walk; it is only ever a last-resort substitution made
-- inside resolve_allied_ladder_rung when every real rung is unreachable.
CREATE OR REPLACE FUNCTION allied_ladder_next_manager_rung(p_rung text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_rung
           WHEN 'rsm' THEN 'hm'
           WHEN 'hm'  THEN 'hmod'
           ELSE NULL          -- 'hmod' is terminal; 'admin' is terminal.
         END;
$$;

-- Resolve a rung to a live recipient, SKIPPING rungs whose resolver returns NULL
-- (no RSM for the house, whole HM leave chain out, empty rotor). Returns the rung
-- actually landed on plus its recipient, or (NULL, NULL) when nobody at all is
-- reachable and there is no configured project administrator.
CREATE OR REPLACE FUNCTION resolve_allied_ladder_rung(
  p_house_id  text,
  p_from_rung text,
  p_now       timestamptz
)
RETURNS TABLE (rung text, recipient_user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rung      text := p_from_rung;
  v_recipient uuid;
  v_admin_id  uuid;
BEGIN
  WHILE v_rung IS NOT NULL LOOP
    v_recipient := CASE v_rung
                     WHEN 'rsm'  THEN resolve_rsm_for_house(p_house_id, p_now)
                     WHEN 'hm'   THEN resolve_hm_for_house(p_house_id, p_now)
                     WHEN 'hmod' THEN resolve_hmod_on_duty(p_now)
                     ELSE NULL
                   END;

    IF v_recipient IS NOT NULL THEN
      rung := v_rung;
      recipient_user_id := v_recipient;
      RETURN NEXT;
      RETURN;
    END IF;

    -- Unreachable rung: do not burn its timeout, move on now.
    v_rung := allied_ladder_next_manager_rung(v_rung);
  END LOOP;

  -- Every manager rung was unreachable. Fall back to the project-administrator
  -- terminal, exactly as the pre-ladder code did (BSpec §2.6).
  SELECT config_value::uuid INTO v_admin_id
  FROM system_config
  WHERE config_key = 'project_administrator_user_id';

  IF v_admin_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM users WHERE user_id = v_admin_id AND is_active) THEN
    rung := 'admin';
    recipient_user_id := v_admin_id;
    RETURN NEXT;
    RETURN;
  END IF;

  rung := NULL;
  recipient_user_id := NULL;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION resolve_allied_ladder_rung(text, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION resolve_allied_ladder_rung(text, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_allied_ladder_rung(text, text, timestamptz) TO service_role;

-- ============================================================
-- 5. Notification emission for a rung.
-- ============================================================
-- Deliberately reuses the EXISTING `hmod_urgent` notification type rather than adding
-- an enum value: every current consumer (the Action Inbox read model, the bell count,
-- dispatch-push) keeps working untouched. The payload gains request_id / rung /
-- rung_deadline_at, and restores `block_end_at` (see section 8).
CREATE OR REPLACE FUNCTION emit_allied_coverage_notification(
  p_request_id uuid,
  p_now        timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req             allied_coverage_requests;
  v_notification_id uuid;
BEGIN
  SELECT * INTO v_req FROM allied_coverage_requests WHERE request_id = p_request_id;
  IF NOT FOUND OR v_req.current_recipient IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
  VALUES (
    v_req.current_recipient,
    'hmod_urgent'::notification_type,
    p_now,
    jsonb_build_object(
      'target',            v_req.current_rung,
      'rung',              v_req.current_rung,
      'request_id',        v_req.request_id,
      'reason',            v_req.reason,
      'block_id',          v_req.block_id,
      'house_id',          v_req.house_id,
      'block_start_at',    v_req.window_start_at,
      'block_end_at',      v_req.window_end_at,
      'rung_deadline_at',  p_now + make_interval(mins => allied_ladder_rung_timeout_minutes())
    )
  )
  RETURNING notification_id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;

REVOKE ALL ON FUNCTION emit_allied_coverage_notification(uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_allied_coverage_notification(uuid, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION emit_allied_coverage_notification(uuid, timestamptz) TO service_role;

-- ============================================================
-- 6. Opening a request.
-- ============================================================
-- COALESCING. The hmod_notify_allied chain step is inherently one fire per 30-minute
-- block, so a 4-hour empty stretch used to produce 8 separate pages. When the new
-- window butts up against (or overlaps) an already-open request for the same house,
-- we EXTEND that request instead of opening a second one, and do not re-page. The
-- manager sees one request for one contiguous stretch, which is how they think about
-- it. The anchor block_id stays the first block, so the one-open-per-block unique
-- index is unaffected.
CREATE OR REPLACE FUNCTION open_allied_coverage_request(
  p_block_id        uuid,
  p_house_id        text,
  p_window_start_at timestamptz,
  p_window_end_at   timestamptz,
  p_reason          text,
  p_now             timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_rung        text;
  v_recipient   uuid;
  v_request_id  uuid;
BEGIN
  -- Extend an adjacent/overlapping open request for the same house rather than
  -- opening a second one. FOR UPDATE so two concurrent ticks cannot both extend.
  SELECT request_id INTO v_existing_id
  FROM allied_coverage_requests
  WHERE house_id = p_house_id
    AND closed_at IS NULL
    AND window_end_at >= p_window_start_at
    AND window_start_at <= p_window_end_at
  ORDER BY window_start_at
  LIMIT 1
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    UPDATE allied_coverage_requests
    SET window_start_at = LEAST(window_start_at, p_window_start_at),
        window_end_at   = GREATEST(window_end_at, p_window_end_at)
    WHERE request_id = v_existing_id;

    RETURN jsonb_build_object(
      'request_id', v_existing_id, 'created', false, 'coalesced', true,
      'rung', NULL, 'recipient_user_id', NULL);
  END IF;

  SELECT r.rung, r.recipient_user_id INTO v_rung, v_recipient
  FROM resolve_allied_ladder_rung(p_house_id, 'rsm', p_now) r;

  IF v_rung IS NULL THEN
    -- Nobody reachable at all, and no project administrator configured. Do NOT
    -- silently swallow this: it is a deployment defect that costs a staffed desk.
    RAISE WARNING 'open_allied_coverage_request: no reachable recipient for block % (house %); set system_config.project_administrator_user_id to an active admin user_id',
      p_block_id, p_house_id;
    RETURN jsonb_build_object(
      'request_id', NULL, 'created', false, 'coalesced', false,
      'rung', NULL, 'recipient_user_id', NULL);
  END IF;

  INSERT INTO allied_coverage_requests (
    block_id, house_id, window_start_at, window_end_at, reason,
    current_rung, rung_fired_at, last_reminder_at, current_recipient)
  VALUES (
    p_block_id, p_house_id, p_window_start_at, p_window_end_at, p_reason,
    v_rung, p_now, p_now, v_recipient)
  ON CONFLICT (block_id) WHERE closed_at IS NULL DO NOTHING
  RETURNING request_id INTO v_request_id;

  IF v_request_id IS NULL THEN
    -- Lost a race with a concurrent tick; the other one paged.
    SELECT request_id INTO v_request_id
    FROM allied_coverage_requests
    WHERE block_id = p_block_id AND closed_at IS NULL;
    RETURN jsonb_build_object(
      'request_id', v_request_id, 'created', false, 'coalesced', false,
      'rung', NULL, 'recipient_user_id', NULL);
  END IF;

  PERFORM emit_allied_coverage_notification(v_request_id, p_now);

  RETURN jsonb_build_object(
    'request_id', v_request_id, 'created', true, 'coalesced', false,
    'rung', v_rung, 'recipient_user_id', v_recipient);
END;
$$;

REVOKE ALL ON FUNCTION open_allied_coverage_request(uuid, text, timestamptz, timestamptz, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION open_allied_coverage_request(uuid, text, timestamptz, timestamptz, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION open_allied_coverage_request(uuid, text, timestamptz, timestamptz, text, timestamptz) TO service_role;

-- ============================================================
-- 7. Advancing the ladder. Called once per orchestrator tick.
-- ============================================================
-- Per open, unacknowledged request:
--   * past rung_fired_at + timeout  -> advance to the next reachable rung and page.
--   * else past last_reminder_at + reminder interval -> re-page the SAME holder.
--   * terminal rung past its timeout -> stay put. Nobody new to page. The request
--     stays open and goes overdue; it is never auto-closed.
CREATE OR REPLACE FUNCTION advance_allied_coverage_ladder(
  p_now   timestamptz,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_timeout    integer := allied_ladder_rung_timeout_minutes();
  v_reminder   integer := allied_ladder_reminder_minutes();
  v_req        record;
  v_next_rung  text;
  v_rung       text;
  v_recipient  uuid;
  v_escalated  integer := 0;
  v_reminded   integer := 0;
  v_terminal   integer := 0;
BEGIN
  FOR v_req IN
    SELECT *
    FROM allied_coverage_requests
    WHERE closed_at IS NULL
      AND acknowledged_at IS NULL
    ORDER BY rung_fired_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    IF p_now >= v_req.rung_fired_at + make_interval(mins => v_timeout) THEN
      v_next_rung := allied_ladder_next_manager_rung(v_req.current_rung);

      IF v_next_rung IS NULL THEN
        -- Terminal rung. Keep reminding the holder; there is nobody above them.
        IF v_req.last_reminder_at IS NULL
           OR p_now >= v_req.last_reminder_at + make_interval(mins => v_reminder) THEN
          UPDATE allied_coverage_requests
          SET last_reminder_at = p_now
          WHERE request_id = v_req.request_id;
          PERFORM emit_allied_coverage_notification(v_req.request_id, p_now);
          v_reminded := v_reminded + 1;
        END IF;
        v_terminal := v_terminal + 1;
        CONTINUE;
      END IF;

      SELECT r.rung, r.recipient_user_id INTO v_rung, v_recipient
      FROM resolve_allied_ladder_rung(v_req.house_id, v_next_rung, p_now) r;

      IF v_rung IS NULL THEN
        -- Nobody above is reachable either. Hold position and keep reminding.
        v_terminal := v_terminal + 1;
        CONTINUE;
      END IF;

      UPDATE allied_coverage_requests
      SET current_rung      = v_rung,
          current_recipient = v_recipient,
          rung_fired_at     = p_now,
          last_reminder_at  = p_now
      WHERE request_id = v_req.request_id;

      PERFORM emit_allied_coverage_notification(v_req.request_id, p_now);
      v_escalated := v_escalated + 1;

    ELSIF v_req.last_reminder_at IS NULL
          OR p_now >= v_req.last_reminder_at + make_interval(mins => v_reminder) THEN
      UPDATE allied_coverage_requests
      SET last_reminder_at = p_now
      WHERE request_id = v_req.request_id;
      PERFORM emit_allied_coverage_notification(v_req.request_id, p_now);
      v_reminded := v_reminded + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'escalated', v_escalated,
    'reminded',  v_reminded,
    'terminal',  v_terminal);
END;
$$;

REVOKE ALL ON FUNCTION advance_allied_coverage_ladder(timestamptz, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION advance_allied_coverage_ladder(timestamptz, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION advance_allied_coverage_ladder(timestamptz, integer) TO service_role;

-- ============================================================
-- 8. Acknowledge and close.
-- ============================================================
-- ACKNOWLEDGE = "I have seen this and I am handling it." Stops escalation and
-- reminders. It does NOT close the request: the outcome is still unrecorded, and an
-- acknowledged-but-unclosed request still goes overdue. Collapsing these two into one
-- control is exactly the behavior that lost the audit trail before this migration.
--
-- Permitted for: the current recipient, any manager who can build for the house, or
-- an admin. Deliberately not restricted to the current rung holder alone. If an RSM
-- picks up a request that has already escalated to their HM, that is a good outcome.
CREATE OR REPLACE FUNCTION acknowledge_allied_coverage_request(
  p_request_id uuid,
  p_user_id    uuid,
  p_now        timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req allied_coverage_requests;
BEGIN
  -- Spoof guard: a caller may only act as themselves unless service_role.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_req FROM allied_coverage_requests
  WHERE request_id = p_request_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;

  IF NOT (v_req.current_recipient = p_user_id
          OR user_can_build_schedule(p_user_id, v_req.house_id)
          OR user_is_admin(p_user_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_req.closed_at IS NOT NULL THEN
    RETURN jsonb_build_object('acknowledged', false, 'reason', 'already_closed');
  END IF;

  IF v_req.acknowledged_at IS NOT NULL THEN
    -- Idempotent: acknowledging twice is a no-op, not an error.
    RETURN jsonb_build_object('acknowledged', false, 'reason', 'already_acknowledged');
  END IF;

  UPDATE allied_coverage_requests
  SET acknowledged_at = p_now,
      acknowledged_by = p_user_id
  WHERE request_id = p_request_id;

  -- Silence the outstanding pages for this request on every surface.
  UPDATE notifications
  SET acknowledged_at = p_now
  WHERE type = 'hmod_urgent'::notification_type
    AND payload ->> 'request_id' = p_request_id::text
    AND acknowledged_at IS NULL;

  RETURN jsonb_build_object('acknowledged', true);
END;
$$;

REVOKE ALL ON FUNCTION acknowledge_allied_coverage_request(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION acknowledge_allied_coverage_request(uuid, uuid, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION acknowledge_allied_coverage_request(uuid, uuid, timestamptz) TO service_role;

-- CLOSE = "here is what actually happened." Requires an outcome. This is the only
-- way a request leaves the active view.
CREATE OR REPLACE FUNCTION close_allied_coverage_request(
  p_request_id uuid,
  p_user_id    uuid,
  p_outcome    allied_coverage_outcome,
  p_note       text,
  p_now        timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req allied_coverage_requests;
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

REVOKE ALL ON FUNCTION close_allied_coverage_request(uuid, uuid, allied_coverage_outcome, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION close_allied_coverage_request(uuid, uuid, allied_coverage_outcome, text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION close_allied_coverage_request(uuid, uuid, allied_coverage_outcome, text, timestamptz) TO service_role;

-- The ONE case the system may close on its own: the coverage is no longer needed
-- because the block was voided or the desk regained a present worker. This is a
-- status write, not a coverage revocation, so hard invariant #3 (no-takeback) is
-- untouched. Nothing else auto-closes a request, ever.
CREATE OR REPLACE FUNCTION system_close_obsolete_coverage_requests(p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed integer;
BEGIN
  WITH obsolete AS (
    SELECT r.request_id
    FROM allied_coverage_requests r
    JOIN shift_blocks sb ON sb.block_id = r.block_id
    WHERE r.closed_at IS NULL
      AND (sb.voided_at IS NOT NULL OR block_has_escalation_coverage(r.block_id))
    FOR UPDATE OF r
  )
  UPDATE allied_coverage_requests r
  SET closed_at = p_now,
      outcome   = 'no_longer_needed'::allied_coverage_outcome,
      acknowledged_at = COALESCE(r.acknowledged_at, p_now)
  FROM obsolete o
  WHERE r.request_id = o.request_id;

  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION system_close_obsolete_coverage_requests(timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION system_close_obsolete_coverage_requests(timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION system_close_obsolete_coverage_requests(timestamptz) TO service_role;

-- ============================================================
-- 9. Wire the two escalation terminals to open a request instead of paging once.
--
--    ALSO FIXES A LIVE REGRESSION. Migration 20260624000001 added a `block_end_at`
--    payload key so the Action Inbox could render the true coverage window. Migration
--    20260713000001 then reproduced BOTH of these functions from the older
--    20260617000006 and silently dropped that key again. Verified against the live
--    catalog on 2026-07-29: neither function contained `block_end_at`. Effect: every
--    Allied alert rendered as a 30-minute window (alliedWindowEndIso falls back to
--    start + 30m) and archived up to 3.5 hours early on a 4-hour no-ack gap. The
--    window is now carried on the request row itself, so it cannot silently regress
--    to a fallback again.
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
  v_claimed_count integer;
  v_open          jsonb;
BEGIN
  INSERT INTO block_step_status (block_id, step_name, status, fired_at, updated_at)
  VALUES (p_block_id, 'hmod_notify_allied', 'fired', p_now, p_now)
  ON CONFLICT (block_id, step_name) DO NOTHING;

  GET DIAGNOSTICS v_claimed_count = ROW_COUNT;

  IF v_claimed_count = 0 THEN
    UPDATE block_step_status
    SET status = 'fired', fired_at = p_now, updated_at = p_now
    WHERE block_id  = p_block_id
      AND step_name = 'hmod_notify_allied'
      AND status    = 'rolled_back';

    GET DIAGNOSTICS v_claimed_count = ROW_COUNT;
  END IF;

  IF v_claimed_count = 0 THEN
    RETURN jsonb_build_object('claimed', false, 'recipient_user_id', NULL, 'target', NULL);
  END IF;

  -- Off-hours pilot ladder (2026-07-13) still pre-empts, unchanged, when switched on.
  -- It pages the desk directly (responsible worker -> SM -> desk), which can secure
  -- cover in minutes without waking a manager.
  IF NOT (is_hm_working_time(p_now) AND is_hm_working_time(p_block_start_at))
     AND is_offhours_ladder_enabled() THEN
    PERFORM start_offhours_allied_ladder(p_block_id, p_house_id, p_block_start_at, p_now, p_reason);
    RETURN jsonb_build_object('claimed', true, 'recipient_user_id', NULL, 'target', 'offhours_ladder');
  END IF;

  -- The manager ladder. Starts at the RSM unconditionally (see the header note: this
  -- supersedes the old hours-dependent first contact).
  v_open := open_allied_coverage_request(
    p_block_id, p_house_id,
    p_block_start_at, p_block_start_at + interval '30 minutes',
    p_reason, p_now);

  RETURN jsonb_build_object(
    'claimed',           true,
    'recipient_user_id', v_open ->> 'recipient_user_id',
    'target',            v_open ->> 'rung',
    'request_id',        v_open ->> 'request_id',
    'coalesced',         v_open -> 'coalesced');
END;
$$;

REVOKE ALL ON FUNCTION process_hmod_notify_allied_step(uuid, text, timestamptz, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION process_hmod_notify_allied_step(uuid, text, timestamptz, timestamptz, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION process_hmod_notify_allied_step(uuid, text, timestamptz, timestamptz, text) TO service_role;

-- The no-ack terminal. Body derived from the LIVE catalog definition so every line
-- outside the replaced branch is byte-identical; only the single-page ELSE branch
-- becomes a ladder call, carrying the TRUE float gap as the coverage window.
CREATE OR REPLACE FUNCTION process_no_ack_float(
  p_float_id uuid,
  p_now timestamptz,
  p_lookahead_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
      -- Manager coverage ladder (RSM -> HM -> HMOD) with required human close-out.
      -- The window passed here is the TRUE float gap (v_float_start_at ..
      -- v_float_end_at, up to the 4h Allied cap), not a single 30-minute block. This
      -- also repairs the block_end_at payload key that 20260713000001 dropped when it
      -- reproduced this function from 20260617000006.
      PERFORM open_allied_coverage_request(
        v_first_destination_block_id, v_destination_house_id,
        v_float_start_at, v_float_end_at,
        'float_no_acknowledgment', p_now);
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

$fn$;

REVOKE ALL ON FUNCTION process_no_ack_float(uuid, timestamptz, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION process_no_ack_float(uuid, timestamptz, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION process_no_ack_float(uuid, timestamptz, integer) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS system_close_obsolete_coverage_requests(timestamptz);
-- DROP FUNCTION IF EXISTS close_allied_coverage_request(uuid, uuid, allied_coverage_outcome, text, timestamptz);
-- DROP FUNCTION IF EXISTS acknowledge_allied_coverage_request(uuid, uuid, timestamptz);
-- DROP FUNCTION IF EXISTS advance_allied_coverage_ladder(timestamptz, integer);
-- DROP FUNCTION IF EXISTS open_allied_coverage_request(uuid, text, timestamptz, timestamptz, text, timestamptz);
-- DROP FUNCTION IF EXISTS emit_allied_coverage_notification(uuid, timestamptz);
-- DROP FUNCTION IF EXISTS resolve_allied_ladder_rung(text, text, timestamptz);
-- DROP FUNCTION IF EXISTS allied_ladder_next_manager_rung(text);
-- DROP FUNCTION IF EXISTS allied_ladder_reminder_minutes();
-- DROP FUNCTION IF EXISTS allied_ladder_rung_timeout_minutes();
-- DROP TABLE IF EXISTS allied_coverage_requests;
-- DROP TYPE IF EXISTS allied_coverage_outcome;
-- (restore process_hmod_notify_allied_step from 20260713000001.)
