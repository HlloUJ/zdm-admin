import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

async function setup(page: Page, permissions: string[], clientCode = 'admin') {
  await installAdminApiMocks(page);
  await page.route('**/api/admin/finished-products/price-level-options', (route) =>
    route.fulfill({ json: { code: 0, message: 'ok', data: [] } }),
  );
  await page.route('**/api/admin/finished-products/attribute-template-options', (route) =>
    route.fulfill({ json: { code: 0, message: 'ok', data: [] } }),
  );
  await page.addInitScript(
    ({ permissions, clientCode }) => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 2,
          clientCode,
          name: '目录测试',
          roles: ['ADMIN_MANAGER'],
          permissions,
          dataPermission: 'all',
        }),
      );
    },
    { permissions, clientCode },
  );
}
const prefix = 'admin.finished-stock-management.';
test('hides finished stock menu without its permissions', async ({ page }) => {
  await setup(page, ['admin.slab-management.warehouse.view']);
  await page.goto('/slab-management');
  await expect(page.locator('.admin-side-menu').getByText('成品现货管理', { exact: true })).toHaveCount(0);
});
test('one tab hides rail and only grants requested row operation', async ({ page }) => {
  await setup(
    page,
    ['supply-chain.finished-stock-management.warehouse.view', 'supply-chain.finished-stock-management.warehouse.edit'],
    'supply-chain',
  );
  await page.goto('/supply-chain/finished-stock-management');
  const main = page.getByRole('main');
  await expect(main.getByText('意式轻奢岩板餐桌', { exact: true })).toBeVisible();
  await expect(main.locator('.status-tabs')).toHaveCount(0);
  await expect(main.locator('.table-actions .t-link')).toHaveText(['编辑']);
  await expect(main.getByRole('button', { name: '发布商品' })).toHaveCount(0);
  await expect(main.getByText('操作日志', { exact: true })).toHaveCount(0);
  await main.locator('.table-actions .t-link').getByText('编辑', { exact: true }).click();
  await expect(main.getByRole('radio', { name: '立刻上架', exact: true })).toBeDisabled();
  await expect(main.getByRole('radio', { name: '暂不上架', exact: true })).toBeEnabled();
});
test('multiple tabs exclude unauthorized default and fall back to selling', async ({ page }) => {
  await setup(page, [prefix + 'selling.view', prefix + 'sold-out.view']);
  const formOptionsLoaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/admin/finished-products/form-options' && response.ok(),
  );
  await page.goto('/finished-stock-management');
  // The tab rail renders before its option request finishes; keep the mocked route alive until it settles.
  await (await formOptionsLoaded).finished();
  const main = page.getByRole('main');
  await expect(main.locator('.status-tabs .t-tabs__nav-item')).toHaveText([/已上架/, /已售完/]);
  await expect(main.locator('.status-tabs .t-tabs__nav-item.t-is-active')).toContainText('已上架');
  await expect(main.locator('.table-actions .t-link')).toHaveCount(0);
});

test('log-only access does not expose unauthorized warehouse content', async ({ page }) => {
  await setup(page, [prefix + 'operation-log.view']);
  let listRequested = false;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/admin/finished-products') listRequested = true;
  });
  await page.goto('/finished-stock-management');
  const main = page.getByRole('main');
  await expect(main.getByText('操作日志', { exact: true })).toBeVisible();
  await expect(main.locator('.status-tabs')).toHaveCount(0);
  await expect(main.locator('table')).toHaveCount(0);
  await expect(main.getByRole('button', { name: '提交' })).toHaveCount(0);
  expect(listRequested).toBe(false);
});

