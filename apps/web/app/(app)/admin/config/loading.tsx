import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// system_config key/value table.
export default function Loading() {
  return <PageSkeleton maxWidth={980} variant="table" rows={8} />;
}
