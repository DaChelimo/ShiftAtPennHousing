-- Migration: worker-readable break periods
--
-- Closes the gap flagged in apps/mobile/.../breakclaim/BreakClaim.kt and the T1-5
-- status note: the mobile break-claim screen ran on a caller-supplied (demo) break
-- NAME / window / "only Harnwell open" context because break_periods carried ONLY a
-- service-role bypass policy. Without an authenticated SELECT a logged-in worker
-- cannot discover the active break's name or its date window to label the picker
-- (BSpec §4.4, the mobile break-claim screen).
--
-- Read-only and minimal. break_periods holds no admin-only / privacy-sensitive
-- columns: break_name, break_type, start_date, end_date are descriptive labels and
-- the date window every worker needs to recognise the break; profile_name and
-- claim_pool_closed_at are operational metadata that leak nothing about other
-- workers. So the whole row is safe to expose to any authenticated user — there is
-- no per-worker scoping to apply (a break period is not owned by a worker).
--
-- All WRITES (admin tooling creating / editing break periods, the phase-11 cron
-- stamping claim_pool_closed_at) remain service-role-only — unchanged.
--
-- Idempotent: drop-then-create so re-application is a no-op.

DROP POLICY IF EXISTS "authenticated users can select break periods" ON break_periods;
CREATE POLICY "authenticated users can select break periods"
  ON break_periods
  FOR SELECT
  TO authenticated
  USING (true);

-- rollback:
-- DROP POLICY IF EXISTS "authenticated users can select break periods" ON break_periods;
