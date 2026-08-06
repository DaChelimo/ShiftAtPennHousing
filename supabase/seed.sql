-- Seed data for Phase 01: Configuration Layer
-- Source of truth: BEHAVIORAL_SPECIFICATION.md §1.1, §3.2, §3.3; ARCHITECTURE.md §2.2–§2.4, §3.10

-- ============================================================
-- Houses (13 rows). Real Penn College House names + ids.
-- Harnwell (2-staff emergency desk) and Upper Quad (3-staff) have special rules
-- throughout; the other 11 are single-staff by default (headcount set per profile).
-- ============================================================

INSERT INTO houses (id, name) VALUES
  ('harnwell', 'Harnwell'),
  ('quad',     'Upper Quad'),
  ('lower-quad', 'Lower Quad'),
  ('gregory', 'Van Pelt / Gregory'),
  ('harrison', 'Harrison'),
  ('hill', 'Hill'),
  ('kings-court', 'Kings Court English'),
  ('lauder', 'Lauder'),
  ('mayer', 'Mayer'),
  ('du-bois', 'Du Bois'),
  ('gutmann', 'Gutmann'),
  ('radian', 'Radian'),
  ('rodin', 'Rodin');

-- ============================================================
-- Operating Profiles (3 rows)
-- Values from ARCHITECTURE.md §2.2 and BEHAVIORAL_SPECIFICATION.md §3.2
-- shift_end_bound stored as 00:00 — application layer interprets as 24:00 (midnight of same day)
-- ============================================================

INSERT INTO operating_profiles (
  profile_name,
  shift_start_bound,
  shift_end_bound,
  default_hours_cap,
  default_cap_enforcement,
  scheduling_mode,
  float_enabled,
  escalation_chain,
  claim_phase_open_offset,
  claim_phase_alert_offset,
  claim_phase_close_offset
) VALUES
  (
    'regular_school_year',
    '08:00',
    '00:00',  -- represents 24:00 (midnight end-of-day)
    20,
    'soft',
    'sm_built',
    true,
    '[
      {"step": "broadcast",         "offset": "-3 hours"},
      {"step": "float_lookup",      "offset": "-2 hours"},
      {"step": "hmod_notify_allied","offset": "-2 hours", "trigger": "on_float_failure"}
    ]'::jsonb,
    NULL,
    NULL,
    NULL
  ),
  (
    'winter_break',
    '08:00',
    '00:00',
    40,
    'hard',
    'claim_based',
    false,
    '[
      {"step": "broadcast",         "offset": "-3 hours"},
      {"step": "hmod_notify_allied","offset": "-2 hours"}
    ]'::jsonb,
    '-14 days'::interval,
    '-3 days'::interval,
    '-1 day'::interval
  ),
  (
    'short_break',
    '08:00',
    '00:00',
    40,
    'hard',
    'claim_based',
    true,
    '[
      {"step": "broadcast",         "offset": "-3 hours"},
      {"step": "float_lookup",      "offset": "-2 hours"},
      {"step": "hmod_notify_allied","offset": "-2 hours", "trigger": "on_float_failure"}
    ]'::jsonb,
    '-14 days'::interval,
    '-3 days'::interval,
    '-1 day'::interval
  );

-- ============================================================
-- Staffing Patterns
-- BEHAVIORAL_SPECIFICATION.md §3.3
-- block_headcounts uses compressed range format:
--   [{"block_start": "HH:MM", "block_end": "HH:MM", "headcount": N}]
-- block_end "00:00" represents 24:00 (midnight end of day).
-- Application layer expands to per-30-minute blocks at read time.
-- ============================================================

-- Regular School Year
--   Harnwell: 2 workers, 08:00–24:00, every day
--   Quad:     3 workers, 08:00–24:00, every day
--   11 single-staff houses: 1 worker, 08:00–24:00, every day

