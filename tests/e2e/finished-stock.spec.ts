import { expect, test } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

test('opens finished stock inventory movements drawer', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
  await installAdminApiMocks(page);

  await page.goto('/finished-stock-management');

  await expect(page.getByText(/仓库中/)).toBeVisible();
  await expect(page.getByText('供应商', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('租户', { exact: true })).toHaveCount(0);
  await expect(page.getByText('门店', { exact: true })).toHaveCount(0);
  const firstProductRow = page.locator('tbody tr').filter({ hasText: '编码：' }).first();
  await expect(firstProductRow).toBeVisible();
  await firstProductRow.getByText('流水').click();

  await expect(page.getByText('库存流水').first()).toBeVisible();
  await expect(page.getByText(/当前库存/)).toBeVisible();
  await expect(page.getByText('库存变化')).toBeVisible();
});

test('matches slab tab counts and selects a fourth-level category in columns', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
  await installAdminApiMocks(page);

  await page.goto('/finished-stock-management');

  await expect(page.getByText('仓库中 1', { exact: true })).toBeVisible();
  await expect(page.getByText('出售中', { exact: true })).toBeVisible();
  await expect(page.getByText('出售中 0', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const picker = page.getByTestId('finished-category-picker');
  await expect(picker.locator('.category-column')).toHaveCount(3);
  await picker.getByRole('button', { name: '成品现货' }).click();
  await picker.getByRole('button', { name: '餐桌' }).click();
  await picker.getByRole('button', { name: '石材餐桌' }).click();
  await expect(picker.locator('.category-column')).toHaveCount(4);
  await picker.getByRole('button', { name: '奢石餐桌' }).click();
  await page.getByRole('button', { name: '确认，下一步' }).click();

  await expect(page.getByText('当前分类：成品现货 > 餐桌 > 石材餐桌 > 奢石餐桌')).toBeVisible();
});
