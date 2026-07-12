-- Migration: dev-seeding RPC — admin_seed_preferences (docs/dev-tooling/PLAN.md Feature A).
--
-- Lets an administrator write realistic simulated preferences + period targets for a
-- whole roster in one shot, so one person can exercise the summer builder without
-- logging in as every SW/SM. STRICTLY IDEMPOTENT: it wipes ALL of the period's existing
-- preferences/targets (every user, including the admin's own manual tweaks and any
-- departed workers' stale rows) and rewrites from the supplied rows.
--
-- SAFETY: SECURITY DEFINER, granted to service_role ONLY (the web calls it through the
-- service client, where auth.uid() is NULL). The actor is passed explicitly and
-- re-verified with user_is_admin(p_actor_user_id) as defense-in-depth; the real gate is
-- the server action's requireAdmin(). This heeds the confused-deputy audit: the risk it
-- flagged was a caller-supplied uuid COMBINED WITH a grant to `authenticated` — the
-- service-role-only grant is what closes that.
--
-- p_rows shape (from generateWorkerPreferences, flattened by the web action):
--   [ { "user_id": uuid, "target_hours": int, "opted_out": bool,
--       "entries": [ { "block_id": uuid, "status": "preferred"|"cannot" }, ... ] }, ... ]
--
-- The preferences/period_targets writes fire enforce_preference_deadline (INSERT/UPDATE
-- AND DELETE), which is NOT service-role-bypassed. So the function LOCKS the period,
-- opens the window (deadline := NULL), performs the wipe+insert, then restores the saved
-- deadline. NULL deadline = open (preference_deadline_is_open).

CREATE OR REPLACE FUNCTION admin_seed_preferences(
  p_actor_user_id uuid,
  p_period_id     uuid,
  p_rows          jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saved_deadline timestamptz;
  v_pref_count     integer := 0;
  v_target_count   integer := 0;
BEGIN
  IF NOT user_is_admin(p_actor_user_id) THEN
    RAISE EXCEPTION 'Only an administrator may seed preferences.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array'
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

  -- Open the preference window for the duration of the rewrite.
  UPDATE scheduling_periods SET preference_deadline = NULL WHERE period_id = p_period_id;

  -- Idempotent replace: wipe EVERY user's rows for this period, then rewrite.
  DELETE FROM preferences     WHERE period_id = p_period_id;
  DELETE FROM period_targets  WHERE period_id = p_period_id;

  INSERT INTO period_targets (user_id, period_id, target_hours, opted_out)
  SELECT (w.value ->> 'user_id')::uuid,
         p_period_id,
         (w.value ->> 'target_hours')::integer,
         COALESCE((w.value ->> 'opted_out')::boolean, false)
  FROM jsonb_array_elements(p_rows) AS w(value);
  GET DIAGNOSTICS v_target_count = ROW_COUNT;

  INSERT INTO preferences (user_id, block_id, period_id, status)
  SELECT (w.value ->> 'user_id')::uuid,
         (e.value ->> 'block_id')::uuid,
         p_period_id,
         (e.value ->> 'status')::preference_status_enum
  FROM jsonb_array_elements(p_rows) AS w(value)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.value -> 'entries', '[]'::jsonb)) AS e(value);
  GET DIAGNOSTICS v_pref_count = ROW_COUNT;

  -- Restore the deadline exactly as it was (the seed does not change the window).
  UPDATE scheduling_periods SET preference_deadline = v_saved_deadline
  WHERE period_id = p_period_id;

  RETURN jsonb_build_object('workers', v_target_count, 'preferences', v_pref_count);
END;
$$;

REVOKE ALL ON FUNCTION admin_seed_preferences(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_seed_preferences(uuid, uuid, jsonb) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS admin_seed_preferences(uuid, uuid, jsonb);
