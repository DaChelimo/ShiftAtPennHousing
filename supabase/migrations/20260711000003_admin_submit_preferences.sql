-- Migration: admin_submit_preferences — a schedule builder authors ONE worker's
-- semester preferences on that worker's behalf (BSpec §4.2/§4.4 build-prep).
--
-- The oversight screen (/admin/preferences) lets an SM/HM/BM/RSM/admin open a
-- roster member and paint their availability in the same grid the worker uses.
-- The self-submit path (submit_preferences, called by the submit-preferences Edge
-- Function) is JWT-scoped to the actor, so it cannot write another user's rows;
-- this RPC is the on-behalf analogue and mirrors override.ts / admin_seed_preferences:
--
--   * SECURITY DEFINER, granted to service_role ONLY. The web calls it through the
--     service client (auth.uid() is NULL there), so the actor uuid is passed
--     explicitly and re-verified with user_can_build_schedule(actor, target_house)
--     as defense-in-depth. The real gate is the server action's canBuildForHouse().
--     Heeds the confused-deputy audit: caller-supplied uuid is only dangerous when
--     COMBINED with a grant to `authenticated` — the service-role-only grant closes
--     that. A plain sm may author only their own house (user_can_build_schedule
--     is own-house for sm, cross-house for hm/bm/rsm/admin).
--
--   * Managers OVERRIDE the preference deadline (stakeholder decision 2026-07-11):
--     they may enter a worker's preferences even after the window has closed. The
--     preferences/period_targets writes fire enforce_preference_deadline (NOT
--     service-role-bypassed), so — exactly like admin_seed_preferences — the
--     function LOCKS the period, opens the window (deadline := NULL) for the write,
--     then restores the saved deadline. NULL deadline = open.
--
--   * UPSERT semantics match submit_preferences (full-grid payload from
--     buildSubmitPayload): ON CONFLICT overwrite, no cross-user wipe. This edits
--     exactly one worker and never touches anyone else's rows.
--
-- Hours are unchanged by preferences (targets are a build INPUT, not scheduled
-- hours), so no hours-cap invariant is engaged here.

CREATE OR REPLACE FUNCTION admin_submit_preferences(
  p_actor_user_id  uuid,
  p_target_user_id uuid,
  p_period_id      uuid,
  p_preferences    jsonb,
  p_target_hours   integer,
  p_opted_out      boolean DEFAULT false
)
RETURNS TABLE (
  preferences_upserted integer,
  target_upserted      integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_house_id       text;
  v_saved_deadline timestamptz;
  v_pref_count     integer := 0;
  v_target_count   integer := 0;
BEGIN
  -- Resolve the target worker's home house — the authorization scope.
  SELECT u.home_house_id
    INTO v_house_id
  FROM users u
  WHERE u.user_id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such worker %', p_target_user_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Re-verify the actor may build the schedule for that worker's house
  -- (sm = own house; hm/bm/rsm/admin = any house). Defense-in-depth behind the
  -- server action's own canBuildForHouse() gate.
  IF NOT user_can_build_schedule(p_actor_user_id, v_house_id) THEN
    RAISE EXCEPTION 'Not authorized to edit preferences for this worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF jsonb_typeof(COALESCE(p_preferences, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'preferences must be an array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Lock the period and stash its deadline so concurrent writers serialize behind us.
  SELECT sp.preference_deadline
    INTO v_saved_deadline
  FROM scheduling_periods sp
  WHERE sp.period_id = p_period_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No scheduling period % exists.', p_period_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Open the preference window for the duration of the write (manager override).
  UPDATE scheduling_periods SET preference_deadline = NULL WHERE period_id = p_period_id;

  INSERT INTO preferences (user_id, block_id, period_id, status)
  SELECT
    p_target_user_id,
    (entry.value ->> 'block_id')::uuid,
    p_period_id,
    (entry.value ->> 'status')::preference_status_enum
  FROM jsonb_array_elements(COALESCE(p_preferences, '[]'::jsonb)) AS entry(value)
  ON CONFLICT (user_id, block_id, period_id)
  DO UPDATE SET status = EXCLUDED.status;
  GET DIAGNOSTICS v_pref_count = ROW_COUNT;

  INSERT INTO period_targets (user_id, period_id, target_hours, opted_out)
  VALUES (p_target_user_id, p_period_id, p_target_hours, COALESCE(p_opted_out, false))
  ON CONFLICT (user_id, period_id)
  DO UPDATE SET
    target_hours = EXCLUDED.target_hours,
    opted_out    = EXCLUDED.opted_out;
  GET DIAGNOSTICS v_target_count = ROW_COUNT;

  -- Restore the deadline exactly as it was (this edit never changes the window).
  UPDATE scheduling_periods SET preference_deadline = v_saved_deadline
  WHERE period_id = p_period_id;

  RETURN QUERY SELECT v_pref_count, v_target_count;
END;
$$;

REVOKE ALL ON FUNCTION admin_submit_preferences(uuid, uuid, uuid, jsonb, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_submit_preferences(uuid, uuid, uuid, jsonb, integer, boolean) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS admin_submit_preferences(uuid, uuid, uuid, jsonb, integer, boolean);
