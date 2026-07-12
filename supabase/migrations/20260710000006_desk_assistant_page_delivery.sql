-- Desk Assistant v1 — Phase F0: critical-alert page delivery (BUILD_PLAN §4a).
--
-- An additive notification severity layered on the EXISTING delivery machinery; it
-- does NOT touch any staffing notification. A page delivered to the resolved on-duty
-- contact arrives as a critical alert: undismissable / respond-only, a unique sound,
-- and it re-notifies until responded. This table tracks each delivery attempt and its
-- response; the presentation/degrade decision is pure logic (packages/core delivery.ts)
-- and the actual push extends dispatch-push.

CREATE TABLE da_page_deliveries (
  delivery_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id          uuid NOT NULL REFERENCES da_page_drafts (draft_id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  severity          text NOT NULL DEFAULT 'critical' CHECK (severity = 'critical'),
  adapter           text NOT NULL CHECK (adapter IN ('app_notification', 'legacy_pager')),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'responded')),
  reminder_count    int  NOT NULL DEFAULT 0,
  next_reminder_at  timestamptz,      -- when to re-notify if still unanswered
  delivered_at      timestamptz,
  responded_at      timestamptz,
  response          text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX da_page_deliveries_recipient_idx ON da_page_deliveries (recipient_user_id);
-- Drives the re-notification sweep: unanswered deliveries whose reminder is due.
CREATE INDEX da_page_deliveries_pending_idx ON da_page_deliveries (next_reminder_at)
  WHERE status <> 'responded';

ALTER TABLE da_page_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service-role bypass" ON da_page_deliveries
  TO service_role USING (true) WITH CHECK (true);

-- The recipient may read their own deliveries and mark them responded.
CREATE POLICY "recipient reads own deliveries" ON da_page_deliveries
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE POLICY "recipient responds to own deliveries" ON da_page_deliveries
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

-- The page author may read the delivery status of their own page.
CREATE POLICY "author reads page deliveries" ON da_page_deliveries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM da_page_drafts d
      WHERE d.draft_id = da_page_deliveries.draft_id
        AND d.author_user_id = auth.uid()
    )
  );
