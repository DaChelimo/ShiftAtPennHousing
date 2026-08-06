import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Admin - Preferences' };

import { PreferencesOversight } from '../../../../components/preferences/PreferencesOversight';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { canBuildSchedule, getSessionUser, writeHouseId } from '../../../../lib/auth';
import { getShellHouses } from '../../../../lib/data/hmod';
import { getPreferencesOversight } from '../../../../lib/data/preferences';
import { simNow } from '../../../../lib/time/simClock';

// Preferences oversight (design §6.11). READ-only presentation over existing data
// (lib/data/preferences) — submission + reminder tracking for the active period.
// SM build-prep surface — gated to SM/HM/BM (same as the builder / hours / coverage).
// 2026-06-27 cross-house: a schedule admin (hm/bm/rsm) may inspect another house's
// build inputs via ?house= (this is a builder input); an sm is pinned to their own.
export default async function PreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ house?: string }>;
}) {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  if (!canBuildSchedule(user)) {
    return (
      <div className="page">
        <PageHead eyebrow="Operate" title="Preferences oversight" />
        <Notification kind="warning" title="Managers only" testId="preferences-unauthorized">
          Preferences oversight is available to Student Managers and Housing Managers.
        </Notification>
      </div>
    );
  }

  const { house } = await searchParams;
  const validHouseIds = (await getShellHouses()).map((h) => h.id);
  const data = await getPreferencesOversight(
    writeHouseId(user, house ?? null, validHouseIds),
    await simNow(),
  );
  return <PreferencesOversight data={data} />;
}
