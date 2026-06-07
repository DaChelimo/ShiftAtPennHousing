import { PickupDot } from './Tag';
import { SHIFT_STATES } from './shiftState';

// The persistent shift-state legend (design-brief §6.1). A compact strip that
// the calendar keeps on screen so the color encoding is always decodable.
export function StatusLegend({ className = '' }: { className?: string }) {
  return (
    <div className={`legend ${className}`.trim()} aria-label="Shift state legend">
      <span className="t-label legend-lead">Legend</span>
      <div className="legend-strip">
        {SHIFT_STATES.map((s) => (
          <span className="legend-chip" key={s.key}>
            <span className={`legend-sw ${s.swatch}`} aria-hidden="true" />
            {s.label}
          </span>
        ))}
        <span className="legend-chip">
          <PickupDot />
          Cross-house pickup
        </span>
      </div>
    </div>
  );
}
