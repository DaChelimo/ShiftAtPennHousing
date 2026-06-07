'use client';

import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/EmptyState';

// Route error boundary for the schedule builder (e.g. the snapshot failed to load).
export default function ScheduleBuilderError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page">
      <ErrorState
        title="Couldn’t load the builder"
        desc="The schedule snapshot failed to load. Try again in a moment."
        action={
          <Button kind="secondary" onClick={reset}>
            Retry
          </Button>
        }
      />
    </div>
  );
}
