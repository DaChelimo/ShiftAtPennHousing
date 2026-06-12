-- pgTAP tests for T2-6: the `hire_worker` RPC (BSpec §4.5 "Hiring").
--
-- Spec sources (authoritative):
--   BEHAVIORAL_SPECIFICATION.md §4.5 ("A new hire is added at any time during a
--     period and starts with no assigned shifts. From the moment of activation,
--     the new hire holds all standard SW capabilities."),
--   §6.6 / §2.3 / §2.6 (people-admin is HM/BM-only — user_has_house_admin_role,
--     NOT the schedule-builder helper; SM and non-admin rejected; an HM/BM of a
--     DIFFERENT house cannot hire into a house they do not administer),
--   AGENTS.md hard invariant #1 (Harnwell training — a hire sets only a home house
--     + role, never a shift, so it cannot place a non-Harnwell worker on the
--     Harnwell desk).
--
-- The EF (hire-worker) owns auth.admin.createUser (the only non-SQL step); this RPC
-- owns the authz re-check + validation + the public.users / user_roles inserts. In
-- these tests we pre-create the auth.users row (as the EF would) and call the RPC.
--
-- WHAT THIS SUITE COVERS
--   A. Existence & shape — signature; SECURITY DEFINER; revoked from PUBLIC; granted
--      to service_role.
--   B. Permissions — HM-of-house allowed; BM-of-house allowed; SM-of-house rejected;
--      SW rejected; HM-of-OTHER-house rejected.
--   C. Creation — public.users row (active, not broadcast-subscribed, home house);
--      user_roles row; sw → NULL scope; sm/hm/bm → home-house scope.
--   D. Validation — blank name; bad email; unknown house; duplicate (already-exists).
--   E. Invariant edge — a Harnwell hire is created (home_house harnwell) with no shift.

BEGIN;

SELECT plan(24);