for (const [status, scope] of [
  ['warehouse', 'warehouse'],
  ['selling', 'selling'],
  ['offShelf', 'off-shelf'],
  ['soldOut', 'sold-out'],
  ['recycle', 'recycle'],
]) {
  test(`operations ${status} opens read-only complete details and preserves list`, async ({ page }, testInfo) => {
    await setup(page, [prefix + scope + '.view', prefix + scope + '.detail']);
    const product = {
      id: 71,
      name: '详情验收商品',
      status,
      categoryId: 2,
      supplierId: 2,
      sourceStatus: status === 'selling' ? 'offShelf' : 'selling',
      sourceUnavailable: status === 'selling',
      publisherType: '平台发布',
      totalStock: 6,
      createdByName: '验收人员',
      createdAt: '2026-09-20T10:00:00',
      detail: '<p>完整图文资料</p>',
      attributes: [{ attributeId: 1, attributeName: '材质', value: '岩板' }],
      variants: [{ id: 81, variantLabel: '标准规格', stock: 6, costPrice: 88 }],
      guidePrices: [{ skuId: 81, costPrice: 88, priceCoefficient: 2, price: 176 }],
      markupPrices: [
        {
          skuId: 81,
          storeLevelId: 1,
          storeLevelName: '1级合伙人',
          costPrice: 88,
          priceCoefficient: 1.1,
          price: 96.8,
          priceSource: 'auto',
        },
      ],
    };
    let writes = 0;
    await page.route('**/api/admin/finished-products', (route) => {
      if (route.request().method() !== 'GET') writes++;
      return route.fulfill({ json: { code: 0, message: 'ok', data: [product] } });
    });
    await page.route('**/api/admin/finished-products/71', (route) => {
      if (route.request().method() !== 'GET') writes++;
      return route.fulfill({ json: { code: 0, message: 'ok', data: product } });
    });
    await page.goto('/finished-stock-management');
    const main = page.getByRole('main');
    if (status === 'selling') {
      const overlay = main.locator('.source-unavailable-overlay');
      await expect(overlay).toContainText('该商品已被供应链下架');
      await expect(overlay.getByRole('button', { name: '彻底删除', exact: true })).toHaveCount(0);
      const rowBox = await main.locator('tr.source-unavailable').boundingBox();
      const overlayBox = await overlay.boundingBox();
      const containerBox = await main.locator('.source-overlay-container').boundingBox();
      expect(Math.abs(overlayBox!.width - Math.min(rowBox!.width, containerBox!.width))).toBeLessThan(2);
      expect(Math.abs(overlayBox!.height - rowBox!.height)).toBeLessThan(2);
      await overlay.getByRole('button', { name: '详情', exact: true }).click();
    } else {
      await main.getByText('详情', { exact: true }).click();
    }
    const drawer = page.locator('.t-drawer:visible');
    await expect(drawer.getByText('完整图文资料', { exact: true })).toBeVisible();
    await expect(drawer.getByText('SKU ID：81', { exact: true })).toBeVisible();
    await expect(drawer.getByRole('columnheader', { name: '商家编码', exact: true })).toHaveCount(0);
    await expect(drawer.getByText('岩板', { exact: true })).toBeVisible();
    await expect(drawer.getByText('操作信息', { exact: true })).toHaveCount(0);
    await expect(drawer.locator('input,textarea')).toHaveCount(0);
    if (status === 'warehouse') {
      const idRow = drawer.locator('.t-descriptions tr').filter({ has: page.getByText('ID', { exact: true }) });
      await expect(idRow.locator('td').last()).toHaveAttribute('colspan', '5');
      await drawer.getByRole('button', { name: '全屏显示', exact: true }).click();
      const fullscreen = page.locator('.sales-fullscreen-panel.is-fullscreen');
      await expect(fullscreen.getByText('SKU ID：81', { exact: true })).toBeVisible();
      await expect(fullscreen.locator('thead th')).toHaveText(['商品规格', '成本价', '指导价', '1级合伙人', '库存']);
      const specCell = fullscreen.locator('tbody tr').first().locator('td').first();
      await expect(specCell).toContainText('标准规格');
      await expect(specCell.locator('.product-code')).toHaveText('SKU ID：81');
      await expect(fullscreen.getByRole('button', { name: '跟随配置', exact: true })).toBeDisabled();
      const box = await fullscreen.boundingBox();
      const viewport = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      }));
      expect(box?.width).toBe(viewport.width);
      expect(box?.height).toBe(viewport.height);
      await page.screenshot({ path: testInfo.outputPath('finished-detail-fullscreen.png') });
      await fullscreen.getByRole('button', { name: '还原', exact: true }).click();
      await expect(page.locator('.sales-fullscreen-panel.is-fullscreen')).toHaveCount(0);
      await expect(drawer).toBeVisible();
      await drawer.getByRole('button', { name: '全屏显示', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(page.locator('.sales-fullscreen-panel.is-fullscreen')).toHaveCount(0);
      await expect(drawer).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('finished-detail-cell.png') });
    }
    await drawer.locator('.t-drawer__close-btn').click();
    await expect(main.getByText('详情验收商品', { exact: true })).toBeVisible();
    expect(writes).toBe(0);
  });
}

