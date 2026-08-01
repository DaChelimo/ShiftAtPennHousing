import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// Leave window form and the current-leave card.
export default function Loading() {
  return <PageSkeleton maxWidth={720} variant="cards" rows={2} />;
}
