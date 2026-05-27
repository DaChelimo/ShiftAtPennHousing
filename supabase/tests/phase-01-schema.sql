-- pgTAP schema validation tests for Phase 01: Configuration Layer
-- Run with: supabase test db

BEGIN;

SELECT plan(167);

-- ============================================================
-- 1. All 12 tables exist
-- ============================================================

SELECT has_table('public', 'houses',             'houses table exists');
SELECT has_table('public', 'operating_profiles', 'operating_profiles table exists');
SELECT has_table('public', 'operating_calendar', 'operating_calendar table exists');
SELECT has_table('public', 'staffing_patterns',  'staffing_patterns table exists');
SELECT has_table('public', 'float_routing',      'float_routing table exists');
SELECT has_table('public', 'weekly_cap_overrides','weekly_cap_overrides table exists');
SELECT has_table('public', 'hmod_rotor',         'hmod_rotor table exists');
SELECT has_table('public', 'hm_leave',           'hm_leave table exists');
SELECT has_table('public', 'ack_cadence_config', 'ack_cadence_config table exists');
SELECT has_table('public', 'break_periods',      'break_periods table exists');
SELECT has_table('public', 'scheduling_periods', 'scheduling_periods table exists');
SELECT has_table('public', 'system_config',      'system_config table exists');

-- ============================================================
-- 2. Column existence and types
-- ============================================================

-- houses
SELECT has_column('public', 'houses', 'id',   'houses.id exists');
SELECT has_column('public', 'houses', 'name', 'houses.name exists');
SELECT col_type_is('public', 'houses', 'id',   'text', 'houses.id is text');
SELECT col_type_is('public', 'houses', 'name', 'text', 'houses.name is text');

-- operating_profiles
SELECT has_column('public', 'operating_profiles', 'profile_name',             'operating_profiles.profile_name exists');
SELECT has_column('public', 'operating_profiles', 'shift_start_bound',        'operating_profiles.shift_start_bound exists');
SELECT has_column('public', 'operating_profiles', 'shift_end_bound',          'operating_profiles.shift_end_bound exists');
SELECT has_column('public', 'operating_profiles', 'default_hours_cap',        'operating_profiles.default_hours_cap exists');
SELECT has_column('public', 'operating_profiles', 'default_cap_enforcement',  'operating_profiles.default_cap_enforcement exists');
SELECT has_column('public', 'operating_profiles', 'scheduling_mode',          'operating_profiles.scheduling_mode exists');
SELECT has_column('public', 'operating_profiles', 'float_enabled',            'operating_profiles.float_enabled exists');
SELECT has_column('public', 'operating_profiles', 'escalation_chain',         'operating_profiles.escalation_chain exists');
SELECT has_column('public', 'operating_profiles', 'claim_phase_open_offset',  'operating_profiles.claim_phase_open_offset exists');
SELECT has_column('public', 'operating_profiles', 'claim_phase_alert_offset', 'operating_profiles.claim_phase_alert_offset exists');
SELECT has_column('public', 'operating_profiles', 'claim_phase_close_offset', 'operating_profiles.claim_phase_close_offset exists');

SELECT col_type_is('public', 'operating_profiles', 'shift_start_bound',   'time without time zone', 'shift_start_bound is time');
SELECT col_type_is('public', 'operating_profiles', 'shift_end_bound',     'time without time zone', 'shift_end_bound is time');
SELECT col_type_is('public', 'operating_profiles', 'default_hours_cap',   'integer',                'default_hours_cap is integer');
SELECT col_type_is('public', 'operating_profiles', 'float_enabled',       'boolean',                'float_enabled is boolean');
SELECT col_type_is('public', 'operating_profiles', 'escalation_chain',    'jsonb',                  'escalation_chain is jsonb');
SELECT col_type_is('public', 'operating_profiles', 'claim_phase_open_offset',  'interval', 'claim_phase_open_offset is interval');
SELECT col_type_is('public', 'operating_profiles', 'claim_phase_alert_offset', 'interval', 'claim_phase_alert_offset is interval');
SELECT col_type_is('public', 'operating_profiles', 'claim_phase_close_offset', 'interval', 'claim_phase_close_offset is interval');

-- operating_calendar
SELECT has_column('public', 'operating_calendar', 'date',         'operating_calendar.date exists');
SELECT has_column('public', 'operating_calendar', 'profile_name', 'operating_calendar.profile_name exists');
SELECT col_type_is('public', 'operating_calendar', 'date', 'date', 'operating_calendar.date is date');

