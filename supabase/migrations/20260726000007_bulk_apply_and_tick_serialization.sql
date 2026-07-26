-- Migration: stop the two expensive recurring jobs from ever running twice at once
-- (cost audit F-09 and the overlap risk noted in audit §2.1).
--
-- ===========================================================================
-- OVERLAP -- neither the orchestrator tick nor a season apply had any mutual exclusion.
--
-- The audit's §2.1 note: cron.schedule does NOT prevent a second run from starting while
-- the first is still going. orchestrator-tick is protected from CRON overlap only by
-- accident -- net.http_post is fire-and-forget, so the cron row completes instantly --
-- but the Edge Function invocations it triggers absolutely can overlap, and a tick is on
-- the order of a second or more of DB time. There is no advisory lock, no in-flight
-- marker, and no orchestrator_health.last_tick_at guard anywhere in the function.
--
-- Correctness was never the problem: step claims go through block_step_status upserts
-- and FOR UPDATE RPCs, so two concurrent ticks cannot double-fire a step. THE COST IS
-- DUPLICATED though -- both ticks scan, both resolve profiles, both read step status.
-- The same is true, far more expensively, of two concurrent season applies.
--
-- pg_try_advisory_xact_lock is the right tool: it is non-blocking (a second caller
-- returns immediately rather than queueing up behind the first, which is what turns an
-- overlap into a pile-up), and it is transaction-scoped, so the lock is released on
-- commit, rollback, or a dropped connection. No leaked lock is possible, which matters
-- because a lock leaked by a crashed Edge Function would silently stop all escalation.
--
-- ===========================================================================
-- F-09 -- why the row-by-row bulk writes are NOT rewritten set-based here.
--
-- The audit ranks F-09 last of the real findings (rank 16 of 17) at "⚠️⚠️ High" invariant
-- risk, and says so itself: "F-02's debounce ... caps the follow-on refetch cost
-- regardless of how many rows a bulk write touches -- fix that first and this finding
-- drops to Medium on its own." That debounce has shipped (500 ms + conflate, in
-- WorkerShiftsRepository), so the expensive half -- every connected client running a
-- ~2.7 s refetch per delivered Realtime message, with no coalescing -- is already capped
-- at one refetch per client per burst.
--
-- The per-block UPDATEs themselves were investigated and deliberately left alone. They
-- CANNOT simply be deferred and flushed as one set-based statement, and the reason is
-- specific rather than a matter of taste: enforce_block_occupied_headcount
-- (20260702000005) is a trigger that reads shift_blocks.required_headcount, and the seat
-- INSERTs happen inside the same loop iteration as the headcount UPDATE. Deferring the
-- UPDATE past the INSERT makes the trigger evaluate against the OLD headcount and reject
-- the insert. The ordering is load-bearing.
--
-- Layered on that, the headcount-decrease cut order (external floaters first, then the
-- shorter shift, then assignment_id) is specified behaviour with pgTAP coverage in
-- supabase/tests/apply-compiled-season.sql, and the trigger is deliberately
-- grandfathering-aware. Rewriting all of it set-based to save compute on an admin-gated
-- operation that runs a handful of times a season is a bad trade, and this note exists so
-- the next person does not re-derive that conclusion from scratch.
--
-- What IS fixed here is the part that is pure duplicated cost with no invariant exposure:
-- two applies (or an apply racing its own dry-run preview) can no longer run at once.

-- ---------------------------------------------------------------------------
-- Lock namespace. Arbitrary but fixed constants; recorded here so a future advisory
-- lock does not collide.
--   1 = orchestrator tick
--   2 = compiled-season / config apply
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION try_orchestrator_tick_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_try_advisory_xact_lock(hashtext('shift.orchestrator'), 1);
$$;

REVOKE ALL ON FUNCTION try_orchestrator_tick_lock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION try_orchestrator_tick_lock() TO service_role;

COMMENT ON FUNCTION try_orchestrator_tick_lock() IS
  'Non-blocking, transaction-scoped guard against overlapping orchestrator ticks (audit '
  '§2.1). Correctness never depended on it -- block_step_status upserts and FOR UPDATE '
  'RPCs already prevent double-firing -- but two concurrent ticks duplicated the whole '
  'scan. Returns false if another tick holds it; the caller should skip, not wait.';

-- ---------------------------------------------------------------------------
-- Serialize compiled-season applies.
--
-- Wraps rather than re-implements: the body of apply_compiled_season is long, carries
-- the documented cut order, and is covered by pgTAP. Renaming it and adding a thin
-- guarded front means the invariant-bearing logic is not retyped.
--
-- The DRY RUN deliberately takes the lock too. A preview is a rolled-back subtransaction
-- that does the SAME work as an apply (that is the point -- preview and apply must share
-- identical logic, supabase/AGENTS.md), so an unguarded preview racing a real apply
-- doubles the most expensive operation in the system. Because the lock is
-- transaction-scoped it is released the moment the preview's transaction ends.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('apply_compiled_season(uuid,uuid,jsonb,boolean)') IS NOT NULL
     AND to_regprocedure('apply_compiled_season_unguarded(uuid,uuid,jsonb,boolean)') IS NULL
  THEN
    ALTER FUNCTION apply_compiled_season(uuid, uuid, jsonb, boolean)
      RENAME TO apply_compiled_season_unguarded;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION apply_compiled_season(
  p_calling_user_id uuid,
  p_season_id uuid,
  p_payload jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('shift.orchestrator'), 2) THEN
    -- Surfaced as a normal, actionable outcome rather than an exception: the admin
    -- console shows it as a message and the operator retries. An exception here would
    -- read as a failed apply, which is misleading -- nothing was attempted.
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'apply_in_progress',
      'message', 'Another season apply or preview is already running. Try again in a moment.'
    );
  END IF;

  RETURN apply_compiled_season_unguarded(
    p_calling_user_id, p_season_id, p_payload, p_dry_run
  );
END;
$$;

REVOKE ALL ON FUNCTION apply_compiled_season(uuid, uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_compiled_season(uuid, uuid, jsonb, boolean) TO service_role;

COMMENT ON FUNCTION apply_compiled_season(uuid, uuid, jsonb, boolean) IS
  'Serialized front for apply_compiled_season_unguarded (cost audit F-09). Takes a '
  'non-blocking transaction-scoped advisory lock so two applies -- or an apply racing a '
  'dry-run preview, which costs the same compute by design -- can never run at once. All '
  'reconcile semantics, including the headcount-decrease cut order, live unchanged in '
  'the _unguarded body.';

-- rollback:
-- DROP FUNCTION IF EXISTS apply_compiled_season(uuid, uuid, jsonb, boolean);
-- ALTER FUNCTION apply_compiled_season_unguarded(uuid, uuid, jsonb, boolean)
--   RENAME TO apply_compiled_season;
-- DROP FUNCTION IF EXISTS try_orchestrator_tick_lock();
