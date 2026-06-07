import { Skeleton } from '../../../components/ui/Skeleton';

// Skeleton shown while the server fetches the week's schedule (week navigation
// re-fetches, so this also covers prev/next/pick).
export default function CalendarLoading() {
  return (
    <div className="page page-wide" aria-busy="true" aria-label="Loading calendar">
      <div className="row between" style={{ padding: '20px 24px 14px', gap: 16, flexWrap: 'wrap' }}>
        <div className="col gap-2">
          <Skeleton w={180} h={22} />
          <Skeleton w={240} h={12} />
        </div>
        <div className="row gap-2">
          <Skeleton w={260} h={36} />
          <Skeleton w={120} h={36} />
        </div>
      </div>
      <div style={{ margin: '0 24px 10px' }}>
        <Skeleton w="100%" h={34} />
      </div>
      <div style={{ margin: '0 12px 12px' }}>
        <Skeleton w="100%" h={520} />
      </div>
    </div>
  );
}
