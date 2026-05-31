import {
  authenticate,
  edgeHandler,
  isUuid,
  jsonResponse,
  readObjectBody,
} from '../_shared/swap-http.ts';

Deno.serve(
  edgeHandler('void-swap', async (req) => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const parsed = await readObjectBody(req);
    if (!parsed.ok) return parsed.response;

    const { swap_id: swapId } = parsed.body;
    if (!isUuid(swapId)) {
      return jsonResponse({ error: 'swap_id must be a UUID' }, 400);
    }

    const { data, error } = await auth.supabase
      .from('swap_requests')
      .update({ status: 'voided' })
      .eq('swap_id', swapId)
      .eq('status', 'pending')
      .or(`initiator_user_id.eq.${auth.userId},counterparty_user_id.eq.${auth.userId}`)
      .select('swap_id,status')
      .maybeSingle();

    if (error !== null) return jsonResponse({ error: error.message }, 400);
    if (data === null) return jsonResponse({ voided: false, reason: 'not_pending' }, 409);
    return jsonResponse({ voided: true, swap_id: data.swap_id, status: data.status });
  }),
);
