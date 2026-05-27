-- Seed data for Phase 01: Configuration Layer
-- Source of truth: BEHAVIORAL_SPECIFICATION.md §1.1, §3.2, §3.3; ARCHITECTURE.md §2.2–§2.4, §3.10

-- ============================================================
-- Houses (13 rows)
-- Harnwell and Quad have special rules throughout.
-- 11 single-staff houses use placeholder IDs — real names TODO before launch.
-- ============================================================

INSERT INTO houses (id, name) VALUES
  ('harnwell', 'Harnwell'),
  ('quad',     'Quad'),
  ('house-03', 'House-03'),
  ('house-04', 'House-04'),
  ('house-05', 'House-05'),
  ('house-06', 'House-06'),
  ('house-07', 'House-07'),
  ('house-08', 'House-08'),
  ('house-09', 'House-09'),
  ('house-10', 'House-10'),
  ('house-11', 'House-11'),
  ('house-12', 'House-12'),
  ('house-13', 'House-13');

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
  ('regular_school_year', 'house-03', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-03', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-04', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-04', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-05', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-05', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-06', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-06', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-07', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-07', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-08', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-08', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-09', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-09', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-10', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-10', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-11', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-11', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-12', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-12', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-13', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('regular_school_year', 'house-13', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]');

-- Winter Break: only Harnwell is operational (1 worker). All other 12 houses: NO ROW = closed.
INSERT INTO staffing_patterns (profile_name, house_id, day_type, block_headcounts) VALUES
  ('winter_break', 'harnwell', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('winter_break', 'harnwell', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]');

-- Short Break: same headcounts as regular_school_year for all 13 houses
INSERT INTO staffing_patterns (profile_name, house_id, day_type, block_headcounts) VALUES
  ('short_break', 'harnwell', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":2}]'),
  ('short_break', 'harnwell', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":2}]'),
  ('short_break', 'quad',     'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":3}]'),
  ('short_break', 'quad',     'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":3}]'),
  ('short_break', 'house-03', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-03', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-04', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-04', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-05', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-05', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-06', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-06', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-07', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-07', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-08', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-08', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-09', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-09', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-10', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-10', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-11', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-11', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-12', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-12', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-13', 'weekday', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]'),
  ('short_break', 'house-13', 'weekend', '[{"block_start":"08:00","block_end":"00:00","headcount":1}]');

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
  ('regular_school_year', 'quad', 'house-03', 1),
  ('regular_school_year', 'quad', 'house-04', 1),
  ('regular_school_year', 'quad', 'house-05', 1),
  ('regular_school_year', 'quad', 'house-06', 1),
  ('regular_school_year', 'quad', 'house-07', 1),
  ('regular_school_year', 'quad', 'house-08', 1),
  ('regular_school_year', 'quad', 'house-09', 1),
  ('regular_school_year', 'quad', 'house-10', 1),
  ('regular_school_year', 'quad', 'house-11', 1),
  ('regular_school_year', 'quad', 'house-12', 1),
  ('regular_school_year', 'quad', 'house-13', 1),
  -- Harnwell (precedence 2) → all houses including Quad
  -- Note: float algorithm also enforces Harnwell as destination = no float (§1.5 invariant)
  ('regular_school_year', 'harnwell', 'quad',     2),
  ('regular_school_year', 'harnwell', 'house-03', 2),
  ('regular_school_year', 'harnwell', 'house-04', 2),
  ('regular_school_year', 'harnwell', 'house-05', 2),
  ('regular_school_year', 'harnwell', 'house-06', 2),
  ('regular_school_year', 'harnwell', 'house-07', 2),
  ('regular_school_year', 'harnwell', 'house-08', 2),
  ('regular_school_year', 'harnwell', 'house-09', 2),
  ('regular_school_year', 'harnwell', 'house-10', 2),
  ('regular_school_year', 'harnwell', 'house-11', 2),
  ('regular_school_year', 'harnwell', 'house-12', 2),
  ('regular_school_year', 'harnwell', 'house-13', 2);

-- Short Break float routing (same structure as regular_school_year)
INSERT INTO float_routing (profile_name, source_house_id, destination_house_id, precedence_order) VALUES
  ('short_break', 'quad', 'house-03', 1),
  ('short_break', 'quad', 'house-04', 1),
  ('short_break', 'quad', 'house-05', 1),
  ('short_break', 'quad', 'house-06', 1),
  ('short_break', 'quad', 'house-07', 1),
  ('short_break', 'quad', 'house-08', 1),
  ('short_break', 'quad', 'house-09', 1),
  ('short_break', 'quad', 'house-10', 1),
  ('short_break', 'quad', 'house-11', 1),
  ('short_break', 'quad', 'house-12', 1),
  ('short_break', 'quad', 'house-13', 1),
  ('short_break', 'harnwell', 'quad',     2),
  ('short_break', 'harnwell', 'house-03', 2),
  ('short_break', 'harnwell', 'house-04', 2),
  ('short_break', 'harnwell', 'house-05', 2),
  ('short_break', 'harnwell', 'house-06', 2),
  ('short_break', 'harnwell', 'house-07', 2),
  ('short_break', 'harnwell', 'house-08', 2),
  ('short_break', 'harnwell', 'house-09', 2),
  ('short_break', 'harnwell', 'house-10', 2),
  ('short_break', 'harnwell', 'house-11', 2),
  ('short_break', 'harnwell', 'house-12', 2),
  ('short_break', 'harnwell', 'house-13', 2);

-- winter_break: zero float_routing rows (floating is disabled for this profile)

-- ============================================================
-- System Config
-- ARCHITECTURE.md §3.10 / Appendix B
-- ============================================================

INSERT INTO system_config (config_key, config_value, value_type) VALUES
  ('drop_horizon_days',              '30',    'integer'),
  ('min_float_chunk_blocks',         '2',     'integer'),
  ('float_retention_days',           '14',    'integer'),
  ('shift_block_minutes',            '30',    'integer'),
  ('shift_swap_expiry_anchor',       'T-3h',  'enum'),
  ('float_swap_expiry_hours',        '24',    'integer'),
  ('permanent_swap_expiry_days',     '7',     'integer'),
  ('hm_working_hours_start',         '08:00', 'time_of_day'),
  ('hm_working_hours_end',           '17:00', 'time_of_day'),
  ('no_ack_trigger_offset_minutes',  '5',     'integer'),
  ('ack_deadline_offset_minutes',    '10',    'integer');
