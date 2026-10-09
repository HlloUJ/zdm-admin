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
                effectiveCoefficient: 2,
                sourceName: '本店餐桌',
              },
              {
                id: 12,
                parentId: 11,
                scope,
                name: '石材餐桌',
                status: 'enabled',
                effectiveCoefficient: 2,
                sourceName: '本店餐桌',
              },
            ]
          : [
              {
                id: 13,
                parentId: null,
                scope,
                name: '未配置配件',
                status: 'enabled',
                effectiveCoefficient: null,
                sourceName: '未配置',
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
          ? [{ id: 1, scope, categoryId: 11, roleId: null, targetName: '本店餐桌', coefficient: 2, status: 'enabled' }]
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
          status: 'enabled',
        },
      ];
    await route.fulfill({ json: { code: 0, message: 'ok', data } });
  });
  return requests;
}
const menu = (page: Page) => page.locator('.price-menu');
test('category tree integrates inherited prices and sets the selected target without an add flow', async ({ page }) => {
  const requests = await setup(page, ['price.finished.view', 'price.finished.create']);
  await page.goto('/store/price-configuration');
  await expect(menu(page).locator('.t-submenu__item')).toHaveText(['成品现货']);
  await expect(page.locator('.t-tabs')).toHaveCount(0);
  await expect(page.getByText('继承本店餐桌', { exact: true })).toBeVisible();
  await expect(page.getByText('分类生效系数', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增', exact: true })).toHaveCount(0);
  await page.getByRole('row').filter({ hasText: '石材餐桌' }).getByText('设置', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('石材餐桌', { exact: true })).toBeVisible();
  await dialog.locator('.t-input-number input').fill('2.5');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    scope: 'finished',
    body: { categoryId: 12, roleId: null, coefficient: 2.5 },
  });
  expect(requests.some((request) => request.path.includes('/discount'))).toBe(false);
});
test('product menus isolate category targets and role coefficients', async ({ page }) => {
  const requests = await setup(page, [
    'price.finished.view',
    'price.accessory.view',
    'price.accessory.create',
    'discount.finished.view',
    'discount.accessory.view',
  ]);
  await page.goto('/store/price-configuration');
  await expect(menu(page).locator('.t-submenu__item')).toHaveText(['成品现货', '配件', '成品现货', '配件']);
  await menu(page).locator('.t-submenu__item').filter({ hasText: '配件' }).first().click();
  await expect(page.getByRole('row').filter({ hasText: '未配置配件' })).toBeVisible();
  await expect(page.getByText('石材餐桌', { exact: true })).toHaveCount(0);
  await page.getByRole('row').filter({ hasText: '未配置配件' }).getByText('设置', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await dialog.locator('.t-input-number input').fill('3');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    scope: 'accessory',
    body: { categoryId: 13, roleId: null, coefficient: 3 },
  });
  await menu(page).locator('.t-submenu__item').filter({ hasText: '成品现货' }).last().click();
  await expect(page.getByRole('row').filter({ hasText: '店长' }).getByText('0.80', { exact: true })).toBeVisible();
  await menu(page).locator('.t-submenu__item').filter({ hasText: '配件' }).last().click();
  await expect(page.getByRole('row').filter({ hasText: '店长' }).getByText('0.90', { exact: true })).toBeVisible();
  await expect(page.getByText('设置', { exact: true })).toHaveCount(0);
});
test('batch settings submit explicit selected categories and a single coefficient', async ({ page }) => {
  const requests = await setup(page, [
    'price.finished.view',
    'price.finished.create',
    'price.finished.edit',
    'price.finished.batch-set',
  ]);
  await page.goto('/store/price-configuration');
  await expect(page.getByRole('button', { name: '批量设置' })).toBeDisabled();
  await page.locator('thead .t-checkbox').click();
  await expect(page.locator('thead input[type=checkbox]')).toBeChecked();
  await page.getByRole('button', { name: '批量设置' }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText(/已选择 2 个分类/)).toBeVisible();
  await dialog.locator('.t-input-number input').fill('2.2');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.find((request) => request.path.endsWith('/batch'))).toMatchObject({
    scope: 'finished',
    body: { categoryIds: [11, 12], coefficient: 2.2 },
  });
});
test('discount-only grants select the authorized scope and expose no category APIs or writes', async ({ page }) => {
  const requests = await setup(page, ['discount.accessory.view']);
  await page.goto('/store/price-configuration');
  await expect(menu(page).locator('.t-submenu__item')).toHaveText(['配件']);
  await expect(page.getByRole('row').filter({ hasText: '店长' }).getByText('0.90', { exact: true })).toBeVisible();
  await expect(page.getByText('设置', { exact: true })).toHaveCount(0);
  expect(
    requests.every(
      (request) => request.method === 'GET' && request.scope === 'accessory' && !request.path.includes('/price'),
    ),
  ).toBe(true);
});
test('historical unscoped grants do not grant the new product-specific settings', async ({ page }) => {
  const requests = await setup(page, ['view', 'create', 'price.view', 'discount.view']);
  await page.goto('/store/price-configuration');
  await expect(page).not.toHaveURL(/store\/price-configuration$/);
  await expect(page.locator('.side-nav').getByText('价格配置', { exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});
