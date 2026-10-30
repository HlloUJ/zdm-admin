import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
import { installAdminApiMocks as installAccessoryApiMocks } from './accessory-api-mocks';
const surfaces = [
  { path: '/supply-chain/finished-stock-management', resource: 'finished-products', client: 'supply-chain' },
  { path: '/supply-chain/accessory-management', resource: 'accessory-products', client: 'supply-chain' },
  { path: '/supply-chain/slab-management', resource: 'slabs', client: 'supply-chain' },
  { path: '/store/finished-stock-management', resource: 'store-finished-products', client: 'store' },
  { path: '/store/accessory-management', resource: 'store-accessory-products', client: 'store' },
] as const;
for (const surface of surfaces)
  for (const tab of ['all']) {
    test(`${surface.path} ${tab} All-only batch uses one request, grouped failures and retains native availability`, async ({
      page,
    }) => {
      await (surface.resource.includes('accessory') ? installAccessoryApiMocks : installAdminApiMocks)(page);
      if (surface.resource !== 'slabs') {
        for (const option of ['attribute-template-options', 'price-level-options', 'categories'])
          await page.route(`**/api/admin/${surface.resource}/${option}`, (route) =>
            route.fulfill({ json: { code: 0, data: [] } }),
          );
      }
      const prefix = `${surface.client}.${surface.path.split('/').at(-1)}`;
      await page.addInitScript(
        ({ prefix, client }) => {
          localStorage.setItem('zdm-admin-token', 'dev-token');
          localStorage.setItem(
            'zdm-admin-user',
            JSON.stringify({
              id: 1,
              name: '运营批量测试',
              clientCode: client === 'store' ? 'admin' : client,
              ...(client === 'store' ? { tenantId: 1, storeId: 2, storeType: 'cityPartner' } : {}),
              roles: ['OPERATOR'],
              permissions: [
                `${prefix}.all.view`,
                `${prefix}.warehouse.view`,
                `${prefix}.selling.view`,
                `${prefix}.batch-shelf`,
              ],
              dataPermission: 'all',
            }),
          );
        },
        { prefix, client: surface.client },
      );
      const products = [71, 72, 73, 74, 75].map((id) => ({
        id,
        productId: id + 1000,
        effectiveStatus: id === 72 ? 'selling' : 'warehouse',
        name: `批量商品${id}`,
        status: id === 72 ? 'selling' : 'warehouse',
        sourceStatus: 'selling',
        sourceUnavailable: false,
        sourceMessage: '',
        createdAt: `2026-10-30T09:${id - 60}:00`,
        totalStock: 2,
        stock: 2,
        attributes: [],
        variants: [],
        offShelfRecords: [],
        specDimensions: [],
        skus: [],
        imageUrls: [],
        attributeNames: {},
        markupPrices: [],
        guidePrices: [],
      }));
      await page.route(`**/api/admin/${surface.resource}`, (route) =>
        route.fulfill({ json: { code: 0, data: products } }),
      );
      let requests = 0;
      await page.route(`**/api/admin/${surface.resource}/all-batch-shelf`, (route) => {
        requests++;
        const ids = route.request().postDataJSON().ids as number[];
        expect(new Set(ids)).toEqual(new Set(tab === 'all' ? [71, 72, 73, 74, 75] : [71, 73, 74, 75]));
        Object.assign(
          products.find((p) => p.id === 71)!,
          { status: 'selling', effectiveStatus: 'selling' },
        );
        for (const id of [73, 75])
          Object.assign(
            products.find((p) => p.id === id)!,
            { sourceStatus: 'warehouse', sourceUnavailable: true, sourceMessage: '该商品已被供应链下架' },
          );
        const failures = ids
          .filter((id) => id !== 71)
          .map((id) => ({
            id,
            code: 'VALIDATION_FAILED',
            reason:
              id === 72
                ? '已处于上架状态，不能重复上架'
                : id === 74
                  ? '缺少指导价配置，无法上架'
                  : '该商品已被供应链下架',
          }));
        return route.fulfill({
          json: { code: 0, data: { total: ids.length, successCount: 1, failureCount: failures.length, failures } },
        });
      });
      await page.goto(`${surface.path}?tab=${tab}`);
      const main = page.getByRole('main');
      const batch = main.getByRole('button', { name: '批量上架', exact: true });
      await expect(batch).toBeDisabled();
      await expect(main.locator('tbody tr')).toHaveCount(tab === 'all' ? 5 : 4);
      await main.locator('thead .t-checkbox__input').click();
      await batch.click();
      await page.locator('.t-dialog:visible').getByRole('button', { name: '确认批量上架', exact: true }).click();
      const result = page.locator('.t-dialog:visible').filter({ hasText: '批量上架结果' });
      await expect(result).toContainText(`成功上架1件，失败${tab === 'all' ? 4 : 3}件。`);
      await expect(result.getByRole('columnheader')).toHaveText(['商品ID', '失败原因']);
      const sourceFailure = result.getByRole('row').filter({ hasText: '该商品已被供应链下架' });
      await expect(sourceFailure).toHaveCount(1);
      await expect(sourceFailure).toContainText(surface.client === 'store' ? '1073' : '73');
      await expect(sourceFailure).toContainText(surface.client === 'store' ? '1075' : '75');
      await expect(result).toContainText('缺少指导价配置，无法上架');
      if (tab === 'all') await expect(result).toContainText('已处于上架状态，不能重复上架');
      expect(requests).toBe(1);
      await result.getByRole('button', { name: '确认', exact: true }).click();
      await expect(result).toBeHidden();
      await expect(main.locator('.source-unavailable-overlay')).toHaveCount(surface.client === 'store' ? 2 : 0);
      if (surface.client === 'store')
        await expect(main.locator('.source-unavailable-overlay').first()).toContainText('该商品已被供应链下架');
      await expect(main.locator('tbody input[type="checkbox"]:checked')).toHaveCount(0);
      await expect(batch).toBeDisabled();
      expect(requests).toBe(1);
    });
  }

