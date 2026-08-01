import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// Per-house launch gate cards.
export default function Loading() {
  return <PageSkeleton maxWidth={820} variant="cards" rows={4} />;
}
