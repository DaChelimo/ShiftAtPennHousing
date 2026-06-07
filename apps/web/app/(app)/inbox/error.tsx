'use client';

import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/EmptyState';

export default function InboxError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page">
      <ErrorState
        title="Couldn’t load the inbox"
        desc="Your notifications failed to load. Try again in a moment."
        action={
          <Button kind="secondary" onClick={reset}>
            Retry
          </Button>
        }
      />
    </div>
  );
}
