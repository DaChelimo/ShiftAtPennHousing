-- pgTAP tests for the Phase-12 audit follow-up: force-triggered floats snapshot
-- the ack-reminder cadence (BSpec §7.1), via the shared snapshot_float_ack_reminders
-- helper. Also pins the helper's null-vs-disabled and skip-past semantics at the
-- SQL layer (the audit's Item-3 ambiguity).
--
-- Spec sources:
--   BEHAVIORAL_SPECIFICATION.md §7.1 (reminders fire when a float is assigned
--     "whether through automated lookup or force-trigger"; 1h/30m/5m mandatory;
--     6h/2h configurable; a float assigned with < lead time starts at the next
--     future offset),
--   ARCHITECTURE.md §2.8 (a NULL offset = system default of -6h/-2h, NOT
--     suppressed; "disabled" — reminder_*_enabled = false — is suppression).
--   AGENTS.md hard invariant #6 (timestamptz in America/New_York).
-- Run with: supabase test db

BEGIN;

SELECT plan(12);

-- ============================================================
-- 0. Fixtures: a harnwell worker (the floater), an SM initiator at house-03, and
--    future blocks (anchor +30d, hour-truncated NY-local, outside seed calendar).
--    Direction harnwell -> house-03 is the only one the harnwell-training trigger
--    permits for a harnwell worker (see phase-08 suite).
-- ============================================================

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('e1200001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p12ft-worker@test.local'),
  ('e1200001-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'p12ft-initiator@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (user_id, name, email, home_house_id, is_active)
VALUES
  ('e1200001-0000-0000-0000-000000000001', 'FT Worker',    'p12ft-worker@test.local',    'harnwell', true),
  ('e1200001-0000-0000-0000-000000000006', 'SM Initiator', 'p12ft-initiator@test.local', 'house-03', true);

INSERT INTO public.user_roles (user_id, role, scope_house_id)
VALUES ('e1200001-0000-0000-0000-000000000006', 'sm', 'house-03')
ON CONFLICT DO NOTHING;

-- Anchor 30 days out — every reminder offset (6h..5m before the T-10m deadline)
-- is therefore comfortably in the future for the long-lead cases below.
SELECT set_config(
  'test.p12ft.anchor',
  ((date_trunc('hour', now() AT TIME ZONE 'America/New_York') + interval '30 days')
    AT TIME ZONE 'America/New_York')::text,
  false
);
-- Ack deadline = destination block start − 10m.
SELECT set_config(
  'test.p12ft.deadline',
  (current_setting('test.p12ft.anchor')::timestamptz - interval '10 minutes')::text,
  false
);

-- Destination block (house-03, vacant assignment) + source block (harnwell,
-- worker scheduled). Both 30 days out.
INSERT INTO public.shift_blocks (block_id, house_id, block_start_at, required_headcount)
VALUES
  ('f1200001-0000-0000-0000-0000000000d1', 'house-03', current_setting('test.p12ft.anchor')::timestamptz, 1),
  ('f1200001-0000-0000-0000-000000000051', 'harnwell', current_setting('test.p12ft.anchor')::timestamptz, 3);

INSERT INTO public.shift_block_assignments
  (assignment_id, block_id, user_id, status, vacancy_origin)
VALUES
  ('a1200001-0000-0000-0000-0000000000d1', 'f1200001-0000-0000-0000-0000000000d1', NULL,
   'vacant', 'never_assigned'),
  ('a1200001-0000-0000-0000-000000000051', 'f1200001-0000-0000-0000-000000000051',
   'e1200001-0000-0000-0000-000000000001', 'scheduled', 'none');

-- ============================================================
-- A. snapshot_float_ack_reminders — direct helper semantics (ARCH §2.8).
--    Synthetic float ids; the helper only reads block_start_at off the
--    destination assignments and writes ack_reminder rows (no float_assignments
--    dependency), so distinct payload float_ids isolate each call's count.
-- ============================================================

SELECT has_function('public', 'snapshot_float_ack_reminders',
  ARRAY['uuid', 'uuid[]', 'text', 'uuid', 'timestamptz'],
  'snapshot_float_ack_reminders(worker, dest_ids, house, float, now) exists');

-- Default config (no ack_cadence_config row for house-03 → COALESCE enabled=true,
-- offsets default): all five offsets, long lead.
SELECT is(
  public.snapshot_float_ack_reminders(
    'e1200001-0000-0000-0000-000000000001',
    ARRAY['a1200001-0000-0000-0000-0000000000d1']::uuid[],
    'house-03',
    '11110001-0000-0000-0000-000000000001',
    now()),
  5, 'default config (no row) snapshots all five reminders (mandatory 3 + 6h + 2h)');

-- The mandatory 1h / 30m / 5m instants are present at deadline − offset.
SELECT is(
  (SELECT count(*)::integer FROM public.notifications
    WHERE payload ->> 'float_id' = '11110001-0000-0000-0000-000000000001'
      AND scheduled_for IN (
        current_setting('test.p12ft.deadline')::timestamptz - interval '1 hour',
        current_setting('test.p12ft.deadline')::timestamptz - interval '30 minutes',
        current_setting('test.p12ft.deadline')::timestamptz - interval '5 minutes')),
  3, 'the mandatory 1h/30m/5m reminders land at deadline − offset');

-- ack_cadence_config for house-03 with the 6h reminder DISABLED → 6h suppressed.
INSERT INTO public.ack_cadence_config (house_id, reminder_6h_enabled, reminder_2h_enabled)
VALUES ('house-03', false, true);

SELECT is(
  public.snapshot_float_ack_reminders(
    'e1200001-0000-0000-0000-000000000001',
    ARRAY['a1200001-0000-0000-0000-0000000000d1']::uuid[],
    'house-03',
    '11110001-0000-0000-0000-000000000002',
    now()),
  4, 'disabling the 6h reminder (enabled=false) drops it → four reminders');

SELECT is(
  (SELECT count(*)::integer FROM public.notifications
    WHERE payload ->> 'float_id' = '11110001-0000-0000-0000-000000000002'
      AND scheduled_for = current_setting('test.p12ft.deadline')::timestamptz - interval '6 hours'),
  0, 'the disabled 6h reminder is absent');

-- Item-3: a NULL offset with the reminder ENABLED is the SYSTEM DEFAULT, not
-- suppression. Set both offsets NULL but keep 6h enabled → 6h fires at -6h.
UPDATE public.ack_cadence_config
SET reminder_6h_enabled = true, reminder_2h_enabled = true,
    reminder_6h_offset = NULL, reminder_2h_offset = NULL
WHERE house_id = 'house-03';

SELECT is(
  public.snapshot_float_ack_reminders(
    'e1200001-0000-0000-0000-000000000001',
    ARRAY['a1200001-0000-0000-0000-0000000000d1']::uuid[],
    'house-03',
    '11110001-0000-0000-0000-000000000003',
    now()),
  5, 'a NULL offset with enabled=true means the system default (-6h/-2h), NOT suppressed (ARCH §2.8)');

SELECT is(
  (SELECT count(*)::integer FROM public.notifications
    WHERE payload ->> 'float_id' = '11110001-0000-0000-0000-000000000003'
      AND scheduled_for = current_setting('test.p12ft.deadline')::timestamptz - interval '6 hours'),
  1, 'the NULL 6h offset resolves to the -6h system default');

-- Both configurable reminders disabled → only the mandatory three.
UPDATE public.ack_cadence_config
SET reminder_6h_enabled = false, reminder_2h_enabled = false
WHERE house_id = 'house-03';

SELECT is(
  public.snapshot_float_ack_reminders(
    'e1200001-0000-0000-0000-000000000001',
    ARRAY['a1200001-0000-0000-0000-0000000000d1']::uuid[],
    'house-03',
    '11110001-0000-0000-0000-000000000004',
    now()),
  3, 'disabling both configurable reminders leaves only the mandatory 1h/30m/5m');

-- Skip-past: a float assigned 45 minutes before the deadline keeps only the
-- offsets strictly under 45m (30m, 5m). Reset to default config first.
UPDATE public.ack_cadence_config
SET reminder_6h_enabled = true, reminder_2h_enabled = true
WHERE house_id = 'house-03';

SELECT is(
  public.snapshot_float_ack_reminders(
    'e1200001-0000-0000-0000-000000000001',
    ARRAY['a1200001-0000-0000-0000-0000000000d1']::uuid[],
    'house-03',
    '11110001-0000-0000-0000-000000000005',
    current_setting('test.p12ft.deadline')::timestamptz - interval '45 minutes'),
  2, 'a short-lead float (45m before deadline) skips past 6h/2h/1h → only 30m/5m remain');

-- ============================================================
-- B. force_trigger_float — the integration: a force-triggered float now
--    snapshots the cadence (the audit gap). The house-03 config is back to
--    default (both enabled) → all five reminders.
-- ============================================================

SELECT is(
  (public.force_trigger_float(
     'e1200001-0000-0000-0000-000000000006',           -- initiator (SM)
     'e1200001-0000-0000-0000-000000000001',           -- worker (floater)
     'harnwell',                                       -- source house
     ARRAY['a1200001-0000-0000-0000-000000000051']::uuid[],  -- source assignment
     ARRAY['a1200001-0000-0000-0000-0000000000d1']::uuid[],  -- destination assignment
     'house-03',                                       -- destination house
     now()
   ) ->> 'assigned')::boolean,
  true, 'force_trigger_float assigns the float');

-- The force-triggered float now has ack_reminder rows (all five, long lead).
SELECT is(
  (SELECT count(*)::integer FROM public.notifications
    WHERE recipient_user_id = 'e1200001-0000-0000-0000-000000000001'
      AND type = 'ack_reminder'
      AND payload ->> 'kind' = 'float_ack_reminder'
      AND payload ->> 'float_id' = (
        SELECT float_id::text FROM public.float_assignments
        WHERE user_id = 'e1200001-0000-0000-0000-000000000001'
          AND initiated_by = 'force_triggered')),
  5, 'a force-triggered float snapshots all five ack reminders (BSpec §7.1)');

-- The immediate float_assigned personal_shift notification is still created.
SELECT is(
  (SELECT count(*)::integer FROM public.notifications
    WHERE recipient_user_id = 'e1200001-0000-0000-0000-000000000001'
      AND type = 'personal_shift'
      AND payload ->> 'kind' = 'float_assigned'),
  1, 'the immediate float_assigned notification is still created alongside the reminders');

SELECT * FROM finish();
ROLLBACK;
