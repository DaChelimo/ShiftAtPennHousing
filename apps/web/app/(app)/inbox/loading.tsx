import { Skeleton } from '../../../components/ui/Skeleton';

export default function InboxLoading() {
  return (
    <div className="page" style={{ maxWidth: 880 }} aria-busy="true">
      <div className="col gap-2" style={{ marginBottom: 20 }}>
        <Skeleton w={180} h={22} />
        <Skeleton w={420} h={12} />
      </div>
      <Skeleton w={320} h={36} />
      <div className="col gap-3" style={{ marginTop: 16 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} w="100%" h={120} />
        ))}
      </div>
    </div>
  );
}
