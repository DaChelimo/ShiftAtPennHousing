-- Desk Assistant v1 — Phase B2: scope-filtered vector retrieval.
--
-- match_kb_chunks is the ONE place retrieval happens. It applies the scoping
-- matrix (da_can_read_item, Phase A) inside the query so an out-of-scope chunk can
-- never reach generation, and returns cosine similarity in [0,1] for the caller's
-- grounded-or-defer decision (packages/core selectContext / the da-ask mirror).
--
-- SECURITY: SECURITY DEFINER + EXECUTE granted to service_role ONLY. The caller
-- (da-ask EF, running as service_role) passes the AUTHENTICATED user's id as
-- p_user_id; the function scopes to THAT user. It is deliberately NOT granted to
-- `authenticated` — a client calling it with someone else's p_user_id would be the
-- confused-deputy shape flagged in the 2026-07-07 audit. RLS on kb_chunks remains
-- the direct-read guard.

CREATE OR REPLACE FUNCTION match_kb_chunks(
  p_user_id         uuid,
  p_query_embedding vector(1024),
  p_top_k           int DEFAULT 24
)
RETURNS TABLE (
  chunk_id      uuid,
  document_id   uuid,
  content       text,
  source_ref    text,
  house_scope   text,
  sensitivity   da_sensitivity_enum,
  allowed_roles text[],
  similarity    double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.chunk_id,
    c.document_id,
    c.content,
    d.source_ref,
    c.house_scope,
    c.sensitivity,
    c.allowed_roles,
    1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM kb_chunks c
  JOIN kb_documents d ON d.document_id = c.document_id
  WHERE c.embedding IS NOT NULL
    AND da_can_read_item(p_user_id, c.house_scope, c.sensitivity, c.allowed_roles)
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT GREATEST(p_top_k, 1);
$$;

REVOKE ALL ON FUNCTION match_kb_chunks(uuid, vector, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_kb_chunks(uuid, vector, int) TO service_role;
