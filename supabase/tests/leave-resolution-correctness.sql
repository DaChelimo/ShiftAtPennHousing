-- pgTAP: §2.6 leave resolution correctness — dual HM/BM coverage guard (#162)
-- and depth-10 resolution-walk flag+notify (#148). Migration
-- 20260611000006_leave_resolution_correctness.sql.

BEGIN;

SELECT plan(15);

-- Isolated operating date + houses so the seed's HM/BM populations don't perturb
-- the per-house coverage resolution.
INSERT INTO public.operating_calendar (date, profile_name)
  SELECT DATE '2099-02-02', profile_name FROM public.operating_profiles LIMIT 1
  ON CONFLICT (date) DO NOTHING;

INSERT INTO public.houses (id, name) VALUES ('cov-house', 'Coverage House')
  ON CONFLICT (id) DO NOTHING;

-- cov-house has exactly one HM and one BM.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('c2000006-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cov-hm@test.local'),
  ('c2000006-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cov-bm@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('c2000006-0000-0000-0000-0000000000a1','Cov HM','cov-hm@test.local','cov-house',true),
  ('c2000006-0000-0000-0000-0000000000b1','Cov BM','cov-bm@test.local','cov-house',true);
INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('c2000006-0000-0000-0000-0000000000a1','hm','cov-house'),
  ('c2000006-0000-0000-0000-0000000000b1','bm','cov-house');

-- A different-house active admin to serve as a valid cross-house replacement.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('c2000006-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cov-other@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('c2000006-0000-0000-0000-0000000000c1','Cov Other','cov-other@test.local','quad',true);
INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('c2000006-0000-0000-0000-0000000000c1','hm','quad');

-- ===========================================================================
-- 1. first_uncovered_date_for_house: with NOBODY on leave the house is covered.
-- ===========================================================================
SELECT is(
  first_uncovered_date_for_house('cov-house', DATE '2099-02-02', DATE '2099-02-02'),
  NULL,
  'house with active HM+BM and no leave is covered (no uncovered date)');

-- ===========================================================================
-- 2. BM on leave (terminal/admin) but HM still active -> house stays covered.
-- ===========================================================================
SELECT isnt(
  submit_hm_leave('c2000006-0000-0000-0000-0000000000b1'::uuid, DATE '2099-02-02', DATE '2099-02-02', NULL),
  NULL,
  'BM may take leave while the HM remains active (house still covered)');

-- ===========================================================================
-- 3. §2.6 #162 — HM now also takes leave SAME day designating the SAME-HOUSE BM
--    (who is on leave) -> house would have neither HM nor BM active -> REJECT.
-- ===========================================================================
SELECT throws_ok(
  $$ SELECT submit_hm_leave('c2000006-0000-0000-0000-0000000000a1'::uuid,
       DATE '2099-02-02', DATE '2099-02-02', 'c2000006-0000-0000-0000-0000000000b1'::uuid) $$,
  '23514',
  NULL,
  'submit_hm_leave rejects a leave that would leave the house with neither HM nor BM (#162)');

-- The rejected submit wrote no row.
SELECT is(
  (SELECT count(*)::int FROM public.hm_leave
   WHERE user_id = 'c2000006-0000-0000-0000-0000000000a1' AND status = 'active'),
  0,
  'the uncovered-house rejection is atomic (no hm_leave row written)');

-- ===========================================================================
-- 4. §2.6 #162 — the SAME HM leave but designating a DIFFERENT-house active
--    admin as replacement -> house is covered cross-house -> ACCEPT.
-- ===========================================================================
SELECT isnt(
  submit_hm_leave('c2000006-0000-0000-0000-0000000000a1'::uuid,
    DATE '2099-02-02', DATE '2099-02-02', 'c2000006-0000-0000-0000-0000000000c1'::uuid),
  NULL,
  'a different-house replacement keeps the house covered and is accepted (#162)');

-- ===========================================================================
-- 5-13. §2.6 #148 — depth-10 resolution-walk flag + notify.
-- Build a chain of 12 active leaves d00 -> d01 -> ... -> d11 (terminal NULL) all
-- on a fresh date, each user the sole HM of their own house. A submission whose
-- walk traverses the chain hits the depth-10 limit.
-- ===========================================================================
-- Project administrator terminal (one of the required recipients).
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('c2000006-0000-0000-0000-0000000000ad','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cov-admin@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('c2000006-0000-0000-0000-0000000000ad','Cov Admin','cov-admin@test.local','quad',true);
INSERT INTO public.system_config (config_key, config_value, value_type) VALUES
  ('project_administrator_user_id','c2000006-0000-0000-0000-0000000000ad','uuid')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, value_type = EXCLUDED.value_type;

-- HMOD on the rotor for the duty week containing 2099-02-03 (Friday 2099-01-30).
INSERT INTO public.hmod_rotor (week_start_date, hmod_user_id)
VALUES (DATE '2099-01-30', 'c2000006-0000-0000-0000-0000000000c1')
ON CONFLICT (week_start_date) DO UPDATE SET hmod_user_id = EXCLUDED.hmod_user_id;

INSERT INTO public.operating_calendar (date, profile_name)
  SELECT DATE '2099-02-03', profile_name FROM public.operating_profiles LIMIT 1
  ON CONFLICT (date) DO NOTHING;

DO $$
DECLARE i int; uid uuid; nxt uuid; hid text;
BEGIN
  FOR i IN 0..11 LOOP
    uid := ('c2d00006-0000-0000-0000-0000000000' || lpad(i::text,2,'0'))::uuid;
    hid := 'cov-depth-' || i;
    INSERT INTO public.houses(id,name) VALUES (hid,'CovDepth '||i) ON CONFLICT (id) DO NOTHING;
    INSERT INTO auth.users(id,instance_id,aud,role,email)
      VALUES (uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','covd'||i||'@test.local')
      ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.users(user_id,name,email,home_house_id,is_active)
      VALUES (uid,'CovD'||i,'covd'||i||'@test.local',hid,true) ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.user_roles(user_id,role,scope_house_id) VALUES (uid,'hm',hid) ON CONFLICT DO NOTHING;
  END LOOP;
  -- d01..d10 -> next; d11 terminal NULL. (d00's leave is the submission under test.)
  FOR i IN 1..10 LOOP
    uid := ('c2d00006-0000-0000-0000-0000000000' || lpad(i::text,2,'0'))::uuid;
    nxt := ('c2d00006-0000-0000-0000-0000000000' || lpad((i+1)::text,2,'0'))::uuid;
    INSERT INTO public.hm_leave(user_id,start_date,end_date,replacement_user_id,status)
      VALUES (uid, DATE '2099-02-03', DATE '2099-02-03', nxt, 'active');
  END LOOP;
  INSERT INTO public.hm_leave(user_id,start_date,end_date,replacement_user_id,status)
    VALUES ('c2d00006-0000-0000-0000-000000000011'::uuid, DATE '2099-02-03', DATE '2099-02-03', NULL, 'active');
END $$;

-- leave_resolution_walk from d01 (the head of the active 11-deep chain
-- d01 -> ... -> d11) hits the depth-10 limit. (d00 has no leave row yet — that is
-- the submission under test below; once inserted, the walk from d00 also overflows.)
SELECT ok(
  (SELECT depth_exceeded FROM leave_resolution_walk(
     'c2d00006-0000-0000-0000-000000000001'::uuid, DATE '2099-02-03')),
  'leave_resolution_walk reports depth_exceeded on a deep chain (#148)');

-- The submission is ACCEPTED in degraded mode (not hard-rejected).
SELECT isnt(
  submit_hm_leave('c2d00006-0000-0000-0000-000000000000'::uuid,
    DATE '2099-02-03', DATE '2099-02-03', 'c2d00006-0000-0000-0000-000000000001'::uuid),
  NULL,
  'a depth-10 submission is accepted in degraded mode (config-error flag, not reject) (#148)');

-- A config-error flag was raised for the house.
SELECT is(
  (SELECT count(*)::int FROM public.leave_config_errors
   WHERE leaving_user_id = 'c2d00006-0000-0000-0000-000000000000' AND resolved_at IS NULL),
  1,
  'a depth-10 hit flags exactly one open leave_config_errors row (#148)');

-- The house now routes to HMOD until manually resolved.
SELECT ok(
  house_has_open_leave_config_error('cov-depth-0'),
  'the flagged house routes notifications to the HMOD on duty until resolved (#148)');

-- The project administrator was notified.
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE recipient_user_id = 'c2000006-0000-0000-0000-0000000000ad'
     AND type = 'hmod_urgent' AND payload->>'kind' = 'leave_config_error'),
  1,
  'the project administrator is notified on a depth-10 config error (#148)');

-- The HMOD on duty was notified.
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE recipient_user_id = 'c2000006-0000-0000-0000-0000000000c1'
     AND type = 'hmod_urgent' AND payload->>'kind' = 'leave_config_error'),
  1,
  'the HMOD on duty is notified on a depth-10 config error (#148)');

-- Every HM in the detected chain (10 chained HMs: d00..d09, the walk's first 10
-- entries) is notified exactly once. Spot-check a mid-chain HM (d05).
SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE recipient_user_id = 'c2d00006-0000-0000-0000-000000000005'
     AND type = 'hmod_urgent' AND payload->>'kind' = 'leave_config_error'),
  1,
  'a chain HM is notified exactly once on a depth-10 config error (#148)');

-- Idempotent: a second submission tripping the same chain does NOT duplicate the
-- flag or re-notify the administrator.
SELECT isnt(
  submit_hm_leave('c2d00006-0000-0000-0000-000000000000'::uuid,
    DATE '2099-02-03', DATE '2099-02-03', 'c2d00006-0000-0000-0000-000000000001'::uuid),
  NULL,
  'a second depth-10 submission still succeeds');

SELECT is(
  (SELECT count(*)::int FROM public.leave_config_errors
   WHERE leaving_user_id = 'c2d00006-0000-0000-0000-000000000000' AND resolved_at IS NULL),
  1,
  're-tripping the same chain does NOT create a duplicate open flag (idempotent) (#148)');

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE recipient_user_id = 'c2000006-0000-0000-0000-0000000000ad'
     AND type = 'hmod_urgent' AND payload->>'kind' = 'leave_config_error'),
  1,
  're-tripping the same chain does NOT re-notify the administrator (idempotent) (#148)');

SELECT finish();
ROLLBACK;
