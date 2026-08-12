-- Migration: restore the partial-headcount-decrease branch of reconcile_config_blocks
-- that 20260801000002_manager_directed_float.sql silently dropped.
--
-- 20260801000002 redefined reconcile_config_blocks to add the B1 manual_float exclusion
-- (a manually-minted float destination block must never be swept by season/break
-- reconciliation), but in doing so it replaced the function's full body with a much
-- smaller one that only handles v_target = 0 (house closes) and v_target >
-- required_headcount (increase). The 0 < v_target < required_headcount case (a partial
-- decrease) fell through both branches and did nothing: no excess-occupant cancellation,
-- no cut order, no cancellation notifications, and no float-voiding on a cut seat. It
-- also dropped the "un-void a block a prior apply had voided, now that the house is open
-- again" branch. This restores the full body from 20260709000004_break_compiler_apply.sql
-- (itself unchanged since 20260709000003_season_downsize_cancel_excess.sql for the cut
-- order), with ONLY the B1 origin = 'generated' predicate carried forward from
-- 20260801000002. The return shape reverts to the richer one this body has always
-- produced (blocks_generated/blocks_voided/seats_added/seats_removed/
-- assignments_cancelled/floats_voided/affected_workers). apps/web/lib/actions/
-- operatingSeasons.ts and SeasonEditor.tsx are updated in this same commit to match;
-- apps/web/lib/actions/breaks.ts already expected this shape (it had silently degraded
-- to reporting zero impact rather than crashing, since none of the fields it read existed
-- on the smaller shape).
--
-- Every occupancy write below is bulk admin config reconciliation (season/break apply),
-- not a per-seat user action racing another per-seat user action: apply_compiled_season
-- and apply_compiled_break are serialized against each other and the orchestrator tick by
-- a transaction-scoped advisory lock (20260726000007_bulk_apply_and_tick_serialization.sql
-- notes the per-block UPDATEs in this exact reconcile engine were investigated and
-- deliberately left unpredicated for that reason). Each write below is marked
-- seat-write-allow at the point it happens, carried forward unchanged from
-- 20260709000004/20260709000003.

