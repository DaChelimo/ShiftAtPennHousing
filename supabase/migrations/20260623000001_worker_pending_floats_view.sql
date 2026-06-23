-- ---------------------------------------------------------------------------
-- worker_pending_floats — the authenticated worker's PENDING float assignments,
-- one row per float, with the destination house + the float WINDOW (start AND
-- end) aggregated from the destination blocks.
--
-- Why a dedicated view: the My-Shifts float-request carousel and the ack hero
-- must resolve the EXACT float window (e.g. 18:00–20:00) and house. The previous
-- mobile path derived this by matching float_assignments.destination_assignment_ids
-- against worker_my_shifts — but that read is capped by PostgREST's db-max-rows
-- (1000). A worker holding a full semester of 30-minute blocks (thousands of rows)
-- has the late-inserted float blocks truncated out, so the lookup returned NULL and
-- the app fell back to a demo float (the "wrong time" bug). This view is bounded to
-- the worker's handful of pending floats, so it is immune to that cap.
--
-- security_invoker so RLS applies AS THE WORKER:
--   * float_assignments own-row SELECT (user_id = auth.uid()) scopes fa to the worker
--   * the destination blocks are the worker's own rows (user_id = worker) → readable
--     under shift_block_assignments' own-assignment SELECT policy
--   * shift_blocks / houses are authenticated-readable
-- so the view naturally returns only the authed worker's pending floats. The
-- user_id column is exposed so the client can also filter eq(user_id) for parity
-- with the other worker views.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW worker_pending_floats
WITH (security_invoker = true) AS
SELECT
  fa.float_id,
  fa.user_id,
  sb.house_id                                     AS destination_house_id,
  h.name                                          AS destination_house_name,
  min(sb.block_start_at)                          AS float_start,
  max(sb.block_start_at) + interval '30 minutes'  AS float_end,
  count(*)                                        AS block_count,
  fa.created_at
FROM float_assignments fa
JOIN shift_block_assignments sba
  ON sba.assignment_id = ANY (fa.destination_assignment_ids)
JOIN shift_blocks sb USING (block_id)
JOIN houses h ON h.id = sb.house_id
WHERE fa.status = 'pending'
GROUP BY fa.float_id, fa.user_id, sb.house_id, h.name, fa.created_at;

GRANT SELECT ON worker_pending_floats TO anon, authenticated, service_role;

-- rollback:
-- DROP VIEW IF EXISTS worker_pending_floats;
