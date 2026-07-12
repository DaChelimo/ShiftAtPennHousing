-- pgTAP RLS tests (G1) verifying D9: SM (schedule builder) can build for their
-- house but cannot admin users; HM/BM can do both. Runs each probe as the
-- `authenticated` role with a simulated auth.uid() (request.jwt.claims.sub),
-- captures the result, RESETs ROLE, then asserts as the test owner.

BEGIN;

SELECT plan(7);

-- ---- fixture ----
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('e0000d09-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','d9-sm@test.local'),
  ('e0000d09-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','d9-hm@test.local'),
  ('e0000d09-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','d9-sw@test.local'),
  ('e0000d09-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','d9-w@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('e0000d09-0000-0000-0000-000000000001','D9 SM','d9-sm@test.local','lower-quad',true),
  ('e0000d09-0000-0000-0000-000000000002','D9 HM','d9-hm@test.local','lower-quad',true),
  ('e0000d09-0000-0000-0000-000000000003','D9 SW','d9-sw@test.local','lower-quad',true),
  ('e0000d09-0000-0000-0000-000000000004','D9 W','d9-w@test.local','lower-quad',true);

INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('e0000d09-0000-0000-0000-000000000001','sm','lower-quad'),
  ('e0000d09-0000-0000-0000-000000000002','hm','lower-quad'),
  ('e0000d09-0000-0000-0000-000000000003','sw',NULL),
  ('e0000d09-0000-0000-0000-000000000004','sw',NULL);

INSERT INTO public.scheduling_periods (period_id, period_name, profile_name, start_date, end_date, preference_deadline)
VALUES ('c0000d09-0000-0000-0000-000000000001','D9 Period','regular_school_year','2031-09-15','2031-12-15', now() + interval '30 days');

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('f0000d09-0000-0000-0000-0000000000b1','lower-quad','2031-09-16 10:00:00 America/New_York'::timestamptz,2),
  ('f0000d09-0000-0000-0000-0000000000b2','lower-quad','2031-09-16 10:30:00 America/New_York'::timestamptz,2);

INSERT INTO public.draft_block_assignments (period_id, block_id, user_id, created_by) VALUES
  ('c0000d09-0000-0000-0000-000000000001','f0000d09-0000-0000-0000-0000000000b1',
   'e0000d09-0000-0000-0000-000000000004','e0000d09-0000-0000-0000-000000000001');

INSERT INTO public.preferences (user_id, block_id, period_id, status) VALUES
  ('e0000d09-0000-0000-0000-000000000004','f0000d09-0000-0000-0000-0000000000b1',
   'c0000d09-0000-0000-0000-000000000001','preferred');

-- ---- probes ----
-- SM: can see house drafts.
DO $$
DECLARE v int;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"e0000d09-0000-0000-0000-000000000001","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v FROM public.draft_block_assignments
    WHERE block_id = 'f0000d09-0000-0000-0000-0000000000b1';
  RESET ROLE;
  PERFORM set_config('test.d9.sm_drafts', v::text, true);
END $$;
SELECT is(current_setting('test.d9.sm_drafts')::int, 1, 'SM can SELECT drafts for their house');

-- SM: can INSERT a draft for their house (build).
DO $$
DECLARE ok boolean := true;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"e0000d09-0000-0000-0000-000000000001","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.draft_block_assignments (period_id, block_id, user_id, created_by)
    VALUES ('c0000d09-0000-0000-0000-000000000001','f0000d09-0000-0000-0000-0000000000b2',
            'e0000d09-0000-0000-0000-000000000004','e0000d09-0000-0000-0000-000000000001');
  EXCEPTION WHEN OTHERS THEN ok := false;
  END;
  RESET ROLE;
  PERFORM set_config('test.d9.sm_insert', ok::text, true);
END $$;
SELECT is(current_setting('test.d9.sm_insert'), 'true', 'SM can INSERT a draft for their house');

-- SM: can READ house preferences (build input).
DO $$
DECLARE v int;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"e0000d09-0000-0000-0000-000000000001","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v FROM public.preferences
    WHERE block_id = 'f0000d09-0000-0000-0000-0000000000b1';
  RESET ROLE;
  PERFORM set_config('test.d9.sm_prefs', v::text, true);
END $$;
SELECT is(current_setting('test.d9.sm_prefs')::int, 1, 'SM can SELECT house preferences');

-- SM: CANNOT see other users of their house (admin narrowed to hm/bm).
DO $$
DECLARE v int;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"e0000d09-0000-0000-0000-000000000001","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v FROM public.users
    WHERE home_house_id = 'lower-quad'
      AND user_id <> 'e0000d09-0000-0000-0000-000000000001';
  RESET ROLE;
  PERFORM set_config('test.d9.sm_users', v::text, true);
END $$;
SELECT is(current_setting('test.d9.sm_users')::int, 0, 'SM cannot SELECT other house users (admin is hm/bm-only)');

-- HM: CAN see other users of their house (admin).
DO $$
DECLARE v int;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"e0000d09-0000-0000-0000-000000000002","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v FROM public.users
    WHERE home_house_id = 'lower-quad'
      AND user_id <> 'e0000d09-0000-0000-0000-000000000002';
  RESET ROLE;
  PERFORM set_config('test.d9.hm_users', v::text, true);
END $$;
SELECT cmp_ok(current_setting('test.d9.hm_users')::int, '>=', 1, 'HM can SELECT house users (admin)');

-- SW: cannot see drafts (not a builder).
DO $$
DECLARE v int;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"e0000d09-0000-0000-0000-000000000003","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v FROM public.draft_block_assignments
    WHERE block_id = 'f0000d09-0000-0000-0000-0000000000b1';
  RESET ROLE;
  PERFORM set_config('test.d9.sw_drafts', v::text, true);
END $$;
SELECT is(current_setting('test.d9.sw_drafts')::int, 0, 'SW cannot SELECT drafts (not a builder)');

-- SW: cannot INSERT a draft.
DO $$
DECLARE ok boolean := true;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"e0000d09-0000-0000-0000-000000000003","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.draft_block_assignments (period_id, block_id, user_id, created_by)
    VALUES ('c0000d09-0000-0000-0000-000000000001','f0000d09-0000-0000-0000-0000000000b2',
            'e0000d09-0000-0000-0000-000000000003','e0000d09-0000-0000-0000-000000000003');
  EXCEPTION WHEN OTHERS THEN ok := false;
  END;
  RESET ROLE;
  PERFORM set_config('test.d9.sw_insert', ok::text, true);
END $$;
SELECT is(current_setting('test.d9.sw_insert'), 'false', 'SW cannot INSERT a draft (RLS denies)');

SELECT finish();
ROLLBACK;
