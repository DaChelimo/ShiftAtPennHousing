-- ============================================================================
-- Float / escalation edge-case harness — shared SQL helpers  (LOCAL Supabase only)
--   loaded automatically by run.sh before every case; idempotent.
--
-- These `ft_*` helper functions let each case file stay tiny and declarative:
-- clear transient state, park the simulated clock at a target NY instant,
-- vacate a desk (create a gap), and crew a house to an exact present-count on a
-- span. They are dev-harness tooling — installed into the local dev DB only.
--
-- Time model: app_now() = now() + dev_sim_clock.offset_seconds. Parking the
-- clock = storing (target - now()) as the offset. Everything (orchestrator,
-- website, worker app) then believes it is `target`.
-- ============================================================================
\set ON_ERROR_STOP on

-- Park the simulated clock so app_now() == p_target.
CREATE OR REPLACE FUNCTION ft_park(p_target timestamptz)
RETURNS timestamptz LANGUAGE sql AS $$
  UPDATE dev_sim_clock
     SET offset_seconds = extract(epoch FROM (p_target - now())),
         set_at = now()
   WHERE id
  RETURNING now() + make_interval(secs => offset_seconds);
$$;

-- Clear ALL transient float/escalation state and reset the clock to real time.
-- Mirrors reset.sql (floats, exclusions, float-notifications, step status,
-- coverage locks) and restores source seats + DuBois drops to their owners so
-- each case starts from a clean, published world. Global on purpose: only one
-- case is exercised at a time.
CREATE OR REPLACE FUNCTION ft_clear()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE dev_sim_clock SET offset_seconds = 0 WHERE id;

  UPDATE shift_block_assignments SET parent_float_id = NULL WHERE parent_float_id IS NOT NULL;
  DELETE FROM float_assignments;
  DELETE FROM float_exclusions;
  DELETE FROM notifications
   WHERE type IN ('hmod_urgent', 'ack_reminder', 'broadcast')
      OR (type = 'personal_shift' AND payload->>'kind' = 'float_assigned');
  DELETE FROM block_step_status;
  UPDATE shift_blocks SET coverage_locked_at = NULL WHERE coverage_locked_at IS NOT NULL;

  UPDATE shift_block_assignments
     SET status = 'scheduled', vacancy_origin = 'none', is_float = false,
         is_cross_house_pickup = false, source_house_id = NULL
   WHERE status IN ('pending_float_out', 'floated_out');

  UPDATE shift_block_assignments
     SET status = 'vacant', vacancy_origin = 'temporary_drop', user_id = NULL,
         is_float = false, is_cross_house_pickup = false, source_house_id = NULL
   WHERE status IN ('pending_float_in', 'floated_in');

  -- Restore DuBois gaps to the recurring slot owner (single-staff: no dup risk).
  UPDATE shift_block_assignments a
     SET status = 'scheduled', vacancy_origin = 'none',
         user_id = (
           SELECT a2.user_id FROM shift_block_assignments a2
           JOIN shift_blocks b2 ON b2.block_id = a2.block_id
           WHERE b2.house_id = 'dubois' AND a2.status = 'scheduled' AND a2.user_id IS NOT NULL
             AND extract(isodow FROM (b2.block_start_at AT TIME ZONE 'America/New_York'))
                 = extract(isodow FROM (b.block_start_at AT TIME ZONE 'America/New_York'))
             AND (b2.block_start_at AT TIME ZONE 'America/New_York')::time
                 = (b.block_start_at AT TIME ZONE 'America/New_York')::time
           LIMIT 1
         )
    FROM shift_blocks b
   WHERE b.block_id = a.block_id AND b.house_id = 'dubois'
     AND a.status = 'vacant' AND a.vacancy_origin = 'temporary_drop'
     AND EXISTS (
       SELECT 1 FROM shift_block_assignments a2
       JOIN shift_blocks b2 ON b2.block_id = a2.block_id
       WHERE b2.house_id = 'dubois' AND a2.status = 'scheduled' AND a2.user_id IS NOT NULL
         AND extract(isodow FROM (b2.block_start_at AT TIME ZONE 'America/New_York'))
             = extract(isodow FROM (b.block_start_at AT TIME ZONE 'America/New_York'))
         AND (b2.block_start_at AT TIME ZONE 'America/New_York')::time
             = (b.block_start_at AT TIME ZONE 'America/New_York')::time
     );
END;
$$;

