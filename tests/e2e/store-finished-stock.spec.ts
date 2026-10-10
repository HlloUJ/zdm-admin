import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

const ok = (data: unknown) => ({ code: 0, message: 'ok', data });
const permissions = [
  'store.finished-stock-management.warehouse.view',
  'store.finished-stock-management.warehouse.select',
  'store.finished-stock-management.warehouse.edit',
  'store.finished-stock-management.warehouse.shelf',
  'store.finished-stock-management.warehouse.delete',
  'store.finished-stock-management.warehouse.batch-shelf',
  'store.finished-stock-management.selling.view',
  'store.finished-stock-management.selling.edit',
  'store.finished-stock-management.selling.off-shelf',
  'store.finished-stock-management.selling.batch-off-shelf',
  'store.finished-stock-management.off-shelf.view',
  'store.finished-stock-management.off-shelf.batch-restore',
  'store.finished-stock-management.recycle.view',
  'store.finished-stock-management.recycle.batch-restore',
  'store.finished-stock-management.recycle.batch-purge',
  'store.finished-stock-management.recycle.clear',
  'store.finished-stock-management.operation-log.view',
  'store.price-configuration.price.finished.view',
  'store.price-configuration.price.finished.batch-set',
  'store.price-configuration.discount.finished.view',
  'store.price-configuration.discount.finished.batch-set',
];

