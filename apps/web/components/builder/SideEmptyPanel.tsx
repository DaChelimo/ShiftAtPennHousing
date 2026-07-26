'use client';

// Schedule builder: the side panel shown when nothing is selected and no worker is focused.
//
// This is the SM's default view while building a week, so it leads with what they actually
// need to triage (who's on the schedule and how their hours compare to their target) rather
// than with instructions or a raw block count. The how-to guide is condensed to three lines.

import { Avatar, Button, Icon } from '../ui';

function hoursLabel(hours: number): string {
  return `${String(hours)}h`;
}

export interface RosterWorker {
  userId: string;
  name: string;
  assignedHours: number;
  targetHours: number | null;
  optedOut: boolean;
}

export function SideEmptyPanel({
  workersOnSchedule,
  showRoster,
  onRequestRemove,
}: {
  workersOnSchedule: RosterWorker[];
  showRoster: boolean;
  onRequestRemove: (worker: { userId: string; name: string }) => void;
}) {
  return (
    <>
      <div className="side-guide">
        <div className="side-guide-row">
          <Icon name="drag" size={16} />
          <span>Drag across cells to create a shift.</span>
        </div>
        <div className="side-guide-row">
          <Icon name="trash" size={16} />
          <span>Click a worker&apos;s shift, then remove it to delete.</span>
        </div>
        <div className="side-guide-row">
          <Icon name="swap" size={16} />
          <span>Drag the sliders on a selected shift to adjust its hours.</span>
        </div>
      </div>

      {showRoster && workersOnSchedule.length > 0 && (
        <div className="side-workers" data-testid="side-workers">
          <span className="side-list-label t-label">On this schedule</span>
          <div className="side-worker-list">
            {workersOnSchedule.map((w) => {
              const over = w.targetHours !== null && w.assignedHours > w.targetHours;
              return (
                <div key={w.userId} className="side-worker-row">
                  <Avatar name={w.name} size={28} />
                  <div className="side-worker-meta">
                    <b>{w.name}</b>
                    <span className={over ? 'side-worker-hours is-over' : 'side-worker-hours'}>
                      {hoursLabel(w.assignedHours)}
                      {w.targetHours !== null && <> of {hoursLabel(w.targetHours)} target</>}
                      {w.optedOut && ' (opted out)'}
                    </span>
                  </div>
                  <Button
                    kind="ghost"
                    size="sm"
                    icon="trash"
                    data-testid={`remove-worker-${w.userId}`}
                    aria-label={`Remove ${w.name} from the whole week`}
                    onClick={() => onRequestRemove({ userId: w.userId, name: w.name })}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
