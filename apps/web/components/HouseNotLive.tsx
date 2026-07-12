import { Card } from './ui/Card';

// Staggered-launch placeholder. Shown to a worker whose home house has not gone
// live yet: they can sign in, but the portal itself is held back until their house
// is switched on in the admin console. No em dashes in surfaced copy.
export function HouseNotLive({ houseName, email }: { houseName: string; email: string }) {
  return (
    <main
      className="col"
      style={{ minHeight: '100dvh', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <Card pad className="col gap-2" style={{ maxWidth: 440, textAlign: 'center' }}>
        <div className="login-wordmark" style={{ justifyContent: 'center' }}>
          Shift<span className="at">@</span>PennHousing
        </div>
        <div className="t-h2" data-testid="house-not-live-title">
          Shift isn&apos;t live at {houseName} yet
        </div>
        <p data-testid="house-not-live-body">
          You&apos;re signed in as {email}. We&apos;re rolling Shift out house by house, and{' '}
          {houseName} is coming soon. You&apos;ll be able to see your shifts, pick up open shifts,
          and manage swaps here as soon as your house goes live.
        </p>
        <p>Check back shortly, or reach out to your manager if you think this is a mistake.</p>
      </Card>
    </main>
  );
}