async function storeLogin(page: Page) {
  await installAdminApiMocks(page);
  await page.route('**/api/admin/store-finished-products/categories', (route) => route.fulfill({ json: ok([]) }));
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
    createdByName: '门店创建员工',
    createdAt: '2026-10-08T12:34:56',
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

for (const displayMode of ['single', 'layered'] as const) {
  test(`${displayMode} product center shows price ranges and read-only details without supply costs`, async ({
    page,
  }) => {
    await storeLogin(page);
    const imageUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6bEAAAAASUVORK5CYII=';
    let writes = 0;
    await page.route('**/api/admin/store-finished-products**', (route) => {
      const request = route.request();
      if (request.method() !== 'GET') writes++;
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/pool-categories')) {
        return route.fulfill({
          json: ok([
            { id: 1, name: '家具' },
            { id: 2, parentId: 1, name: '桌椅' },
            { id: 3, parentId: 2, name: '餐桌' },
            { id: 4, name: '灯具' },
          ]),
        });
      }
      if (path.endsWith('/pool/91')) {
        return route.fulfill({
          json: ok({
            id: 91,
            name: '门店测试商品',
            merchantCode: 'STORE-91',
            totalStock: 5,
            imageUrls: [],
            categoryName: '家具 / 桌椅 / 餐桌',
            storeLevelName: '区域合作门店',
            attributeNames: { attribute_57: '销售属性（共享）', attribute_63: '销售属性（专属）' },
            supplierName: '平台供应商',
            detail: '<p>商品中心只读详情</p>',
            attributes: [{ attributeId: 1, attributeName: '材质', value: '天然石' }],
            specDimensions: [{ key: 'color', name: '颜色', values: ['白色', '黑色'] }],
            skus: [
              {
                skuId: 101,
                label: '白色',
                stock: 3,
                displayMode,
                salesAttributes: { color: '白色', attribute_57: '纹理 A', attribute_63: '光面' },
                guidePrice: 150,
                partnerPrice: 100,
              },
              {
                skuId: 102,
                label: '黑色',
                stock: 2,
                displayMode,
                salesAttributes: { color: '黑色', attribute_57: '纹理 B', attribute_63: '哑光' },
                guidePrice: 180,
                partnerPrice: 120,
              },
            ],
          }),
        });
      }
      if (path.endsWith('/pool')) {
        return route.fulfill({
          json: ok([
            {
              id: 91,
              name: '门店测试商品',
              merchantCode: 'STORE-91',
              totalStock: 5,
              imageUrl,
              storeLevelName: '区域合作门店',
              categoryId: 3,
              guidePriceMin: 150,
              guidePriceMax: 180,
              partnerPriceMin: 100,
              partnerPriceMax: 120,
            },
          ]),
        });
      }
      return route.fulfill({ json: ok([]) });
    });
    await page.goto('/store/finished-stock-management');
    await page.getByRole('button', { name: '商品中心' }).click();
    const dialog = page.locator('.t-dialog:visible');
    await expect(dialog.getByText('商品中心', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '批量选择', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '选择', exact: true })).toHaveCount(0);
    await expect(dialog.locator('.t-dialog__footer')).toHaveCount(0);
    await expect(dialog.locator('.toolbar-buttons').getByRole('button', { name: '批量选择', exact: true })).toHaveClass(
      /t-button--theme-primary/,
    );
    const keyword = dialog.getByPlaceholder('商品名称 / ID');
    const search = dialog.getByRole('button', { name: '查询', exact: true });
    const reset = dialog.getByRole('button', { name: '重置', exact: true });
    const initialInputWidth = await keyword.evaluate((element) => element.clientWidth);
    await keyword.fill('用于检查宽度是否稳定的很长商品名称或商品ID1234567890');
    expect(await keyword.evaluate((element) => element.clientWidth)).toBe(initialInputWidth);
    await expect
      .poll(async () => {
        const tableBox = (await dialog.locator('.t-table').boundingBox())!;
        const resetBox = (await reset.boundingBox())!;
        return Math.abs(resetBox.x + resetBox.width - tableBox.x - tableBox.width);
      })
      .toBeLessThanOrEqual(1);
    await keyword.fill('不存在');
    await expect(dialog.locator('tbody .t-checkbox')).toHaveCount(1);
    await search.click();
    await expect(dialog.locator('tbody .t-checkbox')).toHaveCount(0);
    await keyword.fill('91');
    await expect(dialog.locator('tbody .t-checkbox')).toHaveCount(0);
    await search.click();
    await expect(dialog.locator('tbody .t-checkbox')).toHaveCount(1);
    await reset.click();
    await expect(keyword).toHaveValue('');
    const category = dialog.locator('.t-form .t-select-input');
    await category.click();
    await page.getByText('灯具', { exact: true }).click();
    await expect(page.locator('.t-cascader-panel:visible')).toHaveCount(0);
    await expect(dialog.locator('tbody .t-checkbox')).toHaveCount(1);
    await search.click();
    await expect(dialog.locator('tbody .t-checkbox')).toHaveCount(0);
    await category.click();
    await page.getByText('家具', { exact: true }).hover();
    await page.getByText('桌椅', { exact: true }).hover();
    await page.getByText('餐桌', { exact: true }).click();
    await expect(category.getByText('餐桌', { exact: true })).toBeVisible();
    await expect(dialog.locator('tbody .t-checkbox')).toHaveCount(0);
    await search.click();
    await expect(dialog.locator('tbody .t-checkbox')).toHaveCount(1);
    await reset.click();
    await expect(category.getByText('餐桌', { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('columnheader', { name: '商品主图', exact: true })).toBeVisible();
    await expect(dialog.getByRole('columnheader', { name: '区域合作门店价', exact: true })).toBeVisible();
    await expect(dialog.getByRole('columnheader', { name: '合伙人价', exact: true })).toHaveCount(0);
    await expect(dialog.getByText('150.00 ~ 180.00', { exact: true })).toBeVisible();
    await expect(dialog.getByText('100.00 ~ 120.00', { exact: true })).toBeVisible();
    await dialog.locator('tbody .t-image').click();
    const imageDialog = page.locator('.t-dialog:visible').filter({ hasText: '商品主图' }).last();
    await expect(imageDialog.locator('img[alt="商品主图"]')).toHaveAttribute('src', imageUrl);
    await imageDialog.locator('.t-dialog__close').click();
    const selectButton = dialog.getByRole('button', { name: '批量选择', exact: true });
    await expect(selectButton).toBeEnabled();
    await selectButton.click();
    await expect(page.getByText('请先选择商品', { exact: true })).toBeVisible();
    expect(writes).toBe(0);
    expect((await dialog.boundingBox())!.width).toBeGreaterThan(1100);
    expect(
      (await dialog.getByRole('columnheader', { name: '商品名称/ID', exact: true }).boundingBox())!.width,
    ).toBeGreaterThan(400);
    await dialog.locator('thead .t-checkbox').click();
    await dialog.getByText('详情', { exact: true }).click();
    const drawer = page.locator('.t-drawer:visible');
    await expect(drawer.getByText('商品中心只读详情')).toBeVisible();
    await expect(drawer.getByText('基础信息', { exact: true })).toBeVisible();
    await expect(drawer.getByText('供应商', { exact: true })).toHaveCount(0);
    await expect(drawer.getByText('平台供应商', { exact: true })).toHaveCount(0);
    await expect(drawer.getByText('家具 / 桌椅 / 餐桌', { exact: true })).toBeVisible();
    await expect(drawer.getByRole('columnheader', { name: '销售属性（共享）', exact: true })).toBeVisible();
    await expect(drawer.getByRole('columnheader', { name: '销售属性（专属）', exact: true })).toBeVisible();
    await expect(drawer.getByText(/attribute_\d+/)).toHaveCount(0);
    if (displayMode === 'single') {
      await expect(drawer.getByText('SKU ID：101', { exact: true })).toBeVisible();
      await expect(drawer.getByText('SKU ID：102', { exact: true })).toBeVisible();
    } else await expect(drawer.getByText(/SKU ID/)).toHaveCount(0);
    await expect(drawer.getByText('销售信息', { exact: true })).toBeVisible();
    await expect(drawer.getByRole('columnheader', { name: '指导价', exact: true })).toBeVisible();
    await expect(drawer.getByRole('columnheader', { name: '区域合作门店价', exact: true })).toBeVisible();
    await expect(drawer.getByText('成本价', { exact: false })).toHaveCount(0);
    await expect(drawer.locator('input:visible, textarea:visible, .t-input-number:visible')).toHaveCount(0);
    await expect(drawer.getByRole('cell', { name: '100', exact: true })).toBeVisible();
    await expect(drawer.getByRole('cell', { name: '120', exact: true })).toBeVisible();
    await expect(drawer.getByRole('cell', { name: '白色', exact: true })).toBeVisible();
    expect(writes).toBe(0);
    await drawer.locator('.t-drawer__close-btn').click();
    await expect(dialog.locator('tbody .t-checkbox')).toHaveClass(/t-is-checked/);
  });
}

test('store uses a direct menu, selects an operations product, and edits only its own price', async ({ page }) => {
  await storeLogin(page);
  let records: ReturnType<typeof product>[] = [];
  let roleWrites = 0;
  await page.route('**/api/admin/store-finished-products', (route) => route.fulfill({ json: ok(records) }));
  await page.route('**/api/admin/store-finished-products/pool-categories', (route) => route.fulfill({ json: ok([]) }));
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
  await page.route('**/api/admin/store-finished-products/41/skus/101/roles/8/price', (route) => {
    roleWrites++;
    records[0] = product({
      skus: [
        {
          ...product().skus[0],
          rolePrices: [{ roleId: 8, roleName: '店长', coefficient: 0.8, price: 140, priceSource: 'manual' }],
        },
      ],
    });
    return route.fulfill({ json: ok(records[0]) });
  });

  await page.goto('/store/finished-stock-management');
  const menu = page.getByRole('complementary');
  await expect(menu.getByText('成品现货管理', { exact: true })).toBeVisible();
  await expect(menu.getByText('价格配置', { exact: true })).toBeVisible();
  await expect(menu.getByText('商品管理', { exact: true })).toHaveCount(0);
  const main = page.getByRole('main');
  await expect(main.locator('.filter-row')).toHaveCSS('display', 'flex');
  await expect(main.locator('.filter-fields')).toHaveCSS('display', 'grid');
  await expect(main.locator('.table-toolbar')).toHaveCSS('display', 'flex');
  await expect(main.getByText('暂无商品')).toBeVisible();
  await main.getByRole('button', { name: '商品中心' }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('门店测试商品')).toBeVisible();
  await dialog.locator('tbody .t-checkbox').click();
  await dialog.getByRole('button', { name: '批量选择', exact: true }).click();
  await expect(main.getByText('门店测试商品')).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '创建人', exact: true })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '创建时间', exact: true })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '挑选时间', exact: true })).toHaveCount(0);
  await expect(main.getByRole('columnheader', { name: '商品主图', exact: true })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '供应商', exact: true })).toHaveCount(0);
  await expect(main.getByRole('columnheader', { name: '统一库存', exact: true })).toHaveCount(0);
  await expect(main.getByRole('cell', { name: '门店创建员工', exact: true })).toBeVisible();
  await expect(main.getByRole('cell', { name: '2026/10/08 12:34', exact: true })).toBeVisible();
  const columns = await main.locator('thead th').allTextContents();
  expect(columns.indexOf('创建人')).toBeLessThan(columns.indexOf('创建时间'));
  await expect(main.locator('.product-code')).toHaveCSS('font-size', '12px');
  await expect(main.locator('th.t-table__th-operation')).toHaveCSS('width', '190px');
  await main.getByText(/出售中（0）/).click();
  await expect(main.getByText('暂无商品')).toBeVisible();
  await main.getByText(/仓库中（1）/).click();
  await expect(main.getByText('门店测试商品')).toBeVisible();
  await main.getByText('编辑', { exact: true }).click();
  const drawer = page.locator('.t-drawer:visible');
  await expect(drawer.getByText('100.00').last()).toBeVisible();
  await expect(drawer.getByRole('cell', { name: '运营端指导价' })).toBeVisible();
  await expect(drawer.getByText('0.8')).toBeVisible();
  await expect(drawer.getByText('指导价（系数')).toHaveCount(0);
  await drawer.getByText('手工价格', { exact: true }).click();
  await drawer.locator('.t-input-number input').first().fill('140');
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => roleWrites).toBe(1);
  await expect(drawer.getByRole('cell', { name: '运营端指导价' })).toBeVisible();
});