CREATE OR REPLACE FUNCTION reconcile_config_blocks(p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now         timestamptz := app_now();
  v_blk         record;
  v_target      integer;
  v_current     integer;
  v_seat_gap    integer;
  v_vacant_removable integer;
  v_occupied_now integer;
  v_victim_ids  uuid[];
  v_gen         record;
  c_blocks_generated integer := 0;
  c_blocks_voided integer := 0;
  c_seats_added integer := 0;
  c_seats_removed integer := 0;
  c_assignments_cancelled integer := 0;
  c_floats_voided integer := 0;
  c_affected jsonb := '[]'::jsonb;
  c_affected_cap constant integer := 60;
  v_occupied text[] := ARRAY['scheduled', 'claimed', 'floated_in', 'pending_float_in'];
BEGIN
  -- Generate any missing blocks for newly-open houses/dates (idempotent; future-only count).
  SELECT * INTO v_gen FROM generate_blocks_for_range(p_start, p_end);
  c_blocks_generated := COALESCE(v_gen.blocks_inserted, 0);

  -- Reconcile EXISTING future blocks in range against the new config.
  FOR v_blk IN
    SELECT sb.block_id, sb.house_id, sb.block_start_at, sb.required_headcount, sb.voided_at
    FROM shift_blocks sb
    WHERE sb.block_start_at > v_now
      AND (sb.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN p_start AND p_end
      -- Harnwell pilot (workstream B1): a manually-minted float destination is not
      -- subject to season/break reconciliation. It has no staffing_patterns row (its
      -- house is dark), so season_target_headcount would read 0 and void it out from
      -- under an in-progress float. It is created and retired only by the manager-float
      -- RPCs, never by the season/break compiler.
      AND sb.origin = 'generated'
  LOOP
    v_target := season_target_headcount(v_blk.house_id, v_blk.block_start_at);

    IF v_target = 0 THEN
      -- House closed (or block now outside desk hours) -> VOID this future block.
      IF v_blk.voided_at IS NULL THEN
        INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
        SELECT a.user_id, 'personal_shift', v_now,
               jsonb_build_object('kind', 'shift_cancelled_config',
                                  'house_id', v_blk.house_id, 'block_start_at', v_blk.block_start_at)
        FROM shift_block_assignments a
        WHERE a.block_id = v_blk.block_id
          AND a.user_id IS NOT NULL
          AND a.status = ANY (v_occupied::shift_status_enum[]);
        GET DIAGNOSTICS v_seat_gap = ROW_COUNT;
        c_assignments_cancelled := c_assignments_cancelled + v_seat_gap;

        IF v_seat_gap > 0 AND jsonb_array_length(c_affected) < c_affected_cap THEN
          c_affected := c_affected || COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                     'house', h.name, 'worker', u.name,
                     'when', to_char(v_blk.block_start_at AT TIME ZONE 'America/New_York', 'Mon DD, HH24:MI'),
                     'kind', 'shift'))
            FROM shift_block_assignments a
            JOIN users u  ON u.user_id = a.user_id
            JOIN houses h ON h.id = v_blk.house_id
            WHERE a.block_id = v_blk.block_id
              AND a.user_id IS NOT NULL
              AND a.status = ANY (v_occupied::shift_status_enum[])
          ), '[]'::jsonb);
        END IF;

        IF jsonb_array_length(c_affected) < c_affected_cap THEN
          c_affected := c_affected || COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                     'house', h.name, 'worker', u.name,
                     'when', to_char(v_blk.block_start_at AT TIME ZONE 'America/New_York', 'Mon DD, HH24:MI'),
                     'kind', 'float'))
            FROM float_assignments f
            JOIN users u  ON u.user_id = f.user_id
            JOIN houses h ON h.id = v_blk.house_id
            WHERE f.status IN ('pending', 'acknowledged')
              AND f.destination_assignment_ids && (
                SELECT array_agg(assignment_id) FROM shift_block_assignments WHERE block_id = v_blk.block_id
              )
          ), '[]'::jsonb);
        END IF;

        WITH blk_assignments AS (
          SELECT array_agg(assignment_id) AS ids
          FROM shift_block_assignments WHERE block_id = v_blk.block_id
        ),
        voided AS (
          UPDATE float_assignments f
          SET status = 'voided'
          FROM blk_assignments b
          WHERE f.status IN ('pending', 'acknowledged')
            AND f.destination_assignment_ids && b.ids
          RETURNING f.user_id
        ),
        notif AS (
          INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
          SELECT user_id, 'personal_shift', v_now,
                 jsonb_build_object('kind', 'float_cancelled_config', 'house_id', v_blk.house_id)
          FROM voided
          RETURNING 1
        )
        SELECT count(*) INTO v_seat_gap FROM voided;
        c_floats_voided := c_floats_voided + v_seat_gap;

        -- seat-write-allow (see header): bulk admin reconcile; the predicate already
        -- names status via v_occupied, kept for parity with the pre-restore body.
        UPDATE shift_block_assignments
        SET status = 'cancelled_config', vacancy_origin = 'none'
        WHERE block_id = v_blk.block_id
          AND status = ANY (v_occupied::shift_status_enum[]);

        DELETE FROM shift_block_assignments
        WHERE block_id = v_blk.block_id AND status = 'vacant';

        UPDATE shift_blocks SET voided_at = v_now WHERE block_id = v_blk.block_id;
        c_blocks_voided := c_blocks_voided + 1;
      END IF;

    ELSE
      -- House open this date. Un-void if a prior apply voided it.
      IF v_blk.voided_at IS NOT NULL THEN
        UPDATE shift_blocks SET voided_at = NULL, required_headcount = v_target
        WHERE block_id = v_blk.block_id;
        v_current := 0;
      ELSE
        v_current := v_blk.required_headcount;
      END IF;

      IF v_target > v_current THEN
        UPDATE shift_blocks SET required_headcount = v_target WHERE block_id = v_blk.block_id;
        SELECT count(*) INTO v_occupied_now
        FROM shift_block_assignments
        WHERE block_id = v_blk.block_id AND status <> 'cancelled_config';
        v_seat_gap := v_target - v_occupied_now;
        IF v_seat_gap > 0 THEN
          INSERT INTO shift_block_assignments (block_id, status, vacancy_origin)
          SELECT v_blk.block_id, 'vacant', 'never_assigned'
          FROM generate_series(1, v_seat_gap);
          c_seats_added := c_seats_added + v_seat_gap;
        END IF;

      ELSIF v_target < v_current THEN
        UPDATE shift_blocks SET required_headcount = v_target WHERE block_id = v_blk.block_id;

        SELECT count(*) INTO v_occupied_now
        FROM shift_block_assignments
        WHERE block_id = v_blk.block_id AND status = ANY (v_occupied::shift_status_enum[]);

        IF v_occupied_now > v_target THEN
          -- More workers hold this now-smaller block than it has seats: cancel the
          -- excess by the cut order (floater -> shorter shift -> assignment_id).
          -- Mirrors apply_compiled_season (20260709000003): config downsize CANCELS
          -- excess, never grandfathers, so no seat is double-booked.
          SELECT array_agg(assignment_id) INTO v_victim_ids
          FROM (
            SELECT a.assignment_id
            FROM shift_block_assignments a
            WHERE a.block_id = v_blk.block_id
              AND a.status = ANY (v_occupied::shift_status_enum[])
            ORDER BY
              (a.status IN ('pending_float_in', 'floated_in')) DESC,
              (SELECT count(*)
                 FROM shift_block_assignments a2
                 JOIN shift_blocks b2 ON b2.block_id = a2.block_id
                WHERE a2.user_id = a.user_id
                  AND b2.house_id = v_blk.house_id
                  AND (b2.block_start_at AT TIME ZONE 'America/New_York')::date
                      = (v_blk.block_start_at AT TIME ZONE 'America/New_York')::date
                  AND a2.status = ANY (v_occupied::shift_status_enum[])) ASC,
              a.assignment_id
            LIMIT (v_occupied_now - v_target)
          ) picked;

          INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
          SELECT a.user_id, 'personal_shift', v_now,
                 jsonb_build_object('kind', 'shift_cancelled_config',
                                    'house_id', v_blk.house_id, 'block_start_at', v_blk.block_start_at)
          FROM shift_block_assignments a
          WHERE a.assignment_id = ANY (v_victim_ids) AND a.user_id IS NOT NULL;
          GET DIAGNOSTICS v_seat_gap = ROW_COUNT;
          c_assignments_cancelled := c_assignments_cancelled + v_seat_gap;

          IF v_seat_gap > 0 AND jsonb_array_length(c_affected) < c_affected_cap THEN
            c_affected := c_affected || COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'house', h.name, 'worker', u.name,
                       'when', to_char(v_blk.block_start_at AT TIME ZONE 'America/New_York', 'Mon DD, HH24:MI'),
                       'kind', 'shift'))
              FROM shift_block_assignments a
              JOIN users u  ON u.user_id = a.user_id
              JOIN houses h ON h.id = v_blk.house_id
              WHERE a.assignment_id = ANY (v_victim_ids) AND a.user_id IS NOT NULL
            ), '[]'::jsonb);
          END IF;

          IF jsonb_array_length(c_affected) < c_affected_cap THEN
            c_affected := c_affected || COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'house', h.name, 'worker', u.name,
                       'when', to_char(v_blk.block_start_at AT TIME ZONE 'America/New_York', 'Mon DD, HH24:MI'),
                       'kind', 'float'))
              FROM float_assignments f
              JOIN users u  ON u.user_id = f.user_id
              JOIN houses h ON h.id = v_blk.house_id
              WHERE f.status IN ('pending', 'acknowledged')
                AND f.destination_assignment_ids && v_victim_ids
            ), '[]'::jsonb);
          END IF;

          WITH voided AS (
            UPDATE float_assignments f
            SET status = 'voided'
            WHERE f.status IN ('pending', 'acknowledged')
              AND f.destination_assignment_ids && v_victim_ids
            RETURNING f.user_id
          ),
          notif AS (
            INSERT INTO notifications (recipient_user_id, type, scheduled_for, payload)
            SELECT user_id, 'personal_shift', v_now,
                   jsonb_build_object('kind', 'float_cancelled_config', 'house_id', v_blk.house_id)
            FROM voided
            RETURNING 1
          )
          SELECT count(*) INTO v_seat_gap FROM voided;
          c_floats_voided := c_floats_voided + v_seat_gap;

          -- seat-write-allow (see header): v_victim_ids is a fixed, already-picked id
          -- list from this same statement-consistent snapshot, not a re-derived
          -- availability check; bulk admin reconcile is serialized at the RPC layer.
          UPDATE shift_block_assignments
          SET status = 'cancelled_config', vacancy_origin = 'none'
          WHERE assignment_id = ANY (v_victim_ids);

          DELETE FROM shift_block_assignments
          WHERE block_id = v_blk.block_id AND status = 'vacant';
          GET DIAGNOSTICS v_seat_gap = ROW_COUNT;
          c_seats_removed := c_seats_removed + v_seat_gap;

        ELSE
          -- Occupied already fits: trim excess vacant seats down to (target - occupied).
          v_vacant_removable := GREATEST(0,
            (SELECT count(*) FROM shift_block_assignments
             WHERE block_id = v_blk.block_id AND status = 'vacant'));
          v_seat_gap := v_vacant_removable - GREATEST(v_target - v_occupied_now, 0);
          IF v_seat_gap > 0 THEN
            DELETE FROM shift_block_assignments
            WHERE ctid IN (
              SELECT ctid FROM shift_block_assignments
              WHERE block_id = v_blk.block_id AND status = 'vacant'
              LIMIT v_seat_gap
            );
            c_seats_removed := c_seats_removed + v_seat_gap;
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'blocks_generated', c_blocks_generated,
    'blocks_voided', c_blocks_voided,
    'seats_added', c_seats_added,
    'seats_removed', c_seats_removed,
    'assignments_cancelled', c_assignments_cancelled,
    'floats_voided', c_floats_voided,
    'affected_workers', c_affected
  );
END;
$$;

-- rollback:
-- (re-apply the smaller body from 20260801000002_manager_directed_float.sql.)
