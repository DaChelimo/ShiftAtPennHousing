import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// Orchestrator health panels.
export default function Loading() {
  return <PageSkeleton maxWidth={760} variant="cards" rows={3} />;
}
