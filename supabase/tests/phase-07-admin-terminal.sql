-- pgTAP: C3a project-administrator terminal (post-verification fix).
--
-- Verifies that when HM and HMOD both resolve to NULL, the urgent notification
-- routes to the configured project administrator
-- (system_config 'project_administrator_user_id'), and that an UNSET terminal
-- is a documented, observable drop rather than a silent loss (BSpec §2.6).
-- Regression guard for the "C3a inert" blocker found during re-verification.

BEGIN;

SELECT plan(4);

-- A weekend (Saturday) moment forces the HMOD branch; with NO hmod_rotor row and
-- NO HM for house-03, both resolve to NULL -> the project-admin fallback applies.
SELECT set_config('test.adt.mon', date_trunc('week', DATE '2031-09-15')::text, false);
SELECT set_config('test.adt.now',
  (((current_setting('test.adt.mon')::date)::timestamp + interval '5 days' + interval '3 hours')
    AT TIME ZONE 'America/New_York')::text, false);
SELECT set_config('test.adt.bstart',
  (((current_setting('test.adt.mon')::date)::timestamp + interval '5 days' + interval '10 hours')
    AT TIME ZONE 'America/New_York')::text, false);

INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('f0000ad7-0000-0000-0000-000000000001','house-03', current_setting('test.adt.bstart')::timestamptz, 1),
  ('f0000ad7-0000-0000-0000-000000000002','house-03', current_setting('test.adt.bstart')::timestamptz + interval '30 minutes', 1);

-- Case A: terminal UNSET -> no recipient (event dropped + RAISE WARNING).
DO $$
DECLARE r jsonb;
BEGIN
  r := public.process_hmod_notify_allied_step(
    'f0000ad7-0000-0000-0000-000000000001'::uuid, 'house-03',
    current_setting('test.adt.bstart')::timestamptz,
    current_setting('test.adt.now')::timestamptz, 'verify_unset');
  PERFORM set_config('test.adt.unset_recipient', COALESCE(r->>'recipient_user_id','NULL'), true);
END $$;

SELECT is(current_setting('test.adt.unset_recipient'), 'NULL',
  'terminal UNSET: HMOD-notify resolves no recipient (documented drop; RAISE WARNING)');

SELECT is(
  (SELECT count(*)::int FROM public.notifications
   WHERE payload->>'block_id' = 'f0000ad7-0000-0000-0000-000000000001'),
  0, 'terminal UNSET: no hmod_urgent notification row is created');

-- Configure a project-administrator terminal (representable now as value_type 'uuid').
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('a0000ad7-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','proj-admin@test.local')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (user_id, name, email, home_house_id, is_active) VALUES
  ('a0000ad7-0000-0000-0000-000000000001','Project Admin','proj-admin@test.local','harnwell',true);
INSERT INTO public.system_config (config_key, config_value, value_type) VALUES
  ('project_administrator_user_id','a0000ad7-0000-0000-0000-000000000001','uuid');

-- Case B: terminal SET -> routes to project_admin (uses a fresh block).
DO $$
DECLARE r jsonb;
BEGIN
  r := public.process_hmod_notify_allied_step(
    'f0000ad7-0000-0000-0000-000000000002'::uuid, 'house-03',
    current_setting('test.adt.bstart')::timestamptz + interval '30 minutes',
    current_setting('test.adt.now')::timestamptz, 'verify_set');
  PERFORM set_config('test.adt.set_target', COALESCE(r->>'target','NULL'), true);
  PERFORM set_config('test.adt.set_recipient', COALESCE(r->>'recipient_user_id','NULL'), true);
END $$;

SELECT is(current_setting('test.adt.set_target'), 'project_admin',
  'terminal SET: HMOD-notify routes to the project administrator (C3a / BSpec §2.6)');

SELECT is(current_setting('test.adt.set_recipient'), 'a0000ad7-0000-0000-0000-000000000001',
  'terminal SET: notification recipient is the configured active admin');

SELECT finish();
ROLLBACK;