test('upstream unavailable row is masked, with detail and purge only', async ({ page }) => {
  await storeLogin(page);
  const blocked = product({
    status: 'selling',
    effectiveStatus: 'selling',
    sourceUnavailable: true,
    sourceMessage: '该商品已被供应链下架或删除',
    categoryName: '家具 / 桌椅 / 餐桌',
    storeLevelName: '华东中心店',
    attributeNames: { attribute_57: '销售纹理（共享）' },
    skus: [{ ...product().skus[0], salesAttributes: { attribute_57: '天然纹理' } }],
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
  const detail = page.locator('.t-drawer--open');
  await expect(detail.getByText('门店商品详情')).toBeVisible();
  await expect(detail.getByText('家具 / 桌椅 / 餐桌', { exact: true })).toBeVisible();
  await expect(detail.getByText('本店状态', { exact: true })).toHaveCount(0);
  await expect(detail.getByText('供应商', { exact: true })).toHaveCount(0);
  await expect(detail.getByRole('columnheader', { name: '华东中心店价', exact: true })).toBeVisible();
  await expect(detail.getByRole('columnheader', { name: '指导价', exact: true })).toBeVisible();
  await expect(detail.getByRole('columnheader', { name: '销售纹理（共享）', exact: true })).toBeVisible();
  await expect(detail.getByText('attribute_57', { exact: true })).toHaveCount(0);
  await expect(detail.getByText('本店成本价', { exact: true })).toHaveCount(0);
  await expect(detail.getByText('运营端指导价', { exact: true })).toHaveCount(0);
});

for (const source of ['供应链', '运营端']) {
  for (const action of ['勾选', '主图', '编辑', '上架', '删除', '批量上架', '确认上架']) {
    test(`store stale ${source} availability blocks ${action} and shows row overlay`, async ({ page }) => {
      await storeLogin(page);
      let unavailable = false;
      let writes = 0;
      const imageUrl =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6bEAAAAASUVORK5CYII=';
      const latest = () =>
        product({
          imageUrl,
          sourceUnavailable: unavailable,
          sourceMessage: unavailable ? `该商品已被${source}下架` : undefined,
        });
      await page.route('**/api/admin/store-finished-products**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== 'GET') {
          writes++;
          return route.fulfill({ json: ok(true) });
        }
        if (path.endsWith('/41')) return route.fulfill({ json: ok(latest()) });
        return route.fulfill({ json: ok(path.endsWith('/categories') ? [] : [latest()]) });
      });
      await page.goto('/store/finished-stock-management');
      const main = page.getByRole('main');
      const overlay = main.locator('.source-unavailable-overlay');
      await expect(main.getByText('门店测试商品', { exact: true })).toBeVisible();
      await expect(overlay).toHaveCount(0);
      if (action === '批量上架') {
        await main.locator('tbody .t-checkbox').click();
        await expect(main.locator('tbody .t-checkbox')).toHaveClass(/t-is-checked/);
      }
      if (action === '确认上架') {
        await main.getByText('上架', { exact: true }).click();
        await expect(page.locator('.t-dialog:visible')).toBeVisible();
      }
      unavailable = true;
      if (action === '勾选') await main.locator('tbody .t-checkbox').click();
      else if (action === '主图') await main.locator('.preview-trigger').click();
      else if (action === '确认上架')
        await page.locator('.t-dialog:visible').getByRole('button', { name: '确认上架', exact: true }).click();
      else await main.getByText(action, { exact: true }).click();
      await expect(overlay).toContainText(`该商品已被${source}下架`);
      await expect(overlay.getByRole('button', { name: '详情', exact: true })).toBeVisible();
      await expect(overlay.getByRole('button', { name: '彻底删除', exact: true })).toBeVisible();
      await expect(main.locator('tbody .t-checkbox.t-is-checked')).toHaveCount(0);
      await expect(main.locator('tr[data-source-id="41"]')).toHaveAttribute('inert', '');
      await expect(page.locator('.t-dialog:visible, .t-drawer--open')).toHaveCount(0);
      expect(writes).toBe(0);
    });
  }
}

