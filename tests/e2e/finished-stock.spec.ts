import { expect, test } from '@playwright/test';

test('opens finished stock inventory movements drawer', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });

  await page.goto('/finished-stock-management');

  await expect(page.getByText(/仓库中/)).toBeVisible();
  const firstProductRow = page.locator('tbody tr').filter({ hasText: '编码：' }).first();
  await expect(firstProductRow).toBeVisible();
  await firstProductRow.getByText('流水').click();

  await expect(page.getByText('库存流水').first()).toBeVisible();
  await expect(page.getByText(/当前库存/)).toBeVisible();
  await expect(page.getByText('库存变化')).toBeVisible();
});
