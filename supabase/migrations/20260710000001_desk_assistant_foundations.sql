-- Desk Assistant v1 — Phase A: foundations.
--
-- Purely additive (V1_SCOPE §2). Nothing here touches the staffing engine
-- (float / claim / swap / pickup / coverage / notifications). It creates the
-- knowledge-base + conversation substrate the assistant retrieves and generates
-- over, with role/house/sensitivity scoping enforced in RLS at the same time.
--
-- Vector dimension is Voyage AI voyage-3 (1024). If the embeddings provider ever
-- changes, this dimension + packages/core's EMBEDDING_DIM constant change together
-- and the corpus is re-embedded; no structural rework.
--
-- The role/house scoping enforced by da_can_read_item() below is a PLACEHOLDER
-- matrix (V1_SCOPE §10.5). The real scoping matrix replaces the body of that one
-- function + the mirrored predicate in packages/core; the table shapes do not change.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Enums (cross-phase; sensitivity + source type are shared vocabulary)
-- ---------------------------------------------------------------------------

-- Sensitivity tier of a knowledge item (V1_SCOPE §6.3). Note: private /
-- disciplinary incident content is NEVER indexed at all (§7.2) — it lives only in
-- kb_incidents_raw (Phase D), so there is deliberately no "private" tier here.
CREATE TYPE da_sensitivity_enum AS ENUM ('general', 'internal', 'restricted');

-- Provenance of an indexed document, used for citations ("per the summer binder").
CREATE TYPE da_source_type_enum AS ENUM (
  'hm_guide',
  'house_binder',
  'summer_binder',
  'incident_lesson',  -- de-identified lesson from the §7.2 redaction pipeline
  'fixture'           -- synthetic corpus used to exercise the pipeline pre-content
);