test('operations role catalog exposes detail permission for all five finished stock statuses', async ({ page }) => {
  await setup(page, ['all']);
  await page.route(/\/api\/admin\/roles(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: [
          {
            id: 2,
            name: '运营管理平台角色',
            code: 'OPS_LISTED_LABEL_TEST',
            clientCode: 'admin',
            createdByClientCode: 'admin',
            dataScope: 'all',
            status: 'enabled',
            functionPermissions: `${prefix}selling.view,${prefix}selling.detail`,
          },
        ],
      },
    }),
  );
  await page.goto('/role-management');
  const row = page.locator('tbody tr').filter({ hasText: '运营管理平台角色' }).first();
  await row.getByText('权限', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '权限配置' });
  await dialog.locator('.permission-module-list').getByText('商品管理', { exact: true }).click();
  const rows = dialog.locator('.permission-matrix tbody tr');
  const first = rows.filter({ hasText: '成品现货管理页' }).first();
  const firstIndex = await first.evaluate((el) => Array.from(el.parentElement!.children).indexOf(el));
  const statusNames = ['仓库中', '已上架', '已下架', '已售完', '回收站'];
  for (const [index, label] of statusNames.entries()) {
    const statusRow = rows.nth(firstIndex + index + 1);
    await expect(statusRow.locator('.permission-tab-text')).toHaveText(label);
    await expect(statusRow.getByText('详情', { exact: true })).toBeVisible();
  }
  const listed = rows.nth(firstIndex + 2);
  await expect(listed.getByRole('checkbox', { name: '查看', exact: true })).toBeChecked();
  await expect(listed.getByRole('checkbox', { name: '详情', exact: true })).toBeChecked();
  await expect(listed.getByRole('checkbox', { name: '价格', exact: true })).not.toBeChecked();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
});

for (const sourceStatus of ['offShelf', 'recycle', 'warehouse', 'purged']) {
  test(`source availability ${sourceStatus} keeps operations blocked and distinguishes permanent deletion`, async ({
    page,
  }, testInfo) => {
    await setup(page, [prefix + 'selling.view', prefix + 'selling.detail', prefix + 'recycle.purge']);
    const product = {
      id: 72,
      name: '来源状态验收商品',
      status: 'selling',
      sourceStatus,
      sourceUnavailable: true,
      totalStock: 6,
      detail: '<p>保留商品资料</p>',
      attributes: [],
      variants: [{ id: 82, variantLabel: '标准规格', stock: 6, costPrice: 88 }],
      guidePrices: [],
      markupPrices: [],
    };
    await page.route('**/api/admin/finished-products', (route) =>
      route.fulfill({ json: { code: 0, message: 'ok', data: [product] } }),
    );
    await page.route('**/api/admin/finished-products/72', (route) =>
      route.fulfill({ json: { code: 0, message: 'ok', data: product } }),
    );
    await page.goto('/finished-stock-management');
    const overlay = page.getByRole('main').locator('.source-unavailable-overlay');
    await expect(overlay).toContainText(sourceStatus === 'purged' ? '该商品已被供应链删除' : '该商品已被供应链下架');
    await expect(overlay.getByRole('button')).toHaveText(['详情', '彻底删除']);
    await overlay.getByRole('button', { name: '详情', exact: true }).click();
    const drawer = page.locator('.t-drawer:visible');
    await expect(drawer.locator('.t-alert')).toContainText(
      sourceStatus === 'purged'
        ? '该商品已被供应链删除，当前仅可查看资料或按权限彻底删除。'
        : '该商品当前在供应链端未上架，暂不可进行运营操作。',
    );
    await expect(drawer.getByText('保留商品资料', { exact: true })).toBeVisible();
    await expect(drawer.locator('input,textarea')).toHaveCount(0);
    if (sourceStatus === 'recycle')
      await page.screenshot({
        path: testInfo.outputPath('finished-source-recycle-detail.png'),
        animations: 'disabled',
      });
  });
}