for (const entry of ['门店详情', '商品中心详情']) {
  test(`${entry} video autoplays within operations preview size and mask preserves detail`, async ({ page }) => {
    await storeLogin(page);
    await page.setViewportSize({ width: 1366, height: 858 });
    const videoBytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 180;
      canvas.height = 360;
      const stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.start();
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'blue';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await new Promise((resolve) => setTimeout(resolve, 350));
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
    });
    await page.route('**/store-preview.webm', (route) =>
      route.fulfill({ contentType: 'video/webm', body: Buffer.from(videoBytes) }),
    );
    const value = product({
      detail: '<p>竖向商品视频</p><video src="/store-preview.webm"></video>',
      sourceUnavailable: true,
      sourceMessage: '该商品已被运营端下架',
    });
    await page.route('**/api/admin/store-finished-products**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/pool/91'))
        return route.fulfill({ json: ok({ ...value, id: 91, attributeNames: {}, storeLevelName: '中心店' }) });
      if (path.endsWith('/pool')) return route.fulfill({ json: ok([{ id: 91, name: value.name }]) });
      if (path.endsWith('/41')) return route.fulfill({ json: ok(value) });
      return route.fulfill({
        json: ok(
          path.endsWith('/categories') || path.endsWith('/pool-categories') || entry === '商品中心详情' ? [] : [value],
        ),
      });
    });
    await page.goto('/store/finished-stock-management');
    if (entry === '门店详情')
      await page.locator('.source-unavailable-overlay').getByRole('button', { name: '详情', exact: true }).click();
    else {
      await page.getByRole('main').getByRole('button', { name: '商品中心', exact: true }).click();
      await page.locator('.t-dialog:visible').getByText('详情', { exact: true }).click();
    }
    const detail = page.locator('.t-drawer--open');
    await detail.getByRole('button', { name: '点击播放视频', exact: true }).click();
    const preview = page.locator('.t-dialog:visible');
    const player = preview.locator('video');
    await expect(player).toHaveAttribute('autoplay', '');
    await expect(player).toHaveAttribute('playsinline', '');
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
    expect((await preview.boundingBox())!.width).toBeLessThanOrEqual(960);
    expect((await player.boundingBox())!.height).toBeLessThanOrEqual(638);
    await page.mouse.click(10, 10);
    await expect(preview).toHaveCount(0);
    await expect(detail).toHaveCount(1);
    await expect(detail.getByText('竖向商品视频', { exact: true })).toBeVisible();
  });
}

test('store submission race refreshes upstream overlay instead of an ordinary error', async ({ page }) => {
  await storeLogin(page);
  let unavailable = false;
  const latest = () =>
    product({
      sourceUnavailable: unavailable,
      sourceMessage: unavailable ? '该商品已被运营端删除至回收站' : undefined,
    });
  await page.route('**/api/admin/store-finished-products**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') {
      unavailable = true;
      return route.fulfill({
        status: 400,
        json: { code: 400, message: '上游商品不可用，只能查看或彻底删除', data: null },
      });
    }
    return route.fulfill({ json: ok(path.endsWith('/categories') ? [] : [latest()]) });
  });
  await page.goto('/store/finished-stock-management');
  const main = page.getByRole('main');
  await main.getByText('上架', { exact: true }).click();
  await page.locator('.t-dialog:visible').getByRole('button', { name: '确认上架', exact: true }).click();
  await expect(main.locator('.source-unavailable-overlay')).toContainText('该商品已被运营端删除至回收站');
  await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
  await expect(page.getByText('上游商品不可用，只能查看或彻底删除', { exact: true })).toHaveCount(0);
});

test('store price configuration separates category prices from role discounts', async ({ page }) => {
  await storeLogin(page);
  await page.route('**/api/admin/store-price-rules/price?scope=*', (route) => route.fulfill({ json: ok([]) }));
  await page.route('**/api/admin/store-price-rules/price/categories?scope=*', (route) =>
    route.fulfill({ json: ok([]) }),
  );
  await page.route('**/api/admin/store-price-rules/discount?scope=*', (route) =>
    route.fulfill({
      json: ok([
        {
          id: 1,
          roleId: 8,
          categoryId: null,
          targetName: '店长',
          coefficient: 0.8,
          createdAt: '2026-09-24T10:00:00',
        },
      ]),
    }),
  );
  await page.route('**/api/admin/store-price-rules/discount/roles?scope=*', (route) =>
    route.fulfill({
      json: ok([
        { id: 8, name: '店长', status: 'enabled' },
        { id: 9, name: '导购', status: 'enabled' },
      ]),
    }),
  );
  await page.goto('/store/price-configuration');
  const main = page.getByRole('main');
  await expect(main.locator('.t-tabs')).toHaveCount(0);
  await main.locator('.price-menu .t-menu__item').filter({ hasText: '成品现货' }).last().click();
  await expect(main.getByText('店长', { exact: true })).toBeVisible();
  await expect(main.getByText('0.80', { exact: true })).toBeVisible();
  await expect(main.locator('th').getByText('折扣系数', { exact: true })).toBeVisible();
  await expect(main.getByText('指导价设置')).toHaveCount(0);
  await expect(main.getByRole('row').filter({ hasText: '导购' })).toHaveCount(0);
  await main.getByRole('row').filter({ hasText: '店长' }).locator('.t-checkbox').click();
  await main.getByRole('button', { name: '批量设置', exact: true }).click();
  await expect(page.locator('.t-dialog:visible').getByText('已选角色', { exact: true })).toBeVisible();
  const coefficient = page.locator('.t-dialog:visible .t-input-number input');
  await coefficient.fill('0.75');
  await coefficient.blur();
  await expect(coefficient).toHaveValue('0.75');
});

