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
    await expect(main.locator('.t-tabs__nav-item')).toHaveText([
      '全部（2）',
      '仓库中（1）',
      '已上架（1）',
      '已售完（1）',
      '回收站（1）',
    ]);
    await expect(main.locator('.t-tabs__nav-item').first()).toHaveClass(/t-is-active/);
    await expect(main.getByRole('columnheader', { name: '创建人', exact: true })).toBeVisible();
    await expect(main.getByRole('columnheader', { name: '创建时间', exact: true })).toBeVisible();
    for (const header of await main.locator('thead th').all())
      await expect(header).toHaveCSS('text-align', (await header.getByRole('checkbox').count()) ? 'center' : 'left');
    for (const cell of await main.locator('tbody tr').first().locator('td').all())
      await expect(cell).toHaveCSS('text-align', (await cell.getByRole('checkbox').count()) ? 'center' : 'left');
    for (const label of ['商品状态', '状态变更时间', '入库时间', '上架时间'])
      await expect(main.getByRole('columnheader', { name: label, exact: true })).toHaveCount(0);
    await expect(main.getByRole('combobox', { name: '商品状态', exact: true })).toHaveCount(0);
    const rows = main.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('汇总商品-selling');
    await expect(rows.last()).toContainText('汇总商品-warehouse');
    await expect(rows.first()).toContainText('真实创建人');
    await expect(rows.first()).not.toContainText('本次状态操作人');
    await expect(main.locator('thead').getByRole('checkbox')).toHaveCount(1);
    await expect(main.getByRole('button', { name: '批量上架', exact: true })).toHaveCount(1);
    await expect(main.getByRole('button', { name: '批量下架', exact: true })).toHaveCount(0);
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
    const entryColumn = await main
      .getByRole('columnheader', { name: '入库类型 / 详细说明', exact: true })
      .evaluate((element) => (element as HTMLTableCellElement).cellIndex);
    await expect(rows.first().locator('td').nth(entryColumn)).toHaveText('-');
    await expect(rows.last().locator('td').nth(entryColumn)).toContainText('下架入库');
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
    await expect(main.locator('.t-tabs__nav-item')).toHaveText([
      '全部（1）',
      '仓库中（1）',
      '已上架（0）',
      '已售完（1）',
      '回收站（2）',
    ]);
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

async function enterSourceProductForm(page: Page, surface: Surface) {
  if (surface.kind !== 'slabs') {
    const picker = page.getByTestId('finished-category-picker');
    for (const name of [surface.kind === 'accessory-products' ? '配件' : '成品现货', '餐桌', '石材餐桌', '奢石餐桌']) {
      await picker.getByRole('button', { name, exact: true }).click();
    }
    await page.getByRole('button', { name: '确认，下一步', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '商品信息分区导航' })).toBeVisible();
  } else {
    await expect(page.getByRole('textbox', { name: '请输入大板编号' })).toBeVisible();
  }
}
for (const surface of surfaces.filter((s) => s.client === 'supply-chain')) {
  test(`${surface.path} global publishing works across tabs and hides shelving without its grant`, async ({ page }) => {
    const p = prefix(surface);
    await setup(page, surface, [`${p}.all.view`, `${p}.warehouse.view`, `${p}.selling.view`, `${p}.publish`]);
    const main = page.getByRole('main');
    for (const label of ['全部', '仓库中', '已上架']) {
      await main.locator('.t-tabs__nav-item').filter({ hasText: label }).click();
      await expect(main.getByRole('button', { name: '发布商品', exact: true })).toBeVisible();
      await expect(main.getByRole('button', { name: '操作日志', exact: true })).toHaveCount(0);
      await expect(main.locator('tbody tr').getByText('编辑', { exact: true })).toHaveCount(0);
    }
    await main.getByRole('button', { name: '发布商品', exact: true }).click();
    await enterSourceProductForm(page, surface);
    await expect(page.getByRole('radio', { name: '立刻上架', exact: true })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: '暂不上架', exact: true })).toHaveCount(0);
  });
  test(`${surface.path} shelving grant reveals the field with warehouse selected by default`, async ({ page }) => {
    const p = prefix(surface);
    await setup(page, surface, [`${p}.warehouse.view`, `${p}.publish`, `${p}.warehouse.shelf`]);
    await page.getByRole('main').getByRole('button', { name: '发布商品', exact: true }).click();
    await enterSourceProductForm(page, surface);
    await expect(page.getByRole('radio', { name: '立刻上架', exact: true })).toBeEnabled();
    await expect(page.getByRole('radio', { name: '暂不上架', exact: true })).toBeChecked();
  });
}
for (const surface of surfaces.filter((s) => s.client === 'store')) {
  test(`${surface.path} one global product-center grant works in All and warehouse`, async ({ page }) => {
    const p = prefix(surface);
    await setup(page, surface, [`${p}.all.view`, `${p}.warehouse.view`, `${p}.selling.view`, `${p}.select`]);
    const main = page.getByRole('main');
    for (const label of ['全部', '仓库中']) {
      await main.locator('.t-tabs__nav-item').filter({ hasText: label }).click();
      await expect(main.getByRole('button', { name: '商品中心', exact: true })).toBeVisible();
      await expect(main.getByRole('button', { name: '操作日志', exact: true })).toHaveCount(0);
    }
    await main.locator('.t-tabs__nav-item').filter({ hasText: '已上架' }).click();
    await expect(main.getByRole('button', { name: '商品中心', exact: true })).toHaveCount(0);
  });
}

