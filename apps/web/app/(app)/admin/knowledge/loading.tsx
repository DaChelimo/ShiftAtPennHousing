import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// KB intake queue and document list.
export default function Loading() {
  return <PageSkeleton maxWidth={900} variant="cards" rows={4} />;
}
