-- Migration: dev-seeding RPC — admin_seed_draft_schedule (docs/dev-tooling PLAN Feature B).
--
-- Writes a coverage-first, shift-length-balanced set of DRAFT assignments for one house
-- of a period, so the admin can review (and optionally tweak) a full house schedule in
-- the builder without hand-placing every seat. Does NOT publish. STRICTLY IDEMPOTENT
-- per house: it deletes the house's existing drafts for the period, then rewrites.
--
-- SAFETY: SECURITY DEFINER, service_role ONLY. The actor is passed explicitly (auth.uid()
-- is NULL under the service client) and re-verified with user_is_admin(); it also fills
-- draft_block_assignments.created_by (NOT NULL). Per-row inserts fire the existing
-- headcount + Harnwell-training triggers, which backstop the pure generator.
--
-- p_rows shape (from generateBalancedSchedule): [ { "block_id": uuid, "user_id": uuid }, ... ]

CREATE OR REPLACE FUNCTION admin_seed_draft_schedule(
  p_actor_user_id uuid,
  p_period_id     uuid,
  p_house_id      text,
  p_rows          jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned integer := 0;
BEGIN
  IF NOT user_is_admin(p_actor_user_id) THEN
    RAISE EXCEPTION 'Only an administrator may seed draft schedules.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM scheduling_periods WHERE period_id = p_period_id) THEN
    RAISE EXCEPTION 'No scheduling period % exists.', p_period_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Idempotent replace: drop this house's existing drafts for the period.
  DELETE FROM draft_block_assignments
  WHERE period_id = p_period_id
    AND block_id IN (SELECT block_id FROM shift_blocks WHERE house_id = p_house_id);

  INSERT INTO draft_block_assignments (period_id, block_id, user_id, created_by)
  SELECT p_period_id,
         (r.value ->> 'block_id')::uuid,
         (r.value ->> 'user_id')::uuid,
         p_actor_user_id
  FROM jsonb_array_elements(p_rows) AS r(value);
  GET DIAGNOSTICS v_assigned = ROW_COUNT;

  RETURN jsonb_build_object('assigned', v_assigned);
END;
$$;

REVOKE ALL ON FUNCTION admin_seed_draft_schedule(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_seed_draft_schedule(uuid, uuid, text, jsonb) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS admin_seed_draft_schedule(uuid, uuid, text, jsonb);
