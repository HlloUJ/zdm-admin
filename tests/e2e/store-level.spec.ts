import { expect, test } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        name: '韩健',
        phone: '15926626945',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });
  await installAdminApiMocks(page);
});

test('manages store levels under tenant store base data', async ({ page }) => {
  await page.goto('/store-level-management');
  const main = page.getByRole('main');
  const baseDataMenu = page.locator('.menu-level-two').filter({ hasText: '门店基础数据' });

  await expect(baseDataMenu.locator('.menu-level-three-item')).toHaveText(['门店级别管理']);
  await expect(main.locator('.t-breadcrumb')).toHaveText(/租户与门店.*门店基础数据.*门店级别管理/);
  await expect(main.getByRole('row', { name: /^1 1级 / })).toBeVisible();
  await expect(main.getByRole('row', { name: /^2 2级 / })).toBeVisible();
  await expect(main.getByText('级别编码', { exact: true })).toHaveCount(0);

  await main.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.locator('.t-dialog').filter({ hasText: '新增店铺级别' });
  await expect(dialog.getByText('级别编码', { exact: true })).toHaveCount(0);
  await dialog.getByPlaceholder('请输入级别名称').fill('4级');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByText('已新增“4级”', { exact: true })).toBeVisible();

  await main
    .getByRole('row', { name: /^1 1级 / })
    .getByText('编辑', { exact: true })
    .click();
  const editDialog = page.locator('.t-dialog').filter({ hasText: '编辑店铺级别' });
  await expect(editDialog.getByText('级别编码', { exact: true })).toHaveCount(0);
});

test('loads only enabled store levels when creating a store', async ({ page }) => {
  await page.goto('/tenant-store-management');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.locator('.t-dialog').filter({ hasText: '新增' });
  await dialog.locator('.t-form__item').filter({ hasText: '门店级别' }).getByPlaceholder('请选择').click();
  const options = page.locator('.t-select__dropdown:visible');
  await expect(options.getByText('1级', { exact: true })).toBeVisible();
  await expect(options.getByText('2级', { exact: true })).toBeVisible();
  await expect(options.getByText('3级', { exact: true })).toHaveCount(0);
});

test('shows the reference blocker before opening the store level delete confirmation', async ({ page }) => {
  await page.route('**/api/admin/store-levels/1/delete-preview', async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 400, message: '该门店级别已被门店引用，不能删除', data: null }),
    });
  });

  await page.goto('/store-level-management');
  const row = page.getByRole('main').getByRole('row', { name: /^1 1级 / });
  await row.getByText('删除', { exact: true }).click();

  await expect(page.getByText('该门店级别已被门店引用，不能删除', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认删除', exact: true })).toHaveCount(0);
});

test('hides store level operations without their permissions', async ({ page }) => {
  await page.addInitScript(() =>
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 30,
        name: '店铺级别只读管理员',
        phone: '15926620030',
        roles: ['STORE_LEVEL_VIEWER'],
        permissions: ['admin.tenant.store-level-management.view'],
        dataPermission: 'all',
      }),
    ),
  );
  await page.goto('/store-level-management');
  const main = page.getByRole('main');
  await expect(main.getByText('1级', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: '新增', exact: true })).toHaveCount(0);
  await expect(main.locator('.table-actions .t-link')).toHaveCount(0);
});
