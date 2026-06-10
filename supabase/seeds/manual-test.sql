-- ============================================================================
-- Manual Test seed — clean 3-house world for hands-on SM-tool drafting.
--
-- Houses:   Harnwell (2/block), Quad (3/block), DuBois (1/block)
-- People:   8 SW + 1 SM + 1 HM per house = 30 accounts
--           name  "<First> <n> <House>"        e.g. "Alice 1 Harnwell"
--           email "<first>-<house>@upenn.edu"  e.g. alice-harnwell@upenn.edu
--           password: abc123   (everyone)
-- Period:   Fall 2026 — 2026-08-19 .. 2026-12-17 (regular_school_year)
--           Whole-semester blocks generated; preferences + targets seeded so the
--           Phase-1 "preference-assisted" drafter (draft 1) shows real grouping.
--           Nothing is drafted or published — you draft/override in the tool.
--
-- Run AFTER `supabase db reset` (which loads the base config seed first):
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/seeds/manual-test.sql
-- Or paste into Studio's SQL editor. Idempotent — safe to re-run.
-- `supabase db reset` reverts everything back to the default dev seed.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Clean 3-house world.
--    Hide the default dev-seed users (@pennhousing.test) so only Manual Test
--    accounts populate builder rosters. Non-destructive (is_active=false).
-- ----------------------------------------------------------------------------
UPDATE users
SET is_active = false, broadcast_subscribed = false
WHERE email LIKE '%@pennhousing.test';

-- Restrict block generation to our 3 houses: drop every OTHER house's
-- regular_school_year staffing pattern so generate_blocks_for_range() only
-- emits Harnwell / Quad / DuBois blocks. (winter_break / short_break patterns
-- are left intact; `supabase db reset` restores all of them.)
DELETE FROM staffing_patterns
WHERE profile_name = 'regular_school_year'
  AND house_id NOT IN ('harnwell', 'quad', 'dubois');

