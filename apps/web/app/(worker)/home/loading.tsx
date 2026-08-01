import { PageSkeleton } from '../../../components/ui/PageSkeleton';

// Worker home: the tile grid of everything they can do.
export default function Loading() {
  return <PageSkeleton variant="cards" rows={4} />;
}
