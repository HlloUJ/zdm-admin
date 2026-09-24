import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

const ok = (data: unknown) => ({ code: 0, message: 'ok', data });
const permissions = [
  'store.finished-stock-management.warehouse.view',
  'store.finished-stock-management.warehouse.select',
  'store.finished-stock-management.warehouse.detail',
  'store.finished-stock-management.warehouse.price',
  'store.finished-stock-management.warehouse.shelf',
  'store.finished-stock-management.selling.view',
  'store.finished-stock-management.selling.detail',
  'store.finished-stock-management.selling.price',
  'store.finished-stock-management.selling.off-shelf',
  'store.finished-stock-management.unavailable.purge',
  'store.finished-stock-management.operation-log.view',
  'store.price-configuration.view',
  'store.price-configuration.create',
];

async function storeLogin(page: Page) {
  await installAdminApiMocks(page);
  await page.addInitScript((grants) => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 7,
        name: '门店员工',
        clientCode: 'admin',
        tenantId: 1,
        storeId: 2,
        storeType: 'cityPartner',
        roles: ['STORE_ADMIN'],
        permissions: grants,
        dataPermission: 'all',
      }),
    );
  }, permissions);
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    productId: 91,
    name: '门店测试商品',
    merchantCode: 'STORE-91',
    status: 'warehouse',
    effectiveStatus: 'warehouse',
    sourceUnavailable: false,
    totalStock: 3,
    imageUrls: [],
    detail: '<p>门店商品详情</p>',
    attributes: [{ attributeId: 1, attributeName: '材质', value: '天然石' }],
    specDimensions: [],
    skus: [
      {
        skuId: 101,
        label: '标准规格',
        stock: 3,
        costPrice: 100,
        guidePrice: 150,
        guideSource: 'auto',
        rolePrices: [{ roleId: 8, roleName: '店长', coefficient: 0.8, price: 80, priceSource: 'auto' }],
      },
    ],
    ...overrides,
  };
}

test('store uses a direct menu, selects an operations product, and edits only its own price', async ({ page }) => {
  await storeLogin(page);
  let records: ReturnType<typeof product>[] = [];
  let guideWrites = 0;
  await page.route('**/api/admin/store-finished-products', (route) => route.fulfill({ json: ok(records) }));
  await page.route('**/api/admin/store-finished-products/pool', (route) =>
    route.fulfill({
      json: ok([{ id: 91, name: '门店测试商品', merchantCode: 'STORE-91', totalStock: 3, supplierName: '平台供应商' }]),
    }),
  );
  await page.route('**/api/admin/store-finished-products/select', (route) => {
    records = [product()];
    return route.fulfill({ json: ok(records) });
  });
  await page.route('**/api/admin/store-finished-products/41', (route) => route.fulfill({ json: ok(records[0]) }));
  await page.route('**/api/admin/store-finished-products/41/skus/101/guide-price', (route) => {
    guideWrites++;
    records[0] = product({ skus: [{ ...product().skus[0], guidePrice: 140, guideSource: 'manual' }] });
    return route.fulfill({ json: ok(records[0]) });
  });

  await page.goto('/store/finished-stock-management');
  const menu = page.getByRole('complementary');
  await expect(menu.getByText('成品现货管理', { exact: true })).toBeVisible();
  await expect(menu.getByText('价格配置', { exact: true })).toBeVisible();
  await expect(menu.getByText('商品管理', { exact: true })).toHaveCount(0);
  const main = page.getByRole('main');
  await expect(main.getByText('暂无商品')).toBeVisible();
  await main.getByRole('button', { name: '挑选商品' }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('门店测试商品')).toBeVisible();
  await dialog.locator('tbody .t-checkbox').click();
  await dialog.getByRole('button', { name: '提交' }).click();
  await expect(main.getByText('门店测试商品')).toBeVisible();
  await main.getByText('价格', { exact: true }).click();
  const drawer = page.locator('.t-drawer:visible');
  await expect(drawer.getByText('100.00').last()).toBeVisible();
  await expect(drawer.getByText('运营端指导价')).toBeVisible();
  await expect(drawer.getByText('0.8')).toBeVisible();
  await expect(drawer.getByText('指导价（系数')).toHaveCount(0);
  await drawer.locator('.t-input-number input').first().fill('140');
  await drawer.getByRole('button', { name: '保存指导价' }).click();
  await expect.poll(() => guideWrites).toBe(1);
});

