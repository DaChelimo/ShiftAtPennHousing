import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// My Shifts: week navigator plus grouped shift cards.
export default function Loading() {
  return <PageSkeleton variant="cards" rows={4} actions={1} />;
}
