-- Desk Assistant v1 — Phase F: AI-assisted page drafting (V1_SCOPE §4.3).
--
-- A drafted page is authored by a worker, reviewed by that worker (structural
-- human-in-the-loop: drafting and sending are separate endpoints), and only then
-- handed off. da_page_drafts holds the draft + its collected critical fields + the
-- resolved recipient. The assistant never sends without an explicit author action
-- and never initiates a staffing assignment.

CREATE TABLE da_page_drafts (
  draft_id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id           uuid REFERENCES da_conversations (conversation_id) ON DELETE SET NULL,
  author_user_id            uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  house_id                  text NOT NULL REFERENCES houses (id),
  issue_type                text NOT NULL,
  fields                    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- collected critical fields
  missing_fields            text[] NOT NULL DEFAULT '{}',          -- still-needed field keys
  body                      text,                                  -- assembled page text (once complete)
  resolved_recipient_user_id uuid REFERENCES users (user_id),
  resolved_tier             text,
  handoff_adapter           text NOT NULL DEFAULT 'app_notification'
    CHECK (handoff_adapter IN ('app_notification', 'legacy_pager')),
  status                    text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'responded', 'cancelled')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX da_page_drafts_author_idx ON da_page_drafts (author_user_id);
CREATE INDEX da_page_drafts_recipient_idx ON da_page_drafts (resolved_recipient_user_id) WHERE status = 'sent';

ALTER TABLE da_page_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON da_page_drafts
  TO service_role USING (true) WITH CHECK (true);

-- Author has full control of their own drafts (create, edit, send, cancel).
CREATE POLICY "author manages own drafts" ON da_page_drafts
  FOR ALL TO authenticated
  USING (author_user_id = auth.uid())
  WITH CHECK (author_user_id = auth.uid());

-- The resolved recipient may read a page once it has been sent to them.
CREATE POLICY "recipient reads sent page" ON da_page_drafts
  FOR SELECT TO authenticated
  USING (status IN ('sent', 'responded') AND resolved_recipient_user_id = auth.uid());
