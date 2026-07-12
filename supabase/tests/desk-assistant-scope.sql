-- Desk Assistant — pgTAP for the scoping matrix da_can_read_item (V1_SCOPE §6.3,
-- §10.5; migration 20260710000001). This is the SQL half of the shared truth table;
-- the TS mirror is packages/core/tests/desk-assistant/scope.test.ts. The two MUST
-- stay in lockstep. da_can_read_item is a plain function (not an RLS read), so this
-- runs under raw psql as well as `supabase test db`.
--
-- Self-contained: BEGIN...ROLLBACK, own houses + auth.users + users + roles, no
-- assumption about the seed's house ids.
--
-- Run with: supabase test db   (or: pnpm pgtap:file supabase/tests/desk-assistant-scope.sql)

BEGIN;

SELECT plan(19);

-- Fixtures -----------------------------------------------------------------
INSERT INTO houses (id, name) VALUES ('da-a', 'DA House A'), ('da-b', 'DA House B')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('da000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da-sw-a@test.local'),
  ('da000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da-sw-b@test.local'),
  ('da000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da-hm-a@test.local'),
  ('da000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da-hm-b@test.local'),
  ('da000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da-rsm@test.local'),
  ('da000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da-admin@test.local'),
  ('da000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da-sm-a@test.local'),
  ('da000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'da-inactive@test.local')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('da000000-0000-0000-0000-000000000001', 'SW A',      'da-sw-a@test.local',    'da-a', true),
  ('da000000-0000-0000-0000-000000000002', 'SW B',      'da-sw-b@test.local',    'da-b', true),
  ('da000000-0000-0000-0000-000000000003', 'HM A',      'da-hm-a@test.local',    'da-b', true),
  ('da000000-0000-0000-0000-000000000004', 'HM B',      'da-hm-b@test.local',    'da-b', true),
  ('da000000-0000-0000-0000-000000000005', 'RSM',       'da-rsm@test.local',     'da-b', true),
  ('da000000-0000-0000-0000-000000000006', 'Admin',     'da-admin@test.local',   'da-b', true),
  ('da000000-0000-0000-0000-000000000007', 'SM A',      'da-sm-a@test.local',    'da-a', true),
  ('da000000-0000-0000-0000-000000000008', 'Inactive',  'da-inactive@test.local','da-a', false);

INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('da000000-0000-0000-0000-000000000001', 'sw',    NULL),
  ('da000000-0000-0000-0000-000000000002', 'sw',    NULL),
  ('da000000-0000-0000-0000-000000000003', 'hm',    'da-a'),
  ('da000000-0000-0000-0000-000000000004', 'hm',    'da-b'),
  ('da000000-0000-0000-0000-000000000005', 'rsm',   'da-b'),
  ('da000000-0000-0000-0000-000000000006', 'admin', NULL),
  ('da000000-0000-0000-0000-000000000007', 'sm',    'da-a'),
  ('da000000-0000-0000-0000-000000000008', 'sw',    NULL);

-- Shorthands
\set sw_a   '''da000000-0000-0000-0000-000000000001''::uuid'
\set sw_b   '''da000000-0000-0000-0000-000000000002''::uuid'
\set hm_a   '''da000000-0000-0000-0000-000000000003''::uuid'
\set hm_b   '''da000000-0000-0000-0000-000000000004''::uuid'
\set rsm    '''da000000-0000-0000-0000-000000000005''::uuid'
\set admin  '''da000000-0000-0000-0000-000000000006''::uuid'
\set sm_a   '''da000000-0000-0000-0000-000000000007''::uuid'
\set inact  '''da000000-0000-0000-0000-000000000008''::uuid'

-- House gate ---------------------------------------------------------------
SELECT ok(da_can_read_item(:sw_a, NULL, 'general', '{}'::text[]),
  'shared corpus readable by any worker');
SELECT ok(da_can_read_item(:sw_a, 'da-a', 'general', '{}'::text[]),
  'overlay readable by home-house worker');
SELECT ok(NOT da_can_read_item(:sw_b, 'da-a', 'general', '{}'::text[]),
  'overlay NOT readable by other-house worker');
SELECT ok(da_can_read_item(:hm_a, 'da-a', 'general', '{}'::text[]),
  'overlay readable by that house HM');
SELECT ok(NOT da_can_read_item(:hm_b, 'da-a', 'general', '{}'::text[]),
  'overlay NOT readable by a different-house HM');
SELECT ok(da_can_read_item(:rsm, 'da-a', 'general', '{}'::text[]),
  'overlay readable by RSM (cross-house)');
SELECT ok(da_can_read_item(:admin, 'da-a', 'general', '{}'::text[]),
  'overlay readable by admin');

-- Sensitivity gate ---------------------------------------------------------
SELECT ok(da_can_read_item(:sw_a, NULL, 'general', '{}'::text[]),
  'general sensitivity readable by all');
SELECT ok(da_can_read_item(:sw_a, NULL, 'internal', '{}'::text[]),
  'internal readable by active user');
SELECT ok(NOT da_can_read_item(:inact, NULL, 'internal', '{}'::text[]),
  'internal NOT readable by inactive user');
SELECT ok(NOT da_can_read_item(:sw_a, NULL, 'restricted', '{}'::text[]),
  'restricted NOT readable by plain SW');
SELECT ok(da_can_read_item(:hm_a, NULL, 'restricted', '{}'::text[]),
  'restricted readable by HM');
SELECT ok(da_can_read_item(:admin, NULL, 'restricted', '{}'::text[]),
  'restricted readable by admin');
SELECT ok(NOT da_can_read_item(:sm_a, NULL, 'restricted', '{}'::text[]),
  'restricted NOT readable by SM');

-- Role gate ----------------------------------------------------------------
SELECT ok(da_can_read_item(:sw_a, NULL, 'general', '{}'::text[]),
  'empty allowed_roles readable by every role');
SELECT ok(da_can_read_item(:sm_a, NULL, 'general', ARRAY['sm']::text[]),
  'role-scoped item readable by holder of the role');
SELECT ok(NOT da_can_read_item(:sw_a, NULL, 'general', ARRAY['sm','hm']::text[]),
  'role-scoped item NOT readable by user lacking the role');

-- Combined gates -----------------------------------------------------------
SELECT ok(da_can_read_item(:hm_a, 'da-a', 'restricted', ARRAY['hm']::text[]),
  'all gates pass for the Harnwell-equivalent HM');
SELECT ok(NOT da_can_read_item(:sw_a, 'da-a', 'restricted', ARRAY['hm']::text[]),
  'SW fails the restricted + role gate even in-house');

SELECT * FROM finish();
ROLLBACK;
