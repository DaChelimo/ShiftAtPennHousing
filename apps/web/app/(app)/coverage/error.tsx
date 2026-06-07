'use client';

import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/EmptyState';

export default function CoverageError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page">
      <ErrorState
        title="Couldn’t load coverage"
        desc="The coverage snapshot failed to load. Try again in a moment."
        action={
          <Button kind="secondary" onClick={reset}>
            Retry
          </Button>
        }
      />
    </div>
  );
}
