-- Migration: shift blocks and calendar generation
-- Phase 03: 30-minute block model and per-date calendar generation.

CREATE TYPE shift_status_enum AS ENUM (
  'scheduled',
  'claimed',
  'floated_in',
  'floated_out',
  'pending_float_in',
  'pending_float_out',
  'allied',
  'vacant'
);

CREATE TYPE vacancy_origin_enum AS ENUM (
  'none',
  'temporary_drop',
  'permanent_drop',
  'never_assigned',
  'expired_claim',
  'displaced_decliner'
);

CREATE TYPE block_step_status_enum AS ENUM (
  'fired',
  'completed_via_force_trigger',
  'rolled_back'
);

CREATE TABLE shift_blocks (
  block_id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id           text        NOT NULL REFERENCES houses (id),
  block_start_at     timestamptz NOT NULL,
  required_headcount integer     NOT NULL CHECK (required_headcount > 0),
  CONSTRAINT shift_blocks_block_start_boundary_check
    CHECK (
      date_part('minute', block_start_at AT TIME ZONE 'America/New_York') IN (0, 30)
      AND date_part('second', block_start_at AT TIME ZONE 'America/New_York') = 0
    ),
  UNIQUE (house_id, block_start_at)
);

-- TODO(phase-03): Partition by month if production volume warrants it.
CREATE TABLE shift_block_assignments (
  assignment_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id              uuid NOT NULL REFERENCES shift_blocks (block_id) ON DELETE CASCADE,
  user_id               uuid REFERENCES users (user_id),
  status                shift_status_enum NOT NULL,
  vacancy_origin        vacancy_origin_enum NOT NULL DEFAULT 'none',
  is_float              boolean NOT NULL DEFAULT false,
  is_cross_house_pickup boolean NOT NULL DEFAULT false,
  source_house_id       text REFERENCES houses (id),
  parent_float_id       uuid,
  CONSTRAINT valid_vacancy_origin CHECK (
    (status = 'vacant' AND vacancy_origin != 'none') OR
    (status != 'vacant' AND vacancy_origin = 'none')
  ),
  CONSTRAINT float_pickup_exclusive CHECK (
    NOT (is_float = true AND is_cross_house_pickup = true)
  ),
  CONSTRAINT source_house_required_when_non_home CHECK (
    (is_float = false AND is_cross_house_pickup = false) OR source_house_id IS NOT NULL
  )
);

CREATE TABLE block_step_status (
  block_id   uuid                   NOT NULL REFERENCES shift_blocks (block_id) ON DELETE CASCADE,
  step_name  text                   NOT NULL,
  status     block_step_status_enum NOT NULL,
  fired_at   timestamptz            NOT NULL DEFAULT now(),
  updated_at timestamptz            NOT NULL DEFAULT now(),
  PRIMARY KEY (block_id, step_name)
);

CREATE INDEX shift_blocks_block_start_at_idx
  ON shift_blocks (block_start_at);

CREATE INDEX shift_block_assignments_block_status_idx
  ON shift_block_assignments (block_id, status);

CREATE INDEX shift_block_assignments_user_id_idx
  ON shift_block_assignments (user_id);

CREATE INDEX block_step_status_status_idx
  ON block_step_status (status);

ALTER TABLE shift_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_block_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE block_step_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON shift_blocks
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated users can select shift blocks" ON shift_blocks
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service-role bypass" ON shift_block_assignments
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Workers must see their own assignments anywhere — float-out and
-- cross-house pickup rows attach to non-home-house blocks but belong
-- to the worker's personal calendar (BEH §11.2).
CREATE POLICY "users can select own assignments" ON shift_block_assignments
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "authenticated users can select accessible assignments" ON shift_block_assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM shift_blocks
      WHERE shift_blocks.block_id = shift_block_assignments.block_id
        AND (
          EXISTS (
            SELECT 1
            FROM users
            WHERE users.user_id = auth.uid()
              AND users.home_house_id = shift_blocks.house_id
          )
          OR user_has_house_admin_role(auth.uid(), shift_blocks.house_id)
        )
    )
  );