-- staffing_patterns
SELECT has_column('public', 'staffing_patterns', 'profile_name',     'staffing_patterns.profile_name exists');
SELECT has_column('public', 'staffing_patterns', 'house_id',         'staffing_patterns.house_id exists');
SELECT has_column('public', 'staffing_patterns', 'day_type',         'staffing_patterns.day_type exists');
SELECT has_column('public', 'staffing_patterns', 'block_headcounts', 'staffing_patterns.block_headcounts exists');
SELECT col_type_is('public', 'staffing_patterns', 'block_headcounts', 'jsonb', 'block_headcounts is jsonb');

-- float_routing
SELECT has_column('public', 'float_routing', 'profile_name',         'float_routing.profile_name exists');
SELECT has_column('public', 'float_routing', 'source_house_id',      'float_routing.source_house_id exists');
SELECT has_column('public', 'float_routing', 'destination_house_id', 'float_routing.destination_house_id exists');
SELECT has_column('public', 'float_routing', 'precedence_order',     'float_routing.precedence_order exists');
SELECT col_type_is('public', 'float_routing', 'precedence_order', 'integer', 'precedence_order is integer');

-- weekly_cap_overrides
SELECT has_column('public', 'weekly_cap_overrides', 'week_start_date', 'weekly_cap_overrides.week_start_date exists');
SELECT has_column('public', 'weekly_cap_overrides', 'hours_cap',       'weekly_cap_overrides.hours_cap exists');
SELECT has_column('public', 'weekly_cap_overrides', 'cap_enforcement', 'weekly_cap_overrides.cap_enforcement exists');
SELECT has_column('public', 'weekly_cap_overrides', 'modified_by',     'weekly_cap_overrides.modified_by exists');
SELECT has_column('public', 'weekly_cap_overrides', 'modified_at',     'weekly_cap_overrides.modified_at exists');
SELECT col_type_is('public', 'weekly_cap_overrides', 'week_start_date', 'date',                        'week_start_date is date');
SELECT col_type_is('public', 'weekly_cap_overrides', 'modified_at',     'timestamp with time zone',    'modified_at is timestamptz');

-- hmod_rotor
SELECT has_column('public', 'hmod_rotor', 'week_start_date', 'hmod_rotor.week_start_date exists');
SELECT has_column('public', 'hmod_rotor', 'hmod_user_id',    'hmod_rotor.hmod_user_id exists');
SELECT col_type_is('public', 'hmod_rotor', 'week_start_date', 'date', 'hmod_rotor.week_start_date is date');
SELECT col_type_is('public', 'hmod_rotor', 'hmod_user_id',    'uuid', 'hmod_rotor.hmod_user_id is uuid');

-- hm_leave
SELECT has_column('public', 'hm_leave', 'leave_id',            'hm_leave.leave_id exists');
SELECT has_column('public', 'hm_leave', 'user_id',             'hm_leave.user_id exists');
SELECT has_column('public', 'hm_leave', 'start_date',          'hm_leave.start_date exists');
SELECT has_column('public', 'hm_leave', 'end_date',            'hm_leave.end_date exists');
SELECT has_column('public', 'hm_leave', 'replacement_user_id', 'hm_leave.replacement_user_id exists');
SELECT has_column('public', 'hm_leave', 'status',              'hm_leave.status exists');
SELECT has_column('public', 'hm_leave', 'cancelled_at',        'hm_leave.cancelled_at exists');
SELECT col_type_is('public', 'hm_leave', 'leave_id',     'uuid',                       'leave_id is uuid');
SELECT col_type_is('public', 'hm_leave', 'start_date',   'date',                       'start_date is date');
SELECT col_type_is('public', 'hm_leave', 'end_date',     'date',                       'end_date is date');
SELECT col_type_is('public', 'hm_leave', 'cancelled_at', 'timestamp with time zone',   'cancelled_at is timestamptz');

-- ack_cadence_config
SELECT has_column('public', 'ack_cadence_config', 'house_id',           'ack_cadence_config.house_id exists');
SELECT has_column('public', 'ack_cadence_config', 'reminder_6h_offset', 'ack_cadence_config.reminder_6h_offset exists');
SELECT has_column('public', 'ack_cadence_config', 'reminder_2h_offset', 'ack_cadence_config.reminder_2h_offset exists');
SELECT has_column('public', 'ack_cadence_config', 'modified_by',        'ack_cadence_config.modified_by exists');
SELECT has_column('public', 'ack_cadence_config', 'modified_at',        'ack_cadence_config.modified_at exists');
SELECT col_type_is('public', 'ack_cadence_config', 'reminder_6h_offset', 'interval',                   'reminder_6h_offset is interval');
SELECT col_type_is('public', 'ack_cadence_config', 'reminder_2h_offset', 'interval',                   'reminder_2h_offset is interval');
SELECT col_type_is('public', 'ack_cadence_config', 'modified_at',        'timestamp with time zone',   'modified_at is timestamptz');

