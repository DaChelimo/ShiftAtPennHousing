-- Migration: worker-readable scheduling periods
--
-- Closes the gap flagged in apps/mobile/.../preferences/Preferences.kt: a logged-in
-- worker could read NEITHER the active period_id NOR the preference_deadline, because
-- scheduling_periods carried ONLY a service-role bypass policy. Without this a worker
-- cannot discover which period to submit preferences for (BSpec §5, the mobile
-- Preferences screen) nor see their published calendar.
--
-- Read-only, and deliberately narrow: a worker sees a period ONLY once it is either
-- open for preference submission (preference_deadline IS NOT NULL) or published
-- (published_at IS NOT NULL). Draft periods the SM has not yet opened stay invisible.
-- All WRITES (set-deadline, publish) remain service-role / admin-only — unchanged.

CREATE POLICY "authenticated users can select open or published periods"
  ON scheduling_periods
  FOR SELECT
  TO authenticated
  USING (preference_deadline IS NOT NULL OR published_at IS NOT NULL);

-- rollback:
-- DROP POLICY IF EXISTS "authenticated users can select open or published periods" ON scheduling_periods;