test('store operation logs show the same filter, pagination, and detail structure', async ({ page }) => {
  await storeLogin(page);
  await page.route('**/api/admin/store-finished-products', (route) => route.fulfill({ json: ok([]) }));
  const log = {
    id: 1,
    productId: 91,
    productName: '门店测试商品',
    operationType: 'UPDATE',
    operationSummary: '编辑商品',
    operatorName: '门店员工',
    operatedAt: '2026-09-24T10:00:00',
    beforeStatus: 'warehouse',
    afterStatus: 'warehouse',
    changeDetails: '{"最低价":{"before":150,"after":140}}',
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
  await expect(drawer.getByRole('cell', { name: '编辑商品' }).first()).toBeVisible();
  await expect(drawer.getByRole('columnheader', { name: '操作类型' })).toBeVisible();
  await expect(drawer.getByRole('columnheader', { name: '操作时间' })).toBeVisible();
  await expect(drawer.locator('.t-pagination')).toBeVisible();
  await drawer.getByText('详情', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('状态变化')).toBeVisible();
  await expect(dialog.getByText('变更对比')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '最低价' })).toBeVisible();
});

for (const operationType of ['SOURCE_OFF_SHELF', 'OPERATIONS_OFF_SHELF']) {
  test(`${operationType} log shows historical store status separately from upstream status`, async ({ page }) => {
    await storeLogin(page);
    const source = operationType.startsWith('SOURCE_');
    const log = {
      id: 8,
      productId: 91,
      productName: '门店历史商品',
      operationType,
      operationSummary: source ? '供应链已下架该商品' : '运营端已下架该商品',
      operatorName: '上游操作员',
      operatedAt: '2026-10-08T10:00:00',
      beforeStatus: 'warehouse',
      afterStatus: 'warehouse',
      changeDetails: JSON.stringify({ [source ? '来源状态' : '运营状态']: { before: 'selling', after: 'offShelf' } }),
    };
    await page.route('**/api/admin/store-finished-products**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/operation-logs/8')) return route.fulfill({ json: ok(log) });
      if (path.endsWith('/operation-logs')) return route.fulfill({ json: ok({ records: [log], total: 1 }) });
      return route.fulfill({
        json: ok(path.endsWith('/categories') ? [] : [product({ status: 'selling', effectiveStatus: 'selling' })]),
      });
    });
    await page.goto('/store/finished-stock-management');
    await page.getByRole('main').getByText('操作日志', { exact: true }).click();
    const expectedSummary = source ? '该商品已被供应链下架' : '该商品已被运营管理平台下架';
    await expect(page.locator('.t-drawer--open').getByText(expectedSummary, { exact: true })).toBeVisible();
    await page.locator('.t-drawer--open').getByText('详情', { exact: true }).click();
    const detail = page.locator('.t-dialog:visible');
    await expect(detail.getByText('状态变化', { exact: true })).toBeVisible();
    await expect(detail.getByText('仓库中 → 仓库中', { exact: true })).toBeVisible();
    await expect(detail.getByText(expectedSummary, { exact: true })).toBeVisible();
    const changes = detail.locator('.change-pair');
    await expect(detail.getByRole('heading', { name: '来源状态', exact: true })).toBeVisible();
    await expect(detail.getByRole('heading', { name: '运营状态', exact: true })).toHaveCount(0);
    await expect(changes).toContainText('已上架');
    await expect(changes).toContainText('已下架');
    await expect(changes.getByText('出售中', { exact: true })).toHaveCount(0);
  });
}

for (const operationType of ['SHELF', 'OFF_SHELF', 'RESTORE', 'DELETE_TO_RECYCLE', 'PURGE']) {
  test(`${operationType} store log omits duplicate comparison and keeps only off-shelf explanation`, async ({
    page,
  }) => {
    await storeLogin(page);
    const log = {
      id: 9,
      productId: 91,
      productName: '本门店商品',
      operationType,
      operationSummary: '本门店状态操作',
      operatorName: '门店员工',
      operatedAt: '2026-10-08T10:00:00',
      beforeStatus: 'warehouse',
      afterStatus: 'selling',
      changeDetails: JSON.stringify({
        状态: { before: 'warehouse', after: 'selling' },
        下架原因: '商品信息调整',
        详细说明: '调整规格后重新上架',
      }),
    };
    await page.route('**/api/admin/store-finished-products**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/operation-logs/9')) return route.fulfill({ json: ok(log) });
      if (path.endsWith('/operation-logs')) return route.fulfill({ json: ok({ records: [log], total: 1 }) });
      return route.fulfill({ json: ok([]) });
    });
    await page.goto('/store/finished-stock-management');
    await page.getByRole('main').getByText('操作日志', { exact: true }).click();
    await page.locator('.t-drawer--open').getByText('详情', { exact: true }).click();
    const detail = page.locator('.t-dialog:visible');
    await expect(detail.getByText('仓库中 → 出售中', { exact: true })).toBeVisible();
    await expect(detail.getByText('变更对比', { exact: true })).toHaveCount(0);
    if (operationType === 'OFF_SHELF') {
      await expect(detail.getByText('操作说明', { exact: true })).toBeVisible();
      await expect(detail.getByText('商品信息调整', { exact: true })).toBeVisible();
      await expect(detail.getByText('调整规格后重新上架', { exact: true })).toBeVisible();
    } else {
      await expect(detail.getByText('操作说明', { exact: true })).toHaveCount(0);
      await expect(detail.getByText('商品信息调整', { exact: true })).toHaveCount(0);
    }
  });
}

