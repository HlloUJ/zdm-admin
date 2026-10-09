import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
async function setup(page: Page, grants: string[]) {
  await installAdminApiMocks(page);
  await page.addInitScript(
    (permissions) => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          clientCode: 'admin',
          name: '测试员工',
          roles: ['EMPLOYEE'],
          tenantId: 1,
          storeId: 1,
          storeType: 'cityPartner',
          dataPermission: 'self',
          permissions,
        }),
      );
    },
    grants.map((grant) => `store.price-configuration.${grant}`),
  );
  const requests: { method: string; path: string; scope: string | null; body: unknown }[] = [];
  await page.route('**/api/admin/store-price-rules/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const scope = url.searchParams.get('scope');
    requests.push({ method: route.request().method(), path, scope, body: route.request().postDataJSON() });
    let data: unknown = [];
    if (path.endsWith('/categories'))
      data =
        scope === 'finished'
          ? [
              {
                id: 11,
                parentId: null,
                scope,
                name: '本店餐桌',
                status: 'enabled',
              },
              {
                id: 12,
                parentId: 11,
                scope,
                name: '石材餐桌',
                status: 'enabled',
              },
            ]
          : [
              {
                id: 13,
                parentId: null,
                scope,
                name: '未配置配件',
                status: 'enabled',
              },
            ];
    else if (path.endsWith('/roles'))
      data = [
        { id: 7, name: '店长', status: 'enabled' },
        { id: 8, name: '导购', status: 'enabled' },
      ];
    else if (path.endsWith('/price'))
      data =
        scope === 'finished'
          ? [{ id: 1, scope, categoryId: 11, roleId: null, targetName: '本店餐桌', coefficient: 2 }]
          : [];
    else if (path.endsWith('/discount'))
      data = [
        {
          id: 2,
          scope,
          categoryId: null,
          roleId: 7,
          targetName: '店长',
          coefficient: scope === 'finished' ? 0.8 : 0.9,
        },
      ];
    await route.fulfill({ json: { code: 0, message: 'ok', data } });
  });
  return requests;
}
const menu = (page: Page) => page.locator('.price-menu');
test('category list has only explicit coefficients and no derived values or maintenance actions', async ({ page }) => {
  const requests = await setup(page, ['price.finished.view']);
  await page.goto('/store/price-configuration');
  await expect(menu(page).locator('.t-submenu__item')).toHaveText(['成品现货']);
  await expect(page.locator('thead th')).toHaveText(['分类名称', '本分类系数']);
  await expect(page.getByRole('row').filter({ hasText: '本店餐桌' }).getByText('2.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '石材餐桌' }).getByText('—', { exact: true })).toBeVisible();
  await expect(page.getByText(/继承本店餐桌/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '批量设置' })).toHaveCount(0);
  await expect(page.getByText('设置', { exact: true })).toHaveCount(0);
  expect(requests.every((request) => request.method === 'GET')).toBe(true);
});

test('price batch sets only explicitly selected categories with no single-record permission', async ({ page }) => {
  const requests = await setup(page, ['price.finished.view', 'price.finished.batch-set']);
  await page.goto('/store/price-configuration');
  await expect(page.getByRole('button', { name: '批量设置' })).toBeDisabled();
  await page.locator('thead .t-checkbox').click();
  await page.getByRole('button', { name: '批量设置' }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText(/已选择 2 个分类/)).toBeVisible();
  await dialog.locator('.t-input-number input').fill('2.2');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    path: '/api/admin/store-price-rules/price/batch',
    scope: 'finished',
    body: { targetIds: [11, 12], coefficient: 2.2 },
  });
  expect(
    requests.filter((request) => request.method !== 'GET').every((request) => request.path.endsWith('/batch')),
  ).toBe(true);
});

test('role batch stores discount only for the selected role and product type', async ({ page }) => {
  const requests = await setup(page, [
    'discount.finished.view',
    'discount.accessory.view',
    'discount.accessory.batch-set',
  ]);
  await page.goto('/store/price-configuration');
  await expect(page.getByRole('row').filter({ hasText: '店长' }).getByText('0.80', { exact: true })).toBeVisible();
  await menu(page).locator('.t-submenu__item').filter({ hasText: '配件' }).click();
  await expect(page.getByRole('row').filter({ hasText: '店长' }).getByText('0.90', { exact: true })).toBeVisible();
  await expect(page.locator('thead th')).toHaveText(['', '角色', '折扣系数', '折扣说明']);
  await page.getByRole('row').filter({ hasText: '导购' }).locator('.t-checkbox').click();
  await page.getByRole('button', { name: '批量设置' }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText(/已选择 1 个角色/)).toBeVisible();
  await dialog.locator('.t-input-number input').fill('1.2');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    path: '/api/admin/store-price-rules/discount/batch',
    scope: 'accessory',
    body: { targetIds: [8], coefficient: 1.2 },
  });
});

test('product menus isolate categories and view-only role coefficients', async ({ page }) => {
  const requests = await setup(page, ['price.finished.view', 'price.accessory.view', 'discount.accessory.view']);
  await page.goto('/store/price-configuration');
  await menu(page).locator('.t-submenu__item').filter({ hasText: '配件' }).first().click();
  await expect(page.getByRole('row').filter({ hasText: '未配置配件' })).toBeVisible();
  await expect(page.getByText('石材餐桌', { exact: true })).toHaveCount(0);
  await menu(page).locator('.t-submenu__item').filter({ hasText: '配件' }).last().click();
  await expect(page.getByRole('row').filter({ hasText: '店长' }).getByText('0.90', { exact: true })).toBeVisible();
  await expect(page.locator('thead input[type=checkbox]')).toHaveCount(0);
  expect(requests.every((request) => request.method === 'GET')).toBe(true);
});

test('historical unscoped grants do not grant the product-specific settings', async ({ page }) => {
  const requests = await setup(page, ['view', 'create', 'price.view', 'discount.view']);
  await page.goto('/store/price-configuration');
  await expect(page).not.toHaveURL(/store\/price-configuration$/);
  expect(requests).toHaveLength(0);
});
