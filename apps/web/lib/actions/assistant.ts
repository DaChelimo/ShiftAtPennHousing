'use server';

// Desk Assistant — web server actions (V1_SCOPE §4). Thin glue that forwards the
// signed-in user's access token to the da-* Edge Functions (the EFs derive the user
// from the bearer and enforce all scope/guardrails). Mirrors the forceTrigger.ts
// token-forwarding pattern.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';
import { createClient } from '../supabase/server';

export interface Citation {
  documentId: string;
  sourceRef: string;
  chunkIds: string[];
}

export interface RouteInfo {
  matchedTier?: string;
  resolvedTier: string;
  tierLabel?: string;
  userId: string | null;
  contact?: { userId: string; name: string | null; phone: string | null } | null;
}

export interface AskResult {
  conversationId: string;
  messageId: string | null;
  content: string;
  citations: Citation[];
  deferred: boolean;
  route?: RouteInfo | null;
  safety: {
    lifeSafety: string | null;
    access: boolean;
    incidentProbe: boolean;
    leakageBlocked?: boolean;
  };
}

export interface FieldSpec {
  key: string;
  label: string;
  prompt: string;
}

export interface DraftResult {
  draftId: string;
  issueType: string;
  complete: boolean;
  missingFields: FieldSpec[];
  body: string | null;
  recipient: { tier: string; label: string; userId: string | null };
}

export interface SendResult {
  draftId: string;
  adapter: 'app_notification' | 'legacy_pager';
  deliveryId: string;
  pagerText?: string;
  recipientUserId?: string;
  status?: string;
}

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function callEdge<T>(fn: string, body: unknown): Promise<ActionResult<T>> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (token === undefined) return { ok: false, error: 'Your session has expired. Sign in again.' };

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}/${fn}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const detail = typeof json.error === 'string' ? json.error : `request failed (${res.status})`;
      // The assistant EFs return 503 when Voyage/Anthropic keys are unset.
      if (res.status === 503)
        return {
          ok: false,
          error: 'The assistant is not configured yet. Ask an administrator to set the API keys.',
        };
      return { ok: false, error: detail };
    }
    return { ok: true, data: json as T };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not reach the assistant service.',
    };
  }
}

export async function draftPage(input: {
  issueType: string;
  fields: Record<string, string>;
  conversationId?: string | null;
  draftId?: string | null;
}): Promise<ActionResult<DraftResult>> {
  return callEdge<DraftResult>('da-draft-page', {
    issueType: input.issueType,
    fields: input.fields,
    conversationId: input.conversationId ?? null,
    draftId: input.draftId ?? null,
  });
}

export async function sendPage(input: {
  draftId: string;
  adapter?: 'app_notification' | 'legacy_pager';
  body?: string;
}): Promise<ActionResult<SendResult>> {
  return callEdge<SendResult>('da-send-page', {
    draftId: input.draftId,
    adapter: input.adapter ?? 'app_notification',
    body: input.body,
  });
}