test('store list applies keyword and operations category only after query', async ({ page }) => {
  await storeLogin(page);
  await page.route('**/api/admin/store-finished-products', (route) =>
    route.fulfill({
      json: ok([
        product({ id: 41, productId: 91, name: '餐桌商品', categoryId: 3 }),
        product({ id: 42, productId: 92, name: '沙发商品', categoryId: 4 }),
      ]),
    }),
  );
  await page.route('**/api/admin/store-finished-products/categories', (route) =>
    route.fulfill({
      json: ok([
        { id: 1, name: '家具' },
        { id: 2, parentId: 1, name: '桌椅' },
        { id: 3, parentId: 2, name: '餐桌' },
        { id: 4, parentId: 1, name: '沙发' },
        { id: 5, name: '无商品分类' },
      ]),
    }),
  );
  await page.goto('/store/finished-stock-management');
  const main = page.getByRole('main');
  const keyword = main.getByPlaceholder('商品名称 / ID');
  const query = main.getByRole('button', { name: '查询', exact: true });
  const reset = main.getByRole('button', { name: '重置', exact: true });
  await expect(main.locator('.t-form__label').filter({ hasText: '供应商' })).toHaveCount(0);
  await keyword.fill('91');
  await expect(main.locator('tbody tr')).toHaveCount(2);
  await query.click();
  await expect(main.locator('tbody tr')).toHaveCount(1);
  await expect(main.getByText('餐桌商品', { exact: true })).toBeVisible();
  await keyword.clear();
  await expect(main.locator('tbody tr')).toHaveCount(1);
  await reset.click();
  await expect(main.locator('tbody tr')).toHaveCount(2);
  const category = main.locator('.filter-row .t-select-input');
  await category.click();
  const panel = page.locator('.t-cascader__panel:visible');
  await expect(panel.getByText('无商品分类', { exact: true })).toBeVisible();
  await panel.getByText('家具', { exact: true }).hover();
  await panel.getByText('桌椅', { exact: true }).hover();
  await panel.getByText('餐桌', { exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(main.locator('tbody tr')).toHaveCount(2);
  await query.click();
  await expect(main.locator('tbody tr')).toHaveCount(1);
  await expect(main.getByText('餐桌商品', { exact: true })).toBeVisible();
  await reset.click();
  await expect(main.locator('tbody tr')).toHaveCount(2);
});

test('store batch shelf matches shared confirmation and partial failure feedback', async ({ page }) => {
  await storeLogin(page);
  const records = [product({ id: 41, name: '成功商品' }), product({ id: 42, name: '失败商品' })];
  const requests: number[][] = [];
  let failSecond = true;
  await page.route('**/api/admin/store-finished-products', (route) => route.fulfill({ json: ok(records) }));
  await page.route('**/api/admin/store-finished-products/status/batch', (route) => {
    const { ids } = route.request().postDataJSON();
    requests.push(ids);
    if (ids[0] === 42 && failSecond)
      return route.fulfill({ status: 400, json: { code: 400, message: '请先配置门店销售价格', data: null } });
    const item = records.find((record) => record.id === ids[0])!;
    item.status = 'selling';
    item.effectiveStatus = 'selling';
    return route.fulfill({ json: ok([item]) });
  });
  await page.goto('/store/finished-stock-management');
  const main = page.getByRole('main');
  const button = main.getByRole('button', { name: '批量上架', exact: true });
  await expect(button).toBeEnabled();
  await expect(button).toHaveClass(/t-button--theme-primary/);
  await expect(button.locator('.t-icon-upload')).toBeVisible();
  await button.click();
  await expect(page.getByText('请先选择商品', { exact: true })).toBeVisible();
  await main.locator('thead .t-checkbox').click();
  await button.click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('是否批量上架所选成品现货？', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(requests).toEqual([]);
  await button.click();
  await dialog.getByRole('button', { name: '确认批量上架', exact: true }).click();
  await expect(page.getByText('已上架 1 个商品，未上架 1 个商品', { exact: true })).toBeVisible();
  await expect(main.locator('.finished-row-warning')).toContainText('请先配置门店销售价格');
  await expect(main.locator('tbody .t-checkbox.t-is-checked')).toHaveCount(1);
  expect(requests).toEqual([[41], [42]]);
  failSecond = false;
  await button.click();
  await dialog.getByRole('button', { name: '确认批量上架', exact: true }).click();
  await expect(page.getByText('已上架 1 个商品，未上架 0 个商品', { exact: true })).toBeVisible();
  await expect(main.locator('.finished-row-warning')).toHaveCount(0);
  await expect(main.getByText('暂无商品', { exact: true })).toBeVisible();
  expect(requests).toEqual([[41], [42], [42]]);
});

for (const scenario of [
  {
    tab: '已下架',
    status: 'offShelf',
    button: '批量放回到仓库',
    icon: 'rollback',
    theme: 'primary',
    description: '是否将所选成品现货放回仓库？',
    success: '操作已完成',
  },
  {
    tab: '回收站',
    status: 'recycle',
    button: '批量放回到仓库',
    icon: 'rollback',
    theme: 'primary',
    description: '是否将所选成品现货放回仓库？',
    success: '操作已完成',
  },
  {
    tab: '回收站',
    status: 'recycle',
    button: '批量彻底删除',
    icon: 'delete',
    theme: 'danger',
    description: '是否批量彻底删除所选成品现货？',
    success: '已删除“1 个商品”',
  },
  {
    tab: '回收站',
    status: 'recycle',
    button: '清空回收站',
    icon: 'clear',
    theme: 'danger',
    description: '是否清空回收站？',
    success: '已删除“1 个回收站商品”',
  },
]) {
  test(`store ${scenario.tab} ${scenario.button} matches operations confirmation and failure feedback`, async ({
    page,
  }) => {
    await storeLogin(page);
    let records = [product({ status: scenario.status, effectiveStatus: scenario.status })];
    let fail = true;
    let writes = 0;
    await page.route('**/api/admin/store-finished-products**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET') {
        writes++;
        if (fail)
          return route.fulfill({ status: 400, json: { code: 400, message: '当前商品状态不支持此操作', data: null } });
        if (path.endsWith('/status/batch')) {
          records = [product()];
          return route.fulfill({ json: ok(records) });
        }
        records = [];
        return route.fulfill({ json: ok(true) });
      }
      return route.fulfill({ json: ok(path.endsWith('/categories') ? [] : records) });
    });
    await page.goto('/store/finished-stock-management');
    const main = page.getByRole('main');
    await main.getByText(`${scenario.tab}（1）`, { exact: true }).click();
    const button = main.getByRole('button', { name: scenario.button, exact: true });
    await expect(button).toBeEnabled();
    await expect(button).toHaveClass(new RegExp(`t-button--theme-${scenario.theme}`));
    await expect(button.locator(`.t-icon-${scenario.icon}`)).toBeVisible();
    if (scenario.button === '批量彻底删除') await expect(button).toHaveClass(/deep-danger-button/);
    if (scenario.button !== '清空回收站') {
      await button.click();
      await expect(page.getByText('请先选择商品', { exact: true })).toBeVisible();
      await main.locator('thead .t-checkbox').click();
    }
    await button.click();
    const dialog = page.locator('.t-dialog:visible');
    await expect(dialog.getByText(scenario.description, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(writes).toBe(0);
    await button.click();
    await dialog.getByRole('button', { name: `确认${scenario.button}`, exact: true }).click();
    await expect(page.getByText('当前商品状态不支持此操作', { exact: true })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(main.getByText('门店测试商品', { exact: true })).toBeVisible();
    fail = false;
    await dialog.getByRole('button', { name: `确认${scenario.button}`, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(scenario.success, { exact: true })).toBeVisible();
    await expect(main.getByText('暂无商品', { exact: true })).toBeVisible();
    expect(writes).toBe(2);
  });
}

test('store batch off shelf uses operations reason dialog and failure feedback', async ({ page }) => {
  await storeLogin(page);
  let records = [product({ status: 'selling', effectiveStatus: 'selling' })];
  let fail = true;
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/admin/store-finished-products**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/status/batch')) {
      payload = route.request().postDataJSON();
      if (fail) return route.fulfill({ status: 400, json: { code: 400, message: '商品已售完，不能下架', data: null } });
      records = [product({ status: 'offShelf', effectiveStatus: 'offShelf' })];
      return route.fulfill({ json: ok(records) });
    }
    return route.fulfill({ json: ok(path.endsWith('/categories') ? [] : records) });
  });
  await page.goto('/store/finished-stock-management');
  const main = page.getByRole('main');
  await main.getByText('出售中（1）', { exact: true }).click();
  const button = main.getByRole('button', { name: '批量下架', exact: true });
  await expect(button).toHaveClass(/brown-button/);
  await expect(button.locator('.t-icon-download')).toBeVisible();
  await button.click();
  await expect(page.getByText('请先选择商品', { exact: true })).toBeVisible();
  await main.locator('thead .t-checkbox').click();
  await button.click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.locator('.t-dialog__header')).toHaveText('下架');
  await expect(dialog).toHaveCSS('width', '520px');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByText('请选择原因', { exact: true })).toBeVisible();
  expect(payload).toBeUndefined();
  await dialog.locator('.t-select').click();
  await page.getByText('商品暂停售卖', { exact: true }).click();
  await dialog.locator('textarea').fill('  门店调整  ');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('商品已售完，不能下架', { exact: true })).toBeVisible();
  expect(payload).toEqual({ ids: [41], target: 'offShelf', reason: '商品暂停售卖', detail: '门店调整' });
  await expect(main.locator('tbody .t-checkbox.t-is-checked')).toHaveCount(1);
  fail = false;
  await button.click();
  await dialog.locator('.t-select').click();
  await page.getByText('商品暂停售卖', { exact: true }).click();
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByText('已批量下架', { exact: true })).toBeVisible();
  await expect(main.getByText('暂无商品', { exact: true })).toBeVisible();
});

