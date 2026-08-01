import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// Break authoring calendar.
export default function Loading() {
  return <PageSkeleton variant="cards" rows={3} />;
}
