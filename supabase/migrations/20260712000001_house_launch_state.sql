-- Migration: house launch state (staggered rollout gate)
-- Adds a per-house launch flag so the app can be rolled out house by house
-- (pilot Harnwell, then the high rises, then the rest) instead of all 13 at once.
--
-- Model:
--   houses.launch_state  'pre_launch' | 'live'   (default pre_launch)
--   system_config('staggered_launch_enabled')    master switch, 'true' | 'false'
--
-- The master switch is the safety valve: when it is absent/false (the default, and
-- what every existing dev seed / test environment sees) the gate is OFF and EVERY
-- house behaves as live regardless of launch_state, so historical behavior and the
-- whole test suite are unchanged. Production turns the switch ON in the project
-- admin console and flips houses to 'live' one at a time.
--
-- Enforcement is at the APPLICATION layer (a "your house isn't live yet" placeholder
-- for workers, admins bypass) per the product decision; these DB helpers are the
-- single source of truth both platforms consult so web and mobile agree.

-- 1. The per-house flag. Default pre_launch: a freshly seeded house is dark until
--    an admin explicitly launches it. launched_at is the audit stamp.
ALTER TABLE houses
  ADD COLUMN IF NOT EXISTS launch_state text NOT NULL DEFAULT 'pre_launch'
    CHECK (launch_state IN ('pre_launch', 'live')),
  ADD COLUMN IF NOT EXISTS launched_at timestamptz;

-- 2. Master switch reader. STABLE, SECURITY DEFINER so any authenticated client can
--    consult it without a direct system_config read grant. Absent row => disabled.
CREATE OR REPLACE FUNCTION is_staggered_launch_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT config_value = 'true'
       FROM system_config
      WHERE config_key = 'staggered_launch_enabled'),
    false
  );
$$;

REVOKE ALL ON FUNCTION is_staggered_launch_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_staggered_launch_enabled() TO authenticated, service_role;

-- 3. Effective liveness for a single house. When the gate is off, every house is
--    live; when on, only launch_state = 'live'. Unknown house => not live.
CREATE OR REPLACE FUNCTION house_is_live(p_house_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT is_staggered_launch_enabled() THEN
      EXISTS (SELECT 1 FROM houses WHERE id = p_house_id)
    ELSE
      COALESCE(
        (SELECT launch_state = 'live' FROM houses WHERE id = p_house_id),
        false
      )
  END;
$$;

REVOKE ALL ON FUNCTION house_is_live(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION house_is_live(text) TO authenticated, service_role;

-- 4. Enumeration view: the houses a WORKER may see/switch into. Filtered by
--    effective liveness so the switcher and directory hide dark houses during a
--    pilot. Admins read the raw houses table (they must prep unlaunched houses).
CREATE OR REPLACE VIEW worker_visible_houses AS
  SELECT id, name, desk_phone, launch_state
    FROM houses
   WHERE house_is_live(id);

GRANT SELECT ON worker_visible_houses TO authenticated, service_role;

-- 5. Admin mutation: launch / un-launch a house. Admin-only (superuser); mirrors the
--    people-admin gating. launched_at is a first-go-live audit stamp: set once when the
--    house first goes live and never cleared, so un-launching (then re-launching) does
--    not lose the original launch time.
CREATE OR REPLACE FUNCTION set_house_launch_state(p_house_id text, p_live boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT user_is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'only the project administrator may change a house launch state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM houses WHERE id = p_house_id) THEN
    RAISE EXCEPTION 'unknown house %', p_house_id;
  END IF;
  UPDATE houses
     SET launch_state = CASE WHEN p_live THEN 'live' ELSE 'pre_launch' END,
         launched_at  = CASE
                          WHEN p_live AND launched_at IS NULL THEN now()
                          ELSE launched_at
                        END
   WHERE id = p_house_id;
END;
$$;

REVOKE ALL ON FUNCTION set_house_launch_state(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_house_launch_state(text, boolean) TO authenticated, service_role;

-- 6. Admin mutation: flip the master switch. Upserts the system_config row with the
--    'enum' value_type ('true'/'false') and records the actor.
CREATE OR REPLACE FUNCTION set_staggered_launch_enabled(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT user_is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'only the project administrator may change the staggered launch switch';
  END IF;
  INSERT INTO system_config (config_key, config_value, value_type, modified_by, modified_at)
  VALUES (
    'staggered_launch_enabled',
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

REVOKE ALL ON FUNCTION set_staggered_launch_enabled(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_staggered_launch_enabled(boolean) TO authenticated, service_role;

-- rollback:
-- DROP VIEW IF EXISTS worker_visible_houses;
-- DROP FUNCTION IF EXISTS set_staggered_launch_enabled(boolean);
-- DROP FUNCTION IF EXISTS set_house_launch_state(text, boolean);
-- DROP FUNCTION IF EXISTS house_is_live(text);
-- DROP FUNCTION IF EXISTS is_staggered_launch_enabled();
-- DELETE FROM system_config WHERE config_key = 'staggered_launch_enabled';
-- ALTER TABLE houses DROP COLUMN IF EXISTS launched_at;
-- ALTER TABLE houses DROP COLUMN IF EXISTS launch_state;
