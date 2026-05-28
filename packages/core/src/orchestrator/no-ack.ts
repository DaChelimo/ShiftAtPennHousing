import type {
  DecideNoAckActionInput,
  NoAckOutcome,
  SourceSideAction,
  SourceSideAtTriggerTime,
} from './types.js';

function resolveSourceSideAction(
  initiatedBy: DecideNoAckActionInput['initiatedBy'],
  sourceSideAtTriggerTime: SourceSideAtTriggerTime,
): SourceSideAction {
  if (initiatedBy === 'automated') {
    return { type: 'none' };
  }

  switch (sourceSideAtTriggerTime.kind) {
    case 'force_triggered_still_vacant':
      return { type: 'restore_floater_original_assignment' };
    case 'force_triggered_claimed_by_other':
    case 'force_triggered_covered_by_allied':
      return { type: 'mark_floater_displaced' };
    case 'automated':
      return { type: 'none' };
  }
}

export function decideNoAckAction(input: DecideNoAckActionInput): NoAckOutcome {
  if (input.acknowledgedAt !== null) {
    return { kind: 'skip', reason: 'acknowledged' };
  }

  if (input.declinedAt !== null) {
    return { kind: 'skip', reason: 'declined' };
  }

  return {
    kind: 'void_and_reescalate',
    voidFloat: true,
    addToFloatExclusions: true,
    destinationToVacant: true,
    rolledBackSteps: input.initiatedBy === 'force_triggered' ? ['broadcast', 'float_lookup'] : [],
    sourceSideAction: resolveSourceSideAction(input.initiatedBy, input.sourceSideAtTriggerTime),
    escalationNextStep: 'hmod_notify_allied',
  };
}
