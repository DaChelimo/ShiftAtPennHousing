-- Migration: hoist per-row constants out of the hot RLS policies (cost audit F-05).
--
-- BASELINE, measured as a real Harnwell worker under RLS on the seeded local stack:
-- `SELECT * FROM worker_my_shifts WHERE user_id = <me> AND start_at >= <monday-1w>`
-- returns 394 rows for 30,478 shared buffers, and the plan shows the house-admin arm of
-- the shift_block_assignments SELECT policy (`SubPlan 5`) executing loops=5261.
--
-- WHAT IS ACTUALLY EXPENSIVE. Not the policy logic -- the packaging. Every arm of every
-- OR-ed policy re-derived, PER ROW:
--
--     (COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
--               (NULLIF(current_setting('request.jwt.claims', true), ''))::jsonb ->> 'sub'))::uuid
--
-- That is a **jsonb parse of the whole JWT claims blob, per row, per arm** -- four arms
-- on shift_block_assignments, so up to four parses per candidate row. On top of it,
-- `user_is_rsm(auth.uid())` is a SECURITY DEFINER function whose only input is that same
-- constant, and it too was called per row.
--
-- THE FIX is the standard Supabase remedy, applied consistently:
--
--   * `auth.uid()`                -> `(SELECT auth.uid())`
--   * `user_is_rsm(auth.uid())`   -> `(SELECT user_is_rsm((SELECT auth.uid())))`
--
-- A scalar subselect with no outer reference is hoisted by the planner into a one-shot
-- InitPlan, so each becomes a single evaluation per QUERY instead of per row. This is
-- exactly the same trick that fixed the horizon predicate in 20260726000001, and it is
-- safe here for the same reason: both expressions are constant for the duration of a
-- statement (`auth.uid()` reads a GUC; `user_is_rsm` is STABLE and depends only on it).
--
--   * The home-house EXISTS becomes a scalar comparison against an InitPlan:
--         EXISTS (SELECT 1 FROM users WHERE users.user_id = auth.uid()
--                                       AND users.home_house_id = shift_blocks.house_id)
--     ->  shift_blocks.house_id = (SELECT u.home_house_id FROM users u
--                                   WHERE u.user_id = (SELECT auth.uid()))
--     Equivalent because users.user_id is the primary key, so the subquery yields at
--     most one row. A NULL result (no such user) makes the comparison NULL, i.e. not
--     true -- the same outcome the EXISTS gave. It cannot be hoisted all the way to an
--     InitPlan because it is compared against a per-row house_id, but the users lookup
--     itself now happens once.
--
--   * `user_can_build_schedule(auth.uid(), shift_blocks.house_id)` is left correlated:
--     its second argument genuinely varies per row. Only its uid argument is hoisted.
--
-- WHAT IS DELIBERATELY NOT CHANGED -- this is the trap the audit flagged:
--
--   shift_block_assignments keeps ALL FOUR of its permissive SELECT policies as separate
--   policies. They are OR-ed by PostgreSQL, and the own-assignment arm
--   (`user_id = auth.uid()`) is LOAD-BEARING: float-out and cross-house-pickup rows
--   attach to blocks in a house that is not the worker's home house, so without that arm
--   they vanish from the personal calendar (supabase/AGENTS.md, "Authorization
--   predicates -- do not collapse them"; BSpec §11.2). Collapsing the policies would
--   look like a performance win and would be a data-visibility bug. Only the
--   EXPRESSIONS are rewritten here; the set of arms and what each admits is unchanged.
--
-- No policy is added, removed, widened or narrowed by this migration.

-- ---------------------------------------------------------------------------
-- 1. shift_block_assignments -- four permissive SELECT policies, still four.
-- ---------------------------------------------------------------------------

-- (a) own assignment. Load-bearing for float-out / cross-house-pickup visibility.
DROP POLICY IF EXISTS "users can select own assignments" ON shift_block_assignments;
CREATE POLICY "users can select own assignments" ON shift_block_assignments
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- (b) own dropped-still-open vacant row (20260611000001). The dropper's own data.
DROP POLICY IF EXISTS "users can select own dropped vacant assignments" ON shift_block_assignments;
CREATE POLICY "users can select own dropped vacant assignments" ON shift_block_assignments
  FOR SELECT
  TO authenticated
  USING (dropped_by_user_id = (SELECT auth.uid()));

-- (c) RSM cross-house read + home-house + house-admin (20260617000006).
DROP POLICY IF EXISTS "authenticated users can select accessible assignments" ON shift_block_assignments;
CREATE POLICY "authenticated users can select accessible assignments" ON shift_block_assignments
  FOR SELECT
  TO authenticated
  USING (
    (SELECT user_is_rsm((SELECT auth.uid())))
    OR EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = shift_block_assignments.block_id
        AND (
          shift_blocks.house_id = (
            SELECT u.home_house_id FROM users u WHERE u.user_id = (SELECT auth.uid())
          )
          OR user_can_build_schedule((SELECT auth.uid()), shift_blocks.house_id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. float_assignments -- same treatment, same arms.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "users can select own float assignments" ON float_assignments;
CREATE POLICY "users can select own float assignments" ON float_assignments
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "builders can select related float assignments" ON float_assignments;
CREATE POLICY "builders can select related float assignments" ON float_assignments
  FOR SELECT
  TO authenticated
  USING (
    (SELECT user_is_rsm((SELECT auth.uid())))
    OR EXISTS (
      SELECT 1
      FROM unnest(
             float_assignments.source_assignment_ids
             || float_assignments.destination_assignment_ids
           ) AS related(assignment_id)
      JOIN shift_block_assignments sba ON sba.assignment_id = related.assignment_id
      JOIN shift_blocks sb ON sb.block_id = sba.block_id
      WHERE user_can_build_schedule((SELECT auth.uid()), sb.house_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. float_exclusions -- same treatment, same arms.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "users can select own float exclusions" ON float_exclusions;
CREATE POLICY "users can select own float exclusions" ON float_exclusions
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "builders can select destination float exclusions" ON float_exclusions;
CREATE POLICY "builders can select destination float exclusions" ON float_exclusions
  FOR SELECT
  TO authenticated
  USING (
    (SELECT user_is_rsm((SELECT auth.uid())))
    OR user_can_build_schedule((SELECT auth.uid()), destination_house_id)
  );

-- rollback:
-- (re-apply the SELECT policies from 20260527000004, 20260611000001, 20260617000006)
