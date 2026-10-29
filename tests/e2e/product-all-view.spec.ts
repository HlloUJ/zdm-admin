import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
import { installAdminApiMocks as installAccessoryApiMocks } from './accessory-api-mocks';
const surfaces = [
  { path: '/finished-stock-management', client: 'admin', kind: 'finished-products' },
  { path: '/accessory-management', client: 'admin', kind: 'accessory-products' },
  { path: '/slab-management', client: 'admin', kind: 'slabs' },
  { path: '/supply-chain/finished-stock-management', client: 'supply-chain', kind: 'finished-products' },
  { path: '/supply-chain/accessory-management', client: 'supply-chain', kind: 'accessory-products' },
  { path: '/supply-chain/slab-management', client: 'supply-chain', kind: 'slabs' },
  { path: '/store/finished-stock-management', client: 'store', kind: 'store-finished-products' },
  { path: '/store/accessory-management', client: 'store', kind: 'store-accessory-products' },
];
type Surface = (typeof surfaces)[number];
const prefix = (surface: Surface) => `${surface.client}.${surface.path.split('/').at(-1)}`;
async function setup(page: Page, surface: Surface, permissions = ['all']) {
  await (surface.kind.includes('accessory') ? installAccessoryApiMocks : installAdminApiMocks)(page);
  await page.addInitScript(
    ({ surface, permissions }) => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          identityId: 1,
          name: '测试人员',
          clientCode: surface.client === 'store' ? 'admin' : surface.client,
          permissions,
          roles: ['OPERATOR'],
          dataPermission: 'all',
          ...(surface.client === 'store' ? { tenantId: 1, storeId: 2, storeType: 'cityPartner' } : {}),
        }),
      );
    },
    { surface, permissions },
  );
  const records = ['warehouse', 'selling', 'soldOut', 'recycle'].map((state, i) => ({
    id: 900 + i,
    productId: 900 + i,
    name: `汇总商品-${state}`,
    sku: `ALL-${i}`,
    serialNo: `ALL-${i}`,
    status: state,
    sourceStatus: surface.client === 'supply-chain' ? state : 'selling',
    effectiveStatus: state,
    sourceUnavailable: false,
    createdByName: '真实创建人',
    createdAt: `2026-10-0${i + 1}T09:00:00`,
    stateOperatorName: '本次状态操作人',
    stateOperatedAt: '2026-10-29T09:00:00Z',
    warehouseEntryType: state === 'warehouse' ? 'offShelf' : null,
    warehouseEntryReason: state === 'warehouse' ? '价格调整' : null,
    warehouseEntryDetail: null,
    stock: 2,
    totalStock: 2,
    variants: [],
    attributes: [],
    skus: [],
    specDimensions: [],
    markupPrices: [],
    guidePrices: [],
    offShelfRecords: [],
    imageUrls: [],
    mainImageUrls: [],
    attributeNames: {},
  }));
  await page.route(`**/api/admin/${surface.kind}`, (route) => route.fulfill({ json: { code: 0, data: records } }));
  await page.route(`**/api/admin/${surface.kind}/categories`, (route) =>
    route.fulfill({ json: { code: 0, data: [] } }),
  );
  await page.route(`**/api/admin/${surface.kind}/attribute-template-options`, (route) =>
    route.fulfill({ json: { code: 0, data: [] } }),
  );
  await page.goto(surface.path);
  return records;
}
for (const surface of surfaces) {
  test(`${surface.path} defaults to All with real creation, ID tags and state-specific actions`, async ({ page }) => {
    await setup(page, surface);
    const main = page.getByRole('main');
    await expect(main.locator('.t-tabs__nav-item').first()).toContainText('全部');
    await expect(main.locator('.t-tabs__nav-item').first()).toHaveClass(/t-is-active/);
    await expect(main.getByRole('columnheader', { name: '创建人', exact: true })).toBeVisible();
    await expect(main.getByRole('columnheader', { name: '创建时间', exact: true })).toBeVisible();
    for (const label of ['商品状态', '状态变更时间', '入库时间', '上架时间'])
      await expect(main.getByRole('columnheader', { name: label, exact: true })).toHaveCount(0);
    await expect(main.getByRole('combobox', { name: '商品状态', exact: true })).toHaveCount(0);
    const rows = main.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('汇总商品-selling');
    await expect(rows.last()).toContainText('汇总商品-warehouse');
    await expect(rows.first()).toContainText('真实创建人');
    await expect(rows.first()).not.toContainText('本次状态操作人');
    await expect(main.locator('thead').getByRole('checkbox')).toHaveCount(0);
    await expect(main.getByRole('button', { name: /批量上架|批量下架/ })).toHaveCount(0);
    for (const [state, label, action] of [
      ['warehouse', '仓库中', '上架'],
      ['selling', '已上架', '下架'],
    ]) {
      const row = rows.filter({ hasText: `汇总商品-${state}` });
      const product = row
        .locator(surface.kind === 'slabs' ? '.slab-code' : '.product-code')
        .filter({ hasText: 'ID：' });
      await expect(product.locator('.t-tag')).toHaveText(label);
      await expect(product.locator('.t-tag')).toHaveClass(state === 'selling' ? /t-tag--success/ : /t-tag--default/);
      await expect(row.getByText(action, { exact: true })).toBeVisible();
      await expect(row.getByText('编辑', { exact: true })).toBeVisible();
      await expect(row.getByText('删除', { exact: true })).toBeVisible();
    }
    await expect(rows.last()).toContainText('价格调整');
    await expect(rows.first()).not.toContainText('下架入库');
    if (surface.client === 'supply-chain')
      await expect(main.getByRole('button', { name: '发布商品', exact: true })).toBeVisible();
    if (surface.client === 'store')
      await expect(main.getByRole('button', { name: '商品中心', exact: true })).toBeVisible();
  });
  test(`${surface.path} All never grants an unauthorized state or action`, async ({ page }) => {
    await setup(page, surface, [
      `${prefix(surface)}.all.view`,
      `${prefix(surface)}.warehouse.view`,
      `${prefix(surface)}.warehouse.edit`,
    ]);
    const main = page.getByRole('main');
    const rows = main.locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('汇总商品-warehouse');
    await expect(rows.first().getByText('编辑', { exact: true })).toBeVisible();
    await expect(rows.first().getByText('上架', { exact: true })).toHaveCount(0);
    await expect(rows.first().getByText('删除', { exact: true })).toHaveCount(0);
    await expect(main.getByText('汇总商品-selling', { exact: true })).toHaveCount(0);
    await expect(main.locator('.t-tabs__nav-item')).toHaveCount(2);
  });
}

