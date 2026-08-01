import { PageSkeleton } from '../../../../components/ui/PageSkeleton';

// Duty-week rotor rows.
export default function Loading() {
  return <PageSkeleton maxWidth={720} variant="cards" rows={3} />;
}
