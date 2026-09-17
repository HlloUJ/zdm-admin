import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

test('confirms status changes, reports feedback, and formats creation time', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({ id: 1, name: '韩健', roles: ['SUPER_ADMIN'], permissions: ['all'], dataPermission: 'all' }),
    );
  });
  await installAdminApiMocks(page);
  await page.goto('/supplier-supply-type-management');
  const row = page.getByRole('row').filter({ hasText: '大板' });
  await expect(row).toContainText('2026/07/27 08:00');
  await row.getByText('停用', { exact: true }).click();
  const disableDialog = page.locator('.t-dialog').filter({ hasText: '是否停用供货类型“大板”？' });
  await expect(disableDialog).toBeVisible();
  await disableDialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(disableDialog).toBeHidden();
  await expect(row.getByText('停用', { exact: true })).toBeVisible();
  await row.getByText('停用', { exact: true }).click();
  await disableDialog.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByText('已停用“大板”', { exact: true })).toBeVisible();
  await expect(row.locator('.t-tag')).toHaveText('停用');
  await row.getByText('启用', { exact: true }).click();
  const enableDialog = page.locator('.t-dialog').filter({ hasText: '是否启用供货类型“大板”？' });
  await enableDialog.getByRole('button', { name: '确认启用', exact: true }).click();
  await expect(page.getByText('已启用“大板”', { exact: true })).toBeVisible();
});
