import type { ChainStep, ChainStepEvaluation, EvaluateChainStepsInput } from './types.js';

function stepFireAt(blockStartAt: Date, step: ChainStep): number {
  return blockStartAt.getTime() + step.offsetMinutes * 60 * 1000;
}

function toEvaluation(step: ChainStep): ChainStepEvaluation {
  return step.trigger === undefined
    ? { stepName: step.stepName }
    : { stepName: step.stepName, trigger: step.trigger };
}

export function evaluateChainSteps(input: EvaluateChainStepsInput): ChainStepEvaluation[] {
  const nowMs = input.now.getTime();
  const blockStartMs = input.blockStartAt.getTime();

  if (nowMs >= blockStartMs || input.chain.length === 0) {
    return [];
  }

  const maxReachedMissingOffset = input.chain.reduce<number | null>((maxOffset, step) => {
    if (
      input.stepStatus[step.stepName] !== undefined ||
      nowMs < stepFireAt(input.blockStartAt, step)
    ) {
      return maxOffset;
    }

    return maxOffset === null ? step.offsetMinutes : Math.max(maxOffset, step.offsetMinutes);
  }, null);

  return input.chain.flatMap((step) => {
    const status = input.stepStatus[step.stepName];
    const fireAt = stepFireAt(input.blockStartAt, step);
    const offsetReached = nowMs >= fireAt;

    if (!offsetReached) {
      return [];
    }

    if (status === 'fired' || status === 'completed_via_force_trigger') {
      return [];
    }

    if (status === 'rolled_back') {
      return nowMs === fireAt ? [toEvaluation(step)] : [];
    }

    if (maxReachedMissingOffset !== null && step.offsetMinutes < maxReachedMissingOffset) {
      return [];
    }

    return [toEvaluation(step)];
  });
}
