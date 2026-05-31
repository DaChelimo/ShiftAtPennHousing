import {
  authenticate,
  edgeHandler,
  isUuid,
  isUuidArray,
  jsonResponse,
  readObjectBody,
} from '../_shared/swap-http.ts';

Deno.serve(
  edgeHandler('accept-swap', async (req) => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const parsed = await readObjectBody(req);
    if (!parsed.ok) return parsed.response;

    const { swap_id: swapId, affected_assignment_ids: affectedAssignmentIds } = parsed.body;
    if (!isUuid(swapId)) {
      return jsonResponse({ error: 'swap_id must be a UUID' }, 400);
    }

    const { data: swap, error: swapError } = await auth.supabase
      .from('swap_requests')
      .select('swap_type')
      .eq('swap_id', swapId)
      .maybeSingle();

    if (swapError !== null) {
      return jsonResponse({ error: swapError.message }, 400);
    }
    if (swap === null) {
      return jsonResponse({ error: 'swap_not_found' }, 404);
    }

    if (swap.swap_type === 'permanent_swap') {
      if (!isUuidArray(affectedAssignmentIds)) {
        return jsonResponse(
          { error: 'affected_assignment_ids must be a non-empty UUID array' },
          400,
        );
      }
      const { data, error } = await auth.supabase.rpc('apply_permanent_swap', {
        p_swap_id: swapId,
        p_new_owner_user_id: auth.userId,
        p_affected_assignment_ids: affectedAssignmentIds,
        p_now: new Date().toISOString(),
      });
      if (error !== null) return jsonResponse({ error: error.message }, 400);
      return jsonResponse(data);
    }

    const { data, error } = await auth.supabase.rpc('accept_swap', {
      p_swap_id: swapId,
      p_accepting_user_id: auth.userId,
      p_now: new Date().toISOString(),
    });
    if (error !== null) return jsonResponse({ error: error.message }, 400);
    return jsonResponse(data);
  }),
);