test('store list header checkbox selects and clears only the current page', async ({ page }) => {
  await storeLogin(page);
  const records = Array.from({ length: 15 }, (_, index) =>
    product({ id: index + 1, productId: index + 101, name: `门店分页商品${index + 1}` }),
  );
  await page.route('**/api/admin/store-finished-products', (route) => route.fulfill({ json: ok(records) }));
  await page.goto('/store/finished-stock-management');
  const main = page.getByRole('main');
  const header = main.locator('thead .t-checkbox');
  const rows = main.locator('tbody .t-checkbox');
  const checked = main.locator('tbody .t-checkbox.t-is-checked');
  await expect(rows).toHaveCount(10);
  await header.click();
  await expect(checked).toHaveCount(10);
  await rows.first().click();
  await expect(header).toHaveClass(/t-is-indeterminate/);
  await rows.first().click();
  await main.locator('.t-pagination__btn-next').click();
  await expect(rows).toHaveCount(5);
  await expect(checked).toHaveCount(0);
  await header.click();
  await expect(checked).toHaveCount(5);
  await header.click();
  await expect(checked).toHaveCount(0);
  await main.locator('.t-pagination__btn-prev').click();
  await expect(checked).toHaveCount(10);
  await header.click();
  await expect(checked).toHaveCount(0);
});

