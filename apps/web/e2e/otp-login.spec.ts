import { expect, test } from '@playwright/test';

import { SEED, getOtpCodeFromInbucket, otpLogin } from './helpers';

// Passwordless (email-OTP) login UI. Only meaningful with NEXT_PUBLIC_AUTH_MODE=production
// set on the server under test — the default e2e run (password auth, per apps/web/lib/env.ts)
// never renders this flow, so every test here skips unless that flag is on.
//
// Run in isolation against a dedicated port (avoids clobbering an already-running dev
// server, and needs the flag baked into that server's process env):
//   NEXT_PUBLIC_AUTH_MODE=production PORT=3100 E2E_BASE_URL=http://localhost:3100 \
//     pnpm e2e:file e2e/otp-login.spec.ts
//
// Requires local Supabase running (`supabase start`) so Inbucket (port 54324) captures
// the OTP email — see supabase/config.toml [inbucket].

const PASSWORDLESS = process.env.NEXT_PUBLIC_AUTH_MODE === 'production';

test.describe('Passwordless email-OTP login', () => {
  test.skip(!PASSWORDLESS, 'Requires NEXT_PUBLIC_AUTH_MODE=production — see file header');

  test('no password field is rendered', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).not.toBeVisible();
    await expect(page.getByTestId('login-send-code')).toBeVisible();
  });

  test('an unrecognized email is rejected without creating an account', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill('not-a-real-worker@pennhousing.test');
    await page.getByTestId('login-send-code').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('login-otp-code')).not.toBeVisible();
  });

  test('wrong code is rejected, correct code signs in', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(SEED.hmQuad.email);
    await page.getByTestId('login-send-code').click();
    await expect(page.getByTestId('login-otp-code')).toBeVisible();

    await page.getByTestId('login-otp-code').fill('000000');
    await page.getByTestId('login-verify').click();
    await expect(page.getByTestId('login-error')).toBeVisible();

    const code = await getOtpCodeFromInbucket(SEED.hmQuad.email);
    await page.getByTestId('login-otp-code').fill(code);
    await page.getByTestId('login-verify').click();
    await expect(page.getByTestId('app-shell')).toBeVisible();
  });

  test('full login round-trip via the shared helper', async ({ page }) => {
    await otpLogin(page, SEED.hmQuad);
  });

  test('/auth/forgot redirects away (no password to reset)', async ({ page }) => {
    await page.goto('/auth/forgot');
    await expect(page).toHaveURL(/\/login$/);
  });
});
