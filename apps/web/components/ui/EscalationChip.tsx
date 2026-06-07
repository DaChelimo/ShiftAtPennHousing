import { Fragment } from 'react';

import { Icon } from './Icon';

// The coverage escalation timeline (design-brief §3 / BEH §6): a gap moves
// T-3h broadcast → T-2h automated float lookup → fallback HMOD calls Allied.
// This chip is the recurring visual motif showing where a gap sits on it.
export type EscalationStep = 'broadcast' | 'float' | 'allied';

export const ESCALATION_STEPS: { key: EscalationStep; t: string; label: string }[] = [
  { key: 'broadcast', t: 'T-3h', label: 'Broadcast' },
  { key: 'float', t: 'T-2h', label: 'Float lookup' },
  { key: 'allied', t: 'Fallback', label: 'Allied' },
];

export function EscalationChip({
  step,
  compact = false,
}: {
  step: EscalationStep;
  compact?: boolean;
}) {
  const idx = ESCALATION_STEPS.findIndex((s) => s.key === step);
  return (
    <div className={`esc-chip ${compact ? 'esc-compact' : ''}`.trim()}>
      {ESCALATION_STEPS.map((s, i) => {
        const done = i < idx;
        const cur = i === idx;
        return (
          <Fragment key={s.key}>
            {i > 0 && <span className={`esc-line ${i <= idx ? 'esc-line-on' : ''}`.trim()} />}
            <div className={`esc-node ${done ? 'is-done' : ''} ${cur ? 'is-cur' : ''}`.trim()}>
              <span className="esc-bead">{done ? <Icon name="check" size={10} /> : i + 1}</span>
              {!compact && (
                <span className="esc-meta">
                  <b>{s.t}</b>
                  {s.label}
                </span>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
