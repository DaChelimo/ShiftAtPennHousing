-- pgTAP behavioral tests for Phase 07: process_hmod_notify_allied_step()
-- atomic RPC (audit finding B-1, hmod portion).
--
-- Spec sources:
--   ARCHITECTURE §1.3 (atomicity invariant),
--                §4.1 (block_step_status; ON CONFLICT DO NOTHING claim),
--                §4.2 ("Step: hmod_notify_allied" — resolve HMOD via
--                       hmod_rotor + hm_leave; route to HM during HM
--                       hours and block within HM hours, else HMOD),
--                §4.6 (HM/HMOD routing rules),
--                §2.7 (hm_leave depth-10 limit);
--   BEHAVIORAL_SPECIFICATION §5.4 (HMOD notification on float failure),
--                            §10.1 (routing: weekday [08:00, 17:00)
--                                   inclusive lower / exclusive upper).
--
-- Audit finding exercised:
--   B-1 (hmod): claimStep() + hmodNotifyAlliedStep() were two separate
--        round-trips. A crash between them left block_step_status as
--        'fired' but no notification — the HMOD/HM never knew Allied
--        was needed. The new RPC ties the claim INSERT and the
--        notification INSERT into one transaction. The recipient
--        resolution (HM vs HMOD via hm_leave + hmod_rotor) also runs
--        inside the transaction so it sees a consistent snapshot.
--
-- Run with: supabase test db

BEGIN;

SELECT plan(12);

-- The shared seed (supabase/seed.sql) makes "Ingrid Incoming" (a0000000-…-000a) an hm for
-- house-03. resolve_hm_for_house has no ORDER BY, so it can return her instead of this
-- suite's own house-03 HM fixture. Remove that seeded role (rolled back at the end) so the
-- fixture HM is the sole house-03 HM.
DELETE FROM public.user_roles
  WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'
    AND role = 'hm'
    AND scope_house_id = 'house-03';

-- ============================================================
-- 0. Fixture: an HM at one house + an HMOD on the rotor for a known
--    Monday-of-week. We anchor at a Wednesday inside HM hours so the
--    HM is the active recipient; a separate block lands at midnight
--    so the HMOD is the active recipient.
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('e000050a-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07hm-hm@test.local'),
  ('e000050a-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p07hm-hmod@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('e000050a-0000-0000-0000-000000000001', 'Test HM', 'p07hm-hm@test.local',
   'house-03', true),
  ('e000050a-0000-0000-0000-000000000002', 'Test HMOD', 'p07hm-hmod@test.local',
   'harnwell', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES
  ('e000050a-0000-0000-0000-000000000001', 'hm', 'house-03'),
  ('e000050a-0000-0000-0000-000000000002', 'hm', 'harnwell');

-- Anchor: a Wednesday 30 days out, 12:00 EDT — solidly inside HM
-- working hours so the HM path is exercised. We resolve the
-- Friday-anchored duty week from this anchor for the hmod_rotor row
-- (Fri 08:00 -> next Fri 08:00; see 20260528000008_hmod_friday_boundary).
SELECT set_config(
  'test.phase07hm.anchor',
  (
    (
      date_trunc('hour', now() AT TIME ZONE 'America/New_York')
        + interval '30 days'
        + (12 - extract(hour from now() AT TIME ZONE 'America/New_York'))::int * interval '1 hour'
        + ((3 - extract(isodow from now() AT TIME ZONE 'America/New_York'))::int * interval '1 day')
    ) AT TIME ZONE 'America/New_York'
  )::text,
  false
);

-- hmod_rotor row covering the Friday-anchored duty week the anchor falls
-- into (mirrors resolve_hmod_on_duty: shift -8h, snap back to Friday/isodow 5).
INSERT INTO public.hmod_rotor (week_start_date, hmod_user_id)
VALUES
  (
    (
      WITH shifted AS (
        SELECT (
          (current_setting('test.phase07hm.anchor')::timestamptz
            AT TIME ZONE 'America/New_York') - interval '8 hours'
        )::date AS d
      )
      SELECT d - (((extract(isodow FROM d)::int + 2) % 7)) FROM shifted
    ),
    'e000050a-0000-0000-0000-000000000002'
  )
ON CONFLICT (week_start_date) DO UPDATE
  SET hmod_user_id = EXCLUDED.hmod_user_id;

INSERT INTO public.shift_blocks
  (block_id, house_id, block_start_at, required_headcount)
VALUES
  -- Block A: 12:00 Wednesday — HM hours, HM at the block's house.
  ('f000050a-0000-0000-0000-000000000001', 'house-03',
   current_setting('test.phase07hm.anchor')::timestamptz, 1),
  -- Block B: 22:00 Wednesday (same date, +10h) — outside HM hours.
  ('f000050a-0000-0000-0000-000000000002', 'house-03',
   current_setting('test.phase07hm.anchor')::timestamptz + interval '10 hours', 1),
  -- Block C: idempotency target.
  ('f000050a-0000-0000-0000-000000000003', 'house-03',
   current_setting('test.phase07hm.anchor')::timestamptz + interval '30 minutes', 1);

-- ============================================================
-- 1. Function exists with the expected signature.
-- ============================================================

SELECT has_function(
  'public', 'process_hmod_notify_allied_step',
  ARRAY['uuid', 'text', 'timestamptz', 'timestamptz', 'text'],
  'process_hmod_notify_allied_step(block_id, house_id, block_start_at, now, reason) exists'
);

-- ============================================================
-- 2. HM-hours path: scan fires AT 10:00 (HM hours, weekday), block
--    starts at 12:00 (also HM hours, weekday) → HM is the recipient.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.process_hmod_notify_allied_step(
       'f000050a-0000-0000-0000-000000000001'::uuid,
       'house-03',
       current_setting('test.phase07hm.anchor')::timestamptz,
       current_setting('test.phase07hm.anchor')::timestamptz - interval '2 hours',
       'float_lookup_failed'
     ) $$,
  'B-1 hmod: HM-hours RPC runs without error'
);