test('supply slab warehouse uses the global grant with its unchanged partial-failure flow', async ({ page }) => {
  await installAdminApiMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        clientCode: 'supply-chain',
        name: '仓库权限验证',
        roles: ['OPERATOR'],
        dataPermission: 'all',
        permissions: ['supply-chain.slab-management.warehouse.view', 'supply-chain.slab-management.batch-shelf'],
      }),
    );
  });
  const products = [401, 402].map((id) => ({
    id,
    name: '仓库大板' + id,
    status: 'warehouse',
    sourceStatus: 'warehouse',
    stock: 2,
    offShelfRecords: [],
    attributes: [],
    markupPrices: [],
  }));
  await page.route('**/api/admin/slabs', (route) => route.fulfill({ json: { code: 0, data: products } }));
  const requests: number[][] = [];
  let allRequests = 0;
  await page.route('**/api/admin/slabs/all-batch-shelf', (route) => {
    allRequests++;
    return route.fulfill({ status: 500, json: { code: 500, message: '仓库不应调用全部接口' } });
  });
  await page.route('**/api/admin/slabs/batch-status', (route) => {
    const body = route.request().postDataJSON();
    expect(body.status).toBe('selling');
    requests.push(body.ids);
    if (body.ids[0] === 402)
      return route.fulfill({ status: 400, json: { code: 400, message: '库存不足', data: null } });
    Object.assign(
      products.find((p) => p.id === body.ids[0])!,
      { status: 'selling', sourceStatus: 'selling' },
    );
    return route.fulfill({ json: { code: 0, data: true } });
  });
  await page.goto('/supply-chain/slab-management?tab=warehouse');
  const main = page.getByRole('main');
  await expect(main.locator('tbody tr')).toHaveCount(2);
  await expect(main.getByText('上架', { exact: true })).toHaveCount(0);
  await main.locator('thead .t-checkbox__input').click();
  await main.getByRole('button', { name: '批量上架', exact: true }).click();
  await page.locator('.t-dialog:visible').getByRole('button', { name: '确认批量上架', exact: true }).click();
  await expect(page.getByText('已上架 1 个大板，未上架 1 个大板', { exact: true })).toBeVisible();
  await expect(main.locator('.t-alert')).toContainText('库存不足');
  await expect(main.locator('tbody .t-checkbox.t-is-checked')).toHaveCount(1);
  expect(requests).toEqual([[402], [401]]);
  expect(allRequests).toBe(0);
  await expect(page.locator('.t-dialog:visible').filter({ hasText: '批量上架结果' })).toHaveCount(0);
});

for (const [terminal, client, modules, entry] of [
  [
    '供应链协同系统',
    'supply-chain',
    ['finished-stock-management', 'accessory-management', 'slab-management'],
    '发布商品',
  ],
  ['城市合伙人门店管理后台', 'store', ['finished-stock-management', 'accessory-management'], '商品中心'],
] as const) {
  test(`${client} saves only the shared global batch-shelf grants without state or single-action grants`, async ({
    page,
  }) => {
    await installAdminApiMocks(page);
    await page.addInitScript(() => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          name: '权限验证',
          roles: ['SUPER_ADMIN'],
          permissions: ['all'],
          dataPermission: 'all',
        }),
      );
    });
    await page.goto('/terminal-function-allocation');
    const main = page.getByRole('main');
    await main.locator('.terminal-tabs').getByText(terminal, { exact: true }).click();
    await main.getByRole('button', { name: '清空全部', exact: true }).click();
    await main.locator('.permission-module-list').getByText('商品管理', { exact: true }).click();
    const matrix = main.locator('.permission-matrix');
    const globals = matrix
      .locator('tbody tr')
      .filter({ has: page.locator('.permission-tab-cell').getByText('页面全局', { exact: true }) });
    await expect(globals).toHaveCount(modules.length);
    for (let i = 0; i < modules.length; i++) {
      await expect(globals.nth(i).locator('.permission-action-grid .t-checkbox')).toHaveText([
        entry,
        '批量上架',
        '操作日志',
      ]);
      await globals.nth(i).getByText('批量上架', { exact: true }).click();
    }
    const saved = page.waitForRequest(
      (r) => r.method() === 'PUT' && r.url().endsWith(`/terminal-function-policies/${client}`),
    );
    await main.getByRole('button', { name: /^确认(?:新增|保存|配置权限)$/, exact: true }).click();
    expect((await saved).postDataJSON().functionPermissions.split(',').sort()).toEqual(
      modules.map((m) => `${client}.${m}.batch-shelf`).sort(),
    );
    await page.reload();
    await main.locator('.terminal-tabs').getByText(terminal, { exact: true }).click();
    await main.locator('.permission-module-list').getByText('商品管理', { exact: true }).click();
    for (let i = 0; i < modules.length; i++)
      await expect(globals.nth(i).getByRole('checkbox', { name: '批量上架', exact: true })).toBeChecked();
    const warehouseRows = matrix
      .locator('tbody tr')
      .filter({ has: page.locator('.permission-tab-cell').getByText('仓库中', { exact: true }) });
    await expect(warehouseRows).toHaveCount(modules.length);
    for (let i = 0; i < modules.length; i++)
      await expect(warehouseRows.nth(i).getByText('批量上架', { exact: true })).toHaveCount(0);
  });
}
