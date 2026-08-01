import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// Swap requests, incoming and outgoing.
export default function Loading() {
  return <PageSkeleton variant="cards" rows={3} />;
}