for (const surface of surfaces) {
  test(`${surface.path} deletion in All removes the row without leaving All`, async ({ page }) => {
    const records = await setup(page, surface);
    let writes = 0;
    await page.route(`**/api/admin/${surface.kind}**`, async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (path.endsWith('/action-check')) return route.fulfill({ json: { code: 0, data: true } });
      if (request.method() !== 'GET') {
        writes++;
        const body = request.postDataJSON();
        if (surface.kind === 'slabs') expect(path).toBe('/api/admin/slabs/901/delete');
        else {
          expect(body.target ?? body.status).toBe('recycle');
          expect(body.operation).toBeUndefined();
        }
        const row = records[1];
        row.status = row.effectiveStatus = 'recycle';
        if (surface.client === 'supply-chain') row.sourceStatus = 'recycle';
        return route.fulfill({ json: { code: 0, data: surface.kind === 'slabs' ? true : row } });
      }
      if (path === `/api/admin/${surface.kind}`) return route.fulfill({ json: { code: 0, data: records } });
      if (path.endsWith('/901')) return route.fulfill({ json: { code: 0, data: records[1] } });
      return route.fallback();
    });
    const main = page.getByRole('main');
    await main.locator('tbody tr').filter({ hasText: '汇总商品-selling' }).getByText('删除', { exact: true }).click();
    await page
      .locator('.t-dialog:visible')
      .getByRole('button', { name: /^确认删除(?:至回收站)?$/, exact: true })
      .click();
    await expect(main.locator('tbody tr').filter({ hasText: '汇总商品-selling' })).toHaveCount(0);
    await expect(main.locator('.t-tabs__nav-item').first()).toHaveClass(/t-is-active/);
    await expect(main.locator('tbody tr').filter({ hasText: '汇总商品-warehouse' })).toHaveCount(1);
    expect(writes).toBe(1);
  });
  test(`${surface.path} All without any underlying state grant cannot display products`, async ({ page }) => {
    await setup(page, surface, [`${prefix(surface)}.all.view`]);
    await expect(page.getByRole('main').getByText('汇总商品-warehouse', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('main').getByText('汇总商品-selling', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('main').locator('.t-tabs__nav-item')).toHaveCount(0);
    const moduleName = surface.path.endsWith('slab-management')
      ? '大板管理'
      : surface.path.endsWith('accessory-management')
        ? '配件管理'
        : '成品现货管理';
    await expect(page.locator('.admin-side-menu').getByText(moduleName, { exact: true })).toHaveCount(0);
  });
}
