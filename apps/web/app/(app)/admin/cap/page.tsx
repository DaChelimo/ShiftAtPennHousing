import { redirect } from 'next/navigation';

import { WeeklyCapModifier } from '../../../../components/cap/WeeklyCapModifier';
import { canModifyWeeklyCap, getSessionUser } from '../../../../lib/auth';
import { getWeeklyCaps } from '../../../../lib/data/cap';

export default async function CapPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Weekly hours cap</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Choose a calendar week and set its campus-wide cap.
      </p>
      {canModifyWeeklyCap(user) ? (
        <WeeklyCapModifier weeks={await getWeeklyCaps()} />
      ) : (
        <div
          data-testid="cap-unauthorized"
          className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"
        >
          403: Only Housing Managers and Building Managers may modify the weekly cap.
        </div>
      )}
    </main>
  );
}
