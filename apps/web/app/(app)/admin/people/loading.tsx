import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// Roster table plus the hire control in the header.
export default function Loading() {
  return <PageSkeleton variant="table" rows={8} actions={1} />;
}
