import { Skeleton } from '../../../components/ui/Skeleton';

export default function CoverageLoading() {
  return (
    <div className="page" style={{ maxWidth: 1000 }} aria-busy="true">
      <div className="col gap-2" style={{ marginBottom: 20 }}>
        <Skeleton w={220} h={22} />
        <Skeleton w={420} h={12} />
      </div>
      <div className="statstrip" style={{ marginBottom: 20 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} w="100%" h={84} />
        ))}
      </div>
      <Skeleton w={320} h={36} />
      <div className="gap-grid" style={{ marginTop: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} w="100%" h={190} />
        ))}
      </div>
    </div>
  );
}