-- break_periods
SELECT has_column('public', 'break_periods', 'break_id',    'break_periods.break_id exists');
SELECT has_column('public', 'break_periods', 'break_name',  'break_periods.break_name exists');
SELECT has_column('public', 'break_periods', 'break_type',  'break_periods.break_type exists');
SELECT has_column('public', 'break_periods', 'start_date',  'break_periods.start_date exists');
SELECT has_column('public', 'break_periods', 'end_date',    'break_periods.end_date exists');
SELECT has_column('public', 'break_periods', 'profile_name','break_periods.profile_name exists');
SELECT col_type_is('public', 'break_periods', 'break_id',   'uuid', 'break_id is uuid');
SELECT col_type_is('public', 'break_periods', 'start_date', 'date', 'start_date is date');
SELECT col_type_is('public', 'break_periods', 'end_date',   'date', 'end_date is date');

-- scheduling_periods
SELECT has_column('public', 'scheduling_periods', 'period_id',           'scheduling_periods.period_id exists');
SELECT has_column('public', 'scheduling_periods', 'period_name',         'scheduling_periods.period_name exists');
SELECT has_column('public', 'scheduling_periods', 'profile_name',        'scheduling_periods.profile_name exists');
SELECT has_column('public', 'scheduling_periods', 'start_date',          'scheduling_periods.start_date exists');
SELECT has_column('public', 'scheduling_periods', 'end_date',            'scheduling_periods.end_date exists');
SELECT has_column('public', 'scheduling_periods', 'preference_deadline', 'scheduling_periods.preference_deadline exists');
SELECT has_column('public', 'scheduling_periods', 'published_at',        'scheduling_periods.published_at exists');
SELECT col_type_is('public', 'scheduling_periods', 'period_id',           'uuid',                     'period_id is uuid');
SELECT col_type_is('public', 'scheduling_periods', 'start_date',          'date',                     'start_date is date');
SELECT col_type_is('public', 'scheduling_periods', 'end_date',            'date',                     'end_date is date');
SELECT col_type_is('public', 'scheduling_periods', 'preference_deadline', 'timestamp with time zone', 'preference_deadline is timestamptz');
SELECT col_type_is('public', 'scheduling_periods', 'published_at',        'timestamp with time zone', 'published_at is timestamptz');
-- preference_deadline and published_at must be nullable (null until SM sets them)
SELECT ok(
  (SELECT is_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'scheduling_periods'
     AND column_name = 'preference_deadline') = 'YES',
  'preference_deadline is nullable'
);
SELECT ok(
  (SELECT is_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'scheduling_periods'
     AND column_name = 'published_at') = 'YES',
  'published_at is nullable'
);

-- system_config
SELECT has_column('public', 'system_config', 'config_key',   'system_config.config_key exists');
SELECT has_column('public', 'system_config', 'config_value', 'system_config.config_value exists');
SELECT has_column('public', 'system_config', 'value_type',   'system_config.value_type exists');
SELECT has_column('public', 'system_config', 'modified_by',  'system_config.modified_by exists');
SELECT has_column('public', 'system_config', 'modified_at',  'system_config.modified_at exists');
SELECT has_column('public', 'system_config', 'notes',        'system_config.notes exists');
SELECT col_type_is('public', 'system_config', 'modified_at', 'timestamp with time zone', 'system_config.modified_at is timestamptz');

-- ============================================================
-- 3. No plain timestamp columns (all must be timestamptz)
-- ============================================================

SELECT is(
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN (
       'houses','operating_profiles','operating_calendar','staffing_patterns',
       'float_routing','weekly_cap_overrides','hmod_rotor','hm_leave',
       'ack_cadence_config','break_periods','scheduling_periods','system_config'
     )
     AND data_type = 'timestamp without time zone')::integer,
  0,
  'No plain timestamp (non-tz) columns in config tables'
);

-- ============================================================
-- 4. jsonb columns
-- ============================================================

SELECT col_type_is('public', 'operating_profiles', 'escalation_chain',    'jsonb', 'escalation_chain is jsonb (duplicate assertion for clarity)');
SELECT col_type_is('public', 'staffing_patterns',  'block_headcounts',    'jsonb', 'block_headcounts is jsonb (duplicate assertion for clarity)');

