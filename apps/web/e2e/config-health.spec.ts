import { expect, test } from '@playwright/test';

import { SEED, login } from './helpers';

// TB-4 — System configuration + integration health (§6.12) — routes
// /admin/config and /admin/health.
//
// Test BACKFILL over two ALREADY-BUILT System screens:
//   * Config: the project administrator edits a system_config value with an audit
//     trail (modified_by + notes), read back on the next render. Project-admin only
//     (isProjectAdministrator) — an HM gets config-unauthorized.
//   * Health: per-integration cards (§6.12). Push delivery is the only instrumented
//     integration (real pending_notification_deliveries backlog + push_tokens); the
//     rest render explicit "Not configured" cards. House-admin OR project-admin.
//
// Seed: admin@pennhousing.test (SEED.projectAdmin, password test-Password-123) is
// set as system_config.project_administrator_user_id; the seeded config rows include
// no_ack_trigger_offset_minutes ('5'). hmQuad is a house admin (health-authorized,
// config-unauthorized); smQuad is neither (health-unauthorized).
//
// Selector contract:
//   config-unauthorized — shown to a non-project-admin instead of the editor.
//   <key> value / <key> notes — per-row inputs (aria-label); Save per card.
//   health-push-card — the instrumented push-delivery card.
//   health-not-configured-{sms,allied,sso,sis} — the explicit not-configured cards.
//   health-unauthorized — shown to a non-admin instead of the health page.

test.describe('System configuration (§6.12)', () => {
  const CONFIG_KEY = 'no_ack_trigger_offset_minutes';

  test('the project administrator edits a config value with an audit trail (round-trip)', async ({
    page,
  }) => {
    await login(page, SEED.projectAdmin);
    await page.goto('/admin/config');

    const card = page.locator('.card', { hasText: CONFIG_KEY });
    const valueInput = page.getByLabel(`${CONFIG_KEY} value`);
    await expect(valueInput).toBeVisible();

    // Edit the value + audit notes, then save (the server action writes via the
    // service client and stamps modified_by = the acting admin).
    await valueInput.fill('7');
    await page.getByLabel(`${CONFIG_KEY} notes`).fill('TB-4 round-trip check.');
    await card.getByRole('button', { name: /Save/ }).click();

    // Round-trip: the new value persists and the audit line names the admin + notes.
    await expect(valueInput).toHaveValue('7');
    await expect(card).toContainText(SEED.projectAdmin.name);
    await expect(card).toContainText('TB-4 round-trip check.');

    // Restore the seeded value so the suite leaves system_config pristine.
    await valueInput.fill('5');
    await page.getByLabel(`${CONFIG_KEY} notes`).fill('Restored to seed default.');
    await card.getByRole('button', { name: /Save/ }).click();
    await expect(valueInput).toHaveValue('5');
  });

  test('config editing is gated to the project administrator — an HM is blocked', async ({
    page,
  }) => {
    await login(page, SEED.hmQuad);
    await page.goto('/admin/config');

    await expect(page.getByTestId('config-unauthorized')).toBeVisible();
    await expect(page.getByLabel(`${CONFIG_KEY} value`)).toHaveCount(0);
  });
});

test.describe('Integration health (§6.12)', () => {
  test('an admin sees the instrumented push card + explicit not-configured cards', async ({
    page,
  }) => {
    await login(page, SEED.hmQuad);
    await page.goto('/admin/health');

    // The only instrumented integration: push delivery (real signals).
    await expect(page.getByTestId('health-push-card')).toBeVisible();
    await expect(page.getByTestId('health-push-card')).toContainText('Push delivery');

    // The rest are honest "Not configured" cards — no fabricated health.
    for (const id of ['sms', 'allied', 'sso', 'sis']) {
      await expect(page.getByTestId(`health-not-configured-${id}`)).toBeVisible();
    }
  });

  test('the health page is gated to admins — a Student Manager is blocked', async ({ page }) => {
    await login(page, SEED.smQuad);
    await page.goto('/admin/health');

    await expect(page.getByTestId('health-unauthorized')).toBeVisible();
    await expect(page.getByTestId('health-push-card')).toHaveCount(0);
  });
});
