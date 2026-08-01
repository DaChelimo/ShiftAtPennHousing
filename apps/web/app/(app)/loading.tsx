import { PageSkeleton } from '../../components/ui/PageSkeleton';

// Admin dashboard: today's coverage summary cards.
export default function Loading() {
  return <PageSkeleton variant="cards" rows={3} />;
}
