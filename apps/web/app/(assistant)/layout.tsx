import { redirect } from 'next/navigation';

import { getSessionUser } from '../../lib/auth';

// Self-contained shell for the Desk Assistant surface (V1_SCOPE §3). Deliberately
// NOT the admin AppShell: this mounts standalone (phone + laptop) and is designed to
// be hosted by the broader SW/SM/admin web app later via one component. Internal
// roles only; unauthenticated requests go to /login.
export default async function AssistantLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  return (
    <div className="min-h-dvh bg-surface-2 text-text-primary">
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-surface px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-sm font-semibold text-text-on-color">
            S
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Ask Snoopy</div>
            <div className="text-xs text-text-secondary">{user.name}</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-4">{children}</main>
    </div>
  );
}
