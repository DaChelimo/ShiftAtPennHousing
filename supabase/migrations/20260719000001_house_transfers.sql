-- Migration: House transfers — season-scoped house membership.
--
-- Feature: an HM/BM (of EITHER the source or the destination house) can transfer
-- a worker from one house to another, effective on a date (defaulting to the next
-- season boundary, or "today" for an immediate move). House membership becomes
-- time-scoped: a worker belongs to a house for a span, and `users.home_house_id`
-- is the maintained "current" value (the membership covering today). All existing
-- live-operation code keeps reading `home_house_id` unchanged; only the two
-- forward-looking surfaces (preferences + upcoming-season builder roster, patched
-- elsewhere) look ahead to a future membership.
--
-- Design (see the chat plan + docs/design):
--   * user_house_memberships is the source of truth + audit trail.
--   * `home_house_id` stays authoritative for every current-season read path.
--   * A future-dated transfer records the membership now, changes nothing live;
--     a daily job flips `home_house_id` + unwinds old-house shifts on the day.
--   * The unwind mirrors fire_worker's proven mechanics (permanent_drop_slot for
--     recurring seats, direct vacate for claimed seats, void floats), SCOPED to
--     the old home house and WITHOUT deactivating the worker.
--
-- Harnwell invariant (AGENTS #1): a transfer INTO Harnwell makes the worker a
-- Harnwell resident (satisfied automatically). A transfer OUT vacates their future
-- Harnwell seats here, so no non-resident is ever left on a Harnwell desk; the
-- ongoing "can't touch Harnwell unless home==Harnwell" rule is already enforced at
-- every write point and needs nothing new.
--
-- No-takeback (AGENTS #3) governs AUTOMATED float revocation; a transfer is a
-- sanctioned manual admin action (like fire_worker), so voiding the worker's
-- floats during the move is permitted.

-- ============================================================
-- 1. Membership table
-- ============================================================
CREATE TABLE user_house_memberships (
  membership_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  house_id       text NOT NULL REFERENCES houses (id),
  effective_from date NOT NULL,
  effective_to   date,                       -- NULL = open-ended (current/indefinite)
  applied_at     timestamptz,                -- when home_house_id was synced to this row
  created_by     uuid REFERENCES users (user_id),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX user_house_memberships_user_idx
  ON user_house_memberships (user_id, effective_from);
CREATE INDEX user_house_memberships_house_idx
  ON user_house_memberships (house_id, effective_from);
CREATE INDEX user_house_memberships_pending_idx
  ON user_house_memberships (effective_from)
  WHERE applied_at IS NULL;

COMMENT ON TABLE user_house_memberships IS
  'Time-scoped house membership + transfer history. users.home_house_id is the '
  'maintained cache of the row covering today (see 20260719000001_house_transfers).';

-- Non-overlap per user (a worker is in exactly one house at a time). Enforced by
-- trigger rather than a gist exclusion so the migration carries no btree_gist
-- dependency. The transfer RPC always closes the current row before inserting the
-- next, so this never false-positives on the legitimate write path.
CREATE OR REPLACE FUNCTION check_membership_no_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_house_memberships m
    WHERE m.user_id = NEW.user_id
      AND m.membership_id <> NEW.membership_id
      AND daterange(m.effective_from, m.effective_to, '[]')
          && daterange(NEW.effective_from, NEW.effective_to, '[]')
  ) THEN
    RAISE EXCEPTION 'user_house_memberships overlap for user %', NEW.user_id
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_house_memberships_no_overlap
  BEFORE INSERT OR UPDATE OF user_id, effective_from, effective_to
  ON user_house_memberships
  FOR EACH ROW EXECUTE FUNCTION check_membership_no_overlap();

-- Backfill: one open-ended, already-applied membership per existing user from
-- their current home house. Effective from a sentinel far past so it covers all
-- history/today.
INSERT INTO user_house_memberships (user_id, house_id, effective_from, effective_to, applied_at)
SELECT user_id, home_house_id, DATE '2000-01-01', NULL, now()
FROM users;

-- ============================================================
-- 2. RLS — read for house admins of either house + the worker; writes are
--    service-role only (all mutation goes through the RPCs below).
-- ============================================================
ALTER TABLE user_house_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_house_memberships_select_self
  ON user_house_memberships FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY user_house_memberships_select_admin
  ON user_house_memberships FOR SELECT
  USING (
    user_has_house_admin_role(auth.uid(), house_id)
    OR user_has_house_admin_role(
         auth.uid(),
         (SELECT home_house_id FROM users u WHERE u.user_id = user_house_memberships.user_id)
       )
  );

-- ============================================================
-- 3. Amend the home_house_id immutability trigger to also permit the transfer
--    path. apply_house_transfer sets a LOCAL flag before its update; the trigger
--    honors it (in addition to the existing service_role bypass). This keeps the
--    "no ad-hoc home_house_id edits" guarantee while letting the sanctioned RPC
--    write it even when it runs from cron (where auth.role() is not service_role).
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_home_house_update_without_admin_override()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.home_house_id IS DISTINCT FROM NEW.home_house_id
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(current_setting('app.house_transfer', true), '') <> '1' THEN
    RAISE EXCEPTION 'home_house_id is immutable except by service-role admin override'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 4. apply_house_transfer — flip home_house_id + unwind old-house obligations.
--    Idempotent (a re-run on an already-applied membership is a no-op). Runs with
--    p_now = the moment of application (immediately for a same-day transfer, or on
--    the effective date via the daily job), so "future old-house shifts" always
--    means "from the application moment onward".
-- ============================================================
CREATE OR REPLACE FUNCTION apply_house_transfer(
  p_membership_id uuid,
  p_now           timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m                     user_house_memberships%ROWTYPE;
  v_old_house             text;
  v_new_house             text;
  v_float                 float_assignments%ROWTYPE;
  v_floats_voided         integer := 0;
  v_recurring_dropped     integer := 0;
  v_non_recurring_vacated integer := 0;
  v_fallback              integer := 0;
  v_slot                  record;
BEGIN
  SELECT * INTO v_m FROM user_house_memberships
  WHERE membership_id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership_not_found';
  END IF;

  -- Idempotent: already applied.
  IF v_m.applied_at IS NOT NULL THEN
    RETURN jsonb_build_object('applied', false, 'already_applied', true);
  END IF;

  v_new_house := v_m.house_id;

  SELECT home_house_id INTO v_old_house
  FROM users WHERE user_id = v_m.user_id
  FOR UPDATE;

  -- Same-house (no real move): just stamp applied, touch nothing.
  IF v_old_house = v_new_house THEN
    UPDATE user_house_memberships SET applied_at = p_now WHERE membership_id = p_membership_id;
    RETURN jsonb_build_object('applied', true, 'no_change', true);
  END IF;

  -- Permit the home_house_id write (see the amended trigger above).
  PERFORM set_config('app.house_transfer', '1', true);
  UPDATE users SET home_house_id = v_new_house WHERE user_id = v_m.user_id;

  -- ---- unwind the worker's OLD-house obligations (mirror fire_worker) ----

  -- (a) Void the worker's live floats. A worker changing home house carries no
  --     float commitment across the move; floats are near-term and re-lookup
  --     re-covers. Reopen destinations, restore + (below) drop sources. This is
  --     the fire_worker float loop, unfiltered by house on purpose: it also
  --     guarantees no voided-out-of-Harnwell worker is left covering Harnwell.
  FOR v_float IN
    SELECT * FROM float_assignments
    WHERE user_id = v_m.user_id
      AND status IN ('pending', 'acknowledged')
    FOR UPDATE
  LOOP
    UPDATE float_assignments
    SET status = 'voided'::float_status_enum
    WHERE float_id = v_float.float_id;

    UPDATE shift_block_assignments
    SET user_id = NULL, status = 'vacant', vacancy_origin = 'temporary_drop',
        is_float = false, source_house_id = NULL, parent_float_id = NULL
    WHERE assignment_id = ANY(v_float.destination_assignment_ids);

    UPDATE block_step_status
    SET status = 'rolled_back', updated_at = p_now
    WHERE block_id IN (
      SELECT block_id FROM shift_block_assignments
      WHERE assignment_id = ANY(v_float.destination_assignment_ids)
    )
      AND step_name IN ('broadcast', 'float_lookup');

    UPDATE shift_block_assignments
    SET user_id = v_float.user_id, status = 'scheduled', vacancy_origin = 'none',
        is_float = false, source_house_id = NULL, parent_float_id = NULL
    WHERE assignment_id = ANY(v_float.source_assignment_ids);

    DELETE FROM shift_block_assignments
    WHERE parent_float_id = v_float.float_id
      AND status = 'vacant'
      AND assignment_id != ALL(v_float.source_assignment_ids)
      AND assignment_id != ALL(v_float.destination_assignment_ids);

    v_floats_voided := v_floats_voided + 1;
  END LOOP;

  -- (b) Recurring drop: every distinct (NY-DOW) among the worker's FUTURE
  --     scheduled seats AT THE OLD HOUSE (incl. just-restored float sources).
  --     In a regular-school-year semester these are recurring template seats, so
  --     permanent_drop_slot reopens them across the semester AND stops re-publish.
  --     Outside a school-year semester (summer / breaks, which are individually
  --     placed and never re-published) permanent_drop_slot raises
  --     'semester_boundary_not_found'; there we fall back to a direct vacate of
  --     this slot's future old-house seats. Either way the seats reopen.
  FOR v_slot IN
    SELECT
      EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York')::int AS day_of_week,
      array_agg(DISTINCT TO_CHAR(sb.block_start_at AT TIME ZONE 'America/New_York', 'HH24:MI')) AS locals
    FROM shift_block_assignments sba
    JOIN shift_blocks sb ON sb.block_id = sba.block_id
    WHERE sba.user_id = v_m.user_id
      AND sba.status = 'scheduled'
      AND sb.house_id = v_old_house
      AND sb.block_start_at > p_now
    GROUP BY EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York')::int
  LOOP
    BEGIN
      v_recurring_dropped := v_recurring_dropped
        + COALESCE(
            (permanent_drop_slot(
              v_m.user_id, v_old_house, v_slot.day_of_week, v_slot.locals, p_now, v_m.created_by
            ) ->> 'affected_count')::integer, 0);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'semester_boundary_not_found' THEN
        RAISE;
      END IF;
      UPDATE shift_block_assignments sba
      SET status = 'vacant', vacancy_origin = 'temporary_drop', user_id = NULL,
          is_cross_house_pickup = false, source_house_id = NULL, parent_float_id = NULL
      FROM shift_blocks sb
      WHERE sba.block_id = sb.block_id
        AND sba.user_id = v_m.user_id
        AND sba.status = 'scheduled'
        AND sb.house_id = v_old_house
        AND sb.block_start_at > p_now
        AND EXTRACT(DOW FROM sb.block_start_at AT TIME ZONE 'America/New_York')::int = v_slot.day_of_week;
      GET DIAGNOSTICS v_fallback = ROW_COUNT;
      v_recurring_dropped := v_recurring_dropped + v_fallback;
    END;
  END LOOP;

  -- (c) Non-recurring vacate: the worker's FUTURE claimed seats at the old house.
  UPDATE shift_block_assignments sba
  SET status = 'vacant', vacancy_origin = 'temporary_drop', user_id = NULL,
      is_cross_house_pickup = false, source_house_id = NULL, parent_float_id = NULL
  FROM shift_blocks sb
  WHERE sba.block_id = sb.block_id
    AND sba.user_id = v_m.user_id
    AND sba.status = 'claimed'
    AND sb.house_id = v_old_house
    AND sb.block_start_at > p_now;

  GET DIAGNOSTICS v_non_recurring_vacated = ROW_COUNT;

  UPDATE user_house_memberships SET applied_at = p_now WHERE membership_id = p_membership_id;

  RETURN jsonb_build_object(
    'applied', true,
    'from_house', v_old_house,
    'to_house', v_new_house,
    'floats_voided', v_floats_voided,
    'recurring_seats_dropped', v_recurring_dropped,
    'non_recurring_vacated', v_non_recurring_vacated
  );
END;
$$;

REVOKE ALL ON FUNCTION apply_house_transfer(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_house_transfer(uuid, timestamptz) TO service_role;

-- ============================================================
-- 4b. membership_house_for_date — the house a worker belongs to ON a given date.
--     This is what the FORWARD-LOOKING surfaces (preferences + the upcoming-season
--     builder roster) use so a scheduled-but-not-yet-applied transfer shows the
--     worker in their DESTINATION house for the upcoming season, while every
--     current-season read path keeps using users.home_house_id. Falls back to the
--     live home_house_id when no membership row covers the date.
-- ============================================================
CREATE OR REPLACE FUNCTION membership_house_for_date(
  p_user_id uuid,
  p_date    date
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT house_id FROM user_house_memberships
     WHERE user_id = p_user_id
       AND effective_from <= p_date
       AND (effective_to IS NULL OR effective_to >= p_date)
     ORDER BY effective_from DESC
     LIMIT 1),
    (SELECT home_house_id FROM users WHERE user_id = p_user_id)
  );
$$;

GRANT EXECUTE ON FUNCTION membership_house_for_date(uuid, date) TO authenticated, service_role;

-- house_roster_as_of — active SWs whose membership covers p_as_of at p_house_id.
-- The upcoming-season builder uses this (as-of the build week) so an incoming
-- transferred worker joins the destination roster on/after their effective date,
-- and drops from the old house's roster for those same weeks.
CREATE OR REPLACE FUNCTION house_roster_as_of(
  p_house_id text,
  p_as_of    date
)
RETURNS TABLE (user_id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.user_id, u.name
  FROM users u
  JOIN user_roles r ON r.user_id = u.user_id AND r.role = 'sw'
  WHERE u.is_active
    AND membership_house_for_date(u.user_id, p_as_of) = p_house_id
  ORDER BY u.name;
$$;

GRANT EXECUTE ON FUNCTION house_roster_as_of(text, date) TO authenticated, service_role;

-- ============================================================
-- 5. transfer_worker — the people-admin entry point. Records the membership
--    (immediately applying it if the effective date is today).
-- ============================================================
CREATE OR REPLACE FUNCTION transfer_worker(
  p_initiator      uuid,
  p_user_id        uuid,
  p_dest_house_id  text,
  p_effective_date date DEFAULT NULL,   -- NULL => next season boundary
  p_note           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user       users%ROWTYPE;
  v_from_house text;
  v_today      date := (app_now() AT TIME ZONE 'America/New_York')::date;
  v_eff        date;
  v_current_id uuid;
  v_new_id     uuid;
  v_apply      jsonb := NULL;
BEGIN
  SELECT * INTO v_user FROM users WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker_not_found';
  END IF;
  IF v_user.is_active = false THEN
    RAISE EXCEPTION 'worker_inactive';
  END IF;

  v_from_house := v_user.home_house_id;

  IF NOT EXISTS (SELECT 1 FROM houses WHERE id = p_dest_house_id) THEN
    RAISE EXCEPTION 'destination_house_not_found';
  END IF;
  IF p_dest_house_id = v_from_house THEN
    RAISE EXCEPTION 'already_in_destination_house';
  END IF;

  -- Authz: HM/BM of EITHER the source OR the destination house (or an admin,
  -- whom user_has_house_admin_role already admits for every house).
  IF NOT (
       user_has_house_admin_role(p_initiator, v_from_house)
    OR user_has_house_admin_role(p_initiator, p_dest_house_id)
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Resolve the effective date. Default = the next season boundary after today
  -- across operating_seasons + scheduling_periods.
  IF p_effective_date IS NULL THEN
    SELECT min(d) INTO v_eff FROM (
      SELECT start_date AS d FROM operating_seasons   WHERE start_date > v_today
      UNION ALL
      SELECT start_date      FROM scheduling_periods  WHERE start_date > v_today
    ) x;
    IF v_eff IS NULL THEN
      RAISE EXCEPTION 'no_upcoming_season'
        USING HINT = 'Pass an explicit effective date; no future season boundary was found.';
    END IF;
  ELSE
    v_eff := p_effective_date;
  END IF;

  IF v_eff < v_today THEN
    RAISE EXCEPTION 'effective_date_in_past';
  END IF;

  -- Supersede any not-yet-applied future transfer for this worker (this call is
  -- authoritative), then reopen the current membership so it can be re-closed at
  -- the new effective date.
  DELETE FROM user_house_memberships
  WHERE user_id = p_user_id AND applied_at IS NULL AND effective_from > v_today;

  -- Self-heal: a worker created after this migration (a later hire, or a fixture)
  -- may have no membership row yet. Seed their current home house so the history
  -- stays coherent.
  IF NOT EXISTS (SELECT 1 FROM user_house_memberships WHERE user_id = p_user_id) THEN
    INSERT INTO user_house_memberships (user_id, house_id, effective_from, effective_to, applied_at)
    VALUES (p_user_id, v_from_house, DATE '2000-01-01', NULL, app_now());
  END IF;

  SELECT membership_id INTO v_current_id
  FROM user_house_memberships
  WHERE user_id = p_user_id
  ORDER BY effective_from DESC
  LIMIT 1;

  UPDATE user_house_memberships
  SET effective_to = CASE WHEN v_eff > effective_from THEN v_eff - 1 ELSE effective_from END
  WHERE membership_id = v_current_id;

  INSERT INTO user_house_memberships
    (user_id, house_id, effective_from, effective_to, created_by, note)
  VALUES (p_user_id, p_dest_house_id, v_eff, NULL, p_initiator, p_note)
  RETURNING membership_id INTO v_new_id;

  -- Immediate move: apply now.
  IF v_eff <= v_today THEN
    v_apply := apply_house_transfer(v_new_id, app_now());
  END IF;

  RETURN jsonb_build_object(
    'transferred', true,
    'membership_id', v_new_id,
    'from_house', v_from_house,
    'to_house', p_dest_house_id,
    'effective_date', v_eff,
    'applied_now', (v_eff <= v_today),
    'apply_result', v_apply
  );
END;
$$;

REVOKE ALL ON FUNCTION transfer_worker(uuid, uuid, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_worker(uuid, uuid, text, date, text) TO service_role;

-- ============================================================
-- 6. apply_due_house_transfers — the daily boundary job. Applies every
--    unapplied membership whose effective date has arrived (in NY), oldest first.
-- ============================================================
CREATE OR REPLACE FUNCTION apply_due_house_transfers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (app_now() AT TIME ZONE 'America/New_York')::date;
  v_id    uuid;
  v_count integer := 0;
BEGIN
  FOR v_id IN
    SELECT membership_id FROM user_house_memberships
    WHERE applied_at IS NULL AND effective_from <= v_today
    ORDER BY effective_from, created_at
  LOOP
    PERFORM apply_house_transfer(v_id, app_now());
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION apply_due_house_transfers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_due_house_transfers() TO service_role;

-- ============================================================
-- 7. Cron — apply due transfers hourly (cheap no-op when nothing is due; hourly
--    bounds the post-midnight delay regardless of the server's clock vs NY).
--    Guarded so the migration still applies where pg_cron is absent.
-- ============================================================
DO $do$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    IF to_regprocedure('cron.unschedule(text)') IS NOT NULL THEN
      BEGIN PERFORM cron.unschedule('apply-house-transfers'); EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    PERFORM cron.schedule(
      'apply-house-transfers',
      '15 * * * *',
      $sql$ SELECT apply_due_house_transfers() $sql$
    );
  END IF;
EXCEPTION WHEN invalid_schema_name OR undefined_function THEN NULL;
END;
$do$;

-- rollback:
-- SELECT cron.unschedule('apply-house-transfers');
-- DROP FUNCTION IF EXISTS apply_due_house_transfers();
-- DROP FUNCTION IF EXISTS transfer_worker(uuid, uuid, text, date, text);
-- DROP FUNCTION IF EXISTS apply_house_transfer(uuid, timestamptz);
-- DROP TABLE IF EXISTS user_house_memberships;
-- (restore prevent_home_house_update_without_admin_override to its 20260527000003 body)