-- ============================================================
-- 5. RLS enabled on every table
-- ============================================================

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'houses' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on houses'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'operating_profiles' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on operating_profiles'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'operating_calendar' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on operating_calendar'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'staffing_patterns' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on staffing_patterns'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'float_routing' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on float_routing'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'weekly_cap_overrides' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on weekly_cap_overrides'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'hmod_rotor' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on hmod_rotor'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'hm_leave' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on hm_leave'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'ack_cadence_config' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on ack_cadence_config'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'break_periods' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on break_periods'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'scheduling_periods' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on scheduling_periods'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'system_config' AND relnamespace = 'public'::regnamespace),
  'RLS enabled on system_config'
);

-- ============================================================
-- 6. Service-role bypass policy exists on every table
-- ============================================================

SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'houses'              AND policyname = 'service-role bypass'),
  'service-role bypass policy on houses'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'operating_profiles'  AND policyname = 'service-role bypass'),
  'service-role bypass policy on operating_profiles'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'operating_calendar'  AND policyname = 'service-role bypass'),
  'service-role bypass policy on operating_calendar'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'staffing_patterns'   AND policyname = 'service-role bypass'),
  'service-role bypass policy on staffing_patterns'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'float_routing'       AND policyname = 'service-role bypass'),
  'service-role bypass policy on float_routing'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'weekly_cap_overrides' AND policyname = 'service-role bypass'),
  'service-role bypass policy on weekly_cap_overrides'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hmod_rotor'          AND policyname = 'service-role bypass'),
  'service-role bypass policy on hmod_rotor'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'hm_leave'            AND policyname = 'service-role bypass'),
  'service-role bypass policy on hm_leave'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ack_cadence_config'  AND policyname = 'service-role bypass'),
  'service-role bypass policy on ack_cadence_config'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'break_periods'       AND policyname = 'service-role bypass'),
  'service-role bypass policy on break_periods'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scheduling_periods'  AND policyname = 'service-role bypass'),
  'service-role bypass policy on scheduling_periods'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_config'       AND policyname = 'service-role bypass'),
  'service-role bypass policy on system_config'
);

-- ============================================================
-- 7. FK relationships
-- ============================================================

SELECT fk_ok(
  'public', 'operating_calendar', ARRAY['profile_name'],
  'public', 'operating_profiles', ARRAY['profile_name'],
  'operating_calendar.profile_name → operating_profiles'
);

SELECT fk_ok(
  'public', 'staffing_patterns', ARRAY['profile_name'],
  'public', 'operating_profiles', ARRAY['profile_name'],
  'staffing_patterns.profile_name → operating_profiles'
);

SELECT fk_ok(
  'public', 'staffing_patterns', ARRAY['house_id'],
  'public', 'houses', ARRAY['id'],
  'staffing_patterns.house_id → houses'
);

SELECT fk_ok(
  'public', 'float_routing', ARRAY['profile_name'],
  'public', 'operating_profiles', ARRAY['profile_name'],
  'float_routing.profile_name → operating_profiles'
);

SELECT fk_ok(
  'public', 'float_routing', ARRAY['source_house_id'],
  'public', 'houses', ARRAY['id'],
  'float_routing.source_house_id → houses'
);

SELECT fk_ok(
  'public', 'float_routing', ARRAY['destination_house_id'],
  'public', 'houses', ARRAY['id'],
  'float_routing.destination_house_id → houses'
);

SELECT fk_ok(
  'public', 'ack_cadence_config', ARRAY['house_id'],
  'public', 'houses', ARRAY['id'],
  'ack_cadence_config.house_id → houses'
);

SELECT fk_ok(
  'public', 'break_periods', ARRAY['profile_name'],
  'public', 'operating_profiles', ARRAY['profile_name'],
  'break_periods.profile_name → operating_profiles'
);

SELECT fk_ok(
  'public', 'scheduling_periods', ARRAY['profile_name'],
  'public', 'operating_profiles', ARRAY['profile_name'],
  'scheduling_periods.profile_name → operating_profiles'
);

-- ============================================================
-- 8. Seed data: 13 houses, 3 profiles
-- ============================================================

SELECT is(
  (SELECT count(*)::integer FROM houses),
  13,
  'Seed: 13 houses exist'
);

SELECT ok(
  EXISTS (SELECT 1 FROM houses WHERE id = 'harnwell'),
  'Seed: Harnwell house exists'
);
SELECT ok(
  EXISTS (SELECT 1 FROM houses WHERE id = 'quad'),
  'Seed: Quad house exists'
);

SELECT is(
  (SELECT count(*)::integer FROM operating_profiles),
  3,
  'Seed: 3 operating profiles exist'
);