INSERT INTO staffing_patterns (profile_name, house_id, day_type, block_headcounts) VALUES
  ('regular_school_year', 'harnwell', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":2}]'),
  ('regular_school_year', 'harnwell', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":2}]'),
  ('regular_school_year', 'quad',     'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":3}]'),
  ('regular_school_year', 'quad',     'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":3}]'),
  ('regular_school_year', 'lower-quad', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'lower-quad', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'gregory', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'gregory', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'harrison', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'harrison', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'hill', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'hill', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'kings-court', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'kings-court', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'lauder', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'lauder', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'mayer', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'mayer', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'du-bois', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'du-bois', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'gutmann', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'gutmann', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'radian', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'radian', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'rodin', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'rodin', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]');

-- Winter Break: only Harnwell is operational (1 worker). All other 12 houses: NO ROW = closed.
INSERT INTO staffing_patterns (profile_name, house_id, day_type, block_headcounts) VALUES
  ('winter_break', 'harnwell', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('winter_break', 'harnwell', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]');

-- Short Break: same headcounts as regular_school_year for all 14 houses
INSERT INTO staffing_patterns (profile_name, house_id, day_type, block_headcounts) VALUES
  ('short_break', 'harnwell', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":2}]'),
  ('short_break', 'harnwell', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":2}]'),
  ('short_break', 'quad',     'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":3}]'),
  ('short_break', 'quad',     'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":3}]'),
  ('short_break', 'lower-quad', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'lower-quad', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'gregory', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'gregory', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'harrison', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'harrison', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'hill', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'hill', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'kings-court', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'kings-court', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'lauder', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'lauder', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'mayer', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'mayer', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'du-bois', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'du-bois', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'gutmann', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'gutmann', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'radian', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'radian', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'rodin', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'rodin', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]');

-- ============================================================
-- Float Routing
-- ARCHITECTURE.md §2.4
-- regular_school_year and short_break:
--   precedence 1: Quad → all 11 single-staff houses
--   precedence 2: Harnwell → all houses (including Quad)
-- winter_break: zero rows (float disabled)
-- ============================================================

-- Regular School Year float routing
INSERT INTO float_routing (profile_name, source_house_id, destination_house_id, precedence_order) VALUES
  -- Quad (precedence 1) → 11 single-staff houses
  ('regular_school_year', 'quad', 'lower-quad', 1),
  ('regular_school_year', 'quad', 'gregory', 1),
  ('regular_school_year', 'quad', 'harrison', 1),
  ('regular_school_year', 'quad', 'hill', 1),
  ('regular_school_year', 'quad', 'kings-court', 1),
  ('regular_school_year', 'quad', 'lauder', 1),
  ('regular_school_year', 'quad', 'mayer', 1),
  ('regular_school_year', 'quad', 'du-bois', 1),
  ('regular_school_year', 'quad', 'gutmann', 1),
  ('regular_school_year', 'quad', 'radian', 1),
  ('regular_school_year', 'quad', 'rodin', 1),
  -- Harnwell (precedence 2) → all houses including Quad
  -- Note: float algorithm also enforces Harnwell as destination = no float (§1.5 invariant)
  ('regular_school_year', 'harnwell', 'quad',     2),
  ('regular_school_year', 'harnwell', 'lower-quad', 2),
  ('regular_school_year', 'harnwell', 'gregory', 2),
  ('regular_school_year', 'harnwell', 'harrison', 2),
  ('regular_school_year', 'harnwell', 'hill', 2),
  ('regular_school_year', 'harnwell', 'kings-court', 2),
  ('regular_school_year', 'harnwell', 'lauder', 2),
  ('regular_school_year', 'harnwell', 'mayer', 2),
  ('regular_school_year', 'harnwell', 'du-bois', 2),
  ('regular_school_year', 'harnwell', 'gutmann', 2),
  ('regular_school_year', 'harnwell', 'radian', 2),
  ('regular_school_year', 'harnwell', 'rodin', 2);

-- Short Break float routing (same structure as regular_school_year)
INSERT INTO float_routing (profile_name, source_house_id, destination_house_id, precedence_order) VALUES
  ('short_break', 'quad', 'lower-quad', 1),
  ('short_break', 'quad', 'gregory', 1),
  ('short_break', 'quad', 'harrison', 1),
  ('short_break', 'quad', 'hill', 1),
  ('short_break', 'quad', 'kings-court', 1),
  ('short_break', 'quad', 'lauder', 1),
  ('short_break', 'quad', 'mayer', 1),
  ('short_break', 'quad', 'du-bois', 1),
  ('short_break', 'quad', 'gutmann', 1),
  ('short_break', 'quad', 'radian', 1),
  ('short_break', 'quad', 'rodin', 1),
  ('short_break', 'harnwell', 'quad',     2),
  ('short_break', 'harnwell', 'lower-quad', 2),
  ('short_break', 'harnwell', 'gregory', 2),
  ('short_break', 'harnwell', 'harrison', 2),
  ('short_break', 'harnwell', 'hill', 2),
  ('short_break', 'harnwell', 'kings-court', 2),
  ('short_break', 'harnwell', 'lauder', 2),
  ('short_break', 'harnwell', 'mayer', 2),
  ('short_break', 'harnwell', 'du-bois', 2),
  ('short_break', 'harnwell', 'gutmann', 2),
  ('short_break', 'harnwell', 'radian', 2),
  ('short_break', 'harnwell', 'rodin', 2);

-- winter_break: zero float_routing rows (floating is disabled for this profile)

-- ============================================================
-- System Config
-- ARCHITECTURE.md §3.10 / Appendix B
-- ============================================================

INSERT INTO system_config (config_key, config_value, value_type) VALUES
  ('drop_horizon_days',              '30',    'integer'),
  -- Minimum float chunk lowered 2 -> 1 (BSpec §6.2 #4, 2026-06-30): a single
  -- coverable block is floated rather than sent to Allied. The pure algorithm
  -- hardcodes MIN_FLOAT_CHUNK_BLOCKS; this row documents the §14 parameter.
  ('min_float_chunk_blocks',         '1',     'integer'),
  -- Max Allied coverage secured per pass (BSpec §5.4). The orchestrator caps a
  -- single contiguous vacant gap at MAX_ALLIED_COVERAGE_BLOCKS before floating /
  -- Allied-notifying; this row documents the §14 parameter.
  ('max_allied_coverage_blocks',     '8',     'integer'),
  ('float_retention_days',           '14',    'integer'),
  ('shift_block_minutes',            '30',    'integer'),
  ('shift_swap_expiry_anchor',       'T-3h',  'enum'),
  ('float_swap_expiry_hours',        '24',    'integer'),
  ('permanent_swap_expiry_days',     '7',     'integer'),
  ('hm_working_hours_start',         '08:00', 'time_of_day'),
  ('hm_working_hours_end',           '17:00', 'time_of_day'),
  ('no_ack_trigger_offset_minutes',  '5',     'integer'),
  ('ack_deadline_offset_minutes',    '10',    'integer');

-- ============================================================
-- Phase 13b — Admin web app E2E fixtures (Playwright)
-- Source of truth: apps/web/e2e/{helpers.ts,README.md} (the SEED contract) and
-- tests/PHASE_13b/TEST_PLAN.md. House under test: Quad (multi-staff, non-Harnwell —
-- no training constraint to confound grouping). Build week Monday 2026-02-02 (regular
-- school year, EST). Preference window closed; period unpublished (published_at NULL).
--
-- This block seeds the auth users (password `abc123` for everyone), the
-- public.users + roles, the period, four Quad blocks (10:00–11:30), the worker
-- preferences + period targets, the incoming-chain leave row, and the
-- project-administrator config. Idempotent against a fresh `supabase db reset`.
-- ============================================================

-- --- Auth users (GoTrue). Empty-string token columns avoid GoTrue NULL-scan errors. ---
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  v.id::uuid,
  'authenticated',
  'authenticated',
  v.email,
  extensions.crypt('abc123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  '', '', '', ''
FROM (VALUES
  ('a0000000-0000-4000-8000-000000000001', 'sm.quad@pennhousing.test'),
  ('a0000000-0000-4000-8000-000000000002', 'alice.quad@pennhousing.test'),
  ('a0000000-0000-4000-8000-000000000003', 'ben.quad@pennhousing.test'),
  ('a0000000-0000-4000-8000-000000000004', 'cara.quad@pennhousing.test'),
  ('a0000000-0000-4000-8000-000000000005', 'dana.quad@pennhousing.test'),
  ('a0000000-0000-4000-8000-000000000006', 'erin.quad@pennhousing.test'),
  ('a0000000-0000-4000-8000-000000000007', 'fred.quad@pennhousing.test'),
  ('a0000000-0000-4000-8000-000000000008', 'hm.quad@pennhousing.test'),
  ('a0000000-0000-4000-8000-000000000009', 'bm.quad@pennhousing.test'),
  ('a0000000-0000-4000-8000-00000000000a', 'hm.incoming@pennhousing.test'),
  ('a0000000-0000-4000-8000-00000000000b', 'admin@upenn.edu')
) AS v(id, email);

-- --- Auth identities (email provider) for each seeded user. ---
-- auth.identities.email is a GENERATED column (derived from identity_data->>'email'); omit it.
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
FROM auth.users u
WHERE u.email LIKE '%@pennhousing.test';

-- --- App users (public.users). FK → auth.users. ---
INSERT INTO users (user_id, name, email, home_house_id, is_active) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Sam Quad',              'sm.quad@pennhousing.test',     'quad',     true),
  ('a0000000-0000-4000-8000-000000000002', 'Alice Quad',            'alice.quad@pennhousing.test',  'quad',     true),
  ('a0000000-0000-4000-8000-000000000003', 'Ben Quad',              'ben.quad@pennhousing.test',    'quad',     true),
  ('a0000000-0000-4000-8000-000000000004', 'Cara Quad',             'cara.quad@pennhousing.test',   'quad',     true),
  ('a0000000-0000-4000-8000-000000000005', 'Dana Quad',             'dana.quad@pennhousing.test',   'quad',     true),
  ('a0000000-0000-4000-8000-000000000006', 'Erin Quad',             'erin.quad@pennhousing.test',   'quad',     true),
  ('a0000000-0000-4000-8000-000000000007', 'Fred Quad',             'fred.quad@pennhousing.test',   'quad',     true),
  ('a0000000-0000-4000-8000-000000000008', 'Hana Quad',             'hm.quad@pennhousing.test',     'quad',     true),
  ('a0000000-0000-4000-8000-000000000009', 'Bea Quad',              'bm.quad@pennhousing.test',     'quad',     true),
  ('a0000000-0000-4000-8000-00000000000a', 'Ingrid Incoming',       'hm.incoming@pennhousing.test', 'lower-quad', true),
  ('a0000000-0000-4000-8000-00000000000b', 'Project Administrator', 'admin@upenn.edu',              'quad',     true);

-- --- Roles. SW workers (no scope); SM/HM/BM scoped to their house. The top-level
-- `admin` role (BSpec §2.7, scope NULL) is granted below; it is distinct from the
-- project-administrator TERMINAL CONTACT identified via system_config (BSpec §2.6),
-- though the seeded admin user happens to be the same human as that pointer. ---
INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'sm', 'quad'),
  ('a0000000-0000-4000-8000-000000000002', 'sw', NULL),
  ('a0000000-0000-4000-8000-000000000003', 'sw', NULL),
  ('a0000000-0000-4000-8000-000000000004', 'sw', NULL),
  ('a0000000-0000-4000-8000-000000000005', 'sw', NULL),
  ('a0000000-0000-4000-8000-000000000006', 'sw', NULL),
  ('a0000000-0000-4000-8000-000000000007', 'sw', NULL),
  ('a0000000-0000-4000-8000-000000000008', 'hm', 'quad'),
  ('a0000000-0000-4000-8000-000000000009', 'bm', 'quad'),
  ('a0000000-0000-4000-8000-00000000000a', 'hm', 'lower-quad'),
  -- Top-level administrator (BSpec §2.7): house-agnostic superuser, scope NULL.
  -- Same human the project_administrator_user_id pointer targets (line ~400), but
  -- the ROLE grant is what confers admin powers; the pointer is a leave terminal.
  ('a0000000-0000-4000-8000-00000000000b', 'admin', NULL);

-- --- Scheduling period covering the build week (regular school year, unpublished). ---
-- A future preference_deadline lets the preference rows below insert (the submission-
-- window trigger blocks inserts past the deadline); we close the window afterward.
INSERT INTO scheduling_periods (period_id, period_name, profile_name, start_date, end_date, preference_deadline, published_at) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'Spring 2026', 'regular_school_year', '2026-01-12', '2026-05-01', '2099-12-31 23:59:59-05', NULL);

-- --- Quad blocks for 2026-02-02 at 10:00 / 10:30 / 11:00 / 11:30 NY (EST, -05:00).
-- required_headcount 3 = Quad's staffing pattern. ---
INSERT INTO shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('b0000000-0000-4000-8000-000000001000', 'quad', '2026-02-02 10:00:00-05', 3),
  ('b0000000-0000-4000-8000-000000001030', 'quad', '2026-02-02 10:30:00-05', 3),
  ('b0000000-0000-4000-8000-000000001100', 'quad', '2026-02-02 11:00:00-05', 3),
  ('b0000000-0000-4000-8000-000000001130', 'quad', '2026-02-02 11:30:00-05', 3);

-- --- Worker preferences for the four blocks (period_id, user_id, block_id, status).
--   Alice  → 10:00 preferred, rest available   ⇒ PREFERRED group
--   Ben    → all four available                ⇒ AVAILABLE group
--   Cara   → 10:00 cannot, rest available       ⇒ BLOCKED (cannot @10:00)
--   Erin   → all four available (target 1h)     ⇒ AVAILABLE; a 2h span over-targets
--   Dana / Fred → no rows                        ⇒ Phase-2 roster only ---
INSERT INTO preferences (user_id, block_id, period_id, status) VALUES
  -- Alice
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000001000', 'c0000000-0000-4000-8000-000000000001', 'preferred'),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000001030', 'c0000000-0000-4000-8000-000000000001', 'available'),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000001100', 'c0000000-0000-4000-8000-000000000001', 'available'),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000001130', 'c0000000-0000-4000-8000-000000000001', 'available'),
  -- Ben
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000001000', 'c0000000-0000-4000-8000-000000000001', 'available'),
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000001030', 'c0000000-0000-4000-8000-000000000001', 'available'),
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000001100', 'c0000000-0000-4000-8000-000000000001', 'available'),
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000001130', 'c0000000-0000-4000-8000-000000000001', 'available'),
  -- Cara
  ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000001000', 'c0000000-0000-4000-8000-000000000001', 'cannot'),
  ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000001030', 'c0000000-0000-4000-8000-000000000001', 'available'),
  ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000001100', 'c0000000-0000-4000-8000-000000000001', 'available'),
  ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000001130', 'c0000000-0000-4000-8000-000000000001', 'available'),
  -- Erin
  ('a0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000001000', 'c0000000-0000-4000-8000-000000000001', 'available'),
  ('a0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000001030', 'c0000000-0000-4000-8000-000000000001', 'available'),
  ('a0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000001100', 'c0000000-0000-4000-8000-000000000001', 'available'),
  ('a0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000001130', 'c0000000-0000-4000-8000-000000000001', 'available');

-- --- Period targets. Dana has NO row (fully unsubmitted). Fred opted out (no hours). ---
INSERT INTO period_targets (user_id, period_id, target_hours, opted_out) VALUES
  ('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 20, false), -- Alice
  ('a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 20, false), -- Ben
  ('a0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 20, false), -- Cara
  ('a0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001',  1, false), -- Erin (1h target)
  ('a0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001',  0, true);  -- Fred (opted out)

-- --- Incoming-chain leave: Ingrid's ACTIVE leave names Hana (hm.quad) as replacement,
-- so Hana is in Ingrid's forward chain ⇒ Ingrid is in Hana's incoming chain ⇒ excluded
-- from Hana's replacement picker (cycle prevention, BSpec §2.6). ---
INSERT INTO hm_leave (leave_id, user_id, start_date, end_date, replacement_user_id, status) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a',
   '2026-02-01', '2026-02-28', 'a0000000-0000-4000-8000-000000000008', 'active');

-- --- Project administrator: the always-valid terminal replacement (BSpec §2.6). ---
INSERT INTO system_config (config_key, config_value, value_type) VALUES
  ('project_administrator_user_id', 'a0000000-0000-4000-8000-00000000000b', 'uuid');

-- --- The simulated clock is gated by ROLE now, not environment (20260805000001):
-- dev_sim_clock_admin_gate denies a non-zero offset unless set_by is a user holding the
-- admin role, in every environment including production. `admin@upenn.edu` above already
-- holds that role, so the local time-travel harness works with no extra config row. ---

-- --- Close the preference window now that the fixtures are loaded (prefs locked,
-- the realistic builder state — the submitted-but-locked period the SM builds against). ---
UPDATE scheduling_periods
SET preference_deadline = '2026-01-30 23:59:59-05'
WHERE period_id = 'c0000000-0000-4000-8000-000000000001';

-- =====================================================================
-- S1 admin-override e2e fixtures (web-remediation, audit #1).
-- The live calendar renders any shift_blocks + assignment rows for a house/week
-- (no published_at gate, no operating_calendar join — see lib/data/calendar.ts),
-- so the override flows (assign / reassign / remove + advisory confirm) need a
-- Quad week (the NEXT NY Monday, anchored at seed time below) holding a
-- Cara-occupied seat AND vacant "open shift" seats, plus Fred opted-out so
-- assigning Fred trips the advisory.
-- A SEPARATE Summer period (no overlap with Spring) carries Fred's opt-out; it
-- does not disturb the unpublished Spring period the builder/preferences specs use.
-- =====================================================================
INSERT INTO scheduling_periods (period_id, period_name, profile_name, start_date, end_date, preference_deadline, published_at) VALUES
  -- Future preference_deadline so the period_targets insert below passes the
  -- submission-window trigger (the deadline is irrelevant to the override e2e).
  -- end_date runs to Aug 31 so it covers the now-relative Quad week (below) all
  -- summer; it stays clear of Spring (<= 2026-05-01) and of the phase-04 pgTAP
  -- Open Period (>= 2026-09-01), so scheduling_periods_no_overlap still holds.
  ('c0000000-0000-4000-8000-000000000002', 'Summer 2026', 'regular_school_year', '2026-06-01', '2026-08-31', '2099-12-31 23:59:59-04', '2026-06-01 00:00:00-04');

-- The Quad override/force-trigger week is anchored to NEXT week's Monday in NY,
-- computed at seed time, so these e2e fixtures never age out: the coverage 30-day
-- horizon and the admin-override "block_start_at > now" gate are now()-relative, so
-- a fixed past date silently breaks both (see project memory web-e2e-run-gotchas).
-- helpers.ts SEED.overrideWeek computes the SAME Monday at runtime. date_trunc('week')
-- is Monday-anchored; AT TIME ZONE keeps the 10:00/10:30 NY wall-clock DST-correct.
SELECT set_config(
  'e2e.quad_monday',
  ((date_trunc('week', now() AT TIME ZONE 'America/New_York')::date) + 7)::text,
  false
);

-- Operating-calendar for the e2e week (regular_school_year, float_enabled=true) so the
-- S2 force-trigger EF resolves the float profile and runs the lookup. Without it,
-- loadProfileForBlock → null → the force-trigger gate returns float_not_enabled (gated).
INSERT INTO operating_calendar (date, profile_name)
SELECT d::date, 'regular_school_year'
FROM generate_series(
  current_setting('e2e.quad_monday')::date,
  current_setting('e2e.quad_monday')::date + 6,
  interval '1 day'
) AS d
ON CONFLICT (date) DO NOTHING;

-- Quad blocks for the Quad-Monday at 10:00 / 10:30 NY; headcount 3. Future-dated
-- (next Monday) so they render as upcoming, assignable, broadcast-stage gaps.
INSERT INTO shift_blocks (block_id, house_id, block_start_at, required_headcount) VALUES
  ('b0000000-0000-4000-8000-000000060800', 'quad',
   (current_setting('e2e.quad_monday')::date + time '10:00') AT TIME ZONE 'America/New_York', 3),
  ('b0000000-0000-4000-8000-000000060830', 'quad',
   (current_setting('e2e.quad_monday')::date + time '10:30') AT TIME ZONE 'America/New_York', 3);

-- 10:00 block: Cara (overrideIncumbent) on seat 1 → reassign/remove target; seats
-- 2-3 vacant → "open shift" assign targets. 10:30 block: all vacant.
INSERT INTO shift_block_assignments (assignment_id, block_id, user_id, status, vacancy_origin, is_float, source_house_id) VALUES
  ('e0000000-0000-4000-8000-000000060801', 'b0000000-0000-4000-8000-000000060800', 'a0000000-0000-4000-8000-000000000004', 'scheduled', 'none', false, NULL),
  ('e0000000-0000-4000-8000-000000060802', 'b0000000-0000-4000-8000-000000060800', NULL, 'vacant', 'never_assigned', false, NULL),
  ('e0000000-0000-4000-8000-000000060803', 'b0000000-0000-4000-8000-000000060800', NULL, 'vacant', 'never_assigned', false, NULL),
  ('e0000000-0000-4000-8000-000000060831', 'b0000000-0000-4000-8000-000000060830', NULL, 'vacant', 'never_assigned', false, NULL),
  ('e0000000-0000-4000-8000-000000060832', 'b0000000-0000-4000-8000-000000060830', NULL, 'vacant', 'never_assigned', false, NULL),
  ('e0000000-0000-4000-8000-000000060833', 'b0000000-0000-4000-8000-000000060830', NULL, 'vacant', 'never_assigned', false, NULL);

-- Fred (overrideAdvisoryWorker) opted out for the Summer period → opted_out advisory.
INSERT INTO period_targets (user_id, period_id, target_hours, opted_out) VALUES
  ('a0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000002', 0, true);

-- =====================================================================
-- Action-inbox e2e fixtures.
-- The action inbox (/inbox) reads the SIGNED-IN manager's notifications (RLS-scoped).
-- These four rows give Hana Quad (the Quad HM, a0…0008) an ACTIVE unresolved Allied
-- alert (Coverage tab), an ARCHIVED resolved one (Archive tab — its coverage window
-- has just elapsed), a non-urgent UNREAD item (Notifications tab / mark-read target),
-- and a FUTURE item (hidden by the #18b due gate). Allied placement is by the coverage
-- WINDOW (payload.block_start_at / block_end_at), so those are now()-relative:
--   N1 active  → window straddles now (started 30m ago, ends in 30m);
--   N2 archived→ window ended ~1h ago (inside the 24h archive). N1/N2 carry DISTINCT
-- reasons so the Playwright suite can address each, and are seeded acknowledged (read)
-- so N3 is the sole unread dot. Fixed ids + ON CONFLICT → idempotent under reset.
-- =====================================================================
INSERT INTO notifications
  (notification_id, recipient_user_id, type, scheduled_for, delivered_at, acknowledged_at,
   resolved_at, resolved_by, payload)
VALUES
  -- N1 — ACTIVE unresolved Allied alert for quad (Coverage tab). Window straddles now.
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000008',
   'hmod_urgent', now() - interval '1 hour', now() - interval '1 hour', now() - interval '50 minutes',
   NULL, NULL,
   jsonb_build_object('target', 'hm', 'reason', 'float_no_acknowledgment', 'house_id', 'quad',
     'block_id', 'b0000000-0000-4000-8000-000000060800',
     'block_start_at', now() - interval '30 minutes',
     'block_end_at', now() + interval '30 minutes')),
  -- N2 — ARCHIVED resolved Allied alert for quad (Archive tab). Window ended ~1h ago.
  ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000008',
   'hmod_urgent', now() - interval '2 hours', now() - interval '2 hours', now() - interval '90 minutes',
   now() - interval '30 minutes', 'a0000000-0000-4000-8000-000000000008',
   jsonb_build_object('target', 'hm', 'reason', 'floater_declined', 'house_id', 'quad',
     'block_id', 'b0000000-0000-4000-8000-000000060830',
     'block_start_at', now() - interval '90 minutes',
     'block_end_at', now() - interval '60 minutes')),
  -- N3 — a NON-urgent UNREAD notification (mark-read target).
  ('f0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000008',
   'hm_leave_notice', now() - interval '1 hour', now() - interval '1 hour', NULL, NULL, NULL,
   jsonb_build_object('kind', 'hm_leave_notice')),
  -- N4 — a FUTURE-scheduled notification (#18b: hidden until due).
  ('f0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000008',
   'ack_reminder', now() + interval '2 days', NULL, NULL, NULL, NULL,
   jsonb_build_object('kind', 'reminder'))
ON CONFLICT (notification_id) DO NOTHING;

-- =====================================================================
-- S4 fire-worker e2e fixture (web-remediation, audit #4).
-- A dedicated ACTIVE Quad SW — Gabe Quad — with NO entanglements, so the
-- /admin/people Fire flow (modal → confirm → Active→Inactive) is deterministic
-- regardless of clock/period (firing a worker with no obligations is a pure
-- deactivate). The THOROUGH seat/float/swap unwinding is pgTAP-only
-- (supabase/tests/s4-fire-worker.sql). Authorized actor for the e2e = Hana Quad
-- (hmQuad, a0…0008). Fixed id a0…000c (the next free id after the project admin
-- at …000b) + ON CONFLICT → idempotent. Appended as its own block to avoid churn
-- with S5, which shares the People files.
-- =====================================================================
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-4000-8000-00000000000c',
  'authenticated', 'authenticated', 'gabe.quad@pennhousing.test',
  extensions.crypt('abc123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
  'a0000000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-00000000000c',
  jsonb_build_object('sub', 'a0000000-0000-4000-8000-00000000000c', 'email', 'gabe.quad@pennhousing.test'),
  'email', now(), now(), now()
)
ON CONFLICT (provider_id, provider) DO NOTHING;

INSERT INTO users (user_id, name, email, home_house_id, is_active) VALUES
  ('a0000000-0000-4000-8000-00000000000c', 'Gabe Quad', 'gabe.quad@pennhousing.test', 'quad', true)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('a0000000-0000-4000-8000-00000000000c', 'sw', NULL)
ON CONFLICT (user_id, role, scope_house_id) DO NOTHING;

-- =====================================================================
-- S6 HMOD context e2e fixtures (web-remediation, audit #8/#9/#18a).
-- Make Hana Quad (the Quad HM, a0…0008) the ON-DUTY HMOD *right now* so the
-- AppShell pill resolves to "On duty" for her and "Off duty" for Bea Quad
-- (the Quad BM, a0…0009 — canBeHmod but not in the rotor), and so Hana gains
-- cross-house authority (switcher unlocked, ?house= honored, coverage
-- aggregates all houses) while Bea stays pinned to Quad.
--
-- The duty week is Friday-08:00→Friday-08:00 (BSpec §2.5). We compute the
-- current duty-week Friday with the SAME expression resolve_hmod_on_duty uses
-- (shift back 8h so the 08:00 boundary lands at midnight, then snap to the most
-- recent Friday via (isodow+2)%7) — guaranteeing the row both MATCHES the
-- resolver for `now` and satisfies the hmod_rotor isodow=5 (Friday) CHECK.
-- now()-relative + ON CONFLICT → idempotent and never ages out under db reset.
-- =====================================================================
INSERT INTO hmod_rotor (week_start_date, hmod_user_id)
SELECT (s.d - (((extract(isodow FROM s.d)::int + 2) % 7)))::date,
       'a0000000-0000-4000-8000-000000000008'
FROM (SELECT ((now() AT TIME ZONE 'America/New_York') - interval '8 hours')::date AS d) s
ON CONFLICT (week_start_date) DO UPDATE SET hmod_user_id = EXCLUDED.hmod_user_id;

-- =====================================================================
-- Harnwell HM fixture.
-- Harnwell (2026-08-06) has no HM seeded anywhere above (only Quad/Lower Quad
-- managers exist). Michelle Majeski fills that gap. Fixed id a0…000d (next
-- free id after the S4 fire-worker fixture at …000c) + ON CONFLICT → idempotent.
-- =====================================================================
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-4000-8000-00000000000d',
  'authenticated', 'authenticated', 'mmajeski@upenn.edu',
  extensions.crypt('abc123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (
  'a0000000-0000-4000-8000-00000000000d', 'a0000000-0000-4000-8000-00000000000d',
  jsonb_build_object('sub', 'a0000000-0000-4000-8000-00000000000d', 'email', 'mmajeski@upenn.edu'),
  'email', now(), now(), now()
)
ON CONFLICT (provider_id, provider) DO NOTHING;

INSERT INTO users (user_id, name, email, home_house_id, is_active) VALUES
  ('a0000000-0000-4000-8000-00000000000d', 'Michelle Majeski', 'mmajeski@upenn.edu', 'harnwell', true)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_roles (user_id, role, scope_house_id) VALUES
  ('a0000000-0000-4000-8000-00000000000d', 'hm', 'harnwell')
ON CONFLICT (user_id, role, scope_house_id) DO NOTHING;

-- =====================================================================
-- LOCAL ONLY: keep this stack cron-free.
--
-- 20260727000001_enable_scheduling_extensions.sql creates pg_cron/pg_net and registers
-- the seven scheduled jobs, because hosted Supabase leaves pg_cron off and every
-- cron.schedule() call site is wrapped in a guard that silently skips when it is absent
-- (production-migration landmine L1). That migration must stay unguarded so a hosted push
-- fails loudly rather than handing back an inert database.
--
-- seed.sql runs ONLY on `supabase db reset`, never on `supabase db push`, so undoing the
-- registration here leaves hosted staging and production identical and fully autonomous
-- while the local stack keeps the behaviour it has always had:
--
--   * the orchestrator runs from the web "Run orchestrator now" harness, not once a
--     minute. app.supabase_url / app.service_role_key are unset locally, so a live
--     orchestrator-tick job would raise into cron.job_run_details every minute forever.
--   * expire_pending_swaps_if_uncronned() keeps returning >= 0 rather than -1, which is
--     what supabase/tests/cost-audit-remediation.sql (F-10) asserts.
--
-- To rehearse hosted behaviour locally, comment this block out, set the two settings with
-- ALTER DATABASE, and expect that F-10 assertion to flip.
--
-- GUARD (added 2026-08-06 after a real incident): this file was replayed against the
-- HOSTED Shift project outside a `db reset` flow. It unscheduled all seven jobs by name,
-- and the orchestrator, notification delivery, swap expiry, and the coverage ladder went
-- silently inert for about a week -- nothing surfaced it except a manually-opened admin
-- health page. "Is this local" has no reliable SQL test, so this guards on the thing that
-- actually matters: whether the jobs would DO anything if left registered. That is exactly
-- what app_runtime_setting('app.supabase_url') resolves for the orchestrator cron body
-- itself (Vault first, GUC fallback -- 20260727000002). If it resolves to a real value,
-- this database is configured to run the jobs for real (hosted, or a local stack
-- deliberately rehearsing hosted behaviour per the comment above) and unscheduling them
-- would repeat the incident. Only a database where NEITHER Vault nor the GUC is set --
-- genuine fresh local dev -- ever reaches the unschedule loop below.
-- =====================================================================
DO $$
DECLARE
  v_job text;
  v_configured text;
BEGIN
  IF to_regprocedure('cron.unschedule(text)') IS NULL THEN
    RETURN;
  END IF;

  IF to_regprocedure('app_runtime_setting(text)') IS NOT NULL THEN
    v_configured := app_runtime_setting('app.supabase_url');
    IF COALESCE(v_configured, '') <> '' THEN
      RAISE WARNING 'seed.sql: app.supabase_url resolves (Vault or GUC) -- skipping the '
        'cron unschedule block. This database is configured to run the scheduled jobs '
        'for real; seed.sql must never tear that down. If this really is a fresh local '
        'reset, clear the Vault secret / GUC first.';
      RETURN;
    END IF;
  END IF;

  FOREACH v_job IN ARRAY ARRAY[
    'preference-reminders',
    'orchestrator-tick',
    'swap-expiry',
    'break-phase-transitions',
    'deliver-notifications',
    'apply-house-transfers',
    'operational-retention'
  ] LOOP
    BEGIN
      PERFORM cron.unschedule(v_job);
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END LOOP;
END;
$$;
