-- Migration: cross-house schedule editing for the elevated admin tier.
--
-- Stakeholder decision (2026-06-27): the elevated admin tier — HM, BM, and RSM —
-- may now modify ANY house's SCHEDULE, not only their own. (HMOD timing is moot:
-- any HM/BM may write any house at any time, independent of the duty rotor.)
--
-- This REVERSES the prior RSM invariant ("every WRITE remains scope-matched, so
-- cross-house stays read-only", 20260617000006). Cross-house now applies to the
-- whole elevated tier (hm/bm/rsm) — but ONLY for the schedule.
--
-- Scope of the change (confirmed):
--   * Cross-house (this migration): build drafts, publish, manual assign/remove
--     (override), force-trigger floats, and the builder inputs (preferences
--     oversight, period targets).
--   * STILL own-house (UNCHANGED): people administration (hire/fire, grant/revoke
--     roles), HM leave, weekly hours-cap. These keep user_has_house_admin_role,
--     which is deliberately left scope-matched below.
--   * SM is UNCHANGED — it stays own-house everywhere. SW unaffected.
--
-- Mechanism: a new house-agnostic predicate user_is_schedule_admin(uid) (hm/bm/rsm
-- anywhere; mirrors user_is_rsm but for the whole tier). user_can_build_schedule
-- is redefined to (schedule-admin OR sm-scoped-to-house), so the RPCs that already
-- gate on it (publish_schedule 3-arg, admin_assign_worker, admin_remove_worker)
-- become cross-house for hm/bm/rsm while sm stays own-house. The draft /
-- period_targets / preferences admin RLS policies — which gate on the hm/bm/rsm-only
-- user_has_house_admin_role — are swapped to user_is_schedule_admin (still excludes
-- sm, so sm is preserved).
--
-- Hard invariants (Harnwell training constraint, float-direction rules, no-takeback,
-- hours-cap-not-checked-on-float, block atomicity, NY tz) are enforced at the
-- assignment level regardless of which admin acts, so they continue to hold.
--
-- Idempotent re-application; RLS in-file; NY tz throughout.

-- ============================================================
-- 1. Cross-house schedule-admin predicate — holds hm/bm/rsm anywhere.
-- House-agnostic by design: an elevated admin's schedule authority now spans
-- every house. Mirrors user_is_rsm (20260617000006) but for the whole tier.
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
      AND role IN ('hm', 'bm', 'rsm')
  );
$$;

REVOKE ALL ON FUNCTION user_is_schedule_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_is_schedule_admin(uuid) TO authenticated, service_role;

