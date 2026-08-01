import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// Operating seasons list.
export default function Loading() {
  return <PageSkeleton maxWidth={820} variant="cards" rows={3} />;
}
