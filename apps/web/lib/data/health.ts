import { createServiceClient } from '../supabase/server';

export type OrchestratorHealth = {
  lastTickAt: string;
  blocksScanned: number;
  stepsFired: number;
  floatsVoided: number;
  swapsExpired: number;
  errors: string[];
};

export async function getOrchestratorHealth(): Promise<OrchestratorHealth | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('orchestrator_health')
    .select('last_tick_at, blocks_scanned, steps_fired, floats_voided, swaps_expired, errors')
    .eq('singleton', true)
    .maybeSingle();
  if (error !== null) throw error;
  return data === null
    ? null
    : {
        lastTickAt: data.last_tick_at,
        blocksScanned: data.blocks_scanned,
        stepsFired: data.steps_fired,
        floatsVoided: data.floats_voided,
        swapsExpired: data.swaps_expired,
        errors: data.errors,
      };
}