-- ============================================================
-- 2. Redefine the schedule-builder gate — cross-house for hm/bm/rsm, own-house
-- for sm. This propagates to every caller of user_can_build_schedule:
--   * publish_schedule(uuid, uuid, text)  (20260528000010)
--   * admin_assign_worker / admin_remove_worker  (20260606000001)
--   * the assignment / float / float-exclusion SELECT policies that already OR
--     on it (20260527000004, 20260528001, 20260617000006) — builders now read
--     every house's live schedule, matching their new cross-house write reach.
-- sm keeps its own-house clause verbatim, so SM is unchanged.
-- ============================================================
CREATE OR REPLACE FUNCTION user_can_build_schedule(check_user_id uuid, check_house_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    user_is_schedule_admin(check_user_id)
    OR EXISTS (
      SELECT 1
      FROM user_roles
      WHERE user_id = check_user_id
        AND role = 'sm'
        AND scope_house_id = check_house_id
    );
$$;

REVOKE ALL ON FUNCTION user_can_build_schedule(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_can_build_schedule(uuid, text) TO authenticated, service_role;

-- ============================================================
-- 3. Schedule-builder INPUT surfaces — preferences, period_targets, and draft
-- assignments admin RLS. These gate on the hm/bm/rsm-only user_has_house_admin_role
-- (no sm) and must become cross-house for the elevated tier WITHOUT granting sm
-- anything. Swap each admin clause to the house-agnostic user_is_schedule_admin
-- (same hm/bm/rsm set, no house match). The worker-self (user_id = auth.uid())
-- policies are untouched, so workers still only see/write their own rows.
-- user_has_house_admin_role itself is deliberately LEFT UNCHANGED (own-house) so
-- people admin / leave / cap stay house-local.
-- ============================================================

-- preferences (admin policies keyed by the block's house) --------------------
DROP POLICY IF EXISTS "house admins can select house preferences" ON preferences;
CREATE POLICY "house admins can select house preferences" ON preferences
  FOR SELECT
  TO authenticated
  USING (user_is_schedule_admin(auth.uid()));

DROP POLICY IF EXISTS "house admins can insert house preferences" ON preferences;
CREATE POLICY "house admins can insert house preferences" ON preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (user_is_schedule_admin(auth.uid()));

DROP POLICY IF EXISTS "house admins can update house preferences" ON preferences;
CREATE POLICY "house admins can update house preferences" ON preferences
  FOR UPDATE
  TO authenticated
  USING (user_is_schedule_admin(auth.uid()))
  WITH CHECK (user_is_schedule_admin(auth.uid()));

DROP POLICY IF EXISTS "house admins can delete house preferences" ON preferences;
CREATE POLICY "house admins can delete house preferences" ON preferences
  FOR DELETE
  TO authenticated
  USING (user_is_schedule_admin(auth.uid()));

-- period_targets (admin policies keyed by the worker's home house) ------------
DROP POLICY IF EXISTS "house admins can select house period targets" ON period_targets;
CREATE POLICY "house admins can select house period targets" ON period_targets
  FOR SELECT
  TO authenticated
  USING (user_is_schedule_admin(auth.uid()));

DROP POLICY IF EXISTS "house admins can insert house period targets" ON period_targets;
CREATE POLICY "house admins can insert house period targets" ON period_targets
  FOR INSERT
  TO authenticated
  WITH CHECK (user_is_schedule_admin(auth.uid()));

DROP POLICY IF EXISTS "house admins can update house period targets" ON period_targets;
CREATE POLICY "house admins can update house period targets" ON period_targets
  FOR UPDATE
  TO authenticated
  USING (user_is_schedule_admin(auth.uid()))
  WITH CHECK (user_is_schedule_admin(auth.uid()));

DROP POLICY IF EXISTS "house admins can delete house period targets" ON period_targets;
CREATE POLICY "house admins can delete house period targets" ON period_targets
  FOR DELETE
  TO authenticated
  USING (user_is_schedule_admin(auth.uid()));

-- draft_block_assignments (keyed by the block's house) -----------------------
DROP POLICY IF EXISTS "house schedule-builders can select drafts" ON draft_block_assignments;
CREATE POLICY "house schedule-builders can select drafts" ON draft_block_assignments
  FOR SELECT
  TO authenticated
  USING (user_is_schedule_admin(auth.uid()));

DROP POLICY IF EXISTS "house schedule-builders can insert drafts" ON draft_block_assignments;
CREATE POLICY "house schedule-builders can insert drafts" ON draft_block_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (user_is_schedule_admin(auth.uid()));

DROP POLICY IF EXISTS "house schedule-builders can update drafts" ON draft_block_assignments;
CREATE POLICY "house schedule-builders can update drafts" ON draft_block_assignments
  FOR UPDATE
  TO authenticated
  USING (user_is_schedule_admin(auth.uid()))
  WITH CHECK (user_is_schedule_admin(auth.uid()));

DROP POLICY IF EXISTS "house schedule-builders can delete drafts" ON draft_block_assignments;
CREATE POLICY "house schedule-builders can delete drafts" ON draft_block_assignments
  FOR DELETE
  TO authenticated
  USING (user_is_schedule_admin(auth.uid()));

-- rollback:
--  * DROP FUNCTION user_is_schedule_admin(uuid);
--  * restore user_can_build_schedule body from 20260617000006 (sm/hm/bm/rsm
--    scope-matched);
--  * restore the preferences / period_targets / draft_block_assignments admin
--    policy bodies from 20260527000005 (user_has_house_admin_role(auth.uid(),
--    <house>)).
--  * user_has_house_admin_role is untouched by this migration.
