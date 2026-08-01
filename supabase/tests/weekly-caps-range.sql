-- pgTAP tests for effective_weekly_caps(date, date) — the batched, client-callable
-- weekly-cap lookup added so the mobile app can stop deriving the cap itself.
-- Spec: BEHAVIORAL_SPECIFICATION §9.3 / §5.3 (per-week cap), ARCHITECTURE §2.x.
--
-- The delegation to effective_weekly_cap is the point: this file pins the RANGE
-- behavior (Monday snapping, bounds, the width guard) and the GRANTS. The cap
-- derivation itself is covered by phase-05-cap.sql and must not be duplicated here.

BEGIN;

SELECT plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures: two adjacent weeks with different caps, so a range spanning the
-- boundary must return two DIFFERENT rows rather than one value repeated.
-- 2029 to stay clear of the seeded real-Harnwell schedule (see t3b-directory-grid).
-- Mondays: 2029-01-01, 2029-01-08.
-- ---------------------------------------------------------------------------
INSERT INTO operating_profiles (
  profile_name, shift_start_bound, shift_end_bound, default_hours_cap,
  default_cap_enforcement, scheduling_mode, float_enabled, escalation_chain
) VALUES
  ('t_caps_soft20', '08:00', '00:00', 20, 'soft', 'sm_built', true, '[]'::jsonb),
  ('t_caps_hard40', '08:00', '00:00', 40, 'hard', 'sm_built', true, '[]'::jsonb)
ON CONFLICT (profile_name) DO UPDATE
  SET default_hours_cap = EXCLUDED.default_hours_cap,
      default_cap_enforcement = EXCLUDED.default_cap_enforcement;

INSERT INTO operating_calendar (date, profile_name)
SELECT d::date, 't_caps_soft20'
FROM generate_series('2029-01-01'::date, '2029-01-07'::date, interval '1 day') d
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

INSERT INTO operating_calendar (date, profile_name)
SELECT d::date, 't_caps_hard40'
FROM generate_series('2029-01-08'::date, '2029-01-14'::date, interval '1 day') d
ON CONFLICT (date) DO UPDATE SET profile_name = EXCLUDED.profile_name;

-- ---------------------------------------------------------------------------
-- 1-3. One row per week, in order, each carrying ITS OWN week's cap.
-- This is the case the client cannot compute: two adjacent weeks, two caps.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM effective_weekly_caps('2029-01-01', '2029-01-08')),
  2,
  'a two-week range returns exactly two rows'
);

SELECT is(
  (SELECT hours_cap FROM effective_weekly_caps('2029-01-01', '2029-01-08')
    WHERE week_start_date = '2029-01-01'),
  20,
  'the first week carries its own soft cap'
);

SELECT is(
  (SELECT cap_enforcement::text FROM effective_weekly_caps('2029-01-01', '2029-01-08')
    WHERE week_start_date = '2029-01-08'),
  'hard',
  'the adjacent week carries its own hard enforcement'
);

-- ---------------------------------------------------------------------------
-- 4-6. Monday snapping. A client sends whatever date it has; every row must
-- come back keyed on the NY Monday, because that is what the app keys its map on.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT week_start_date FROM effective_weekly_caps('2029-01-03', '2029-01-03')),
  '2029-01-01'::date,
  'a Wednesday snaps back to its Monday'
);

SELECT is(
  (SELECT week_start_date FROM effective_weekly_caps('2029-01-07', '2029-01-07')),
  '2029-01-01'::date,
  'a Sunday belongs to the week that started Monday, not the next one'
);

SELECT is(
  (SELECT count(*)::int FROM effective_weekly_caps('2029-01-03', '2029-01-05')),
  1,
  'a range inside one week yields one row, not three'
);

-- ---------------------------------------------------------------------------
-- 7-8. Bounds. A reversed range is empty rather than an error (a clock skew on
-- the client must not fail the whole snapshot read); an absurd range is refused.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM effective_weekly_caps('2029-01-08', '2029-01-01')),
  0,
  'a reversed range returns no rows rather than raising'
);

SELECT throws_ok(
  $$ SELECT * FROM effective_weekly_caps('2020-01-01', '2029-01-01') $$,
  '22023',
  NULL,
  'a range wider than 53 weeks is refused'
);

-- ---------------------------------------------------------------------------
-- 9-11. Grants. Per supabase/AGENTS.md these must name anon and authenticated
-- EXPLICITLY: a `has_function_privilege('public', ...)` assertion passes while
-- both still hold EXECUTE, which is exactly how the last grant gap stayed
-- invisible for months. The mobile app calls this as `authenticated`.
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('authenticated', 'effective_weekly_caps(date,date)', 'EXECUTE'),
  'authenticated may call it (the mobile app depends on this)'
);

SELECT ok(
  NOT has_function_privilege('anon', 'effective_weekly_caps(date,date)', 'EXECUTE'),
  'anon may NOT call it'
);

SELECT ok(
  has_function_privilege('service_role', 'effective_weekly_caps(date,date)', 'EXECUTE'),
  'service_role may call it'
);

SELECT * FROM finish();
ROLLBACK;
