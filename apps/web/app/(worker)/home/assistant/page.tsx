import { redirect } from 'next/navigation';

import { AssistantView } from '../../../(app)/assistant/AssistantView';
import { getSessionUser } from '../../../../lib/auth';

function prettifyHouse(id: string): string {
  if (!id) return 'your house';
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// Desk Assistant, mounted inside the worker portal (WorkerShell). Same grounded
// chatbot as the manager surface (app/(app)/assistant) — retrieval scoping is
// server-side and JWT-derived (packages/core/src/desk-assistant/scope.ts), so a
// worker cannot read manager/restricted-sensitivity KB content by reaching this
// route. KB-authoring ("Draft a page") is a content-authoring capability, not
// read-only Q&A, so it's hidden here (canDraftPages=false).
export default async function WorkerAssistantPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  return (
    <AssistantView
      firstName={firstName}
      houseName={prettifyHouse(user.homeHouseId)}
      canDraftPages={false}
    />
  );
}
