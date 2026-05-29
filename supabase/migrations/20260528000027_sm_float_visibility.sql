-- Post-verification remediation: D9 (20260528000016) reverted
-- user_has_house_admin_role to hm/bm-only to undo Phase 4's over-broad SM
-- widening (X-2). That was correct for admin over PEOPLE (users / user_roles)
-- and override authority (preferences / period_targets writes), which stay
-- hm/bm-only. But it also removed the destination SM's READ visibility of
-- inbound floats and the live house schedule, which the spec explicitly grants:
--
--   BSpec §7.1: "The destination house's SM and HM can see the acknowledgment
--                status of an inbound float on their dashboard."
--   BSpec §10 : "The destination house's SM and HM see the float as a passive
--                indicator on their dashboard."
--   BSpec §11 : the destination calendar shows inbound floats (incl. "(Pending)").
--
-- Re-point the three operational READ surfaces to user_can_build_schedule
-- (sm/hm/bm) so an SM scoped to the house can SEE (not write) its floats and
-- live assignments. Writes remain service-role-only RPCs; admin over users /
-- user_roles remains hm/bm-only. This is Phase-8-relevant: force-trigger is an
-- SM/HM/BM destination-house action whose dashboard reads these tables.

-- ---- float_assignments: builders see floats touching their house ----
DROP POLICY IF EXISTS "house admins can select related float assignments" ON float_assignments;
DROP POLICY IF EXISTS "builders can select related float assignments" ON float_assignments;
CREATE POLICY "builders can select related float assignments" ON float_assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM unnest(source_assignment_ids || destination_assignment_ids) AS related(assignment_id)
      JOIN shift_block_assignments sba
        ON sba.assignment_id = related.assignment_id
      JOIN shift_blocks sb
        ON sb.block_id = sba.block_id
      WHERE user_can_build_schedule(auth.uid(), sb.house_id)
    )
  );

-- ---- float_exclusions: builders see exclusions at their destination house ----
DROP POLICY IF EXISTS "house admins can select destination float exclusions" ON float_exclusions;
DROP POLICY IF EXISTS "builders can select destination float exclusions" ON float_exclusions;
CREATE POLICY "builders can select destination float exclusions" ON float_exclusions
  FOR SELECT
  TO authenticated
  USING (user_can_build_schedule(auth.uid(), destination_house_id));

-- ---- shift_block_assignments: builders see their house's live schedule ----
-- (the worker-own-rows policy and service-role bypass are unchanged; only the
--  house-admin branch of the accessible-assignments policy moves to sm/hm/bm.)
DROP POLICY IF EXISTS "authenticated users can select accessible assignments" ON shift_block_assignments;
CREATE POLICY "authenticated users can select accessible assignments" ON shift_block_assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = shift_block_assignments.block_id
        AND (
          EXISTS (
            SELECT 1
            FROM users
            WHERE users.user_id = auth.uid()
              AND users.home_house_id = shift_blocks.house_id
          )
          OR user_can_build_schedule(auth.uid(), shift_blocks.house_id)
        )
    )
  );
