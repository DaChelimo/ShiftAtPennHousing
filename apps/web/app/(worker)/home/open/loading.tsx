import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// Open Shifts: claimable feed, week-scoped.
export default function Loading() {
  return <PageSkeleton variant="cards" rows={4} actions={1} />;
}