test('product center paginates and header checkbox selects only the current page', async ({ page }) => {
  await storeLogin(page);
  let selectedIds: number[] = [];
  await page.route('**/api/admin/store-finished-products**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/pool'))
      return route.fulfill({
        json: ok(
          Array.from({ length: 15 }, (_, index) => ({ id: index + 1, name: `分页商品${index + 1}`, totalStock: 1 })),
        ),
      });
    if (path.endsWith('/select')) selectedIds = route.request().postDataJSON().productIds;
    return route.fulfill({ json: ok([]) });
  });
  await page.goto('/store/finished-stock-management');
  await page.getByRole('button', { name: '商品中心' }).click();
  const dialog = page.locator('.t-dialog:visible');
  const header = dialog.locator('thead .t-checkbox');
  const rows = dialog.locator('tbody .t-checkbox');
  await expect(rows).toHaveCount(10);
  await header.click();
  await expect(dialog.locator('tbody .t-checkbox.t-is-checked')).toHaveCount(10);
  await rows.first().click();
  await expect(header).toHaveClass(/t-is-indeterminate/);
  await rows.first().click();
  await dialog.locator('.t-pagination__btn-next').click();
  await expect(rows).toHaveCount(5);
  await expect(dialog.locator('tbody .t-checkbox.t-is-checked')).toHaveCount(0);
  await header.click();
  await expect(dialog.locator('tbody .t-checkbox.t-is-checked')).toHaveCount(5);
  await header.click();
  await expect(dialog.locator('tbody .t-checkbox.t-is-checked')).toHaveCount(0);
  await dialog.locator('.t-pagination__btn-prev').click();
  await expect(dialog.locator('tbody .t-checkbox.t-is-checked')).toHaveCount(10);
  await dialog.getByRole('button', { name: '批量选择', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect([...selectedIds].sort((first, second) => first - second)).toEqual(
    Array.from({ length: 10 }, (_, index) => index + 1),
  );
});

test('selection log displays historical product, store prices and media without supply costs', async ({ page }) => {
  await storeLogin(page);
  const imageUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6bEAAAAASUVORK5CYII=';
  const log = {
    id: 7,
    productId: 91,
    productName: '挑选时商品',
    operationType: 'SELECT',
    operationSummary: '放入本店仓库',
    operatorName: '门店员工',
    operatedAt: '2026-10-08T10:00:00',
    afterStatus: 'warehouse',
    changeDetails: JSON.stringify({
      商品名称: '挑选时商品',
      商品ID: 91,
      商家编码: 'HISTORY-91',
      商品分类: '家具 / 桌椅 / 餐桌',
      供应商: '挑选时供应商',
      商品属性: [{ attributeId: 1, attributeName: '材质', value: '天然石' }],
      总库存: 3,
      销售规格: [{ skuId: 101, variantLabel: '历史规格', stock: 3, salesAttributes: { attribute_57: '光面' } }],
      销售属性名称: { attribute_57: '历史销售属性' },
      指导价: [{ skuId: 101, price: 300 }],
      层级价格: [{ skuId: 101, storeLevelId: 2, storeLevelName: '挑选时门店级别', price: 120 }],
      宝贝详情: '<p>挑选时完整图文</p><p><img src="media:2"></p><p><video src="media:3"></video></p>',
      媒体: [
        { field: 'mainImage', mediaId: 1, resource: { available: true, url: imageUrl, mediaType: 'image' } },
        { field: 'detailImage', mediaId: 2, resource: { available: true, url: imageUrl, mediaType: 'image' } },
        {
          field: 'detailVideo',
          mediaId: 3,
          resource: { available: true, url: '/test-detail.mp4', mediaType: 'video' },
        },
      ],
    }),
  };
  await page.route('**/api/admin/store-finished-products**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/operation-logs/7')) return route.fulfill({ json: ok(log) });
    if (path.endsWith('/operation-logs')) return route.fulfill({ json: ok({ records: [log], total: 1 }) });
    return route.fulfill({ json: ok([]) });
  });
  await page.goto('/store/finished-stock-management');
  await page.getByRole('main').getByText('操作日志').click();
  await page.locator('.t-drawer:visible').getByText('详情', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('从商品中心放入本店仓库', { exact: true })).toBeVisible();
  await expect(dialog.locator('.creation-snapshot-sections')).toBeVisible();
  await expect(dialog.getByText('家具 / 桌椅 / 餐桌', { exact: true })).toBeVisible();
  await expect(dialog.getByText('变更对比', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('修改前', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('修改后', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: '商家编码', exact: true })).toHaveCount(0);
  await expect(dialog.getByText('供应商', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('挑选时供应商', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('挑选时完整图文', { exact: true })).toBeVisible();
  const richText = dialog.locator('.historical-rich-text');
  await expect(richText.getByText('历史媒体已不可用')).toHaveCount(0);
  await expect(richText.locator('img')).toHaveAttribute('src', imageUrl);
  await expect(richText.locator('video')).toHaveAttribute('src', '/test-detail.mp4');
  const historicalSales = dialog.locator('.creation-snapshot-sections .sales-log-table');
  await expect(historicalSales.getByRole('columnheader', { name: '挑选时门店级别价', exact: true })).toBeVisible();
  await expect(historicalSales.getByRole('columnheader', { name: '历史销售属性', exact: true })).toBeVisible();
  await expect(dialog.getByText('120.00', { exact: true })).toBeVisible();
  await expect(dialog.getByText('成本价', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/系数：/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '查看商品主图' }).locator('img')).toHaveAttribute('src', imageUrl);
});

test('invalid warehouse overlay excludes selection and shows only the source reason', async ({ page }) => {
  await storeLogin(page);
  const blocked = product({ sourceUnavailable: true, sourceMessage: '该商品已被运营管理平台下架' });
  await page.route('**/api/admin/store-finished-products**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: ok(path.endsWith('/categories') ? [] : path.endsWith('/41') ? blocked : [blocked]) });
  });
  await page.goto('/store/finished-stock-management');
  const main = page.getByRole('main');
  const overlay = main.locator('.source-unavailable-overlay');
  await expect(overlay).toContainText('该商品已被运营管理平台下架');
  await expect(overlay).not.toContainText('请彻底删除后重新选择');
  await expect(overlay.getByRole('checkbox')).toHaveCount(0);
  await expect(overlay.getByRole('button', { name: '详情', exact: true })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '彻底删除', exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: '批量彻底删除', exact: true })).toHaveCount(0);
  await main.locator('thead .t-checkbox').click();
  await expect(main.getByText('已选 0 项')).toBeVisible();
  await overlay.getByRole('button', { name: '详情', exact: true }).click();
  const detail = page.locator('.t-drawer').filter({ has: page.getByText('商品详情', { exact: true }) });
  await expect(detail.locator('.t-alert')).toHaveText('该商品已被运营管理平台下架');
});