SELECT ok(
  EXISTS (SELECT 1 FROM operating_profiles WHERE profile_name = 'regular_school_year'),
  'Seed: regular_school_year profile exists'
);
SELECT ok(
  EXISTS (SELECT 1 FROM operating_profiles WHERE profile_name = 'winter_break'),
  'Seed: winter_break profile exists'
);
SELECT ok(
  EXISTS (SELECT 1 FROM operating_profiles WHERE profile_name = 'short_break'),
  'Seed: short_break profile exists'
);

-- ============================================================
-- 9. Profile values match spec exactly
-- ============================================================

SELECT ok(
  (SELECT float_enabled FROM operating_profiles WHERE profile_name = 'regular_school_year'),
  'regular_school_year has float_enabled = true'
);

SELECT ok(
  NOT (SELECT float_enabled FROM operating_profiles WHERE profile_name = 'winter_break'),
  'winter_break has float_enabled = false'
);

SELECT ok(
  (SELECT float_enabled FROM operating_profiles WHERE profile_name = 'short_break'),
  'short_break has float_enabled = true'
);

SELECT is(
  (SELECT default_hours_cap FROM operating_profiles WHERE profile_name = 'regular_school_year'),
  20,
  'regular_school_year default_hours_cap = 20'
);

SELECT is(
  (SELECT default_hours_cap FROM operating_profiles WHERE profile_name = 'winter_break'),
  40,
  'winter_break default_hours_cap = 40'
);

SELECT is(
  (SELECT default_hours_cap FROM operating_profiles WHERE profile_name = 'short_break'),
  40,
  'short_break default_hours_cap = 40'
);

SELECT is(
  (SELECT default_cap_enforcement::text FROM operating_profiles WHERE profile_name = 'regular_school_year'),
  'soft',
  'regular_school_year cap enforcement is soft'
);

SELECT is(
  (SELECT default_cap_enforcement::text FROM operating_profiles WHERE profile_name = 'winter_break'),
  'hard',
  'winter_break cap enforcement is hard'
);

SELECT is(
  (SELECT scheduling_mode::text FROM operating_profiles WHERE profile_name = 'regular_school_year'),
  'sm_built',
  'regular_school_year scheduling_mode = sm_built'
);

SELECT is(
  (SELECT scheduling_mode::text FROM operating_profiles WHERE profile_name = 'winter_break'),
  'claim_based',
  'winter_break scheduling_mode = claim_based'
);

-- regular_school_year: claim phase offsets must be null (sm_built profile)
SELECT is(
  (SELECT claim_phase_open_offset FROM operating_profiles WHERE profile_name = 'regular_school_year'),
  NULL::interval,
  'regular_school_year claim_phase_open_offset is null'
);

-- winter_break / short_break: claim phase offsets present
SELECT is(
  (SELECT claim_phase_open_offset FROM operating_profiles WHERE profile_name = 'winter_break'),
  '-14 days'::interval,
  'winter_break claim_phase_open_offset = -14 days'
);

SELECT is(
  (SELECT claim_phase_open_offset FROM operating_profiles WHERE profile_name = 'short_break'),
  '-14 days'::interval,
  'short_break claim_phase_open_offset = -14 days'
);

-- winter_break: no float_routing rows (float disabled)
SELECT is(
  (SELECT count(*)::integer FROM float_routing WHERE profile_name = 'winter_break'),
  0,
  'winter_break has zero float_routing rows'
);

-- Staffing: winter_break only has Harnwell rows
SELECT is(
  (SELECT count(*)::integer FROM staffing_patterns WHERE profile_name = 'winter_break'),
  2,  -- weekday + weekend for Harnwell only
  'winter_break staffing_patterns has 2 rows (Harnwell weekday + weekend only)'
);

SELECT is(
  (SELECT count(*)::integer FROM staffing_patterns WHERE profile_name = 'winter_break' AND house_id = 'harnwell'),
  2,
  'winter_break Harnwell rows exist (weekday + weekend)'
);

-- system_config: 11 required keys present
SELECT is(
  (SELECT count(*)::integer FROM system_config
   WHERE config_key IN (
     'drop_horizon_days', 'min_float_chunk_blocks', 'float_retention_days',
     'shift_block_minutes', 'shift_swap_expiry_anchor', 'float_swap_expiry_hours',
     'permanent_swap_expiry_days', 'hm_working_hours_start', 'hm_working_hours_end',
     'no_ack_trigger_offset_minutes', 'ack_deadline_offset_minutes'
   )),
  11,
  'system_config contains all 11 required keys'
);

SELECT finish();
ROLLBACK;
