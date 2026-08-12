-- Tier 2b: Du Bois synthetic roster
-- Hand-written (not gen-prod-seed.sh output — Du Bois has no real hires yet).
--
-- ALL 15 of these are NOT real people. They exist so Du Bois can be exercised
-- end-to-end (preferences, builder, live schedule, coverage ladder) before real
-- Du Bois student workers are hired. Mirrors the existing Gregory placeholder
-- pattern (see 02-people.sql: Hana Gregory / Diana Gregory) but for the whole
-- house roster, not just the two admin seats.
--
-- Placeholder addresses are `<firstname>-dubois@upenn.edu` (same convention
-- 02-people.sql used for its two synthetic Gregory seats) and MUST be replaced
-- with deliverable Penn addresses, or the accounts deactivated, before any real
-- Du Bois launch. Password for every account below is `abc123` (the same shared
-- test password used across synthetic/manual-test rosters elsewhere, e.g.
-- supabase/seeds/manual-test.sql), hashed via pgcrypto at insert time -- rotate
-- before real use.
--
-- Roster: 12 SW + 1 SM + 1 RSM + 1 HM.
BEGIN;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated',
  v.email, extensions.crypt('abc123', extensions.gen_salt('bf', 6)),
  now(), now(), now(), '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('name', v.name), '', '', '', ''
FROM (VALUES
  ('d0b00000-0000-4000-8000-000000000001','Alex Kiplagat','alex-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-000000000002','Caroline Nekesa','caroline-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-000000000003','Derrick Mwendwa','derrick-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-000000000004','Eunice Chepngeno','eunice-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-000000000005','Frank Wekesa','frank-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-000000000006','Grace Auma','grace-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-000000000007','Henry Kiptoo','henry-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-000000000008','Irene Nyambura','irene-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-000000000009','Kelvin Rotich','kelvin-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-00000000000a','Lydia Wanjiku','lydia-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-00000000000b','Nicholas Onyango','nicholas-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-00000000000c','Rose Chelangat','rose-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-00000000000d','Peter Njoroge','peter-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-00000000000e','Diana Wafula','diana-dubois@upenn.edu'),
  ('d0b00000-0000-4000-8000-00000000000f','Martin Kariuki','martin-dubois@upenn.edu')
) AS v(id, name, email)
ON CONFLICT (id) DO NOTHING;

-- Keeps the password current on re-run even though the INSERT above is a no-op once the
-- row exists (ON CONFLICT DO NOTHING does not touch encrypted_password on conflict).
UPDATE auth.users SET encrypted_password = extensions.crypt('abc123', extensions.gen_salt('bf', 6))
WHERE id::text LIKE 'd0b00000%';

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email', now(), now(), now()
FROM auth.users u WHERE u.id::text LIKE 'd0b00000%'
ON CONFLICT (provider, provider_id) DO NOTHING;

INSERT INTO users (user_id, name, email, home_house_id, is_active, broadcast_subscribed) VALUES
  ('d0b00000-0000-4000-8000-000000000001','Alex Kiplagat','alex-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-000000000002','Caroline Nekesa','caroline-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-000000000003','Derrick Mwendwa','derrick-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-000000000004','Eunice Chepngeno','eunice-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-000000000005','Frank Wekesa','frank-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-000000000006','Grace Auma','grace-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-000000000007','Henry Kiptoo','henry-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-000000000008','Irene Nyambura','irene-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-000000000009','Kelvin Rotich','kelvin-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-00000000000a','Lydia Wanjiku','lydia-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-00000000000b','Nicholas Onyango','nicholas-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-00000000000c','Rose Chelangat','rose-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-00000000000d','Peter Njoroge','peter-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-00000000000e','Diana Wafula','diana-dubois@upenn.edu','du-bois','t','f'),
  ('d0b00000-0000-4000-8000-00000000000f','Martin Kariuki','martin-dubois@upenn.edu','du-bois','t','f')
ON CONFLICT (user_id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, home_house_id=EXCLUDED.home_house_id, is_active=EXCLUDED.is_active;

INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('d0b00000-0000-4000-8000-000000000001','sw'::user_role_enum,NULL),
  ('d0b00000-0000-4000-8000-000000000002','sw'::user_role_enum,NULL),
  ('d0b00000-0000-4000-8000-000000000003','sw'::user_role_enum,NULL),
  ('d0b00000-0000-4000-8000-000000000004','sw'::user_role_enum,NULL),
  ('d0b00000-0000-4000-8000-000000000005','sw'::user_role_enum,NULL),
  ('d0b00000-0000-4000-8000-000000000006','sw'::user_role_enum,NULL),
  ('d0b00000-0000-4000-8000-000000000007','sw'::user_role_enum,NULL),
  ('d0b00000-0000-4000-8000-000000000008','sw'::user_role_enum,NULL),
  ('d0b00000-0000-4000-8000-000000000009','sw'::user_role_enum,NULL),
  ('d0b00000-0000-4000-8000-00000000000a','sw'::user_role_enum,NULL),
  ('d0b00000-0000-4000-8000-00000000000b','sw'::user_role_enum,NULL),
  ('d0b00000-0000-4000-8000-00000000000c','sw'::user_role_enum,NULL),
  ('d0b00000-0000-4000-8000-00000000000d','sm'::user_role_enum,'du-bois'),
  ('d0b00000-0000-4000-8000-00000000000e','rsm'::user_role_enum,'du-bois'),
  ('d0b00000-0000-4000-8000-00000000000f','hm'::user_role_enum,'du-bois')
ON CONFLICT DO NOTHING;

-- season-scoped membership; users.home_house_id is the cache of the row covering today
INSERT INTO user_house_memberships (membership_id, user_id, house_id, effective_from, effective_to, applied_at, note)
SELECT gen_random_uuid(), v.id::uuid, 'du-bois', '2000-01-01', NULL, now(), 'synthetic Du Bois pilot roster'
FROM (VALUES
  ('d0b00000-0000-4000-8000-000000000001'),('d0b00000-0000-4000-8000-000000000002'),
  ('d0b00000-0000-4000-8000-000000000003'),('d0b00000-0000-4000-8000-000000000004'),
  ('d0b00000-0000-4000-8000-000000000005'),('d0b00000-0000-4000-8000-000000000006'),
  ('d0b00000-0000-4000-8000-000000000007'),('d0b00000-0000-4000-8000-000000000008'),
  ('d0b00000-0000-4000-8000-000000000009'),('d0b00000-0000-4000-8000-00000000000a'),
  ('d0b00000-0000-4000-8000-00000000000b'),('d0b00000-0000-4000-8000-00000000000c'),
  ('d0b00000-0000-4000-8000-00000000000d'),('d0b00000-0000-4000-8000-00000000000e'),
  ('d0b00000-0000-4000-8000-00000000000f')
) AS v(id)
WHERE NOT EXISTS (
  SELECT 1 FROM user_house_memberships m WHERE m.user_id = v.id::uuid AND m.house_id = 'du-bois'
);

COMMIT;
