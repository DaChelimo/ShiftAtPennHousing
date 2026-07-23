// Wire protocol for the streaming Desk Assistant endpoint (Server-Sent Events).
//
// da-ask now streams REAL model tokens as Claude generates them (see
// `supabase/functions/da-ask/index.ts`): `meta` first (citations/route/safety, known
// before generation starts), then a run of `delta` frames carrying live text, then
// `done`. The fail-closed incident-leakage check runs incrementally on the growing
// buffer server-side; if it ever trips, a `retract` frame replaces everything streamed
// so far with the standard refusal (and only the refusal is ever persisted). This route
// (`app/api/assistant/ask/route.ts`) is a thin proxy of da-ask's own SSE stream — these
// types describe da-ask's wire format directly. `messageId` isn't known until the final
// content (vetted answer or refusal) is persisted, so it lives on `done`, not `meta`.
// Pure types, shared by the route handler and the client consumers so all stay in
// lockstep.

import type { AskResult, Citation, RouteInfo } from '../actions/assistant';

export type AssistantStreamEvent =
  // First frame: everything about the answer except its prose.
  | {
      t: 'meta';
      conversationId: string;
      citations: Citation[];
      deferred: boolean;
      route: RouteInfo | null;
      safety: AskResult['safety'];
    }
  // A slice of the answer text, appended in order.
  | { t: 'delta'; text: string }
  // The leakage guardrail tripped: discard everything streamed so far and replace the
  // message with this content (the standard refusal).
  | { t: 'retract'; content: string }
  // Terminal success.
  | { t: 'done'; messageId: string | null }
  // Terminal failure with user-facing copy.
  | { t: 'error'; message: string };
