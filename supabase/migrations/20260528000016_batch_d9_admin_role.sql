-- Batch D (D9): revert user_has_house_admin_role to HM/BM-only and re-point the
-- schedule-builder surfaces to user_can_build_schedule (X-2/F-04-004/F-03-002).
--
-- BSpec §13: an HM can do everything an SM can. The SM (schedule builder) needs
-- to READ preferences / period_targets and CRUD draft_block_assignments for
-- their house; admin over users / user_roles / live shift_block_assignments /
-- float_assignments stays HM/BM-only. Phase 4 had widened the admin helper to
-- include SM, granting SMs admin everywhere — this reverts that.
--
-- Verified by supabase/tests/phase-04-rls.sql (SET ROLE authenticated).

-- ============================================================
-- Narrow the admin helper back to hm/bm. (user_can_build_schedule, the sm/hm/bm
-- helper, was added in 20260528000010.)
-- ============================================================
CREATE OR REPLACE FUNCTION user_has_house_admin_role(check_user_id uuid, check_house_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = check_user_id
      AND role IN ('hm', 'bm')
      AND scope_house_id = check_house_id
  );
$$;

-- ============================================================
-- Re-point the build surfaces to user_can_build_schedule (sm/hm/bm).
-- ============================================================

-- preferences: builders may READ house preferences (write/override stays hm/bm).
DROP POLICY IF EXISTS "house admins can select house preferences" ON preferences;
CREATE POLICY "builders can select house preferences" ON preferences
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM shift_blocks
      WHERE shift_blocks.block_id = preferences.block_id
        AND user_can_build_schedule(auth.uid(), shift_blocks.house_id)
    )
  );

-- period_targets: builders may READ house targets (write/override stays hm/bm).
DROP POLICY IF EXISTS "house admins can select house period targets" ON period_targets;
CREATE POLICY "builders can select house period targets" ON period_targets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.user_id = period_targets.user_id
        AND user_can_build_schedule(auth.uid(), users.home_house_id)
    )
  );

-- draft_block_assignments: full CRUD for schedule builders.
DROP POLICY IF EXISTS "house schedule-builders can select drafts" ON draft_block_assignments;
CREATE POLICY "house schedule-builders can select drafts" ON draft_block_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM shift_blocks
      WHERE shift_blocks.block_id = draft_block_assignments.block_id
        AND user_can_build_schedule(auth.uid(), shift_blocks.house_id)
    )
  );

DROP POLICY IF EXISTS "house schedule-builders can insert drafts" ON draft_block_assignments;
CREATE POLICY "house schedule-builders can insert drafts" ON draft_block_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM shift_blocks
      WHERE shift_blocks.block_id = draft_block_assignments.block_id
        AND user_can_build_schedule(auth.uid(), shift_blocks.house_id)
    )
  );

DROP POLICY IF EXISTS "house schedule-builders can update drafts" ON draft_block_assignments;
CREATE POLICY "house schedule-builders can update drafts" ON draft_block_assignments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM shift_blocks
      WHERE shift_blocks.block_id = draft_block_assignments.block_id
        AND user_can_build_schedule(auth.uid(), shift_blocks.house_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM shift_blocks
      WHERE shift_blocks.block_id = draft_block_assignments.block_id
        AND user_can_build_schedule(auth.uid(), shift_blocks.house_id)
    )
  );

DROP POLICY IF EXISTS "house schedule-builders can delete drafts" ON draft_block_assignments;
CREATE POLICY "house schedule-builders can delete drafts" ON draft_block_assignments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM shift_blocks
      WHERE shift_blocks.block_id = draft_block_assignments.block_id
        AND user_can_build_schedule(auth.uid(), shift_blocks.house_id)
    )
  );
