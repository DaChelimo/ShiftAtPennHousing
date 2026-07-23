// Streaming Desk Assistant ask endpoint (Server-Sent Events).
//
// da-ask now streams REAL model tokens itself (meta/delta/retract/done/error — see
// `supabase/functions/da-ask/index.ts` and `lib/assistant/streamTypes.ts`) in exactly
// this route's wire format, so this is a thin proxy: forward the question with the
// user's bearer token, then relay da-ask's SSE bytes straight through to the browser.
// Pre-generation failures (auth, unconfigured, retrieval/embedding errors) come back as
// plain JSON from da-ask; this route translates those into a single `error` frame so the
// browser only ever has to parse one format.

import type { AssistantStreamEvent } from '@/lib/assistant/streamTypes';
import { getSessionUser } from '@/lib/auth';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

// da-ask streams the full generation itself now; keep some headroom over its own budget.
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  const body: unknown = await request.json().catch(() => ({}));
  const read = (key: string): string =>
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<string, unknown>)[key] === 'string'
      ? ((body as Record<string, string>)[key] as string)
      : '';
  const question = read('question').trim();
  const conversationId = read('conversationId') || null;
  const surface = read('surface') || 'web';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Enqueue/close throw once the client has disconnected; nothing to deliver
      // at that point, so swallow rather than surface an unhandled rejection.
      const send = (event: AssistantStreamEvent): void => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.t}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          /* client disconnected */
        }
      };
      const fail = (message: string): void => {
        send({ t: 'error', message });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        if (question === '') return fail('Ask a desk question to get started.');

        const me = await getSessionUser();
        if (me === null) return fail('Your session has expired. Sign in again.');

        const supabase = await createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token === undefined) return fail('Your session has expired. Sign in again.');

        // Forward the bearer to da-ask; the EF derives the user and enforces every
        // scope/guardrail (same token-forwarding contract as the server action).
        const res = await fetch(`${SUPABASE_URL}/functions/v1/da-ask/da-ask`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ question, conversationId, surface }),
        });

        const isStream = (res.headers.get('content-type') ?? '').includes('text/event-stream');
        if (!res.ok || res.body === null || !isStream) {
          if (res.status === 503)
            return fail(
              'The assistant is not configured yet. Ask an administrator to set the API keys.',
            );
          const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          const detail =
            typeof json.error === 'string' ? json.error : `request failed (${res.status})`;
          return fail(detail);
        }

        // da-ask already emits this exact SSE wire format (meta/delta/retract/done/error)
        // — relay its bytes straight through rather than re-parsing and re-framing.
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          try {
            controller.enqueue(value);
          } catch {
            break; // client disconnected
          }
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Could not reach the assistant service.');
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