-- Vacate a desk over an NY-local [t0, t1) span on a date -> creates an empty gap.
CREATE OR REPLACE FUNCTION ft_vacate(p_house text, p_date date, p_t0 time, p_t1 time)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  UPDATE shift_block_assignments a
     SET status = 'vacant', vacancy_origin = 'temporary_drop', user_id = NULL,
         is_float = false, is_cross_house_pickup = false, source_house_id = NULL
    FROM shift_blocks b
   WHERE a.block_id = b.block_id AND b.house_id = p_house
     AND (b.block_start_at AT TIME ZONE 'America/New_York')::date = p_date
     AND (b.block_start_at AT TIME ZONE 'America/New_York')::time >= p_t0
     AND (b.block_start_at AT TIME ZONE 'America/New_York')::time <  p_t1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Crew a house to EXACTLY p_n present (scheduled) SWs over an NY-local span.
-- Deletes existing span assignments first, then seats the first p_n @upenn SWs
-- of that house (deterministic email order). p_n = 0 leaves the desk empty.
CREATE OR REPLACE FUNCTION ft_crew(p_house text, p_date date, p_t0 time, p_t1 time, p_n integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  DELETE FROM shift_block_assignments a USING shift_blocks b
   WHERE a.block_id = b.block_id AND b.house_id = p_house
     AND (b.block_start_at AT TIME ZONE 'America/New_York')::date = p_date
     AND (b.block_start_at AT TIME ZONE 'America/New_York')::time >= p_t0
     AND (b.block_start_at AT TIME ZONE 'America/New_York')::time <  p_t1;

  INSERT INTO shift_block_assignments (block_id, user_id, status, vacancy_origin)
  SELECT b.block_id, c.user_id, 'scheduled', 'none'
    FROM shift_blocks b
   CROSS JOIN (
     SELECT u.user_id FROM users u
      WHERE u.home_house_id = p_house AND u.email LIKE '%@upenn.edu'
        AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.user_id AND r.role = 'sw')
      ORDER BY u.email LIMIT p_n
   ) c
   WHERE b.house_id = p_house
     AND (b.block_start_at AT TIME ZONE 'America/New_York')::date = p_date
     AND (b.block_start_at AT TIME ZONE 'America/New_York')::time >= p_t0
     AND (b.block_start_at AT TIME ZONE 'America/New_York')::time <  p_t1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Set the HMOD-on-duty for the Friday-anchored week containing p_date. The rotor
-- weeks are Friday-anchored (week_start = the Friday on/before the date), so this
-- keeps HMOD-routing cases self-contained regardless of setup.sql's fixed weeks.
CREATE OR REPLACE FUNCTION ft_rotor_set(p_date date, p_hmod_email text)
RETURNS date LANGUAGE plpgsql AS $$
DECLARE v_week date; v_uid uuid;
BEGIN
  v_week := p_date - ((extract(isodow FROM p_date)::int - 5 + 7) % 7);
  SELECT user_id INTO v_uid FROM users WHERE email = p_hmod_email;
  INSERT INTO hmod_rotor (week_start_date, hmod_user_id) VALUES (v_week, v_uid)
  ON CONFLICT (week_start_date) DO UPDATE SET hmod_user_id = EXCLUDED.hmod_user_id;
  RETURN v_week;
END;
$$;

-- Clear the HMOD-on-duty for the week containing p_date (terminal-fallback case).
CREATE OR REPLACE FUNCTION ft_rotor_clear(p_date date)
RETURNS date LANGUAGE plpgsql AS $$
DECLARE v_week date;
BEGIN
  v_week := p_date - ((extract(isodow FROM p_date)::int - 5 + 7) % 7);
  DELETE FROM hmod_rotor WHERE week_start_date = v_week;
  RETURN v_week;
END;
$$;

-- Add ONE extra present SW (the p_rank-th @upenn SW by email, 1-based) over a
-- sub-span, WITHOUT clearing existing seats. Used to grant a source a spare for
-- only part of a gap (e.g. a single sparable block). No-op if already seated.
CREATE OR REPLACE FUNCTION ft_add_worker(p_house text, p_date date, p_t0 time, p_t1 time, p_rank integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_user uuid; n integer;
BEGIN
  SELECT u.user_id INTO v_user FROM users u
   WHERE u.home_house_id = p_house AND u.email LIKE '%@upenn.edu'
     AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.user_id AND r.role = 'sw')
   ORDER BY u.email OFFSET (p_rank - 1) LIMIT 1;

  INSERT INTO shift_block_assignments (block_id, user_id, status, vacancy_origin)
  SELECT b.block_id, v_user, 'scheduled', 'none'
    FROM shift_blocks b
   WHERE b.house_id = p_house
     AND (b.block_start_at AT TIME ZONE 'America/New_York')::date = p_date
     AND (b.block_start_at AT TIME ZONE 'America/New_York')::time >= p_t0
     AND (b.block_start_at AT TIME ZONE 'America/New_York')::time <  p_t1
     AND NOT EXISTS (
       SELECT 1 FROM shift_block_assignments a2
        WHERE a2.block_id = b.block_id AND a2.user_id = v_user);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