SELECT is(
  (SELECT status::text FROM public.block_step_status
   WHERE block_id = 'f000050a-0000-0000-0000-000000000001'
     AND step_name = 'hmod_notify_allied'),
  'fired',
  'B-1 hmod: block_step_status claimed in the same transaction'
);

SELECT is(
  (SELECT recipient_user_id FROM public.notifications
   WHERE type = 'hmod_urgent'
     AND payload ->> 'block_id' = 'f000050a-0000-0000-0000-000000000001'),
  'e000050a-0000-0000-0000-000000000001'::uuid,
  'B-1 hmod: HM-hours recipient is the HM (not the HMOD)'
);

SELECT is(
  (SELECT payload ->> 'target' FROM public.notifications
   WHERE type = 'hmod_urgent'
     AND payload ->> 'block_id' = 'f000050a-0000-0000-0000-000000000001'),
  'hm',
  'B-1 hmod: notification payload.target = hm'
);

SELECT is(
  (SELECT payload ->> 'reason' FROM public.notifications
   WHERE type = 'hmod_urgent'
     AND payload ->> 'block_id' = 'f000050a-0000-0000-0000-000000000001'),
  'float_lookup_failed',
  'B-1 hmod: notification carries the reason'
);

-- ============================================================
-- 3. HMOD-hours path: block starts at 22:00 (outside HM hours) → HMOD
--    is the recipient even if the scan time is inside HM hours.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.process_hmod_notify_allied_step(
       'f000050a-0000-0000-0000-000000000002'::uuid,
       'house-03',
       current_setting('test.phase07hm.anchor')::timestamptz + interval '10 hours',
       current_setting('test.phase07hm.anchor')::timestamptz - interval '1 hour',
       'escalation_chain'
     ) $$,
  'B-1 hmod: HMOD-hours RPC runs without error'
);

SELECT is(
  (SELECT recipient_user_id FROM public.notifications
   WHERE type = 'hmod_urgent'
     AND payload ->> 'block_id' = 'f000050a-0000-0000-0000-000000000002'),
  'e000050a-0000-0000-0000-000000000002'::uuid,
  'B-1 hmod: HMOD-hours recipient is the HMOD on the rotor'
);

SELECT is(
  (SELECT payload ->> 'target' FROM public.notifications
   WHERE type = 'hmod_urgent'
     AND payload ->> 'block_id' = 'f000050a-0000-0000-0000-000000000002'),
  'hmod',
  'B-1 hmod: notification payload.target = hmod'
);

-- ============================================================
-- 4. Idempotency: a second call against the same block is a no-op.
-- ============================================================

SELECT lives_ok(
  $$ SELECT public.process_hmod_notify_allied_step(
       'f000050a-0000-0000-0000-000000000003'::uuid,
       'house-03',
       current_setting('test.phase07hm.anchor')::timestamptz + interval '30 minutes',
       current_setting('test.phase07hm.anchor')::timestamptz - interval '90 minutes',
       'float_lookup_failed'
     ) $$,
  'B-1 hmod: idempotency fixture — first call succeeds'
);

SELECT is(
  (SELECT (public.process_hmod_notify_allied_step(
            'f000050a-0000-0000-0000-000000000003'::uuid,
            'house-03',
            current_setting('test.phase07hm.anchor')::timestamptz + interval '30 minutes',
            current_setting('test.phase07hm.anchor')::timestamptz - interval '90 minutes',
            'float_lookup_failed'
          ) ->> 'claimed')::boolean),
  false,
  'B-1 hmod: second call returns claimed=false (no re-fire)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE type = 'hmod_urgent'
     AND payload ->> 'block_id' = 'f000050a-0000-0000-0000-000000000003'),
  1,
  'B-1 hmod: still exactly one notification after the idempotent retry'
);

SELECT * FROM finish();
ROLLBACK;