test('operations purge logs display actual previous state to permanently deleted', async ({ page }) => {
  await setup(page, ['all']);
  const states = [
    ['warehouse', '仓库中'],
    ['selling', '已上架'],
    ['offShelf', '已下架'],
    ['soldOut', '已售完'],
    ['recycle', '回收站'],
  ];
  const records = states.map(([beforeStatus, label], index) => ({
    id: index + 1,
    productId: 91,
    productName: `${label}删除状态验收`,
    operationType: 'PURGE',
    operationSummary: '彻底删除运营商品',
    beforeStatus,
    afterStatus: 'purged',
    operatorName: '测试人员',
    operatedAt: '2026-09-21T10:00:00',
    operationSource: 'MANUAL',
    changeDetails: '{}',
  }));
  await page.route('**/api/admin/finished-products/operation-logs?*', (route) =>
    route.fulfill({ json: { code: 0, data: { records, total: records.length } } }),
  );
  await page.route(/\/api\/admin\/finished-products\/operation-logs\/\d+$/, (route) => {
    const id = Number(route.request().url().split('/').pop());
    return route.fulfill({ json: { code: 0, data: records.find((record) => record.id === id) } });
  });
  await page.goto('/finished-stock-management');
  await page.getByRole('main').getByText('操作日志', { exact: true }).click();
  for (const [index, record] of records.entries()) {
    await page.getByRole('row').filter({ hasText: record.productName }).getByText('详情', { exact: true }).click();
    const detail = page.locator('.t-dialog:visible').filter({ hasText: '操作详情' });
    await expect(detail.getByText(`${states[index][1]} → 已彻底删除`, { exact: true })).toBeVisible();
    await detail.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(detail).toBeHidden();
  }
});

for (const [client, retryFailure] of [
  ['supply-chain', false],
  ['supply-chain', true],
  ['admin', false],
] as const) {
  test(`batch shelf serializes ${client} requests and retains only unfinished selections retry=${retryFailure}`, async ({
    page,
  }) => {
    await setup(page, ['all'], client);
    const products = [81, 82, 83].map((id) => ({
      id,
      name: `批量上架验收${id}`,
      status: 'warehouse',
      sourceStatus: client === 'supply-chain' ? 'warehouse' : 'selling',
      sourceUnavailable: false,
      categoryId: 2,
      supplierId: 2,
      publisherType: '平台发布',
      totalStock: 6,
      detail: '<p>商品详情</p>',
      attributes: [],
      variants: [{ id: id + 100, variantLabel: '标准规格', stock: 6, costPrice: 10 }],
      guidePrices: [],
      markupPrices: [],
    }));
    const attempts: number[] = [];
    let active = 0;
    let maximumActive = 0;
    let failedOnce = false;
    await page.route('**/api/admin/finished-products', (route) => route.fulfill({ json: { code: 0, data: products } }));
    await page.route(/\/api\/admin\/finished-products\/8[123]$/, async (route) => {
      const id = Number(route.request().url().split('/').pop());
      if (route.request().method() !== 'PUT') throw new Error('Unexpected method');
      expect(route.request().postDataJSON().status).toBe('selling');
      attempts.push(id);
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 100));
      active--;
      if (retryFailure && id === 82 && !failedOnce) {
        failedOnce = true;
        await route.fulfill({ status: 400, json: { code: 1, message: '第二个商品校验失败，请重试' } });
        return;
      }
      const product = products.find((item) => item.id === id)!;
      if (client === 'supply-chain') product.sourceStatus = 'selling';
      else product.status = 'selling';
      await route.fulfill({ json: { code: 0, data: product } });
    });
    await page.goto(client === 'admin' ? '/finished-stock-management' : '/supply-chain/finished-stock-management');
    const main = page.getByRole('main');
    await expect(main.getByText('批量上架验收83', { exact: true })).toBeVisible();
    await main.locator('thead .t-checkbox__input').click();
    await expect(main.locator('.selection-info')).toHaveText('已选 3 项');
    await main.getByRole('button', { name: '批量上架', exact: true }).click();
    const dialog = page.locator('.t-dialog:visible');
    await dialog.getByRole('button', { name: '确认批量上架', exact: true }).click();
    if (retryFailure) {
      await expect(page.getByText('第二个商品校验失败，请重试', { exact: true })).toBeVisible();
      expect(attempts).toEqual([83, 82]);
      await expect(main.locator('.selection-info')).toHaveText('已选 2 项');
      await expect(main.getByText('批量上架验收83', { exact: true })).toHaveCount(0);
      await dialog.getByRole('button', { name: '确认批量上架', exact: true }).click();
    }
    await expect(dialog).toBeHidden();
    await expect(main.locator('.selection-info')).toHaveText('已选 0 项');
    expect(attempts).toEqual(retryFailure ? [83, 82, 82, 81] : [83, 82, 81]);
    expect(maximumActive).toBe(1);
    await main.locator('.status-tabs .t-tabs__nav-item').filter({ hasText: '已上架' }).click();
    for (const product of products) await expect(main.getByText(product.name, { exact: true })).toBeVisible();
  });
}
