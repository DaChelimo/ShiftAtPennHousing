export type StepFireStatus = 'not_fired' | 'fired' | 'completed_via_force_trigger' | 'rolled_back';

export function shouldFireStep(
  _stepName: string,
  stepOffsetSeconds: number,
  blockStartAt: Date,
  stepStatus: StepFireStatus,
  now: Date,
): boolean {
  if (stepStatus !== 'not_fired' && stepStatus !== 'rolled_back') {
    return false;
  }

  return now.getTime() >= blockStartAt.getTime() + stepOffsetSeconds * 1000;
}
