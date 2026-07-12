import { SITE_URL } from '../env';
import { createServiceClient } from '../supabase/server';

// Server-only helper (NOT a Server Action — deliberately no 'use server' directive, so it
// is never exposed as a public HTTP endpoint). It calls the service-role admin API and
// returns a GoTrue recovery link, which is a login-equivalent secret. It must only be
// reached AFTER an authorization + house-scope check by its callers (hireWorker,
// resendInvite, inviteHouseRoster). Do NOT export this from a 'use server' module.
//
// We use type 'recovery' uniformly for BOTH first-time setup and later resets: it works
// whether or not a password exists yet (the account just needs to exist), and consuming
// the link opens a short-lived recovery session in which the worker sets their password.

// The redirect target GoTrue appends its recovery token to. One place so hire, resend,
// and bulk invite all land the worker on the same set-password page.
const REDIRECT_TO = `${SITE_URL}/auth/update-password`;

// Generate a set-password (recovery) link for one already-created account. Best-effort:
// a generation failure yields null (not a throw), so a caller like hireWorker can still
// report the hire succeeded.
export async function generateSetupLink(email: string): Promise<string | null> {
  const service = createServiceClient();
  const { data, error } = await service.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: REDIRECT_TO },
  });
  if (error !== null || data == null) return null;
  return data.properties?.action_link ?? null;
}
