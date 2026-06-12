-- Migration: house-closure read-model signal (BSpec §3.4 Closed Houses / §11.3 closed-house display)
--
-- The gap (parity chunk T2-12c-be): there was no machine-readable "house X is
-- closed on date D" signal the calendars can consume. The worker read-model views
-- (20260605000001) expose no closed flag, and the web `.cal-closed` CSS was orphaned.
--
-- How closure is represented in THIS schema (investigated, not fabricated):
--   A house is closed for a date when the operating profile assigned to that date
--   has NO staffing_patterns row (with a positive-headcount band) for that house and
--   day_type. This is exactly the join the block generator
--   (generate_blocks_for_date, 20260527000004) uses: operating_calendar resolves the
--   date -> profile_name; staffing_patterns(profile_name, house_id, day_type) with
--   headcount > 0 produces the blocks. A house with no matching staffing row
--   generates zero blocks == it is closed for that date.
--
--   Canonical case (BSpec §3.2/§3.4, seed.sql lines 137-140): in winter break only
--   Harnwell has a winter_break staffing_patterns row; every other house has NO ROW
--   and is therefore fully closed. A date with no operating_calendar row at all is a
--   non-operating date: every house is closed (§11.3 closure dates).
--
-- The signal: a small SECURITY DEFINER function house_closure(house_id, on_date) -> bool.
--   * Both consumers can use it: the web calendar (service-client, lib/data/calendar.ts)
--     and the RLS-scoped mobile worker calendar (a worker can call the function even
--     though operating_calendar / staffing_patterns carry only a service-role bypass).
--   * SECURITY DEFINER mirrors generate_blocks_for_date: operating_calendar and
--     staffing_patterns are not authenticated-readable, so an invoker-rights derivation
--     would collapse to "always closed" for a logged-in worker. The function returns a
--     single boolean derived from non-sensitive operational config and leaks nothing
--     about other workers; EXECUTE is granted to authenticated (+ service_role).
--   * Invariant #6 (NY-anchored dates): on_date is a NY calendar date; day_type is the
--     weekday/weekend of that NY date via EXTRACT(DOW ...), the same expression the
--     generator uses. No wall-clock TZ conversion is applied to a bare date.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION house_closure(p_house_id text, p_on_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- TRUE when the house is closed for the date: no positive-headcount staffing band
  -- exists for (the date's profile, the house, the NY day_type). A date with no
  -- operating_calendar row resolves to NOT EXISTS -> closed.
  SELECT NOT EXISTS (
    SELECT 1
    FROM operating_calendar oc
    JOIN staffing_patterns sp
      ON sp.profile_name = oc.profile_name
     AND sp.house_id     = p_house_id
     AND sp.day_type     = (
       CASE
         WHEN EXTRACT(DOW FROM p_on_date) IN (0, 6) THEN 'weekend'
         ELSE 'weekday'
       END
     )::day_type_enum
    CROSS JOIN LATERAL jsonb_to_recordset(sp.block_headcounts)
      AS band(block_start text, block_end text, headcount integer)
    WHERE oc.date = p_on_date
      AND band.headcount > 0
  );
$$;

GRANT EXECUTE ON FUNCTION house_closure(text, date) TO authenticated, service_role;

COMMENT ON FUNCTION house_closure(text, date) IS
  'BSpec §3.4/§11.3: TRUE when house p_house_id is closed for NY-date p_on_date '
  '(the date''s operating profile has no positive-headcount staffing band for the '
  'house + day_type, or the date is non-operating). Read-model signal for the web '
  'and mobile worker calendars. SECURITY DEFINER: operating_calendar / '
  'staffing_patterns are not authenticated-readable.';

-- rollback:
-- DROP FUNCTION IF EXISTS house_closure(text, date);
