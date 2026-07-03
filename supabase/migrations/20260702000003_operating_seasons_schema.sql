-- Migration: Operating Seasons — authoring schema (P2).
--
-- The admin authors a high-level SEASON (e.g. "Summer 2026") plus per-house open
-- windows, float windows, and a float-routing matrix. A pure-TS compiler
-- (packages/core/src/operating-seasons) derives PHASES from these rows — one phase
-- per change-point — and materializes each phase into the EXISTING runtime config
-- tables (operating_profiles / staffing_patterns / float_routing / operating_calendar)
-- via apply_compiled_season (migration 20260702000005). Lower roles never read these
-- authoring tables; they consume the compiled runtime tables through existing paths.
-- See docs/operating-seasons/PLAN.md §4–§5.
--
-- These tables are AUTHORING TRUTH only. Editing them changes nothing at runtime
-- until the admin runs apply. All five are admin-only (RLS) + service-role bypass.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- 1. operating_seasons — the season header + season-wide settings shared by every
-- phase (cap, enforcement, desk hours, scheduling mode). v1 fixes scheduling_mode
-- to 'sm_built' (decision #4) but the column exists for a future claim-based season.
-- ============================================================
CREATE TABLE operating_seasons (
  season_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_name       text NOT NULL,
  slug              text NOT NULL UNIQUE
                      CHECK (slug ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  start_date        date NOT NULL,
  end_date          date NOT NULL,
  scheduling_mode   scheduling_mode_enum NOT NULL DEFAULT 'sm_built',
  hours_cap         integer NOT NULL CHECK (hours_cap > 0),
  cap_enforcement   cap_enforcement_enum NOT NULL,
  -- '00:00' as an end bound means 24:00 / midnight-end-of-day (repo convention;
  -- the block generator casts it to input_date + 24h). See AGENTS Phase 03 notes.
  shift_start_bound time NOT NULL DEFAULT '08:00',
  shift_end_bound   time NOT NULL DEFAULT '00:00',
  last_applied_at   timestamptz,
  created_by        uuid REFERENCES users (user_id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operating_seasons_dates_check CHECK (end_date >= start_date),
  -- No two seasons may cover overlapping calendar ranges (they would both try to
  -- own the same operating_calendar dates). Inclusive daterange overlap.
  CONSTRAINT operating_seasons_no_overlap
    EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)
);

-- ============================================================
-- 2. season_house_windows — the presence of a window = the house is OPEN for those
-- dates at `headcount`. No window for a date = the house is CLOSED that date.
-- band_headcounts (optional) mirrors staffing_patterns.block_headcounts for
-- desk-hours-varying headcount; NULL = a single full-day band at `headcount`.
-- ============================================================
CREATE TABLE season_house_windows (
  window_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       uuid NOT NULL REFERENCES operating_seasons ON DELETE CASCADE,
  house_id        text NOT NULL REFERENCES houses (id),
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  headcount       integer NOT NULL CHECK (headcount >= 1),
  band_headcounts jsonb,
  CONSTRAINT season_house_windows_dates_check CHECK (end_date >= start_date),
  -- One house cannot have two overlapping open windows in the same season.
  CONSTRAINT season_house_windows_no_overlap
    EXCLUDE USING gist (
      season_id WITH =,
      house_id WITH =,
      daterange(start_date, end_date, '[]') WITH &&
    )
);

CREATE INDEX season_house_windows_season_idx ON season_house_windows (season_id);

-- ============================================================
-- 3. season_float_windows — floating is ON during these windows, OFF elsewhere in
-- the season. No window = floating off for the whole season.
-- ============================================================
CREATE TABLE season_float_windows (
  window_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid NOT NULL REFERENCES operating_seasons ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  CONSTRAINT season_float_windows_dates_check CHECK (end_date >= start_date),
  CONSTRAINT season_float_windows_no_overlap
    EXCLUDE USING gist (
      season_id WITH =,
      daterange(start_date, end_date, '[]') WITH &&
    )
);

CREATE INDEX season_float_windows_season_idx ON season_float_windows (season_id);

-- ============================================================
-- Float routing is NOT authored per season. Floating is UNIVERSAL (stakeholder
-- decision 2026-07-02): when floating is on in a phase, ANY open, multi-staffed
-- house may float to ANY OTHER open house, with the single absolute exception that
-- Harnwell is never a destination (Harnwell MAY source). The compiler derives the
-- routing matrix automatically (generateRoutes in packages/core/src/operating-seasons)
-- and apply_compiled_season writes the per-phase float_routing rows; there is no
-- admin-facing routing table. The Harnwell-destination guard lives in the
-- float_routing legality trigger (20260702000005) and the pure algorithm.
-- ============================================================

-- ============================================================
-- 4. operating_config_audit — every apply (and optionally preview) is logged with
-- the compiled payload and the reconciliation impact summary returned to the UI.
-- ============================================================
CREATE TABLE operating_config_audit (
  audit_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid REFERENCES operating_seasons ON DELETE SET NULL,
  action     text NOT NULL CHECK (action IN ('apply', 'preview')),
  applied_by uuid REFERENCES users (user_id),
  applied_at timestamptz NOT NULL DEFAULT now(),
  payload    jsonb NOT NULL,
  impact     jsonb NOT NULL
);

CREATE INDEX operating_config_audit_season_idx ON operating_config_audit (season_id, applied_at DESC);

-- ============================================================
-- RLS — admin-only for every verb, plus service-role bypass (the apply RPC runs
-- SECURITY DEFINER, and future tooling uses the service client).
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'operating_seasons', 'season_house_windows', 'season_float_windows',
    'operating_config_audit'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);

    EXECUTE format($f$
      DROP POLICY IF EXISTS "service-role bypass" ON %I;
      CREATE POLICY "service-role bypass" ON %I
        TO service_role USING (true) WITH CHECK (true);
    $f$, t, t);

    EXECUTE format($f$
      DROP POLICY IF EXISTS "admin manages %1$s" ON %1$I;
      CREATE POLICY "admin manages %1$s" ON %1$I
        FOR ALL TO authenticated
        USING (user_is_admin(auth.uid()))
        WITH CHECK (user_is_admin(auth.uid()));
    $f$, t);
  END LOOP;
END $$;

-- rollback:
-- DROP TABLE IF EXISTS operating_config_audit;
-- DROP TABLE IF EXISTS season_float_windows;
-- DROP TABLE IF EXISTS season_house_windows;
-- DROP TABLE IF EXISTS operating_seasons;
