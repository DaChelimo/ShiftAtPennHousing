// Shared dev-clock helper for Edge Functions.
//
// Resolves the simulated "now" via the app_now() RPC so worker/admin ACTIONS
// (acknowledge / decline / force-trigger) honor the dev sim clock under
// time-travel, the same way the orchestrator and the web app already do
// (migration 20260611000007). In production the dev_sim_clock offset is always 0,
// so app_now() === now() and this returns exactly the wall clock. Best-effort: any
// failure (RPC missing, transport error) falls back to `new Date()`.

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export async function fetchAppNow(supabase: RpcClient): Promise<Date> {
  try {
    const { data, error } = await supabase.rpc('app_now');
    if (error === null && typeof data === 'string') {
      const parsed = new Date(data);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  } catch {
    // fall through to the real wall clock
  }
  return new Date();
}
