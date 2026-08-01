import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// Updates feed: floats and notifications.
export default function Loading() {
  return <PageSkeleton variant="cards" rows={3} />;
}
