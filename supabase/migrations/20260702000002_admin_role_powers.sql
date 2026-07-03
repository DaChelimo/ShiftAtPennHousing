-- Migration: Administrator role — powers (part 2 of 2).
--
-- Wires the `admin` enum value (added in 20260702000001) into the role model.
-- The admin is a house-agnostic SUPERUSER (stakeholder decision 2026-07-02,
-- docs/operating-seasons/PLAN.md §2 decision #2):
--   * Cross-house schedule authority (joins the user_is_schedule_admin tier).
--   * People admin / leave / weekly cap in EVERY house (user_has_house_admin_role
--     gains an unconditional user_is_admin() clause — this DELIBERATELY widens the
--     own-house-only gate for the admin role only; the hm/bm/rsm branch stays
--     scope-matched, so [Cross-house-schedule] invariant #1 still holds for them).
--   * Authors the operating configuration (season tables, migration 20260702000003).
-- The admin is admin-ONLY: never staffs a desk, never floated, never broadcast,
-- never in the claim pool, never a swap counterparty, never HMOD. Those exclusions
-- live in packages/core/src/eligibility + float-lookup (mirroring `bm`) and in the
-- broadcast guards below. scope_house_id is always NULL (house-agnostic).

-- ============================================================
-- 1. Scope constraint — admin requires NULL scope (house-agnostic), like the
-- worker `sw` role but for the opposite reason. sm/hm/bm/rsm stay scope-required.
-- ============================================================
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_scope_required_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_scope_required_check
  CHECK (
    role = 'sw' OR
    (role IN ('sm', 'hm', 'bm', 'rsm') AND scope_house_id IS NOT NULL) OR
    (role = 'admin' AND scope_house_id IS NULL)
  );

-- ============================================================
-- 2. Admin predicate — house-agnostic. True if the user holds an admin role
-- anywhere. Mirrors user_is_rsm / user_is_schedule_admin.
-- ============================================================
CREATE OR REPLACE FUNCTION user_is_admin(check_user_id uuid)
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
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION user_is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_is_admin(uuid) TO authenticated, service_role;

-- ============================================================
-- 3. Schedule-admin tier — admin joins hm/bm/rsm. Propagates to
-- user_can_build_schedule (20260627000002) and every policy/RPC that ORs on it,
-- so the admin can build/publish/override any house's schedule.
-- ============================================================
CREATE OR REPLACE FUNCTION user_is_schedule_admin(check_user_id uuid)
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
      AND role IN ('hm', 'bm', 'rsm', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION user_is_schedule_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_is_schedule_admin(uuid) TO authenticated, service_role;

-- ============================================================
-- 4. Own-house admin gate — admin overrides the scope match unconditionally
-- (people admin, leave, weekly cap in every house). The hm/bm/rsm scope-matched
-- branch is UNCHANGED, so RSM/HM/BM stay own-house for these powers.
-- ============================================================
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
  SELECT
    user_is_admin(check_user_id)
    OR EXISTS (
      SELECT 1
      FROM user_roles
      WHERE user_id = check_user_id
        AND role IN ('hm', 'bm', 'rsm')
        AND scope_house_id = check_house_id
    );
$$;

-- ============================================================
-- 5. Broadcast guards — the admin can never subscribe to broadcast (admin-only,
-- like hm/bm/rsm). Redefine both guards to the FULL admin-tier list
-- ('hm','bm','rsm','admin'). NOTE: the latest prior definition (20260617000006)
-- already included 'rsm'; this preserves that and adds 'admin' (do not drop 'rsm').
-- ============================================================
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
      AND role IN ('hm', 'bm', 'rsm', 'admin')
  ) THEN
    RAISE EXCEPTION 'HMs, BMs, RSMs, and admins cannot subscribe to broadcast notifications'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION clear_broadcast_subscription_on_admin_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role IN ('hm', 'bm', 'rsm', 'admin') THEN
    UPDATE users
    SET broadcast_subscribed = false
    WHERE user_id = NEW.user_id
      AND broadcast_subscribed = true;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 6. People-directory visibility — the admin sees every user and every role.
-- Additive OR clause on the house-admin SELECT policies (read-only widening;
-- write gates are unaffected).
-- ============================================================
DROP POLICY IF EXISTS "house admins can select house users" ON users;
CREATE POLICY "house admins can select house users" ON users
  FOR SELECT
  TO authenticated
  USING (
    user_is_admin(auth.uid())
    OR user_has_house_admin_role(auth.uid(), home_house_id)
  );

DROP POLICY IF EXISTS "house admins can select scoped roles" ON user_roles;
CREATE POLICY "house admins can select scoped roles" ON user_roles
  FOR SELECT
  TO authenticated
  USING (
    user_is_admin(auth.uid()) OR
    user_can_select_user(auth.uid(), user_id) OR
    user_has_house_admin_role(auth.uid(), scope_house_id)
  );

-- Note: user_has_house_admin_role now returns true for an admin at ANY house, so
-- the "house admins can select house users" clause above is already satisfied for
-- admins; the explicit user_is_admin() OR is kept for legibility and to survive a
-- future narrowing of user_has_house_admin_role.

-- ============================================================
-- 7. system_config — the admin role may read AND write every config key (the
-- authoring RPC and future config UI run as the admin). Additive to the existing
-- is_project_administrator (pointer-based) policies from 20260601000004.
-- ============================================================
DROP POLICY IF EXISTS "admin role can select system config" ON system_config;
CREATE POLICY "admin role can select system config" ON system_config
  FOR SELECT TO authenticated
  USING (user_is_admin(auth.uid()));

DROP POLICY IF EXISTS "admin role can insert system config" ON system_config;
CREATE POLICY "admin role can insert system config" ON system_config
  FOR INSERT TO authenticated
  WITH CHECK (user_is_admin(auth.uid()));

DROP POLICY IF EXISTS "admin role can update system config" ON system_config;
CREATE POLICY "admin role can update system config" ON system_config
  FOR UPDATE TO authenticated
  USING (user_is_admin(auth.uid()))
  WITH CHECK (user_is_admin(auth.uid()));

-- rollback:
-- DROP POLICY IF EXISTS "admin role can update system config" ON system_config;
-- DROP POLICY IF EXISTS "admin role can insert system config" ON system_config;
-- DROP POLICY IF EXISTS "admin role can select system config" ON system_config;
-- (restore prior user_has_house_admin_role / user_is_schedule_admin / broadcast
--  guards / SELECT policies from 20260617000006 + 20260627000002 + 20260527000003)
-- DROP FUNCTION IF EXISTS user_is_admin(uuid);
-- ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_scope_required_check;
-- (re-add the 20260617000006 form without the admin branch)
