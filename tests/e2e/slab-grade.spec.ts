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

test('manages slab grades below color management', async ({ page }) => {
  await page.goto('/slab-grade');
  const main = page.getByRole('main');
  const slabBaseDataMenu = page.locator('.menu-level-two').filter({ hasText: '大板基础数据' });

  await expect(slabBaseDataMenu.locator('.menu-level-three-item')).toHaveText([
    '品种管理',
    '产地管理',
    '纹理管理',
    '色系管理',
    '等级管理',
  ]);
  expect(
    await page
      .locator('[data-menu-path="/slab-grade"]')
      .evaluate((element) => element.previousElementSibling?.getAttribute('data-menu-path')),
  ).toBe('/slab-color');
  await expect(main.locator('.t-breadcrumb')).toHaveText(/商品管理.*大板基础数据.*等级管理/);
  await expect(main.getByRole('row', { name: /^1 A\+ 超精品料 / })).toBeVisible();
  await expect(main.getByRole('row', { name: /^2 A 精品料 / })).toBeVisible();
  await expect(main.getByRole('row', { name: /^3 B 标准料 / })).toBeVisible();

  await main
    .locator('.t-form__item')
    .filter({ hasText: /^等级：/ })
    .getByPlaceholder('请输入', { exact: true })
    .fill('A+');
  await main.getByRole('button', { name: '查询', exact: true }).click();
  await expect(main.getByText('超精品料', { exact: true })).toBeVisible();
  await expect(main.getByText('精品料', { exact: true })).toHaveCount(0);
  await main.getByRole('button', { name: '重置', exact: true }).click();

  await main
    .locator('.t-form__item')
    .filter({ hasText: '等级名称' })
    .getByPlaceholder('请输入', { exact: true })
    .fill('标准料');
  await main.getByRole('button', { name: '查询', exact: true }).click();
  await expect(main.getByText('标准料', { exact: true })).toBeVisible();
  await expect(main.getByText('超精品料', { exact: true })).toHaveCount(0);
  await main.getByRole('button', { name: '重置', exact: true }).click();

  await main.getByRole('button', { name: '新增', exact: true }).click();
  const formDialog = page.locator('.t-dialog').filter({ hasText: '新增等级' });
  await formDialog.getByPlaceholder('请输入等级', { exact: true }).fill('S');
  await formDialog.getByPlaceholder('请输入等级名称').fill('测试等级');
  await formDialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByText('已新增“S 测试等级”', { exact: true })).toBeVisible();

  const gradeRow = main.locator('tbody tr').filter({ hasText: '超精品料' });
  await gradeRow.getByText('编辑', { exact: true }).click();
  await expect(page.getByText('编辑等级', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await gradeRow.getByText('停用', { exact: true }).click();
  await expect(page.getByText('确认停用等级“A+ 超精品料”吗？', { exact: true })).toBeVisible();
});

test('hides grade operations without their permissions', async ({ page }) => {
  await page.addInitScript(() =>
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 24,
        name: '等级只读管理员',
        phone: '15926620024',
        roles: ['SLAB_GRADE_VIEWER'],
        permissions: ['admin.product-data-center.slab-grade.view'],
        dataPermission: 'all',
      }),
    ),
  );
  await page.goto('/slab-grade');
  const main = page.getByRole('main');
  const slabBaseDataMenu = page.locator('.menu-level-two').filter({ hasText: '大板基础数据' });
  await expect(slabBaseDataMenu.locator('.menu-level-three-item')).toHaveText(['等级管理']);
  await expect(main.getByText('超精品料', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: '新增', exact: true })).toHaveCount(0);
  await expect(main.locator('.table-actions .t-link')).toHaveCount(0);
});
