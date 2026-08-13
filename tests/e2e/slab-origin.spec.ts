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

test('shows slab origin in the slab base-data submenu and supports search and CRUD actions', async ({ page }) => {
  await page.goto('/slab-origin');
  const main = page.getByRole('main');

  const originMenuItem = page.locator('[data-menu-path="/slab-origin"]');
  const slabBaseDataMenu = page.locator('.menu-level-two').filter({ hasText: '大板基础数据管理' });
  await expect(slabBaseDataMenu).toBeVisible();
  await expect(slabBaseDataMenu.locator('.menu-level-three-item')).toHaveText([
    '品种管理',
    '产地管理',
    '纹理管理',
    '色系管理',
    '等级管理',
  ]);
  expect(
    await slabBaseDataMenu.evaluate((element) => element.previousElementSibling?.getAttribute('data-menu-path')),
  ).toBe('/finished-stock-craft');
  await expect(originMenuItem).toBeVisible();
  expect(
    await originMenuItem.evaluate((element) => element.previousElementSibling?.getAttribute('data-menu-path')),
  ).toBe('/slab-variety');
  await expect(main.getByText('巴西', { exact: true })).toBeVisible();
  await expect(main.locator('.t-breadcrumb')).toHaveText(/商品基础数据中心.*大板基础数据管理.*产地管理/);

  await main.getByPlaceholder('请输入', { exact: true }).fill('不存在');
  await main.getByRole('button', { name: '查询', exact: true }).click();
  await expect(main.getByText('巴西', { exact: true })).toHaveCount(0);
  await main.getByRole('button', { name: '重置', exact: true }).click();
  await expect(main.getByText('巴西', { exact: true })).toBeVisible();

  await main.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByPlaceholder('请输入产地', { exact: true }).fill('意大利');
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByText('已新增“意大利”', { exact: true })).toBeVisible();

  const originRow = main.locator('tbody tr').filter({ hasText: '巴西' });
  await originRow.getByText('编辑', { exact: true }).click();
  await expect(page.getByText('编辑产地', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await originRow.getByText('停用', { exact: true }).click();
  await expect(page.getByText('是否停用产地“巴西”？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await originRow.getByText('删除', { exact: true }).click();
  await expect(page.getByText('是否删除产地“巴西”？', { exact: true })).toBeVisible();
});

test('hides slab origin operations without their permissions', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 21,
        name: '产地只读管理员',
        phone: '15926620021',
        roles: ['SLAB_ORIGIN_VIEWER'],
        permissions: ['admin.product-data-center.slab-origin.view'],
        dataPermission: 'all',
      }),
    );
  });
  await page.goto('/slab-origin');
  const main = page.getByRole('main');
  const slabBaseDataMenu = page.locator('.menu-level-two').filter({ hasText: '大板基础数据管理' });
  await expect(slabBaseDataMenu.locator('.menu-level-three-item')).toHaveText(['产地管理']);
  await expect(main.getByText('巴西', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: '新增', exact: true })).toHaveCount(0);
  await expect(main.locator('.table-actions .t-link')).toHaveCount(0);
});
