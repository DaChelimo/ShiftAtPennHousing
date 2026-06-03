-- Migration: Phase 13b — HM/BM leave submission-time cycle prevention and
-- early-return ("I'm back") side effects.
--
-- Three server-transaction concerns the web layer (phase-13b) needs but that were
-- previously either missing or done client-side only:
--
--   1. submit_hm_leave        — re-runs the §2.6 incoming-chain (cycle) check INSIDE
--                               the insert transaction. The picker already excludes the
--                               incoming chain at selection time (lib/data/leave.ts), but
--                               another HM may create a leave between picker-load and
--                               submit, so §2.6 mandates the check be re-run atomically.
--   2. craft_hm_return_mailto — the "back from leave" SW-notification mailto (§2.6 #6),
--                               the analogue of craft_hm_leave_mailto.
--   3. end_hm_leave_early      — the atomic "I'm back" action: flip the leave to
--                               cancelled_early, notify the current replacement in-app
--                               that they are no longer covering (§2.6 #6), and return the
--                               back-from-leave mailto for the user to send.

-- 1. Submission-time cycle prevention ----------------------------------------
--
-- Walk the proposed replacement's FORWARD active-leave chain; if it reaches the
-- leaving user, selecting them would close a delegation cycle (§2.6). NULL
-- replacement = the project administrator is the terminal (always valid, never a
-- cycle). The table lock serializes concurrent submissions so the re-check sees a
-- stable chain — leave creation is rare, so the coarse lock is acceptable.
-- p_replacement_user_id DEFAULTs NULL: a NULL replacement means the project
-- administrator is the terminal (§2.6) — and the default lets the generated TS arg
-- be omittable for that case.
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
  v_leave_id uuid;
  v_cursor   uuid;
  v_steps    integer := 0;
BEGIN
  LOCK TABLE hm_leave IN SHARE ROW EXCLUSIVE MODE;

  IF p_replacement_user_id IS NOT NULL THEN
    v_cursor := p_replacement_user_id;
    -- The 64-step bound is a safety stop against a pre-existing cycle in the data;
    -- it is NOT the §2.6 depth-10 resolution limit (a separate resolution concern).
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

  RETURN v_leave_id;
END;
$$;

-- 2. "Back from leave" mailto -------------------------------------------------
--
-- Mirrors craft_hm_leave_mailto: a mailto: href addressed to the house's active
-- student workers. The system never sends; the user clicks the href to open their
-- mail client with the message pre-filled (§2.6 #6).
CREATE OR REPLACE FUNCTION craft_hm_return_mailto(p_leave_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_returning_name text;
  v_house_id       text;
  v_recipients     text;
  v_subject        text;
  v_body           text;
BEGIN
  SELECT leaving_user.name, leaving_user.home_house_id
    INTO v_returning_name, v_house_id
  FROM hm_leave
  JOIN users AS leaving_user
    ON leaving_user.user_id = hm_leave.user_id
  WHERE hm_leave.leave_id = p_leave_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT string_agg(DISTINCT users.email, ',' ORDER BY users.email)
    INTO v_recipients
  FROM users
  JOIN user_roles
    ON user_roles.user_id = users.user_id
   AND user_roles.role = 'sw'
  WHERE users.home_house_id = v_house_id
    AND users.is_active = true;

  v_subject := 'Housing Manager back from leave';
  v_body := format(
    '%s has returned from leave and resumed Housing Manager responsibilities. '
    || 'Emergency contact should once again go to %s.',
    v_returning_name,
    v_returning_name
  );

  RETURN 'mailto:' || COALESCE(v_recipients, '') ||
    '?subject=' || url_encode_mailto_component(v_subject) ||
    '&body=' || url_encode_mailto_component(v_body);
END;
$$;

-- 3. "I'm back" early return --------------------------------------------------
--
-- Atomic: cancel the active leave (cancelled_early + cancelled_at), notify the
-- current replacement in-app that they are no longer covering, and return the
-- back-from-leave mailto. Returns NULL if no active leave owned by p_user_id
-- matches (already returned / not theirs).
CREATE OR REPLACE FUNCTION end_hm_leave_early(
  p_leave_id uuid,
  p_user_id  uuid,
  p_now      timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_replacement_user_id uuid;
  v_returning_name      text;
BEGIN
  UPDATE hm_leave
  SET status       = 'cancelled_early',
      cancelled_at = p_now
  WHERE leave_id = p_leave_id
    AND user_id  = p_user_id
    AND status   = 'active'
  RETURNING replacement_user_id INTO v_replacement_user_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Notify the replacement they are no longer covering (§2.6 #6). Skip when the
  -- terminal replacement was the project administrator (NULL).
  IF v_replacement_user_id IS NOT NULL THEN
    SELECT name INTO v_returning_name FROM users WHERE user_id = p_user_id;

    INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
    VALUES (
      v_replacement_user_id,
      'hm_leave_notice'::notification_type,
      p_now,
      jsonb_build_object(
        'kind', 'leave_ended_early',
        'leave_id', p_leave_id,
        'returning_user_id', p_user_id,
        'returning_user_name', COALESCE(v_returning_name, ''),
        'message', COALESCE(v_returning_name, 'The housing manager')
          || ' is back from leave; you are no longer covering for them.'
      )
    );
  END IF;

  RETURN craft_hm_return_mailto(p_leave_id);
END;
$$;

-- Grants: these are SECURITY DEFINER, service-role-only (the web calls them via the
-- service client after gating on isHouseAdmin / ownership).
REVOKE ALL ON FUNCTION submit_hm_leave(uuid, date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION craft_hm_return_mailto(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION end_hm_leave_early(uuid, uuid, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION submit_hm_leave(uuid, date, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION craft_hm_return_mailto(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION end_hm_leave_early(uuid, uuid, timestamptz) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS end_hm_leave_early(uuid, uuid, timestamptz);
-- DROP FUNCTION IF EXISTS craft_hm_return_mailto(uuid);
-- DROP FUNCTION IF EXISTS submit_hm_leave(uuid, date, date, uuid);
