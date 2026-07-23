SELECT $$-- supabase/seeds/harnwell-real-workers.sql
-- AUTO-GENERATED from the live DB by `pnpm seed:harnwell:regen`
-- (generator: scripts/gen-harnwell-seed.sql). Do not hand-edit; regenerate instead.
--
-- Purpose: keep the 10 REAL Harnwell workers (Valeria, Lealem, Andrew Chelimo, Aaron,
-- Abraham, Amaltuas, Drew, Eleni, Ornella, Purity) and their scheduled shifts safe
-- across `supabase db reset`. These rows were added at runtime through the app and live
-- in no other seed, so a reset would otherwise wipe them.
--
-- Idempotent: every statement is ON CONFLICT DO NOTHING / NOT EXISTS guarded, so it is
-- safe to run repeatedly. Meant to run at the TAIL of `pnpm db:reset:seasons`, AFTER the
-- season seed has regenerated the Jun 1 - Aug 20 Harnwell blocks. It also recreates the
-- Aug 21 - Sep 7 blocks that no season config regenerates, then attaches each scheduled
-- assignment to whatever block now owns that (house, time) slot (block ids are random per
-- reset, so assignments are linked by the natural key (house_id, block_start_at)).

BEGIN;

-- 1. auth login rows (real bcrypt passwords carried over verbatim)
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change) VALUES$$;

SELECT string_agg(
  format('  (%L,%L,%L,%L,%L,%L, now(),now(),now(), %L::jsonb, %L::jsonb, %L,%L,%L,%L)',
    '00000000-0000-0000-0000-000000000000', id::text, 'authenticated', 'authenticated',
    email, encrypted_password, raw_app_meta_data::text, raw_user_meta_data::text,
    '', '', '', ''),
  E',\n' ORDER BY email)
FROM auth.users WHERE id::text LIKE 'fbb00000%';

SELECT $$ON CONFLICT (id) DO NOTHING;

-- 2. email identities (login-by-email)
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at)
SELECT u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email', now(), now(), now()
FROM auth.users u WHERE u.id::text LIKE 'fbb00000%'
ON CONFLICT (provider, provider_id) DO NOTHING;

-- 3. app user rows
INSERT INTO users (user_id, name, email, phone, home_house_id, is_active,
  broadcast_subscribed) VALUES$$;

SELECT string_agg(
  format('  (%L,%L,%L,%L,%L,%L,%L)', user_id::text, name, email, phone,
    home_house_id, is_active::text, broadcast_subscribed::text),
  E',\n' ORDER BY email)
FROM users WHERE user_id::text LIKE 'fbb00000%';

SELECT $$ON CONFLICT (user_id) DO NOTHING;

-- 4. roles (sm / rsm / sw)
INSERT INTO user_roles (user_id, role, scope_house_id) VALUES$$;

SELECT string_agg(
  format('  (%L,%L,%L)', user_id::text, role::text, scope_house_id),
  E',\n' ORDER BY user_id)
FROM user_roles WHERE user_id::text LIKE 'fbb00000%';

SELECT $$ON CONFLICT DO NOTHING;

-- 5. the blocks these shifts sit on. Natural-key upsert: for Jun 1 - Aug 20 the season
--    seed already made the slot (this is a no-op); for Aug 21 - Sep 7 this recreates it.
INSERT INTO shift_blocks (house_id, block_start_at, required_headcount) VALUES$$;

SELECT string_agg(
  format('  (%L,%L,%s)', house_id, block_start_at::text, required_headcount::text),
  E',\n' ORDER BY block_start_at)
FROM (
  SELECT DISTINCT sb.house_id, sb.block_start_at, sb.required_headcount
  FROM shift_blocks sb
  JOIN shift_block_assignments a ON a.block_id = sb.block_id
  WHERE a.user_id::text LIKE 'fbb00000%'
) d;

SELECT $$ON CONFLICT (house_id, block_start_at) DO NOTHING;

-- 6. the scheduled assignments, linked to whatever block_id now owns each (house, time)
--    slot. NOT EXISTS guard keeps re-runs from duplicating (no natural unique constraint).
INSERT INTO shift_block_assignments (block_id, user_id, status, is_float,
  is_cross_house_pickup, vacancy_origin)
SELECT sb.block_id, v.user_id, 'scheduled', false, false, 'none'
FROM (VALUES$$;

SELECT string_agg(
  format('  (%L::uuid, %L::timestamptz)', a.user_id::text, sb.block_start_at::text),
  E',\n' ORDER BY sb.block_start_at, a.user_id)
FROM shift_block_assignments a
JOIN shift_blocks sb ON sb.block_id = a.block_id
WHERE a.user_id::text LIKE 'fbb00000%';

SELECT $$) AS v(user_id, block_start_at)
JOIN shift_blocks sb ON sb.house_id = 'harnwell' AND sb.block_start_at = v.block_start_at
WHERE NOT EXISTS (
  SELECT 1 FROM shift_block_assignments x
  WHERE x.block_id = sb.block_id AND x.user_id = v.user_id AND x.status = 'scheduled'
);

COMMIT;$$;
