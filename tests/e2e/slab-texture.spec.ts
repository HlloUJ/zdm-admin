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

test('manages standard textures and multiple aliases from the third-level menu', async ({ page }) => {
  await page.goto('/slab-texture');
  const main = page.getByRole('main');
  const slabBaseDataMenu = page.locator('.menu-level-two').filter({ hasText: '大板基础数据管理' });
  await expect(slabBaseDataMenu.locator('.menu-level-three-item')).toHaveText([
    '品种管理',
    '产地管理',
    '纹理管理',
    '色系管理',
  ]);
  await expect(page.locator('[data-menu-path="/slab-texture"]')).toBeVisible();
  await expect(main.locator('.t-breadcrumb')).toHaveText(/商品基础数据中心.*大板基础数据管理.*纹理管理/);
  await expect(main.getByText('细纹', { exact: true })).toBeVisible();
  await expect(main.locator('tbody tr').filter({ hasText: '细纹' })).toContainText('1');

  await main
    .locator('.t-form__item')
    .filter({ hasText: '纹理' })
    .getByPlaceholder('请输入', { exact: true })
    .fill('不存在');
  await main.getByRole('button', { name: '查询', exact: true }).click();
  await expect(main.getByText('细纹', { exact: true })).toHaveCount(0);
  await main.getByRole('button', { name: '重置', exact: true }).click();

  await main
    .locator('.t-form__item')
    .filter({ hasText: '别名' })
    .getByPlaceholder('请输入', { exact: true })
    .fill('幼纹');
  await main.getByRole('button', { name: '查询', exact: true }).click();
  await expect(main.getByText('细纹', { exact: true })).toBeVisible();
  await expect(main.getByText('直纹', { exact: true })).toHaveCount(0);
  await main.getByRole('button', { name: '重置', exact: true }).click();

  const row = main.locator('tbody tr').filter({ hasText: '细纹' });
  await row.getByText('别名', { exact: true }).click();
  const aliasDialog = page.locator('.t-dialog').filter({ hasText: '别名管理 - 细纹' });
  await expect(aliasDialog.getByText('幼纹', { exact: true })).toBeVisible();
  await aliasDialog.getByRole('button', { name: '新增别名', exact: true }).click();
  await page.getByPlaceholder('请输入纹理别名').fill('细花纹');
  await page.locator('.t-dialog').filter({ hasText: '新增别名' }).getByRole('button', { name: '提交' }).click();
  await expect(page.getByText('已新增“细花纹”', { exact: true })).toBeVisible();
  await expect(aliasDialog.getByText('细花纹', { exact: true })).toBeVisible();
});

test('hides texture operations without operation permissions', async ({ page }) => {
  await page.addInitScript(() =>
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 22,
        name: '纹理只读管理员',
        phone: '15926620022',
        roles: ['SLAB_TEXTURE_VIEWER'],
        permissions: ['admin.product-data-center.slab-texture.view'],
        dataPermission: 'all',
      }),
    ),
  );
  await page.goto('/slab-texture');
  const main = page.getByRole('main');
  await expect(main.getByText('细纹', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: '新增', exact: true })).toHaveCount(0);
  await expect(main.locator('.table-actions .t-link')).toHaveCount(0);
});