for (const surface of surfaces) {
  test(`${surface.path} creation time title and native triangles sort the full list before pagination`, async ({
    page,
  }) => {
    const records = await setup(page, surface);
    const base = records[0];
    records.splice(
      0,
      records.length,
      ...Array.from({ length: 15 }, (_, i) => ({
        ...base,
        id: 950 + i,
        productId: 950 + i,
        name: `创建排序-${String(i).padStart(2, '0')}`,
        createdAt: `2026-10-${String(i + 1).padStart(2, '0')}T09:00:00`,
      })),
    );
    await page.reload();
    const main = page.getByRole('main'),
      rows = main.locator('tbody tr');
    await expect(rows.first()).toContainText('创建排序-14');
    await main.locator('.t-pagination__btn-next').click();
    await expect(main.locator('.t-pagination__number.t-is-current')).toHaveText('2');
    await main.getByRole('button', { name: '创建时间', exact: true }).click();
    await expect(main.locator('.t-pagination__number.t-is-current')).toHaveText('1');
    await expect(rows.first()).toContainText('创建排序-00');
    await main.getByRole('button', { name: '创建时间', exact: true }).click();
    await expect(rows.first()).toContainText('创建排序-14');
    const header = main.getByRole('columnheader', { name: '创建时间', exact: true });
    await header.locator('.t-table__sort-icon').first().click();
    await expect(rows.first()).toContainText('创建排序-00');
    await header.locator('.t-table__sort-icon').last().click();
    await expect(rows.first()).toContainText('创建排序-14');
    await main.locator('.t-tabs__nav-item').filter({ hasText: '仓库中' }).click();
    await expect(main.getByRole('columnheader', { name: '入库时间', exact: true })).toBeVisible();
  });
}

test('warehouse entry combines full reason and detail with two-line secondary text and tooltip', async ({ page }) => {
  const surface = surfaces.find((s) => s.path === '/supply-chain/finished-stock-management')!;
  const records = await setup(page, surface);
  const full = '价格调整；' + '更新商品图片和价格后重新上架，'.repeat(30);
  await page.route(`**/api/admin/${surface.kind}`, (route) =>
    route.fulfill({
      json: { code: 0, data: [{ ...records[0], warehouseEntryDetail: full.slice('价格调整；'.length) }] },
    }),
  );
  await page.reload();
  const main = page.getByRole('main');
  const summary = main.locator('[data-entry-detail]');
  await expect(summary).toHaveText(full);
  await expect(summary).toHaveClass(/t-typography--secondary/);
  const metrics = await summary.evaluate((el) => {
    const clamp = el.querySelector('[style*="line-clamp"]') || el;
    const box = clamp.getBoundingClientRect();
    return {
      height: box.height,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      scrollHeight: clamp.scrollHeight,
      clamp: getComputedStyle(clamp).webkitLineClamp,
      font: parseFloat(getComputedStyle(el).fontSize),
      cellFont: parseFloat(getComputedStyle(el.closest('td')!).fontSize),
    };
  });
  expect(metrics.clamp).toBe('2');
  expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight * 2 + 1);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.height);
  expect(metrics.font).toBeLessThan(metrics.cellFont);
  const platform = main.locator('.store-text').first();
  const font = await platform.evaluate((el) => ({
    font: getComputedStyle(el).font,
    color: getComputedStyle(el).color,
  }));
  const summaryStyle = await summary.evaluate((el) => {
    const tag = el.closest('td')!.querySelector('.t-tag')!;
    const style = getComputedStyle(el);
    return {
      font: style.font,
      color: style.color,
      marginTop: style.marginTop,
      marginBottom: style.marginBottom,
      gap: el.getBoundingClientRect().top - tag.getBoundingClientRect().bottom,
    };
  });
  expect(summaryStyle.font).toBe(font.font);
  expect(summaryStyle.color).toBe(font.color);
  expect(summaryStyle.marginTop).toBe('0px');
  expect(summaryStyle.marginBottom).toBe('0px');
  expect(summaryStyle.gap).toBeLessThanOrEqual(metrics.lineHeight / 2);
  await summary.hover();
  await expect(page.locator('.t-popup__content:visible').getByText(full, { exact: true })).toBeVisible();
  const productId = main.locator('.product-code').first();
  await expect(productId).toHaveCSS('font-size', '12px');
  await expect(productId).toHaveCSS('line-height', '20px');
  await page.route(`**/api/admin/${surface.kind}`, (route) =>
    route.fulfill({ json: { code: 0, data: [{ ...records[0], warehouseEntryDetail: '调整后上架' }] } }),
  );
  await page.reload();
  await expect(summary).toHaveText('价格调整；调整后上架');
  await summary.hover();
  await expect(
    page.locator('.t-popup__content:visible').getByText('价格调整；调整后上架', { exact: true }),
  ).toHaveCount(0);
});
