import { redirect } from 'next/navigation';

import { HmodRotor } from '../../../../components/rotor/HmodRotor';
import { getSessionUser, isHouseAdmin } from '../../../../lib/auth';
import { getRotorData } from '../../../../lib/data/rotor';

// §2.5 HMOD rotor admin — HM/BM only.
export default async function RotorPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <h1 className="mb-1 text-lg font-semibold tracking-tight">HMOD rotor</h1>
      <p className="mb-6 text-sm text-zinc-500">
        One Housing Manager On Duty per week, planned by HMs/BMs (§2.5).
      </p>
      {isHouseAdmin(user) ? (
        await renderRotor()
      ) : (
        <div
          data-testid="rotor-unauthorized"
          className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"
        >
          Only Housing Managers and Building Managers may plan the HMOD rotor.
        </div>
      )}
    </main>
  );
}

async function renderRotor() {
  const { weeks, candidates, assignments } = await getRotorData();
  return <HmodRotor weeks={weeks} candidates={candidates} assignments={assignments} />;
}
