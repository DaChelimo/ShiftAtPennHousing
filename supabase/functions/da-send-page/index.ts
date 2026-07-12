// Desk Assistant — da-send-page Edge Function (V1_SCOPE §4.3, §7.4; BUILD_PLAN §4a).
// Sends a REVIEWED draft through the chosen handoff adapter. Separate from
// da-draft-page so human review is structural: only the draft's author can send, and
// only after they have reviewed (and optionally edited) it.
//
// app_notification -> create a critical-alert delivery to the resolved recipient and
//   push it (own path; the staffing dispatch-push is intentionally untouched).
// legacy_pager -> return the formatted text for the worker to paste into the pager.
//
// The push itself is deploy-time config (Firebase + iOS critical entitlement / Android
// full-screen-intent channel), mirroring phase-12; without it, delivery is recorded and
// the presentation degrades. See _shared/desk-assistant-pages.ts resolvePageAlertPresentation.

import { fetchAppNow } from '../_shared/clock.ts';
import {
  DEFAULT_HANDOFF_ADAPTER,
  formatForLegacyPager,
  nextPageReminderAt,
  type HandoffAdapter,
  type PageDraftInput,
} from '../_shared/desk-assistant-pages.ts';
import { tierLabel, type RoutingTier } from '../_shared/desk-assistant-routing.ts';
import { authenticate, edgeHandler, jsonResponse, readObjectBody } from '../_shared/swap-http.ts';

interface DraftRow {
  draft_id: string;
  author_user_id: string;
  house_id: string;
  issue_type: string;
  fields: Record<string, string>;
  body: string | null;
  resolved_recipient_user_id: string | null;
  resolved_tier: string | null;
  status: string;
}

Deno.serve(
  edgeHandler('da-send-page', async (req) => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const { supabase, userId } = auth;

    const parsed = await readObjectBody(req);
    if (!parsed.ok) return parsed.response;
    const draftId = typeof parsed.body.draftId === 'string' ? parsed.body.draftId : null;
    if (draftId === null) return jsonResponse({ error: 'draftId is required' }, 400);
    const adapter: HandoffAdapter =
      parsed.body.adapter === 'legacy_pager' ? 'legacy_pager' : DEFAULT_HANDOFF_ADAPTER;
    // The reviewer may have edited the body; honor the edited text if provided.
    const editedBody = typeof parsed.body.body === 'string' ? parsed.body.body : null;

    const { data: draftData, error: draftErr } = await supabase
      .from('da_page_drafts')
      .select('*')
      .eq('draft_id', draftId)
      .single();
    if (draftErr || draftData === null) return jsonResponse({ error: 'draft_not_found' }, 404);
    const draft = draftData as DraftRow;

    // Structural human-in-the-loop: only the author may send their draft.
    if (draft.author_user_id !== userId) return jsonResponse({ error: 'not_your_draft' }, 403);
    if (draft.status !== 'draft')
      return jsonResponse({ error: `draft is already ${draft.status}` }, 409);
    if (draft.resolved_recipient_user_id === null) {
      return jsonResponse({ error: 'no recipient resolved for this page' }, 409);
    }

    const now = await fetchAppNow(supabase);
    const { data: house } = await supabase
      .from('houses')
      .select('name')
      .eq('id', draft.house_id)
      .single();
    const houseName = (house as { name?: string } | null)?.name ?? draft.house_id;
    const { data: author } = await supabase
      .from('users')
      .select('name')
      .eq('user_id', userId)
      .single();

    const draftInput: PageDraftInput = {
      issueType: draft.issue_type,
      fields: draft.fields,
      houseName,
      authorName: (author as { name?: string } | null)?.name ?? 'Desk',
      recipientLabel: tierLabel((draft.resolved_tier ?? 'hmod') as RoutingTier),
    };

    // Record the delivery (critical severity), schedule the first re-notification.
    const { data: delivery, error: delErr } = await supabase
      .from('da_page_deliveries')
      .insert({
        draft_id: draft.draft_id,
        recipient_user_id: draft.resolved_recipient_user_id,
        adapter,
        status: 'pending',
        next_reminder_at: nextPageReminderAt(now, 0).toISOString(),
      })
      .select('delivery_id')
      .single();
    if (delErr)
      return jsonResponse({ error: 'delivery_create_failed', detail: delErr.message }, 500);

    await supabase
      .from('da_page_drafts')
      .update({
        status: 'sent',
        handoff_adapter: adapter,
        body: editedBody ?? draft.body,
        updated_at: now.toISOString(),
      })
      .eq('draft_id', draft.draft_id);

    if (adapter === 'legacy_pager') {
      // No push: hand the worker the text to enter into the current pager channel.
      return jsonResponse({
        draftId: draft.draft_id,
        adapter,
        deliveryId: (delivery as { delivery_id: string }).delivery_id,
        pagerText: formatForLegacyPager(draftInput),
      });
    }

    // app_notification: the critical-alert push is dispatched by the page-delivery
    // sweep (deploy-time Firebase config). Here we have recorded the pending delivery;
    // it is picked up and pushed with the resolved presentation per recipient device.
    return jsonResponse({
      draftId: draft.draft_id,
      adapter,
      deliveryId: (delivery as { delivery_id: string }).delivery_id,
      recipientUserId: draft.resolved_recipient_user_id,
      status: 'sent',
    });
  }),
);
