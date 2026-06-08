-- Migration: S3 — Allied resolved-state + unresolved-only inbox (web-remediation #3).
--
-- BSpec §2.6 / §7.1 (HMOD-for-Allied terminal). When the escalation chain resolves
-- past HM and HMOD to the project administrator, an `hmod_urgent` notification is
-- raised (migration 20260528000025) carrying { target, reason, house_id, block_id,
-- block_start_at }. Until now that alert had no "I handled it" state, so the action
-- inbox could never clear an Allied request once raised.
--
-- This adds a two-column resolved marker on `notifications` (meaningful only for
-- `hmod_urgent`) and ONE SECURITY DEFINER RPC, `set_allied_resolved`, that an
-- HM/BM of the alert's house — or the on-duty HMOD — calls to set / clear it. The
-- inbox's default view then shows only UNRESOLVED Allied requests; resolved ones
-- move behind a "Show resolved" view.
--
-- Resolved ≠ covered: this RPC mutates NO shift_block_assignments / coverage state.
-- It is purely an inbox acknowledgement that a human has actioned the alert (called
-- Allied / arranged cover out-of-band). Non-urgent notifications continue to use the
-- existing mark_notification_read (migration 20260601000001) — unchanged here.

-- ---------------------------------------------------------------------------
-- D1 — resolved-state columns (idempotent; meaningful only for hmod_urgent).
-- No CHECK ties them to the type — the RPC is the only intended writer and gates
-- on type itself, and a loose column keeps re-application safe.
-- ---------------------------------------------------------------------------
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users (user_id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- D2 — set_allied_resolved: set or clear the resolved marker on an hmod_urgent
-- alert. Returns "state changed": true when it set/cleared, false when the row was
-- already in the target state (idempotent no-op, NOT an error).
--
-- Body order is load-bearing:
--   1. fetch type + payload.house_id (404 if the row is gone);
--   2. type gate (must be hmod_urgent) — BEFORE authz, because authz needs the
--      house_id from the payload;
--   3. spoof guard (authed caller may only act as themselves — mirrors
--      mark_notification_read);
--   4. authorization: HM/BM of the alert's house OR the on-duty HMOD at p_now;
--   5. the conditional WHERE … IS [NOT] NULL is what makes a double-resolve return
--      false without error.
-- RAISE messages are the bare tokens; the default P0001 errcode is correct.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_allied_resolved(
  p_notification_id uuid,
  p_user_id uuid,
  p_resolved boolean,
  p_now timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type  notification_type;
  v_house text;
BEGIN
  -- 1. Resolve the notification's type + payload.house_id.
  SELECT type, payload ->> 'house_id'
    INTO v_type, v_house
  FROM notifications
  WHERE notification_id = p_notification_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification_not_found';
  END IF;

  -- 2. Type gate (before authz — authz needs v_house from the payload).
  IF v_type <> 'hmod_urgent' THEN
    RAISE EXCEPTION 'not_resolvable';
  END IF;

  -- 3. Spoof guard: an authed caller may only act as themselves.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- 4. Authorization: HM/BM of the alert's house, or the on-duty HMOD at p_now.
  IF NOT (
    user_has_house_admin_role(p_user_id, v_house)
    OR p_user_id = resolve_hmod_on_duty(p_now)
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- 5. Set or clear. The IS [NOT] NULL guard makes a repeat a no-op (FOUND=false).
  IF p_resolved THEN
    UPDATE notifications
    SET resolved_at = p_now,
        resolved_by = p_user_id
    WHERE notification_id = p_notification_id
      AND resolved_at IS NULL;
  ELSE
    UPDATE notifications
    SET resolved_at = NULL,
        resolved_by = NULL
    WHERE notification_id = p_notification_id
      AND resolved_at IS NOT NULL;
  END IF;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION set_allied_resolved(uuid, uuid, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_allied_resolved(uuid, uuid, boolean, timestamptz) TO authenticated, service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS set_allied_resolved(uuid, uuid, boolean, timestamptz);
-- ALTER TABLE notifications DROP COLUMN IF EXISTS resolved_by;
-- ALTER TABLE notifications DROP COLUMN IF EXISTS resolved_at;
