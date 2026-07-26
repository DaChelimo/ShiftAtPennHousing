-- Migration: content-addressed embedding cache for the knowledge-base intake
-- (cost audit F-16).
--
-- The approve path calls voyageEmbed() on ALL chunks of a document every time, with no
-- dedupe guard: grepping apps/web/lib/actions/kbIntake.ts for content_hash / contentHash
-- / unchanged / existing finds nothing (the one `already` match is about whether a
-- PROPOSAL exists, not whether CONTENT changed). Re-approving a large document re-pays
-- the full embedding bill, and two documents that share boilerplate pay for it twice.
--
-- Severity is genuinely Low -- approval is an explicit admin step, so this cannot run in
-- a loop, and voyage-3 is $0.06/M input tokens, so today's absolute number is cents. It
-- is fixed anyway because the fix is small and the guard is the kind of thing that is
-- much harder to add once the corpus is large.
--
-- Cache key is (content_hash, model). Embeddings are deterministic for a given input and
-- model, so a hit is exactly the value the API would have returned -- this changes cost,
-- never results. Keying on the model matters: a future model swap must not serve
-- voyage-3 vectors to a voyage-4 index. There is no expiry, because an entry cannot go
-- stale; a model change simply produces a different key.
--
-- Deliberately NOT reusing kb_chunks as the cache. Chunks are deleted with their
-- document, carry scope/sensitivity/validity metadata this lookup has no business
-- reading, and are RLS-scoped per reader. This table is a pure content-addressed store:
-- service-role only, no user data, no scope.

CREATE TABLE IF NOT EXISTS kb_embedding_cache (
  content_hash text        NOT NULL,
  model        text        NOT NULL,
  embedding    vector(1024) NOT NULL,
  token_count  integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_hit_at  timestamptz,
  hit_count    integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (content_hash, model)
);

COMMENT ON TABLE kb_embedding_cache IS
  'Content-addressed embedding cache (cost audit F-16). Key is (sha256 of the exact chunk '
  'text, embedding model). Embeddings are deterministic per (input, model), so a hit is '
  'byte-identical to what the API would return: this saves spend without changing '
  'results. No expiry -- entries cannot go stale, and a model change yields a new key.';

ALTER TABLE kb_embedding_cache ENABLE ROW LEVEL SECURITY;

-- Service role only. This holds no user data and no house scope, and nothing outside the
-- intake pipeline has any reason to read it.
DROP POLICY IF EXISTS "service-role bypass" ON kb_embedding_cache;
CREATE POLICY "service-role bypass" ON kb_embedding_cache
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Record a hit. Best-effort accounting so an operator can see whether the cache is
-- earning its keep; never on the critical path of a miss.
CREATE OR REPLACE FUNCTION touch_kb_embedding_cache(
  p_content_hashes text[],
  p_model text,
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_touched integer := 0;
BEGIN
  UPDATE kb_embedding_cache
  SET hit_count = hit_count + 1,
      last_hit_at = p_now
  WHERE model = p_model
    AND content_hash = ANY (p_content_hashes);
  GET DIAGNOSTICS v_touched = ROW_COUNT;
  RETURN v_touched;
END;
$$;

REVOKE ALL ON FUNCTION touch_kb_embedding_cache(text[], text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION touch_kb_embedding_cache(text[], text, timestamptz) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS touch_kb_embedding_cache(text[], text, timestamptz);
-- DROP TABLE IF EXISTS kb_embedding_cache;
