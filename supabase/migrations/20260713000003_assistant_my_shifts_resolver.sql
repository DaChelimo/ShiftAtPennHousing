-- Desk Assistant v1 — personal-schedule resolver for the LLM tool.
--
-- assistant_my_shifts backs the `get_my_shifts` tool the da-ask EF exposes to Claude
-- for first-person schedule questions ("what's my next shift", "am I working this
-- weekend", "how many hours do I have this week"). Before this, such questions had no
-- data path: they classified as durable knowledge, retrieved nothing, and deferred to
-- a human ("I do not have a documented source for that").
--
-- It reads the existing worker_my_shifts read-model view (scheduled / claimed /
-- floated-in / pending / dropped-still-open) for ONE user over a NY-local date range,
-- and COALESCES the 30-minute blocks into contiguous shift spans with computed hours.
-- Coalescing in SQL (not the LLM) means Claude never does block arithmetic and cannot
-- miscount hours. Contiguity is exact timestamptz adjacency (prev end = next start),
-- so it is DST-safe (no wall-clock interval math; project invariant #6). A gap or a
-- change of house/kind starts a new span.
--
-- SECURITY: SECURITY DEFINER + EXECUTE granted to service_role ONLY, exactly like
-- match_kb_chunks. The caller (da-ask EF, running as service_role) passes the
-- AUTHENTICATED user's id as p_user_id; the function scopes to THAT user. It is
-- deliberately NOT granted to `authenticated` — a client calling it with someone
-- else's p_user_id would be the confused-deputy shape flagged in the 2026-07-07 audit.
-- The tool's user_id is bound server-side from the verified bearer token and is never
-- a model-supplied parameter.

CREATE OR REPLACE FUNCTION assistant_my_shifts(
  p_user_id uuid,
  p_from    date,
  p_to      date
)
RETURNS TABLE (
  house_id    text,
  house_name  text,
  start_at    timestamptz,
  end_at      timestamptz,
  kind        text,
  cross_house boolean,
  break_shift boolean,
  block_count int,
  hours       numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      m.house_id,
      m.house_name,
      m.start_at,
      m.end_at,
      m.kind,
      m.cross_house,
      m.break_shift
    FROM worker_my_shifts m
    WHERE m.user_id = p_user_id
      AND (m.start_at AT TIME ZONE 'America/New_York')::date BETWEEN p_from AND p_to
  ),
  flagged AS (
    -- A new island starts wherever this block's start is NOT exactly the previous
    -- block's end within the same house + kind (gaps and house/kind changes split).
    SELECT
      b.*,
      CASE
        WHEN LAG(b.end_at) OVER (
               PARTITION BY b.house_id, b.kind ORDER BY b.start_at
             ) = b.start_at
        THEN 0 ELSE 1
      END AS is_new_island
    FROM base b
  ),
  islanded AS (
    SELECT
      f.*,
      SUM(f.is_new_island) OVER (
        PARTITION BY f.house_id, f.kind ORDER BY f.start_at
        ROWS UNBOUNDED PRECEDING
      ) AS grp
    FROM flagged f
  )
  SELECT
    i.house_id,
    i.house_name,
    MIN(i.start_at)                    AS start_at,
    MAX(i.end_at)                      AS end_at,
    i.kind,
    bool_or(i.cross_house)             AS cross_house,
    bool_or(i.break_shift)             AS break_shift,
    COUNT(*)::int                      AS block_count,
    (COUNT(*) * 0.5)::numeric          AS hours
  FROM islanded i
  GROUP BY i.house_id, i.house_name, i.kind, i.grp
  ORDER BY MIN(i.start_at);
$$;

REVOKE ALL ON FUNCTION assistant_my_shifts(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assistant_my_shifts(uuid, date, date) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS assistant_my_shifts(uuid, date, date);
