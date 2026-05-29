-- pgTAP: destination SM visibility of inbound floats / live house schedule
-- (post-verification fix for the D9 over-correction).
--
-- BSpec §7.1 / §10: "The destination house's SM and HM can see the
-- acknowledgment status of an inbound float on their dashboard." D9 narrowed the
-- float / shift_block_assignments admin SELECT to hm/bm-only; this restores the
-- SM READ path via user_can_build_schedule while keeping it house-scoped.
-- Runs each probe as the `authenticated` role with a simulated auth.uid().

BEGIN;

SELECT plan(4);

-- ---- fixture ----
-- SM scoped to the destination house-03 (home elsewhere, so destination
-- visibility can ONLY come from the build-role branch, not home-house).
-- An SM scoped to an unrelated house, a plain SW, and the floater (harnwell).
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('e0000f17-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','f17-sm03@test.local'),
  ('e0000f17-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','f17-sm04@test.local'),
  ('e0000f17-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','f17-sw@test.local'),
  ('e0000f17-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','f17-floater@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('e0000f17-0000-0000-0000-000000000001','F17 SM03','f17-sm03@test.local','house-09',true),
  ('e0000f17-0000-0000-0000-000000000002','F17 SM04','f17-sm04@test.local','house-04',true),
  ('e0000f17-0000-0000-0000-000000000003','F17 SW','f17-sw@test.local','house-05',true),
  ('e0000f17-0000-0000-0000-000000000004','F17 Floater','f17-floater@test.local','harnwell',true);

INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('e0000f17-0000-0000-0000-000000000001','sm','house-03'),
  ('e0000f17-0000-0000-0000-000000000002','sm','house-04'),
  ('e0000f17-0000-0000-0000-000000000003','sw',NULL);

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('f0000f17-0000-0000-0000-000000000001','harnwell','2031-09-16 10:00:00 America/New_York'::timestamptz,2),
  ('f0000f17-0000-0000-0000-000000000002','house-03','2031-09-16 10:00:00 America/New_York'::timestamptz,1);

-- A pending inbound float: harnwell floater -> house-03 destination.
INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id, parent_float_id)
VALUES
  ('a0000f17-0000-0000-0000-000000000001','f0000f17-0000-0000-0000-000000000001','e0000f17-0000-0000-0000-000000000004','pending_float_out','none',true,'harnwell',NULL),
  ('a0000f17-0000-0000-0000-000000000002','f0000f17-0000-0000-0000-000000000002','e0000f17-0000-0000-0000-000000000004','pending_float_in','none',true,'harnwell',NULL);

INSERT INTO public.float_assignments
  (float_id, user_id, source_assignment_ids, destination_assignment_ids, status, initiated_by, expires_for_cleanup_at)
VALUES
  ('b0000f17-0000-0000-0000-000000000001','e0000f17-0000-0000-0000-000000000004',
   ARRAY['a0000f17-0000-0000-0000-000000000001']::uuid[],
   ARRAY['a0000f17-0000-0000-0000-000000000002']::uuid[],
   'pending','automated','2031-10-01 00:00:00 America/New_York'::timestamptz);

UPDATE public.shift_block_assignments
SET parent_float_id = 'b0000f17-0000-0000-0000-000000000001'
WHERE assignment_id IN ('a0000f17-0000-0000-0000-000000000001','a0000f17-0000-0000-0000-000000000002');

-- ---- probes ----
-- Destination SM (scope house-03) CAN see the inbound float.
DO $$ DECLARE v int; BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"e0000f17-0000-0000-0000-000000000001","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v FROM public.float_assignments WHERE float_id='b0000f17-0000-0000-0000-000000000001';
  RESET ROLE;
  PERFORM set_config('test.f17.sm03_float', v::text, true);
END $$;
SELECT is(current_setting('test.f17.sm03_float')::int, 1,
  'destination SM can SELECT the inbound float (BSpec §7.1/§10)');

-- Destination SM CAN see the live (Pending) destination assignment row at house-03
-- (home is house-09, so this comes only from the build-role branch -> tests the fix).
DO $$ DECLARE v int; BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"e0000f17-0000-0000-0000-000000000001","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v FROM public.shift_block_assignments WHERE assignment_id='a0000f17-0000-0000-0000-000000000002';
  RESET ROLE;
  PERFORM set_config('test.f17.sm03_sba', v::text, true);
END $$;
SELECT is(current_setting('test.f17.sm03_sba')::int, 1,
  'destination SM can SELECT the live destination assignment (calendar "(Pending)" visibility)');

-- An SM of an UNRELATED house cannot see the float (house-scoped).
DO $$ DECLARE v int; BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"e0000f17-0000-0000-0000-000000000002","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v FROM public.float_assignments WHERE float_id='b0000f17-0000-0000-0000-000000000001';
  RESET ROLE;
  PERFORM set_config('test.f17.sm04_float', v::text, true);
END $$;
SELECT is(current_setting('test.f17.sm04_float')::int, 0,
  'SM of an unrelated house cannot SELECT the float (house-scoped, no X-2 over-reach)');

-- A plain SW (not the floater) cannot see the float.
DO $$ DECLARE v int; BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"e0000f17-0000-0000-0000-000000000003","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::int INTO v FROM public.float_assignments WHERE float_id='b0000f17-0000-0000-0000-000000000001';
  RESET ROLE;
  PERFORM set_config('test.f17.sw_float', v::text, true);
END $$;
SELECT is(current_setting('test.f17.sw_float')::int, 0,
  'a plain SW cannot SELECT the inbound float');

SELECT finish();
ROLLBACK;
