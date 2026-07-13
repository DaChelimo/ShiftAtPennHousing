-- Desk Assistant — Building Administrator (BA) duty resolver (reference_duty_hierarchy_roles).
--
-- The BA sits ABOVE the HM in the standing hierarchy (SM < RSM < HM < BA) and is the
-- person in charge when the RSM and HM are both on leave (e.g. Celine covering Rodin /
-- Harrison / Harnwell). Stakeholder decision (2026-07-12): the BA is the EXISTING `bm`
-- (Building Manager) role, scoped per house -- NOT a new role. So this resolver mirrors
-- resolve_rsm_for_house exactly, over role = 'bm', and is leave-aware + as-of-date via the
-- same resolve_hm_for_user chain. The escalation ladder (packages/core routing) gains a
-- 'ba' tier ABOVE 'hmod' so the walk-up rsm -> hmod -> ba surfaces the BA automatically
-- when the upper tiers resolve out on leave.
--
-- SMOD / CSMOD are intentionally NOT resolved to a person here: they are reached via a
-- shared duty phone (same number for whoever is on duty), so routing surfaces the tier +
-- an optional configured phone. Deployers may set these system_config keys (like
-- project_administrator_user_id, seed.sql leaves them unset):
--   INSERT INTO system_config (config_key, config_value, value_type)
--   VALUES ('smod_duty_phone', '<number>', 'text'), ('csmod_duty_phone', '<number>', 'text');

CREATE OR REPLACE FUNCTION resolve_ba_for_house(
  p_house_id text,
  p_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ba_user_id uuid;
  v_resolved   uuid;
BEGIN
  FOR v_ba_user_id IN
    SELECT user_id
    FROM user_roles
    WHERE role = 'bm'
      AND scope_house_id = p_house_id
  LOOP
    v_resolved := resolve_hm_for_user(v_ba_user_id, p_at);
    IF v_resolved IS NOT NULL THEN
      RETURN v_resolved;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION resolve_ba_for_house(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_ba_for_house(text, timestamptz) TO service_role;

COMMENT ON FUNCTION resolve_ba_for_house(text, timestamptz) IS
  'Building Administrator on duty for a house as of p_at, resolved as the leave-aware bm '
  'scoped to that house (reference_duty_hierarchy_roles). NULL if none / all on leave.';
