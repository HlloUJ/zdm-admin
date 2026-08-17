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

test('manages colors and their categories from one menu page', async ({ page }) => {
  await page.goto('/slab-color');
  const main = page.getByRole('main');
  const slabBaseDataMenu = page.locator('.menu-level-two').filter({ hasText: '大板基础数据' });

  await expect(slabBaseDataMenu.locator('.menu-level-three-item')).toHaveText([
    '品种管理',
    '产地管理',
    '纹理管理',
    '色系管理',
    '等级管理',
  ]);
  await expect(page.locator('[data-menu-path="/slab-color"]')).toBeVisible();
  await expect(main.locator('.t-breadcrumb')).toHaveText(/商品管理.*大板基础数据.*色系管理/);
  await expect(main.getByText('奶白', { exact: true })).toBeVisible();
  await expect(main.locator('tbody tr').filter({ hasText: '奶白' })).toContainText('白色系');

  await main.getByRole('button', { name: '色系分类管理', exact: true }).click();
  const categoryDialog = page.locator('.t-dialog').filter({ hasText: '色系分类管理' });
  await expect(categoryDialog.getByText('白色系', { exact: true })).toBeVisible();
  const categoryTable = categoryDialog.locator('.t-table__content');
  await expect(categoryTable).toBeVisible();
  expect(await categoryTable.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await categoryDialog.getByRole('button', { name: '新增色系分类', exact: true }).click();
  await page.getByPlaceholder('请输入色系分类名称').fill('灰色系');
  await page.locator('.t-dialog').filter({ hasText: '新增色系分类' }).getByRole('button', { name: '提交' }).click();
  await expect(page.getByText('已新增“灰色系”', { exact: true })).toBeVisible();
  await categoryDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(categoryDialog).toBeHidden();

  await main.getByRole('button', { name: '新增', exact: true }).click();
  await page.getByPlaceholder('请输入色系名称').fill('浅灰');
  await page.getByPlaceholder('请选择色系分类').click();
  await page.locator('.t-select-option').filter({ hasText: '白色系' }).click();
  await page.locator('.t-dialog').filter({ hasText: '新增色系' }).getByRole('button', { name: '提交' }).click();
  await expect(page.getByText('已新增“浅灰”', { exact: true })).toBeVisible();
});

test('hides color operations and category configuration without operation permissions', async ({ page }) => {
  await page.addInitScript(() =>
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 23,
        name: '色系只读管理员',
        phone: '15926620023',
        roles: ['SLAB_COLOR_VIEWER'],
        permissions: ['admin.product-data-center.slab-color.view'],
        dataPermission: 'all',
      }),
    ),
  );
  await page.goto('/slab-color');
  const main = page.getByRole('main');
  const slabBaseDataMenu = page.locator('.menu-level-two').filter({ hasText: '大板基础数据' });

  await expect(slabBaseDataMenu.locator('.menu-level-three-item')).toHaveText(['色系管理']);
  await expect(main.getByText('奶白', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: '新增', exact: true })).toHaveCount(0);
  await expect(main.getByRole('button', { name: '色系分类管理', exact: true })).toHaveCount(0);
  await expect(main.locator('.table-actions .t-link')).toHaveCount(0);
});