test('upstream unavailable row is masked, with detail and purge only', async ({ page }) => {
  await storeLogin(page);
  const blocked = product({
    status: 'selling',
    effectiveStatus: 'selling',
    sourceUnavailable: true,
    sourceMessage: '该商品已被供应链下架或删除',
  });
  await page.route('**/api/admin/store-finished-products', (route) => route.fulfill({ json: ok([blocked]) }));
  await page.route('**/api/admin/store-finished-products/41', (route) => route.fulfill({ json: ok(blocked) }));
  await page.goto('/store/finished-stock-management');
  await page.getByText(/出售中（1）/).click();
  const overlay = page.locator('.source-unavailable-overlay');
  await expect(overlay).toContainText('供应链下架');
  await expect(overlay.getByRole('button', { name: '详情' })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '彻底删除' })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '下架' })).toHaveCount(0);
  await overlay.getByRole('button', { name: '详情' }).click();
  await expect(page.locator('.t-drawer:visible').getByText('门店商品详情')).toBeVisible();
});

test('store price configuration has roles and coefficients without tabs or guide settings', async ({ page }) => {
  await storeLogin(page);
  await page.route('**/api/admin/store-finished-price-configurations', (route) =>
    route.fulfill({
      json: ok([
        {
          id: 1,
          roleId: 8,
          roleName: '店长',
          priceCoefficient: 0.8,
          status: 'enabled',
          createdAt: '2026-09-24T10:00:00',
        },
      ]),
    }),
  );
  await page.route('**/api/admin/store-finished-price-configurations/roles', (route) =>
    route.fulfill({
      json: ok([
        { id: 8, name: '店长', status: 'enabled' },
        { id: 9, name: '导购', status: 'enabled' },
      ]),
    }),
  );
  await page.goto('/store/price-configuration');
  const main = page.getByRole('main');
  await expect(main.getByText('店长', { exact: true })).toBeVisible();
  await expect(main.getByText('0.8000')).toBeVisible();
  await expect(main.locator('.t-tabs')).toHaveCount(0);
  await expect(main.getByText('指导价设置')).toHaveCount(0);
  await main.getByRole('button', { name: '新增' }).click();
  await expect(page.locator('.t-dialog:visible').getByText('角色', { exact: true })).toBeVisible();
});

test('store operation logs show the same filter, pagination, and detail structure', async ({ page }) => {
  await storeLogin(page);
  await page.route('**/api/admin/store-finished-products', (route) => route.fulfill({ json: ok([]) }));
  const log = {
    id: 1,
    productId: 91,
    productName: '门店测试商品',
    operationType: 'PRICE_UPDATE',
    operationSummary: '修改本店指导价',
    operatorName: '门店员工',
    operatedAt: '2026-09-24T10:00:00',
    beforeStatus: 'warehouse',
    afterStatus: 'warehouse',
    changeDetails: '{"指导价":{"before":150,"after":140}}',
  };
  await page.route('**/api/admin/store-finished-products/operation-logs?**', (route) =>
    route.fulfill({ json: ok({ records: [log], total: 1 }) }),
  );
  await page.route('**/api/admin/store-finished-products/operation-logs/1', (route) =>
    route.fulfill({ json: ok(log) }),
  );
  await page.goto('/store/finished-stock-management');
  await page.getByRole('main').getByText('操作日志').click();
  const drawer = page.locator('.t-drawer:visible');
  await expect(drawer.getByText('门店测试商品')).toBeVisible();
  await expect(drawer.getByText('修改价格')).toBeVisible();
  await expect(drawer.getByRole('columnheader', { name: '操作类型' })).toBeVisible();
  await expect(drawer.getByRole('columnheader', { name: '操作时间' })).toBeVisible();
  await expect(drawer.locator('.t-pagination')).toBeVisible();
  await drawer.getByText('详情', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('状态变化')).toBeVisible();
  await expect(dialog.getByText('变更对比')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '本店指导价' })).toBeVisible();
});
