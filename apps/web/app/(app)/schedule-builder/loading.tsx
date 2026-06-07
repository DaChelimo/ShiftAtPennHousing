import { Skeleton } from '../../../components/ui/Skeleton';

// Skeleton while the server loads the builder snapshot (roster, blocks, prefs, drafts).
export default function ScheduleBuilderLoading() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }} aria-busy="true">
      <div className="row between" style={{ padding: '20px 24px 14px', gap: 16, flexWrap: 'wrap' }}>
        <div className="col gap-2">
          <Skeleton w={260} h={22} />
          <Skeleton w={360} h={12} />
        </div>
        <div className="row gap-2">
          <Skeleton w={240} h={36} />
          <Skeleton w={96} h={40} />
        </div>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 340px', minHeight: 0 }}>
        <Skeleton w="100%" h="100%" style={{ borderTop: '1px solid var(--border-subtle)' }} />
        <Skeleton w="100%" h="100%" style={{ borderLeft: '1px solid var(--border-subtle)' }} />
      </div>
    </div>
  );
}
