-- Migration: hm_leave
-- Layer 7: HM/BM leave periods and single-link replacement chain. Architecture §2.7
--
-- user_id and replacement_user_id FK to users added in phase-2.

CREATE TYPE hm_leave_status_enum AS ENUM ('active', 'cancelled_early');

CREATE TABLE hm_leave (
  leave_id             uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the HM/BM going on leave; FK to users added in phase-2
  user_id              uuid                 NOT NULL,
  start_date           date                 NOT NULL,
  end_date             date                 NOT NULL,
  -- immediate replacement; NULL = project administrator is the terminal replacement
  replacement_user_id  uuid,
  status               hm_leave_status_enum NOT NULL DEFAULT 'active',
  -- populated when "I'm back" is clicked
  cancelled_at         timestamptz,
  CONSTRAINT hm_leave_dates_check CHECK (end_date >= start_date),
  CONSTRAINT hm_leave_cancelled_consistency
    CHECK (
      (status = 'cancelled_early' AND cancelled_at IS NOT NULL) OR
      (status = 'active'          AND cancelled_at IS NULL)
    )
);

ALTER TABLE hm_leave ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON hm_leave
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS: user-scoped policies added in phase-2 when auth is introduced.

-- rollback:
-- DROP TABLE IF EXISTS hm_leave CASCADE;
-- DROP TYPE IF EXISTS hm_leave_status_enum;