CREATE POLICY "service-role bypass" ON block_step_status
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION generate_blocks_for_date(target_date date)
RETURNS TABLE (
  blocks_inserted integer,
  assignments_inserted integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH calendar_profile AS (
    SELECT profile_name
    FROM operating_calendar
    WHERE date = target_date
  ),
  selected_patterns AS (
    SELECT sp.house_id, sp.block_headcounts
    FROM calendar_profile cp
    JOIN staffing_patterns sp
      ON sp.profile_name = cp.profile_name
     AND sp.day_type = (
       CASE
         WHEN EXTRACT(DOW FROM target_date) IN (0, 6) THEN 'weekend'
         ELSE 'weekday'
       END
     )::day_type_enum
  ),
  band_minutes AS (
    SELECT
      selected_patterns.house_id,
      band.headcount,
      (
        split_part(band.block_start, ':', 1)::integer * 60
        + split_part(band.block_start, ':', 2)::integer
      ) AS start_minute,
      CASE
        WHEN (
          split_part(band.block_end, ':', 1)::integer * 60
          + split_part(band.block_end, ':', 2)::integer
        ) = 0 THEN 1440
        WHEN (
          split_part(band.block_end, ':', 1)::integer * 60
          + split_part(band.block_end, ':', 2)::integer
        ) <= (
          split_part(band.block_start, ':', 1)::integer * 60
          + split_part(band.block_start, ':', 2)::integer
        ) THEN (
          split_part(band.block_end, ':', 1)::integer * 60
          + split_part(band.block_end, ':', 2)::integer
          + 1440
        )
        ELSE (
          split_part(band.block_end, ':', 1)::integer * 60
          + split_part(band.block_end, ':', 2)::integer
        )
      END AS end_minute
    FROM selected_patterns
    CROSS JOIN LATERAL jsonb_to_recordset(selected_patterns.block_headcounts)
      AS band(block_start text, block_end text, headcount integer)
    WHERE band.headcount > 0
  ),
  -- Anchor each band's start and end as timestamptz by interpreting the
  -- wall-clock minute offset in America/New_York, then iterate the band as
  -- 30-minute UTC durations. This is DST-correct for any band, including
  -- ones that straddle the spring-forward gap (02:00-03:00 NY: those
  -- wall-clocks simply do not exist, and the UTC step skips them) or the
  -- fall-back repeat (01:00-02:00 NY happens twice: those are two distinct
  -- UTC instants and produce two distinct blocks).
  band_ranges AS (
    SELECT
      house_id,
      headcount,
      (target_date::timestamp + make_interval(mins => start_minute))
        AT TIME ZONE 'America/New_York' AS band_start_at,
      (target_date::timestamp + make_interval(mins => end_minute))
        AT TIME ZONE 'America/New_York' AS band_end_at
    FROM band_minutes
  ),
  expanded AS (
    SELECT
      band_ranges.house_id,
      band_ranges.headcount,
      band_ranges.band_start_at + (n * interval '30 minutes') AS block_start_at
    FROM band_ranges
    CROSS JOIN LATERAL generate_series(
      0,
      (extract(epoch FROM (band_ranges.band_end_at - band_ranges.band_start_at))::bigint / 1800)::integer - 1
    ) AS n
    WHERE band_ranges.band_end_at > band_ranges.band_start_at
  ),
  candidate_blocks AS (
    SELECT
      expanded.house_id,
      expanded.block_start_at,
      max(expanded.headcount) AS required_headcount
    FROM expanded
    GROUP BY expanded.house_id, expanded.block_start_at
  ),
  inserted_blocks AS (
    INSERT INTO shift_blocks (house_id, block_start_at, required_headcount)
    SELECT house_id, block_start_at, required_headcount
    FROM candidate_blocks
    ON CONFLICT (house_id, block_start_at) DO NOTHING
    RETURNING block_id, required_headcount
  ),
  inserted_assignments AS (
    INSERT INTO shift_block_assignments (block_id, status, vacancy_origin)
    SELECT
      inserted_blocks.block_id,
      'vacant'::shift_status_enum,
      'never_assigned'::vacancy_origin_enum
    FROM inserted_blocks
    CROSS JOIN LATERAL generate_series(1, inserted_blocks.required_headcount)
    RETURNING 1
  )
  SELECT
    (SELECT count(*)::integer FROM inserted_blocks),
    (SELECT count(*)::integer FROM inserted_assignments);
END;
$$;

CREATE OR REPLACE FUNCTION generate_blocks_for_range(
  start_date date,
  end_date date
)
RETURNS TABLE (
  blocks_inserted integer,
  assignments_inserted integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(sum(generated.blocks_inserted), 0)::integer AS blocks_inserted,
    COALESCE(sum(generated.assignments_inserted), 0)::integer AS assignments_inserted
  FROM generate_series(start_date, end_date, interval '1 day') AS day
  CROSS JOIN LATERAL generate_blocks_for_date(day::date) AS generated;
$$;

-- rollback:
-- DROP FUNCTION IF EXISTS generate_blocks_for_range(date, date);
-- DROP FUNCTION IF EXISTS generate_blocks_for_date(date);
-- DROP POLICY IF EXISTS "service-role bypass" ON block_step_status;
-- DROP POLICY IF EXISTS "authenticated users can select accessible assignments" ON shift_block_assignments;
-- DROP POLICY IF EXISTS "users can select own assignments" ON shift_block_assignments;
-- DROP POLICY IF EXISTS "service-role bypass" ON shift_block_assignments;
-- DROP POLICY IF EXISTS "authenticated users can select shift blocks" ON shift_blocks;
-- DROP POLICY IF EXISTS "service-role bypass" ON shift_blocks;
-- DROP TABLE IF EXISTS block_step_status CASCADE;
-- DROP TABLE IF EXISTS shift_block_assignments CASCADE;
-- DROP TABLE IF EXISTS shift_blocks CASCADE;
-- DROP TYPE IF EXISTS block_step_status_enum;
-- DROP TYPE IF EXISTS vacancy_origin_enum;
-- DROP TYPE IF EXISTS shift_status_enum;
