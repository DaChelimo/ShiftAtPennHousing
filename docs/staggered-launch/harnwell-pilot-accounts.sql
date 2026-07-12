-- Harnwell pilot accounts (Phase C). The 9 desk workers from the Summer Final schedule
-- plus Amaltuas Taye (RSM). Abraham is the SM. All home-housed at harnwell.
--
-- Idempotent: ON CONFLICT DO NOTHING everywhere, so re-running is safe. Deterministic
-- UUIDs (fbb0...NN) so the same person keeps the same id across environments.
--
-- Passwords: this LOCAL script sets 'abc123' (matching seed.sql) so the pilot is
-- testable immediately. PRODUCTION must NOT set a password here; instead create the
-- accounts password-less and issue set-password links via the admin console
-- (Launch -> Invite roster) or the /auth/forgot flow (Phase D). See ROLLOUT_PLAN.md.

-- 1. auth.users (GoTrue identities).
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  v.id::uuid, 'authenticated', 'authenticated', v.email,
  extensions.crypt('abc123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('name', v.name),
  '', '', '', ''
FROM (VALUES
  ('fbb00000-0000-4000-8000-000000000001', 'elenikan@sas.upenn.edu',   'Eleni'),
  ('fbb00000-0000-4000-8000-000000000002', 'ndlovuab@sas.upenn.edu',   'Abraham'),
  ('fbb00000-0000-4000-8000-000000000003', 'dbukasa@sas.upenn.edu',    'Drew'),
  ('fbb00000-0000-4000-8000-000000000004', 'mercadov@sas.upenn.edu',   'Valeria'),
  ('fbb00000-0000-4000-8000-000000000005', 'akkirui@sas.upenn.edu',    'Aaron'),
  ('fbb00000-0000-4000-8000-000000000006', 'lmelesse@seas.upenn.edu',  'Lealem'),
  ('fbb00000-0000-4000-8000-000000000007', 'ornellar@sas.upenn.edu',   'Ornella'),
  ('fbb00000-0000-4000-8000-000000000008', 'chelimo@seas.upenn.edu',   'Andrew Chelimo'),
  ('fbb00000-0000-4000-8000-000000000009', 'liseche1@nursing.upenn.edu','Purity'),
  ('fbb00000-0000-4000-8000-000000000010', 'amtaye@upenn.edu',         'Amaltuas Taye')
) AS v(id, email, name)
ON CONFLICT (id) DO NOTHING;

-- 2. auth.identities (email provider row per user).
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
FROM auth.users u
WHERE u.id::text LIKE 'fbb00000-0000-4000-8000-%'
ON CONFLICT (provider_id, provider) DO NOTHING;

-- 3. public.users (app profiles). All home-housed at harnwell.
INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('fbb00000-0000-4000-8000-000000000001', 'Eleni',          'elenikan@sas.upenn.edu',    'harnwell', true),
  ('fbb00000-0000-4000-8000-000000000002', 'Abraham',        'ndlovuab@sas.upenn.edu',    'harnwell', true),
  ('fbb00000-0000-4000-8000-000000000003', 'Drew',           'dbukasa@sas.upenn.edu',     'harnwell', true),
  ('fbb00000-0000-4000-8000-000000000004', 'Valeria',        'mercadov@sas.upenn.edu',    'harnwell', true),
  ('fbb00000-0000-4000-8000-000000000005', 'Aaron',          'akkirui@sas.upenn.edu',     'harnwell', true),
  ('fbb00000-0000-4000-8000-000000000006', 'Lealem',         'lmelesse@seas.upenn.edu',   'harnwell', true),
  ('fbb00000-0000-4000-8000-000000000007', 'Ornella',        'ornellar@sas.upenn.edu',    'harnwell', true),
  ('fbb00000-0000-4000-8000-000000000008', 'Andrew Chelimo', 'chelimo@seas.upenn.edu',    'harnwell', true),
  ('fbb00000-0000-4000-8000-000000000009', 'Purity',         'liseche1@nursing.upenn.edu','harnwell', true),
  ('fbb00000-0000-4000-8000-000000000010', 'Amaltuas Taye',  'amtaye@upenn.edu',          'harnwell', true)
ON CONFLICT (user_id) DO NOTHING;

-- 4. public.user_roles. Abraham = SM (scope harnwell); Amaltuas = RSM (scope harnwell);
--    everyone else = SW (scope NULL).
INSERT INTO public.user_roles (user_id, role, scope_house_id) VALUES
  ('fbb00000-0000-4000-8000-000000000001', 'sw',  NULL),
  ('fbb00000-0000-4000-8000-000000000002', 'sm',  'harnwell'),
  ('fbb00000-0000-4000-8000-000000000003', 'sw',  NULL),
  ('fbb00000-0000-4000-8000-000000000004', 'sw',  NULL),
  ('fbb00000-0000-4000-8000-000000000005', 'sw',  NULL),
  ('fbb00000-0000-4000-8000-000000000006', 'sw',  NULL),
  ('fbb00000-0000-4000-8000-000000000007', 'sw',  NULL),
  ('fbb00000-0000-4000-8000-000000000008', 'sw',  NULL),
  ('fbb00000-0000-4000-8000-000000000009', 'sw',  NULL),
  ('fbb00000-0000-4000-8000-000000000010', 'rsm', 'harnwell')
ON CONFLICT (user_id, role, scope_house_id) DO NOTHING;
