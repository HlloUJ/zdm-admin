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
  const requests: { method: string; path: string; body: unknown }[] = [];
  await page.route('**/api/admin/store-price-rules/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push({ method: route.request().method(), path, body: route.request().postDataJSON() });
    let data: unknown = [];
    if (path.endsWith('/categories'))
      data = [
        {
          id: 11,
          parentId: null,
          scope: 'finished',
          name: '本店餐桌',
          status: 'enabled',
          effectiveCoefficient: 2,
          sourceName: '本店餐桌',
        },
        {
          id: 12,
          parentId: 11,
          scope: 'finished',
          name: '石材餐桌',
          status: 'enabled',
          effectiveCoefficient: 2,
          sourceName: '本店餐桌',
        },
        {
          id: 13,
          parentId: null,
          scope: 'accessory',
          name: '未配置配件',
          status: 'enabled',
          effectiveCoefficient: null,
          sourceName: '未配置',
        },
      ];
    else if (path.endsWith('/roles')) data = [{ id: 7, name: '店长', status: 'enabled' }];
    else if (path.endsWith('/price'))
      data = [
        {
          id: 1,
          categoryId: 11,
          roleId: null,
          targetName: '本店餐桌',
          coefficient: 2,
          status: 'enabled',
          createdAt: '2026-10-09T15:00:00',
        },
      ];
    else if (path.endsWith('/discount'))
      data = [{ id: 2, categoryId: null, roleId: 7, targetName: '店长', coefficient: 0.8, status: 'enabled' }];
    await route.fulfill({ json: { code: 0, message: 'ok', data } });
  });
  return requests;
}

test('category price configuration shows inheritance and saves only a store category rule', async ({ page }) => {
  const requests = await setup(page, ['price.view', 'price.create']);
  await page.goto('/store/price-configuration');
  await expect(page.locator('.t-tabs')).toHaveCount(0);
  await expect(page.getByText('2026/10/09 15:00', { exact: true })).toBeVisible();
  await page.getByText('分类生效系数', { exact: true }).click();
  await expect(page.getByText('门店默认', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('row').filter({ hasText: '未配置配件' }).getByText('未配置', { exact: true }),
  ).toHaveCount(2);
  await expect(page.getByText('成品现货 / 本店餐桌 / 石材餐桌', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await dialog.getByPlaceholder('请选择分类').click();
  await page.locator('.t-select-option').filter({ hasText: '成品现货 / 本店餐桌 / 石材餐桌' }).click();
  await dialog.locator('.t-input-number input').fill('2.5');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
    categoryId: 12,
    roleId: null,
    coefficient: 2.5,
  });
  expect(requests.some((request) => request.path.includes('/discount'))).toBe(false);
});

test('discount view alone hides other tab and all writes', async ({ page }) => {
  const requests = await setup(page, ['discount.view']);
  await page.goto('/store/price-configuration');
  await expect(page.getByText('店长', { exact: true })).toBeVisible();
  await expect(page.locator('th').getByText('折扣系数', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增', exact: true })).toHaveCount(0);
  await expect(page.locator('.t-tabs')).toHaveCount(0);
  expect(requests.some((request) => request.path.includes('/price/'))).toBe(false);
  expect(requests.every((request) => request.method === 'GET')).toBe(true);
});

test('historical cost multiplier grants cannot expose new configuration tabs', async ({ page }) => {
  const requests = await setup(page, ['view', 'create']);
  await page.goto('/store/price-configuration');
  await expect(page).not.toHaveURL(/store\/price-configuration$/);
  await expect(page.locator('.side-nav').getByText('价格配置', { exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});