-- ---------------------------------------------------------------------------
-- kb_documents — one row per ingested source document
-- ---------------------------------------------------------------------------
-- house_scope NULL = shared rule corpus (applies to all 13 houses). A non-NULL
-- house_scope is the per-house overlay (V1_SCOPE §6.2) — perimeter doors, key
-- retrieval, access specifics. allowed_roles NULL/empty = every role may retrieve.
CREATE TABLE kb_documents (
  document_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  source_type   da_source_type_enum NOT NULL,
  source_ref    text NOT NULL,          -- human citation label, e.g. "Harnwell summer binder, keys section"
  house_scope   text REFERENCES houses (id),
  sensitivity   da_sensitivity_enum NOT NULL DEFAULT 'general',
  allowed_roles text[] NOT NULL DEFAULT '{}',
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX kb_documents_house_scope_idx ON kb_documents (house_scope);
CREATE INDEX kb_documents_source_type_idx ON kb_documents (source_type);

-- ---------------------------------------------------------------------------
-- kb_chunks — chunked + embedded text; the retrievable index
-- ---------------------------------------------------------------------------
-- Scope columns are denormalized from the parent document so retrieval can filter
-- (and RLS can gate) without a join. embedding is voyage-3 (1024-dim).
CREATE TABLE kb_chunks (
  chunk_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES kb_documents (document_id) ON DELETE CASCADE,
  chunk_index   int  NOT NULL,
  content       text NOT NULL,
  embedding     vector(1024),
  house_scope   text REFERENCES houses (id),
  sensitivity   da_sensitivity_enum NOT NULL DEFAULT 'general',
  allowed_roles text[] NOT NULL DEFAULT '{}',
  token_count   int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_chunks_document_index_unique UNIQUE (document_id, chunk_index)
);

-- Cosine-distance ANN index (HNSW). Built now; empty until ingestion runs.
CREATE INDEX kb_chunks_embedding_idx
  ON kb_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX kb_chunks_scope_idx ON kb_chunks (house_scope, sensitivity);

-- ---------------------------------------------------------------------------
-- da_conversations / da_messages — the chat surface's persistence
-- ---------------------------------------------------------------------------
CREATE TABLE da_conversations (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  house_id        text NOT NULL REFERENCES houses (id),
  surface         text NOT NULL DEFAULT 'web',  -- web | desk | mobile
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX da_conversations_user_idx ON da_conversations (user_id);

CREATE TABLE da_messages (
  message_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES da_conversations (conversation_id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         text NOT NULL,
  citations       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{chunk_id, source_ref, document_id}]
  deferred        boolean NOT NULL DEFAULT false,       -- true when the assistant declined for lack of a grounded source
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX da_messages_conversation_idx ON da_messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- da_can_read_item — PLACEHOLDER scoping matrix (V1_SCOPE §10.5 seam)
-- ---------------------------------------------------------------------------
-- Encodes the role/house/sensitivity read gate used by kb RLS. This is the single
-- place the real scoping matrix drops into. Mirrored by canReadItem() in
-- packages/core/src/desk-assistant/scope.ts (kept in sync by test).
CREATE OR REPLACE FUNCTION da_can_read_item(
  check_user_id   uuid,
  p_house_scope   text,
  p_sensitivity   da_sensitivity_enum,
  p_allowed_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- house gate: shared corpus (NULL) is universal; an overlay is readable by the
    -- home-house worker, that house's HM/BM, any RSM (cross-house read), or admin.
    (
      p_house_scope IS NULL
      OR EXISTS (
        SELECT 1 FROM users u
        WHERE u.user_id = check_user_id AND u.home_house_id = p_house_scope
      )
      OR user_has_house_admin_role(check_user_id, p_house_scope)
      OR user_is_rsm(check_user_id)
      OR user_is_admin(check_user_id)
    )
    -- sensitivity gate (placeholder ranks): general = all; internal = any active
    -- staff user; restricted = admin or any house-admin (hm/bm).
    AND (
      p_sensitivity = 'general'
      OR (
        p_sensitivity = 'internal'
        AND EXISTS (SELECT 1 FROM users u WHERE u.user_id = check_user_id AND u.is_active)
      )
      OR (
        p_sensitivity = 'restricted'
        AND (
          user_is_admin(check_user_id)
          OR EXISTS (
            SELECT 1 FROM user_roles r
            WHERE r.user_id = check_user_id AND r.role IN ('hm', 'bm')
          )
        )
      )
    )
    -- role gate: empty allowed_roles = every role; otherwise the user must hold one.
    AND (
      p_allowed_roles = '{}'
      OR EXISTS (
        SELECT 1 FROM user_roles r
        WHERE r.user_id = check_user_id AND r.role::text = ANY (p_allowed_roles)
      )
    );
$$;

REVOKE ALL ON FUNCTION da_can_read_item(uuid, text, da_sensitivity_enum, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION da_can_read_item(uuid, text, da_sensitivity_enum, text[])
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS — service-role bypass on every table + scoped authenticated read
-- ---------------------------------------------------------------------------

ALTER TABLE kb_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_chunks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE da_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE da_messages     ENABLE ROW LEVEL SECURITY;

-- service_role bypass (Edge Functions / ingestion / orchestration)
CREATE POLICY "service-role bypass" ON kb_documents
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service-role bypass" ON kb_chunks
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service-role bypass" ON da_conversations
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service-role bypass" ON da_messages
  TO service_role USING (true) WITH CHECK (true);

-- Knowledge base: authenticated read is scope-gated (defense in depth; the
-- retrieval EF already filters by scope in-query, but a direct client read is safe).
CREATE POLICY "scoped read" ON kb_documents
  FOR SELECT TO authenticated
  USING (da_can_read_item(auth.uid(), house_scope, sensitivity, allowed_roles));

CREATE POLICY "scoped read" ON kb_chunks
  FOR SELECT TO authenticated
  USING (da_can_read_item(auth.uid(), house_scope, sensitivity, allowed_roles));

-- Conversations + messages: a worker reads only their own conversations.
CREATE POLICY "own conversations" ON da_conversations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "own conversations insert" ON da_conversations
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own messages" ON da_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM da_conversations c
      WHERE c.conversation_id = da_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );
