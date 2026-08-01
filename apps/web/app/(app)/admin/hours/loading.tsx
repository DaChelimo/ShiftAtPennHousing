import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// Per-worker hours report table.
export default function Loading() {
  return <PageSkeleton variant="table" rows={10} />;
}