-- Remove the dev-seed scheduling periods (Spring/Summer 2026) and their
-- dependent rows. The base seed's Summer 2026 (2026-06-01..2026-08-31) overlaps
-- our Fall 2026 (2026-08-19..2026-12-17) under the INCLUSIVE
-- scheduling_periods_no_overlap exclusion constraint — and ON CONFLICT
-- (period_id) below cannot absorb an exclusion-constraint violation (it only
-- infers the primary-key index). Clearing them leaves a clean single-period
-- world. period_house_publications cascades; the other children are NO ACTION
-- so we delete them first. Idempotent: on re-run, Fall already exists and is
-- preserved by the `<>` filter.
--
-- preferences/period_targets carry a BEFORE DELETE deadline-enforcement trigger
-- (Spring 2026's deadline is long past), so we reopen the doomed periods'
-- deadlines (NULL = always open) before deleting their child rows.
UPDATE scheduling_periods SET preference_deadline = NULL
WHERE period_id <> 'c0000000-0000-4000-8000-0000000fa112';

DELETE FROM preferences               WHERE period_id <> 'c0000000-0000-4000-8000-0000000fa112';
DELETE FROM period_targets            WHERE period_id <> 'c0000000-0000-4000-8000-0000000fa112';
DELETE FROM draft_block_assignments   WHERE period_id <> 'c0000000-0000-4000-8000-0000000fa112';
DELETE FROM preference_reminder_sends WHERE period_id <> 'c0000000-0000-4000-8000-0000000fa112';
DELETE FROM scheduling_periods        WHERE period_id <> 'c0000000-0000-4000-8000-0000000fa112';

-- ----------------------------------------------------------------------------
-- 1. DuBois house + config (Harnwell & Quad config come from the base seed).
--    Headcount 1 per 30-min block, 08:00–24:00, weekday & weekend.
-- ----------------------------------------------------------------------------
INSERT INTO houses (id, name) VALUES ('dubois', 'DuBois')
ON CONFLICT (id) DO NOTHING;

INSERT INTO staffing_patterns (profile_name, house_id, day_type, block_headcounts) VALUES
  ('regular_school_year', 'dubois', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'dubois', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]')
ON CONFLICT (profile_name, house_id, day_type) DO NOTHING;

-- Float routing (regular_school_year). DuBois is single-staff (headcount 1) so
-- it is never a float SOURCE; Harnwell is never a float DESTINATION (training
-- rule). Harnwell→Quad already exists in the base seed.
INSERT INTO float_routing (profile_name, source_house_id, destination_house_id, precedence_order) VALUES
  ('regular_school_year', 'harnwell', 'dubois', 2),
  ('regular_school_year', 'quad',     'dubois', 1)
ON CONFLICT (profile_name, source_house_id, destination_house_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. People: 8 SW + 1 SM + 1 HM per house (30 total).
--    UUIDs: f0000000-…-0000000<house><00><person>  (house 1=harnwell,2=quad,3=dubois)
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE mt_people ON COMMIT DROP AS
WITH houses_t(house_id, house_label, house_digit) AS (
  VALUES ('harnwell', 'Harnwell', '1'),
         ('quad',     'Quad',     '2'),
         ('dubois',   'DuBois',   '3')
),
roster(person_num, first_name, role) AS (
  VALUES (1, 'Alice', 'sw'), (2, 'Ben',  'sw'), (3, 'Cara', 'sw'), (4, 'Dan',  'sw'),
         (5, 'Erin',  'sw'), (6, 'Finn', 'sw'), (7, 'Gina', 'sw'), (8, 'Hank', 'sw'),
         (9, 'Sam',   'sm'), (10, 'Hana', 'hm')
)
SELECT
  ('f0000000-0000-4000-8000-0000000' || h.house_digit || '00'
    || lpad(to_hex(r.person_num), 2, '0'))::uuid                AS user_id,
  h.house_id,
  r.role::user_role_enum                                        AS role,
  r.person_num,
  (r.first_name || ' ' || r.person_num || ' ' || h.house_label) AS name,
  (lower(r.first_name) || '-' || h.house_id || '@upenn.edu')    AS email
FROM houses_t h CROSS JOIN roster r;

-- Auth (GoTrue). Empty-string token columns avoid GoTrue NULL-scan errors.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  p.user_id, 'authenticated', 'authenticated', p.email,
  extensions.crypt('abc123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', ''
FROM mt_people p
ON CONFLICT (id) DO NOTHING;

-- auth.identities.email is GENERATED (from identity_data->>'email'); omit it.
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT p.user_id::text, p.user_id,
       jsonb_build_object('sub', p.user_id::text, 'email', p.email),
       'email', now(), now(), now()
FROM mt_people p
ON CONFLICT DO NOTHING;

INSERT INTO users (user_id, name, email, home_house_id, is_active)
SELECT p.user_id, p.name, p.email, p.house_id, true
FROM mt_people p
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_roles (user_id, role, scope_house_id)
SELECT p.user_id, p.role,
       CASE WHEN p.role = 'sw' THEN NULL ELSE p.house_id END
FROM mt_people p
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Fall 2026 period + operating calendar, then generate the semester's blocks.
--    Submission window is left OPEN (deadline 2026-08-12) so you can also test
--    worker preference submission; close it early by setting preference_deadline
--    to a past timestamp if you want preferences locked before building.
-- ----------------------------------------------------------------------------
INSERT INTO scheduling_periods
  (period_id, period_name, profile_name, start_date, end_date, preference_deadline, published_at)
VALUES
  ('c0000000-0000-4000-8000-0000000fa112', 'Fall 2026', 'regular_school_year',
   '2026-08-19', '2026-12-17', '2026-08-12 23:59:59-04', NULL)
ON CONFLICT (period_id) DO NOTHING;

INSERT INTO operating_calendar (date, profile_name)
SELECT d::date, 'regular_school_year'
FROM generate_series('2026-08-19'::date, '2026-12-17'::date, interval '1 day') AS d
ON CONFLICT (date) DO NOTHING;

-- Reads operating_calendar + staffing_patterns → emits 30-min blocks + vacant
-- assignments for Harnwell/Quad/DuBois across the whole semester. Idempotent.
SELECT * FROM generate_blocks_for_range('2026-08-19'::date, '2026-12-17'::date);

-- ----------------------------------------------------------------------------
-- 4. Worker submissions (24 SWs): 20h target each + a deterministic preference
--    pattern so the Phase-1 preference-assisted drafter shows preferred/blocked
--    groups. Each SW prefers one 4-hour band of the day (rotated by index); a
--    few can't work the 22:00–24:00 late blocks. Neutral "available" is the
--    default and is not stored.
-- ----------------------------------------------------------------------------
INSERT INTO period_targets (user_id, period_id, target_hours, opted_out)
SELECT p.user_id, 'c0000000-0000-4000-8000-0000000fa112', 20, false
FROM mt_people p WHERE p.role = 'sw'
ON CONFLICT (user_id, period_id) DO NOTHING;

INSERT INTO preferences (user_id, block_id, period_id, status)
SELECT s.user_id, s.block_id, s.period_id, s.status
FROM (
  SELECT
    p.user_id,
    b.block_id,
    'c0000000-0000-4000-8000-0000000fa112'::uuid AS period_id,
    CASE
      WHEN floor(
             (extract(hour FROM b.block_start_at AT TIME ZONE 'America/New_York')::int - 8) / 4
           ) = ((p.person_num - 1) % 4)
        THEN 'preferred'::preference_status_enum
      WHEN extract(hour FROM b.block_start_at AT TIME ZONE 'America/New_York')::int >= 22
           AND (p.person_num % 3) = 0
        THEN 'cannot'::preference_status_enum
      ELSE NULL
    END AS status
  FROM mt_people p
  JOIN shift_blocks b ON b.house_id = p.house_id
  WHERE p.role = 'sw'
) s
WHERE s.status IS NOT NULL
ON CONFLICT (user_id, block_id, period_id) DO NOTHING;

COMMIT;

-- Quick sanity check (run separately if you like):
--   SELECT home_house_id, count(*) FROM users WHERE email LIKE '%@upenn.edu' GROUP BY 1;
--   SELECT house_id, count(*) FROM shift_blocks GROUP BY 1;          -- 3 houses only
--   SELECT count(*) FROM preferences
--     WHERE period_id = 'c0000000-0000-4000-8000-0000000fa112';
