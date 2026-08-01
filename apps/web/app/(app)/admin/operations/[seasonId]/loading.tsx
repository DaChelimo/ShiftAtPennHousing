import { PageSkeleton } from '../../../../../components/ui/PageSkeleton';

// Season editor: per-house band windows.
export default function Loading() {
  return <PageSkeleton maxWidth={1100} variant="cards" rows={5} actions={1} />;
}
