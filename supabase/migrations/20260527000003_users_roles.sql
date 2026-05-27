-- Migration: users and roles
-- Phase 02: application users, scoped roles, broadcast subscription guards.

CREATE TYPE user_role_enum AS ENUM ('sw', 'sm', 'hm', 'bm');

CREATE OR REPLACE FUNCTION name_array_contained_by_text_array(
  left_names name[],
  right_text text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM unnest(left_names) AS left_name
    WHERE left_name::text <> ALL (right_text)
  );
$$;

CREATE OPERATOR <@ (
  LEFTARG = name[],
  RIGHTARG = text[],
  PROCEDURE = name_array_contained_by_text_array
);

CREATE TABLE users (
  user_id              uuid    PRIMARY KEY,
  name                 text    NOT NULL,
  email                text    NOT NULL,
  phone                text,
  home_house_id        text    NOT NULL REFERENCES houses (id),
  is_active            boolean NOT NULL DEFAULT true,
  broadcast_subscribed boolean NOT NULL DEFAULT false,
  CONSTRAINT users_broadcast_active_check
    CHECK (broadcast_subscribed = false OR is_active = true)
);

ALTER TABLE users
  ADD CONSTRAINT users_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users (id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE user_roles (
  user_id        uuid           NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  role           user_role_enum NOT NULL,
  scope_house_id text           REFERENCES houses (id),
  CONSTRAINT user_roles_scope_required_check
    CHECK (
      role = 'sw' OR
      (role IN ('sm', 'hm', 'bm') AND scope_house_id IS NOT NULL)
    ),
  CONSTRAINT user_roles_unique
    UNIQUE NULLS NOT DISTINCT (user_id, role, scope_house_id)
);

ALTER TABLE hm_leave
  ADD CONSTRAINT hm_leave_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (user_id),
  ADD CONSTRAINT hm_leave_replacement_user_id_fkey
    FOREIGN KEY (replacement_user_id) REFERENCES users (user_id);

ALTER TABLE ack_cadence_config
  ADD CONSTRAINT ack_cadence_config_modified_by_fkey
    FOREIGN KEY (modified_by) REFERENCES users (user_id);

ALTER TABLE weekly_cap_overrides
  ADD CONSTRAINT weekly_cap_overrides_modified_by_fkey
    FOREIGN KEY (modified_by) REFERENCES users (user_id);

CREATE OR REPLACE FUNCTION prevent_hm_bm_broadcast_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_active = false AND NEW.broadcast_subscribed = true THEN
    NEW.broadcast_subscribed = false;
  END IF;

  IF NEW.broadcast_subscribed = true AND EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = NEW.user_id
      AND role IN ('hm', 'bm')
  ) THEN
    RAISE EXCEPTION 'HMs and BMs cannot subscribe to broadcast notifications'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER users_prevent_hm_bm_broadcast_subscription
  BEFORE INSERT OR UPDATE OF is_active, broadcast_subscribed ON users
  FOR EACH ROW
  EXECUTE FUNCTION prevent_hm_bm_broadcast_subscription();

CREATE OR REPLACE FUNCTION clear_broadcast_subscription_on_admin_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role IN ('hm', 'bm') THEN
    UPDATE users
    SET broadcast_subscribed = false
    WHERE user_id = NEW.user_id
      AND broadcast_subscribed = true;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER user_roles_clear_broadcast_subscription_on_admin_role
  BEFORE INSERT OR UPDATE OF role, user_id ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION clear_broadcast_subscription_on_admin_role();

CREATE OR REPLACE FUNCTION enforce_active_hm_leave_replacement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.replacement_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM users
    WHERE user_id = NEW.replacement_user_id
      AND is_active = true
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'HM/BM leave replacement must be an active user'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER hm_leave_enforce_active_replacement
  BEFORE INSERT OR UPDATE OF replacement_user_id ON hm_leave
  FOR EACH ROW
  EXECUTE FUNCTION enforce_active_hm_leave_replacement();

CREATE OR REPLACE FUNCTION user_has_house_admin_role(
  check_user_id uuid,
  check_house_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = check_user_id
      AND role IN ('hm', 'bm')
      AND scope_house_id = check_house_id
  );
$$;

CREATE OR REPLACE FUNCTION user_can_select_user(
  viewer_user_id uuid,
  target_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    viewer_user_id = target_user_id
    OR EXISTS (
      SELECT 1
      FROM users target_user
      WHERE target_user.user_id = target_user_id
        AND user_has_house_admin_role(viewer_user_id, target_user.home_house_id)
    );
$$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON users
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "users can select own row" ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "house admins can select house users" ON users
  FOR SELECT
  TO authenticated
  USING (user_has_house_admin_role(auth.uid(), home_house_id));

CREATE POLICY "service-role bypass" ON user_roles
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "users can select own roles" ON user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "house admins can select scoped roles" ON user_roles
  FOR SELECT
  TO authenticated
  USING (
    user_can_select_user(auth.uid(), user_id) OR
    user_has_house_admin_role(auth.uid(), scope_house_id)
  );

-- rollback:
-- DROP POLICY IF EXISTS "house admins can select scoped roles" ON user_roles;
-- DROP POLICY IF EXISTS "users can select own roles" ON user_roles;
-- DROP POLICY IF EXISTS "service-role bypass" ON user_roles;
-- DROP POLICY IF EXISTS "house admins can select house users" ON users;
-- DROP POLICY IF EXISTS "users can select own row" ON users;
-- DROP POLICY IF EXISTS "service-role bypass" ON users;
-- DROP TRIGGER IF EXISTS hm_leave_enforce_active_replacement ON hm_leave;
-- DROP FUNCTION IF EXISTS enforce_active_hm_leave_replacement();
-- DROP TRIGGER IF EXISTS user_roles_clear_broadcast_subscription_on_admin_role ON user_roles;
-- DROP FUNCTION IF EXISTS clear_broadcast_subscription_on_admin_role();
-- DROP TRIGGER IF EXISTS users_prevent_hm_bm_broadcast_subscription ON users;
-- DROP FUNCTION IF EXISTS prevent_hm_bm_broadcast_subscription();
-- DROP FUNCTION IF EXISTS user_can_select_user(uuid, uuid);
-- DROP FUNCTION IF EXISTS user_has_house_admin_role(uuid, text);
-- DROP TABLE IF EXISTS user_roles CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;
-- DROP OPERATOR IF EXISTS <@ (name[], text[]);
-- DROP FUNCTION IF EXISTS name_array_contained_by_text_array(name[], text[]);
-- DROP TYPE IF EXISTS user_role_enum;