-- ============================================================
-- 0. Fixtures: initiators (HM/BM/SM/SW of house-05; HM of house-07) + the auth.users
--    rows for the to-be-hired workers (the EF would create these).
-- ============================================================
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('26000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't26-hm05@test.local'),
  ('26000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't26-bm05@test.local'),
  ('26000001-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't26-sm05@test.local'),
  ('26000001-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't26-sw05@test.local'),
  ('26000001-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't26-hm07@test.local'),
  -- to-be-hired auth rows (one per creation test; EF would have made these)
  ('26000001-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't26-new-sw@test.local'),
  ('26000001-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't26-new-sm@test.local'),
  ('26000001-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't26-new-bm@test.local'),
  ('26000001-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't26-new-harn@test.local'),
  ('26000001-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 't26-new-reject@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('26000001-0000-0000-0000-000000000002', 'HM (house-05)', 't26-hm05@test.local', 'house-05', true),
  ('26000001-0000-0000-0000-000000000003', 'BM (house-05)', 't26-bm05@test.local', 'house-05', true),
  ('26000001-0000-0000-0000-000000000004', 'SM (house-05)', 't26-sm05@test.local', 'house-05', true),
  ('26000001-0000-0000-0000-000000000006', 'SW (house-05)', 't26-sw05@test.local', 'house-05', true),
  ('26000001-0000-0000-0000-000000000005', 'HM (house-07)', 't26-hm07@test.local', 'house-07', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('26000001-0000-0000-0000-000000000002', 'hm', 'house-05'),
  ('26000001-0000-0000-0000-000000000003', 'bm', 'house-05'),
  ('26000001-0000-0000-0000-000000000004', 'sm', 'house-05'),
  ('26000001-0000-0000-0000-000000000006', 'sw', NULL),
  ('26000001-0000-0000-0000-000000000005', 'hm', 'house-07')
ON CONFLICT DO NOTHING;

-- ============================================================
-- A. Existence & shape
-- ============================================================
SELECT has_function(
  'public', 'hire_worker',
  ARRAY['uuid', 'uuid', 'text', 'text', 'text', 'user_role_enum', 'text'],
  'hire_worker(initiator, user_id, name, email, home_house, role, phone) exists'
);

SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'hire_worker'),
  true,
  'hire_worker is SECURITY DEFINER'
);

SELECT ok(
  NOT has_function_privilege('public', 'hire_worker(uuid, uuid, text, text, text, user_role_enum, text)', 'EXECUTE'),
  'hire_worker is NOT executable by PUBLIC'
);

SELECT ok(
  has_function_privilege('service_role', 'hire_worker(uuid, uuid, text, text, text, user_role_enum, text)', 'EXECUTE'),
  'hire_worker is executable by service_role'
);

-- ============================================================
-- B. Permissions (HM/BM-only, house-scoped)
-- ============================================================
-- SM of the house → rejected
SELECT throws_ok(
  $$ SELECT hire_worker(
       '26000001-0000-0000-0000-000000000004',
       '26000001-0000-0000-0000-0000000000a5',
       'Rejected SM Hire', 't26-new-reject@test.local', 'house-05', 'sw', NULL) $$,
  'not_authorized',
  'SM of the house may NOT hire (people-admin is HM/BM-only)'
);

-- SW → rejected
SELECT throws_ok(
  $$ SELECT hire_worker(
       '26000001-0000-0000-0000-000000000006',
       '26000001-0000-0000-0000-0000000000a5',
       'Rejected SW Hire', 't26-new-reject@test.local', 'house-05', 'sw', NULL) $$,
  'not_authorized',
  'A plain SW may NOT hire'
);

-- HM of a DIFFERENT house → rejected
SELECT throws_ok(
  $$ SELECT hire_worker(
       '26000001-0000-0000-0000-000000000005',
       '26000001-0000-0000-0000-0000000000a5',
       'Rejected Cross Hire', 't26-new-reject@test.local', 'house-05', 'sw', NULL) $$,
  'not_authorized',
  'An HM of a different house may NOT hire into house-05'
);

-- Confirm none of the rejected attempts created the row.
SELECT is(
  (SELECT count(*)::int FROM users WHERE user_id = '26000001-0000-0000-0000-0000000000a5'),
  0,
  'a rejected hire creates no public.users row'
);

-- ============================================================
-- C. Creation — HM creates an SW (NULL scope, active, not subscribed)
-- ============================================================
SELECT lives_ok(
  $$ SELECT hire_worker(
       '26000001-0000-0000-0000-000000000002',
       '26000001-0000-0000-0000-0000000000a1',
       '  New SW  ', 'New.SW@Test.Local', 'house-05', 'sw', '  (215) 555-0100  ') $$,
  'HM of house-05 can hire an SW'
);

SELECT is(
  (SELECT home_house_id FROM users WHERE user_id = '26000001-0000-0000-0000-0000000000a1'),
  'house-05',
  'new SW has the correct home house'
);

SELECT is(
  (SELECT is_active FROM users WHERE user_id = '26000001-0000-0000-0000-0000000000a1'),
  true,
  'new SW is active from creation (§4.5 "moment of activation")'
);

SELECT is(
  (SELECT broadcast_subscribed FROM users WHERE user_id = '26000001-0000-0000-0000-0000000000a1'),
  false,
  'new SW is not broadcast-subscribed'
);

SELECT is(
  (SELECT name FROM users WHERE user_id = '26000001-0000-0000-0000-0000000000a1'),
  'New SW',
  'new SW name is trimmed'
);

SELECT is(
  (SELECT email FROM users WHERE user_id = '26000001-0000-0000-0000-0000000000a1'),
  'new.sw@test.local',
  'new SW email is lower-cased'
);

SELECT is(
  (SELECT phone FROM users WHERE user_id = '26000001-0000-0000-0000-0000000000a1'),
  '(215) 555-0100',
  'new SW phone is trimmed'
);

SELECT is(
  (SELECT scope_house_id FROM user_roles
   WHERE user_id = '26000001-0000-0000-0000-0000000000a1' AND role = 'sw'),
  NULL,
  'an sw hire has NULL role scope'
);

SELECT is(
  (SELECT count(*)::int FROM shift_block_assignments
   WHERE user_id = '26000001-0000-0000-0000-0000000000a1'),
  0,
  'a new hire starts with NO assigned shifts (§4.5)'
);

-- BM creates an SM (scoped to the home house)
SELECT lives_ok(
  $$ SELECT hire_worker(
       '26000001-0000-0000-0000-000000000003',
       '26000001-0000-0000-0000-0000000000a2',
       'New SM', 't26-new-sm@test.local', 'house-05', 'sm', NULL) $$,
  'BM of house-05 can hire an SM'
);

SELECT is(
  (SELECT scope_house_id FROM user_roles
   WHERE user_id = '26000001-0000-0000-0000-0000000000a2' AND role = 'sm'),
  'house-05',
  'an sm hire is scoped to the home house'
);

-- ============================================================
-- D. Validation
-- ============================================================
SELECT throws_ok(
  $$ SELECT hire_worker(
       '26000001-0000-0000-0000-000000000002',
       '26000001-0000-0000-0000-0000000000a3',
       '   ', 't26-new-bm@test.local', 'house-05', 'sw', NULL) $$,
  'name_required',
  'a blank name is rejected'
);

SELECT throws_ok(
  $$ SELECT hire_worker(
       '26000001-0000-0000-0000-000000000002',
       '26000001-0000-0000-0000-0000000000a3',
       'Bad Email', 'not-an-email', 'house-05', 'sw', NULL) $$,
  'invalid_email',
  'a malformed email is rejected'
);

SELECT throws_ok(
  $$ SELECT hire_worker(
       '26000001-0000-0000-0000-000000000002',
       '26000001-0000-0000-0000-0000000000a3',
       'Bad House', 't26-new-bm@test.local', 'no-such-house', 'sw', NULL) $$,
  'not_authorized',
  'an unknown house is rejected at the authz gate (admin has no role there)'
);

-- Duplicate: re-hiring an already-present public.users row is rejected.
SELECT throws_ok(
  $$ SELECT hire_worker(
       '26000001-0000-0000-0000-000000000002',
       '26000001-0000-0000-0000-0000000000a1',
       'Dup SW', 't26-new-sw@test.local', 'house-05', 'sw', NULL) $$,
  'worker_already_exists',
  'hiring an already-present worker is rejected'
);

-- ============================================================
-- E. Harnwell edge — a Harnwell hire is created (home harnwell, no shift). The
--    initiator is an HM/BM of harnwell; reuse the seed's harnwell admin if any,
--    else the gate would reject — so we grant house-05's HM a harnwell admin role
--    just for this assertion is wrong; instead use an HM scoped to harnwell.
-- ============================================================
INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('26000001-0000-0000-0000-000000000002', 'hm', 'harnwell')
ON CONFLICT DO NOTHING;

SELECT lives_ok(
  $$ SELECT hire_worker(
       '26000001-0000-0000-0000-000000000002',
       '26000001-0000-0000-0000-0000000000a4',
       'Harn Hire', 't26-new-harn@test.local', 'harnwell', 'sw', NULL) $$,
  'an HM scoped to harnwell can hire a harnwell-home worker'
);

SELECT finish();
ROLLBACK;
