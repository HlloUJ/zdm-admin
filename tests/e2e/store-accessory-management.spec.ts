import { priceTableGeometry, expectPriceTableStable } from './price-table-feedback';
import { checkDecimalEditing } from './decimal-editing';
import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './accessory-api-mocks';

const ok = (data: unknown) => ({ code: 0, message: 'ok', data });
const permissions = [
  'store.accessory-management.warehouse.view',
  'store.accessory-management.warehouse.select',
  'store.accessory-management.warehouse.edit',
  'store.accessory-management.warehouse.shelf',
  'store.accessory-management.warehouse.delete',
  'store.accessory-management.warehouse.batch-shelf',
  'store.accessory-management.selling.view',
  'store.accessory-management.selling.edit',
  'store.accessory-management.selling.off-shelf',
  'store.accessory-management.selling.batch-off-shelf',
  'store.accessory-management.off-shelf.view',
  'store.accessory-management.off-shelf.batch-restore',
  'store.accessory-management.recycle.view',
  'store.accessory-management.recycle.batch-restore',
  'store.accessory-management.recycle.batch-purge',
  'store.accessory-management.recycle.clear',
  'store.accessory-management.operation-log.view',
  'store.price-configuration.price.accessory.view',
  'store.price-configuration.price.accessory.batch-set',
  'store.price-configuration.discount.accessory.view',
];

async function storeLogin(page: Page) {
  await installAdminApiMocks(page);
  await page.route('**/api/admin/store-accessory-products/categories', (route) => route.fulfill({ json: ok([]) }));
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
    stateOperatorName: '门店创建员工',
    stateOperatedAt: '2026-10-08T04:34:56Z',
    stateOperatorClientCode: 'store',
    detail: '<p>门店商品详情</p>',
    categoryName: '平台分类',
    storeLevelName: '区域合作门店',
    storeCategoryId: 7,
    storeCategoryName: '门店餐桌',
    categoryCoefficient: 1.5,
    attributes: [{ attributeId: 1, attributeName: '材质', value: '天然石' }],
    specDimensions: [],
    skus: [
      {
        skuId: 101,
        label: '标准规格',
        stock: 3,
        costPrice: 100,
        guidePrice: 150,
        salePrice: 150,
        priceMode: 'auto',
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
    await page.route('**/api/admin/store-accessory-products**', (route) => {
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
    await page.goto('/store/accessory-management');
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
    const keyword = dialog.getByPlaceholder('请输入商品名称/ID');
    const search = dialog.getByRole('button', { name: '查询', exact: true });
    const reset = dialog.getByRole('button', { name: '重置', exact: true });
    // A native clear button consumes space inside the input after text is entered.
    // The control boundary must stay fixed; its internal text area may shrink.
    const controlBounds = () =>
      keyword.evaluate((element) => {
        const { x, width } = element.closest('.t-input')!.getBoundingClientRect();
        return { x, width };
      });
    await dialog.evaluate((element) =>
      Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
    const initialInputBounds = await controlBounds();
    await keyword.fill('用于检查宽度是否稳定的很长商品名称或商品ID1234567890');
    expect(await controlBounds()).toEqual(initialInputBounds);
    await expect(keyword).toHaveValue('用于检查宽度是否稳定的很长商品名称或商品ID1234567890');
    await keyword.locator('xpath=ancestor::div[contains(@class,"t-input")][1]').hover();
    await dialog.locator('.t-input__suffix-clear').first().click();
    await expect(keyword).toHaveValue('');
    expect(await controlBounds()).toEqual(initialInputBounds);
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
    await expect(page.locator('.t-dialog:visible')).toHaveCount(1);
    const selectButton = dialog.getByRole('button', { name: '批量选择', exact: true });
    await expect(selectButton).toBeDisabled();
    expect(writes).toBe(0);
    expect((await dialog.boundingBox())!.width).toBeGreaterThan(1100);
    expect(
      (await dialog.getByRole('columnheader', { name: '商品名称/ID', exact: true }).boundingBox())!.width,
    ).toBeGreaterThan(400);
    await dialog.locator('thead .t-checkbox').click();
    await expect(selectButton).toBeEnabled();
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
  let saleWrites = 0;
  await page.route('**/api/admin/store-accessory-products', (route) => route.fulfill({ json: ok(records) }));
  await page.route('**/api/admin/store-accessory-products/pool-categories', (route) => route.fulfill({ json: ok([]) }));
  await page.route('**/api/admin/store-accessory-products/pool', (route) =>
    route.fulfill({
      json: ok([{ id: 91, name: '门店测试商品', merchantCode: 'STORE-91', totalStock: 3, supplierName: '平台供应商' }]),
    }),
  );
  await page.route('**/api/admin/store-accessory-products/select', (route) => {
    records = [product()];
    return route.fulfill({ json: ok(records) });
  });
  await page.route('**/api/admin/store-accessory-products/41/edit-categories', (route) =>
    route.fulfill({ json: ok([{ id: 7, parentId: null, name: '门店餐桌', status: 'enabled', coefficient: 1.5 }]) }),
  );
  await page.route('**/api/admin/store-accessory-products/41', async (route) => {
    if (route.request().method() === 'PUT') {
      saleWrites++;
      const body = route.request().postDataJSON();
      expect(body).toEqual({
        storeCategoryId: 7,
        skus: [
          {
            skuId: 101,
            salePrice: saleWrites === 1 ? 140 : 200,
            priceMode: 'manual',
            saleCoefficient: saleWrites === 1 ? 1.4 : 2,
          },
        ],
      });
      records[0] = product({
        skus: [
          {
            ...product().skus[0],
            salePrice: body.skus[0].salePrice,
            priceMode: 'manual',
            saleCoefficient: body.skus[0].saleCoefficient,
          },
        ],
      });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return route.fulfill({ json: ok(records[0]) });
  });

  await page.goto('/store/accessory-management');
  const menu = page.getByRole('complementary');
  await expect(menu.getByText('配件管理', { exact: true })).toBeVisible();
  await expect(menu.getByText('价格配置', { exact: true })).toBeVisible();
  await expect(menu.getByText('商品管理', { exact: true })).toBeVisible();
  await expect(menu.locator('[data-menu-path="/finished-stock-management"]')).toHaveCount(0);
  await expect(menu.locator('[data-menu-path="/accessory-management"]')).toHaveCount(0);
  const main = page.getByRole('main');
  await expect(main.locator('.filter-row')).toHaveCSS('display', 'grid');
  await expect(main.locator('.filter-fields')).toHaveCSS('display', 'grid');
  await expect(main.locator('.table-toolbar')).toHaveCSS('display', 'flex');
  await expect(main.getByText('暂无商品')).toBeVisible();
  await main.getByRole('button', { name: '商品中心' }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('门店测试商品')).toBeVisible();
  await dialog.locator('tbody .t-checkbox').click();
  await dialog.getByRole('button', { name: '批量选择', exact: true }).click();
  await expect(main.getByText('门店测试商品')).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '入库人', exact: true })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '入库时间', exact: true })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '挑选时间', exact: true })).toHaveCount(0);
  await expect(main.getByRole('columnheader', { name: '商品主图', exact: true })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '供应商', exact: true })).toHaveCount(0);
  await expect(main.getByRole('columnheader', { name: '统一库存', exact: true })).toHaveCount(0);
  await expect(main.getByRole('cell', { name: '门店创建员工', exact: true })).toBeVisible();
  await expect(main.getByRole('cell', { name: '2026/10/08 12:34', exact: true })).toBeVisible();
  const columns = await main.locator('thead th').allTextContents();
  expect(columns.indexOf('入库人')).toBeLessThan(columns.indexOf('入库时间'));
  await expect(main.locator('.product-code')).toHaveCSS('font-size', '12px');
  await expect(main.locator('th.t-table__th-operation')).toHaveCSS('width', '190px');
  await main.getByText(/已上架（0）/).click();
  await expect(main.getByText('暂无商品')).toBeVisible();
  await main.getByText(/仓库中（1）/).click();
  await expect(main.getByText('门店测试商品')).toBeVisible();
  await main.getByText('编辑', { exact: true }).click();
  await expect(page).toHaveURL(/\/store\/accessory-management\/41\/edit$/);
  await expect(page.locator('.t-drawer--open')).toHaveCount(0);
  await expect(main.getByRole('heading', { name: '编辑商品', exact: true })).toBeVisible();
  await expect(main.locator('.form-anchor-nav')).toHaveText('图文描述基础信息销售信息');
  await expect(main.locator('.form-anchor-card')).toHaveCSS('position', 'fixed');
  await expect(main.locator('.form-heading-card h1')).toHaveCSS('font-size', '18px');
  await expect(main.locator('.page-header')).toHaveCount(0);
  await expect(
    main.locator('.readonly-product-fields .zdm-admin-section-card').nth(1).locator('.t-cascader'),
  ).toBeVisible();
  await expect(main.locator('#store-finished-product-sales .spec-table-block')).toBeVisible();
  await expect(main.locator('.form-submit-bar')).toHaveCSS('position', 'sticky');
  await main.getByRole('link', { name: '销售信息', exact: true }).click();
  await expect(main.getByRole('link', { name: '销售信息', exact: true })).toHaveAttribute('aria-current', 'location');
  await expect(main.getByText('门店商品详情', { exact: true })).toBeVisible();
  await expect(main.getByText('天然石', { exact: true })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '指导价', exact: true })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '区域合作门店价', exact: true })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '*商品售价', exact: true })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '数量', exact: true })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: '库存', exact: true })).toHaveCount(0);
  await expect(main.locator('.spec-table-block input:disabled')).toHaveCount(0);
  await expect(main.locator('.quantity-editor input')).toHaveCount(0);
  await expect(main.locator('.price-pair input[placeholder="请输入系数"]')).toBeEnabled();
  await expect(main.getByText('最低可售价', { exact: true })).toHaveCount(0);
  const priceInput = main.locator('.store-sale-price-input input');
  await expect(priceInput).toHaveValue('150.00');
  await priceInput.fill('140');
  await priceInput.blur();
  await expect(main.getByRole('button', { name: '手工价格，点击切换跟随配置' })).toBeVisible();
  await main.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true }).click();
  await expect.poll(() => saleWrites).toBe(1);
  await expect(page).toHaveURL('/store/accessory-management');
  await expect(main.getByText('门店测试商品', { exact: true })).toBeVisible();
  await main.getByText('编辑', { exact: true }).click();
  await expect(priceInput).toHaveValue('140.00');
  const coefficientInput = main.locator('.store-sale-coefficient-input input');
  await expect(coefficientInput).toHaveValue('1.40');
  await coefficientInput.fill('2');
  await coefficientInput.blur();
  await expect(priceInput).toHaveValue('200.00');
  await main.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true }).click();
  await expect.poll(() => saleWrites).toBe(2);
  await expect(page).toHaveURL('/store/accessory-management');
  await main.getByText('编辑', { exact: true }).click();
  await expect(coefficientInput).toHaveValue('2.00');
  await expect(priceInput).toHaveValue('200.00');
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
  await page.route('**/api/admin/store-accessory-products', (route) => route.fulfill({ json: ok([blocked]) }));
  await page.route('**/api/admin/store-accessory-products/41', (route) => route.fulfill({ json: ok(blocked) }));
  await page.goto('/store/accessory-management');
  await page.getByText(/已上架（1）/).click();
  const overlay = page.locator('.source-unavailable-overlay');
  await expect(overlay).toContainText('供应链下架');
  await expect(overlay.getByRole('button', { name: '详情' })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '彻底删除' })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '下架' })).toHaveCount(0);
  await overlay.getByRole('button', { name: '详情' }).click();
  const detail = page.locator('.t-drawer--open');
  await expect(detail.getByText('门店商品详情')).toBeVisible();
  await expect(detail.locator('.t-card__title')).toHaveText(['图文描述', '基础信息', '销售信息']);
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
      await page.route('**/api/admin/store-accessory-products**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== 'GET') {
          writes++;
          return route.fulfill({ json: ok(true) });
        }
        if (path.endsWith('/41')) return route.fulfill({ json: ok(latest()) });
        return route.fulfill({ json: ok(path.endsWith('/categories') ? [] : [latest()]) });
      });
      await page.goto('/store/accessory-management');
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
    await page.route('**/api/admin/store-accessory-products**', (route) => {
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
    await page.goto('/store/accessory-management');
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
  await page.route('**/api/admin/store-accessory-products**', (route) => {
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
  await page.goto('/store/accessory-management');
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
  await main.locator('.price-menu .t-menu__item').filter({ hasText: '配件' }).last().click();
  await expect(main.getByText('店长', { exact: true })).toBeVisible();
  await expect(main.getByText('0.80', { exact: true })).toBeVisible();
  await expect(main.locator('th').getByText('折扣系数', { exact: true })).toBeVisible();
  await expect(main.getByText('指导价设置')).toHaveCount(0);
  await expect(main.getByRole('row').filter({ hasText: '导购' })).toHaveCount(0);
  await expect(main.locator('.t-checkbox')).toHaveCount(0);
  await expect(main.getByRole('button', { name: '批量设置', exact: true })).toHaveCount(0);
});

test('store operation logs show the same filter, pagination, and detail structure', async ({ page }) => {
  await storeLogin(page);
  await page.route('**/api/admin/store-accessory-products', (route) => route.fulfill({ json: ok([]) }));
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
    changeDetails: '{"商品售价":{"before":150,"after":140}}',
  };
  await page.route('**/api/admin/store-accessory-products/operation-logs?**', (route) =>
    route.fulfill({ json: ok({ records: [log], total: 1 }) }),
  );
  await page.route('**/api/admin/store-accessory-products/operation-logs/1', (route) =>
    route.fulfill({ json: ok(log) }),
  );
  await page.goto('/store/accessory-management');
  await page.getByRole('main').getByText('操作日志').click();
  const drawer = page.locator('.t-drawer--open').filter({ has: page.locator('.operation-log-filters') });
  await expect(drawer.locator('.operation-log-keyword-filter input')).toHaveAttribute(
    'placeholder',
    '请输入商品名称/ID',
  );
  await expect(drawer.getByText('门店测试商品')).toBeVisible();
  const dateWidth = (await drawer.locator('.operation-log-date-picker').boundingBox())!.width;
  const keywordWidth = (await drawer.locator('.operation-log-keyword-filter .t-input').boundingBox())!.width;
  expect(dateWidth).toBeCloseTo(keywordWidth, 1);
  const fields = drawer.locator('.operation-log-filters');
  await expect(drawer.locator('.zdm-standard-query')).toHaveAttribute('data-query-layout', 'log');
  expect(await fields.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);
  // Read both rectangles in one frame and wait for the drawer's native transition.
  await expect
    .poll(() =>
      drawer.evaluate((element) => {
        const keyword = element.querySelector('.operation-log-keyword-filter .t-input')!.getBoundingClientRect();
        const date = element.querySelector('.operation-log-date-picker')!.getBoundingClientRect();
        return { aligned: Math.abs(date.x - keyword.x) < 0.5, gap: Math.round(date.y - keyword.bottom) };
      }),
    )
    .toEqual({ aligned: true, gap: 24 });
  await expect(drawer.getByRole('cell', { name: '编辑商品' }).first()).toBeVisible();
  await expect(drawer.getByRole('columnheader', { name: '操作类型' })).toBeVisible();
  await expect(drawer.getByRole('columnheader', { name: '操作时间' })).toBeVisible();
  await expect(drawer.locator('.t-pagination')).toBeVisible();
  await drawer.getByText('详情', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('状态变化')).toBeVisible();
  await expect(dialog.getByText('变更对比')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '商品售价' })).toBeVisible();
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
    await page.route('**/api/admin/store-accessory-products**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/operation-logs/8')) return route.fulfill({ json: ok(log) });
      if (path.endsWith('/operation-logs')) return route.fulfill({ json: ok({ records: [log], total: 1 }) });
      return route.fulfill({
        json: ok(path.endsWith('/categories') ? [] : [product({ status: 'selling', effectiveStatus: 'selling' })]),
      });
    });
    await page.goto('/store/accessory-management');
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
    await page.route('**/api/admin/store-accessory-products**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/operation-logs/9')) return route.fulfill({ json: ok(log) });
      if (path.endsWith('/operation-logs')) return route.fulfill({ json: ok({ records: [log], total: 1 }) });
      return route.fulfill({ json: ok([]) });
    });
    await page.goto('/store/accessory-management');
    await page.getByRole('main').getByText('操作日志', { exact: true }).click();
    await page.locator('.t-drawer--open').getByText('详情', { exact: true }).click();
    const detail = page.locator('.t-dialog:visible');
    await expect(detail.getByText('仓库中 → 已上架', { exact: true })).toBeVisible();
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
  await page.route('**/api/admin/store-accessory-products', (route) =>
    route.fulfill({
      json: ok([
        product({ id: 41, productId: 91, name: '餐桌商品', categoryId: 3 }),
        product({ id: 42, productId: 92, name: '沙发商品', categoryId: 4 }),
      ]),
    }),
  );
  await page.route('**/api/admin/store-accessory-products/categories', (route) =>
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
  await page.goto('/store/accessory-management');
  const main = page.getByRole('main');
  const keyword = main.getByPlaceholder('请输入商品名称/ID/编号');
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
  await page.route('**/api/admin/store-accessory-products', (route) => route.fulfill({ json: ok(records) }));
  await page.route('**/api/admin/store-accessory-products/status/batch', (route) => {
    const { ids } = route.request().postDataJSON();
    requests.push(ids);
    if (ids[0] === 42 && failSecond)
      return route.fulfill({ status: 400, json: { code: 400, message: '请先配置门店销售价格', data: null } });
    const item = records.find((record) => record.id === ids[0])!;
    item.status = 'selling';
    item.effectiveStatus = 'selling';
    return route.fulfill({ json: ok([item]) });
  });
  await page.goto('/store/accessory-management');
  const main = page.getByRole('main');
  const button = main.getByRole('button', { name: '批量上架', exact: true });
  await expect(button).toBeDisabled();
  await expect(button).toHaveClass(/t-button--theme-primary/);
  await expect(button.locator('.t-icon-upload')).toBeVisible();
  await main.locator('thead .t-checkbox').click();
  await expect(button).toBeEnabled();
  await main.locator('thead .t-checkbox').click();
  await expect(button).toBeDisabled();
  await main.locator('thead .t-checkbox').click();
  await expect(button).toBeEnabled();
  await button.click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('是否批量上架所选配件？', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(requests).toEqual([]);
  await button.click();
  await dialog.getByRole('button', { name: '确认批量上架', exact: true }).click();
  await expect(page.getByText('已上架 1 个商品，未上架 1 个商品', { exact: true })).toBeVisible();
  await expect(main.locator('.finished-row-warning')).toContainText('请先配置门店销售价格');
  await expect(main.locator('tbody .t-checkbox.t-is-checked')).toHaveCount(1);
  expect(requests).toEqual([[42], [41]]);
  failSecond = false;
  await button.click();
  await dialog.getByRole('button', { name: '确认批量上架', exact: true }).click();
  await expect(page.getByText('已上架 1 个商品，未上架 0 个商品', { exact: true })).toBeVisible();
  await expect(main.locator('.finished-row-warning')).toHaveCount(0);
  await expect(main.getByText('暂无商品', { exact: true })).toBeVisible();
  expect(requests).toEqual([[42], [41], [42]]);
});

for (const scenario of [
  {
    tab: '已下架',
    status: 'offShelf',
    button: '批量放回到仓库',
    icon: 'rollback',
    theme: 'success',
    description: '是否将所选配件放回仓库？',
    success: '操作已完成',
  },
  {
    tab: '回收站',
    status: 'recycle',
    button: '批量放回到仓库',
    icon: 'rollback',
    theme: 'success',
    description: '是否将所选配件放回仓库？',
    success: '操作已完成',
  },
  {
    tab: '回收站',
    status: 'recycle',
    button: '批量彻底删除',
    icon: 'delete',
    theme: 'danger',
    description: '是否批量彻底删除所选配件？',
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
    await page.route('**/api/admin/store-accessory-products**', (route) => {
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
    await page.goto('/store/accessory-management');
    const main = page.getByRole('main');
    await main.getByText(`${scenario.tab}（1）`, { exact: true }).click();
    const button = main.getByRole('button', { name: scenario.button, exact: true });
    if (scenario.button === '清空回收站') await expect(button).toBeEnabled();
    else await expect(button).toBeDisabled();
    await expect(button).toHaveClass(new RegExp(`t-button--theme-${scenario.theme}`));
    await expect(button.locator(`.t-icon-${scenario.icon}`)).toBeVisible();
    if (scenario.button === '批量彻底删除') await expect(button).toHaveClass(/deep-danger-button/);
    if (scenario.button !== '清空回收站') {
      await main.locator('thead .t-checkbox').click();
      await expect(button).toBeEnabled();
    }
    await button.click();
    const dialog = page.locator('.t-dialog:visible');
    await expect(dialog.getByText(scenario.description, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(writes).toBe(0);
    await button.click();
    await dialog
      .getByRole('button', {
        name: scenario.button === '批量放回到仓库' ? '确认批量放回仓库' : `确认${scenario.button}`,
        exact: true,
      })
      .click();
    await expect(page.getByText('当前商品状态不支持此操作', { exact: true })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(main.getByText('门店测试商品', { exact: true })).toBeVisible();
    fail = false;
    await dialog
      .getByRole('button', {
        name: scenario.button === '批量放回到仓库' ? '确认批量放回仓库' : `确认${scenario.button}`,
        exact: true,
      })
      .click();
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
  await page.route('**/api/admin/store-accessory-products**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/status/batch')) {
      payload = route.request().postDataJSON();
      if (fail) return route.fulfill({ status: 400, json: { code: 400, message: '商品已售完，不能下架', data: null } });
      records = [product({ status: 'offShelf', effectiveStatus: 'offShelf' })];
      return route.fulfill({ json: ok(records) });
    }
    return route.fulfill({ json: ok(path.endsWith('/categories') ? [] : records) });
  });
  await page.goto('/store/accessory-management');
  const main = page.getByRole('main');
  await main.getByText('已上架（1）', { exact: true }).click();
  const button = main.getByRole('button', { name: '批量下架', exact: true });
  await expect(button).toHaveClass(/brown-button/);
  await expect(button.locator('.t-icon-download')).toBeVisible();
  await expect(button).toBeDisabled();
  await main.locator('thead .t-checkbox').click();
  await expect(button).toBeEnabled();
  await button.click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.locator('.t-dialog__header')).toHaveText('下架');
  await expect(dialog).toHaveCSS('width', '520px');
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(dialog.getByText('请选择下架原因', { exact: true })).toBeVisible();
  await expect(page.locator('.zdm-admin-feedback').filter({ hasText: /请选择.*原因/ })).toHaveCount(0);
  expect(payload).toBeUndefined();
  await dialog.locator('.t-select').click();
  await page.getByText('商品暂停售卖', { exact: true }).click();
  await dialog.locator('textarea').fill('  门店调整  ');
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('商品已售完，不能下架', { exact: true })).toBeVisible();
  expect(payload).toEqual({ ids: [41], target: 'offShelf', reason: '商品暂停售卖', detail: '门店调整' });
  await expect(main.locator('tbody .t-checkbox.t-is-checked')).toHaveCount(1);
  fail = false;
  await button.click();
  await dialog.locator('.t-select').click();
  await page.getByText('商品暂停售卖', { exact: true }).click();
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(page.getByText('已批量下架', { exact: true })).toBeVisible();
  await expect(main.getByText('暂无商品', { exact: true })).toBeVisible();
});

test('store list header checkbox selects and clears only the current page', async ({ page }) => {
  await storeLogin(page);
  const records = Array.from({ length: 15 }, (_, index) =>
    product({ id: index + 1, productId: index + 101, name: `门店分页商品${index + 1}` }),
  );
  await page.route('**/api/admin/store-accessory-products', (route) => route.fulfill({ json: ok(records) }));
  await page.goto('/store/accessory-management');
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
  await page.route('**/api/admin/store-accessory-products**', (route) => {
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
  await page.goto('/store/accessory-management');
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
  await page.route('**/api/admin/store-accessory-products**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/operation-logs/7')) return route.fulfill({ json: ok(log) });
    if (path.endsWith('/operation-logs')) return route.fulfill({ json: ok({ records: [log], total: 1 }) });
    return route.fulfill({ json: ok([]) });
  });
  await page.goto('/store/accessory-management');
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
  await page.route('**/api/admin/store-accessory-products**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: ok(path.endsWith('/categories') ? [] : path.endsWith('/41') ? blocked : [blocked]) });
  });
  await page.goto('/store/accessory-management');
  const main = page.getByRole('main');
  const overlay = main.locator('.source-unavailable-overlay');
  await expect(overlay).toContainText('该商品已被运营管理平台下架');
  await expect(overlay).not.toContainText('请彻底删除后重新选择');
  await expect(overlay.getByRole('checkbox')).toHaveCount(0);
  await expect(overlay.getByRole('button', { name: '详情', exact: true })).toBeVisible();
  await expect(overlay.getByRole('button', { name: '彻底删除', exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: '批量彻底删除', exact: true })).toHaveCount(0);
  await main.locator('thead .t-checkbox').click();
  await expect(main.locator('.selection-info')).toHaveCount(0);
  await overlay.getByRole('button', { name: '详情', exact: true }).click();
  const detail = page.locator('.t-drawer').filter({ has: page.getByText('商品详情', { exact: true }) });
  await expect(detail.locator('.t-alert')).toHaveText('该商品已被运营管理平台下架');
});

test('store editor requires category, leaves missing prices empty, and follows only configured categories', async ({
  page,
}) => {
  await storeLogin(page);
  const record = product({
    storeCategoryId: null,
    storeCategoryName: '',
    categoryCoefficient: null,
    skus: [{ ...product().skus[0], salePrice: null, priceMode: 'manual' }],
  });
  await page.route('**/api/admin/store-accessory-products', (route) => route.fulfill({ json: ok([record]) }));
  await page.route('**/api/admin/store-accessory-products/41', (route) => route.fulfill({ json: ok(record) }));
  await page.route('**/api/admin/store-accessory-products/41/edit-categories', (route) =>
    route.fulfill({
      json: ok([
        { id: 5, parentId: null, name: '一级分类', status: 'enabled', coefficient: null },
        { id: 6, parentId: 5, name: '二级分类', status: 'enabled', coefficient: null },
        { id: 7, parentId: 6, name: '有系数分类', status: 'enabled', coefficient: 1.5 },
        { id: 9, parentId: null, name: '无系数分类', status: 'enabled', coefficient: null },
      ]),
    }),
  );
  await page.goto('/store/accessory-management/41/edit');
  const main = page.getByRole('main');
  const input = main.locator('.store-sale-price-input input');
  await expect(input).toHaveValue('');
  await expect(main.getByText(/无法自动计算|缺失原因/)).toHaveCount(0);
  await main.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true }).click();
  await expect(main.getByText('请选择门店分类', { exact: true })).toBeVisible();
  await main.locator('.t-cascader input').click();
  await page.locator('.t-cascader__item').filter({ hasText: '一级分类' }).hover();
  await page.locator('.t-cascader__item').filter({ hasText: '二级分类' }).hover();
  const leaf = page.locator('.t-cascader__item').filter({ hasText: '有系数分类' });
  await expect(leaf).toBeVisible();
  await leaf.hover();
  await expect(input).toHaveValue('');
  await leaf.click();
  await expect(input).toHaveValue('150.00');
  const coefficientInput = main.locator('.store-sale-coefficient-input input');
  await checkDecimalEditing(coefficientInput);
  await checkDecimalEditing(input);
  await coefficientInput.fill('2');
  await coefficientInput.blur();
  await expect(input).toHaveValue('200.00');
  await input.fill('160');
  await expect(coefficientInput).toHaveValue('1.60');
  await input.blur();
  await main.getByRole('button', { name: '手工价格，点击切换跟随配置' }).click();
  const confirm = page.locator('.t-dialog:visible');
  await confirm.getByRole('button', { name: '确认更改价格浮动方式', exact: true }).click();
  await expect(input).toHaveValue('150.00');
  await main.locator('.t-cascader input').click();
  await page.locator('.t-cascader__item').filter({ hasText: '无系数分类' }).click();
  await expect(input).toHaveValue('150.00');
  await expect(main.getByRole('button', { name: '手工价格', exact: true })).toBeDisabled();
  await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
  const table = main.locator('.spec-table-block .t-table');
  const geometry = await priceTableGeometry(table);
  await coefficientInput.fill('');
  await main.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true }).click();
  await expect(main.locator('.store-sale-coefficient-input .t-input')).toHaveClass(/t-is-error/);
  await expect(main.getByText('请输入系数', { exact: true })).toBeVisible();
  await expectPriceTableStable(table, geometry);
  await expect(page).toHaveURL(/\/41\/edit$/);
  await input.fill('');
  await main.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true }).click();
  await expect(main.locator('.store-sale-price-input .t-input')).toHaveClass(/t-is-error/);
  await expect(main.getByText('请输入商品售价', { exact: true })).toBeVisible();
  await expectPriceTableStable(table, geometry);
  await input.fill('150');
  await input.blur();
  await expect(table.locator('.t-input__tips')).toHaveCount(0);
  await expectPriceTableStable(table, geometry);
  await expect(page).toHaveURL(/\/41\/edit$/);
});

test('store editor keeps wide sales specifications inside the content area', async ({ page }) => {
  await page.setViewportSize({ width: 1368, height: 858 });
  await storeLogin(page);
  const dimensions = Array.from({ length: 8 }, (_, index) => ({
    key: `dimension_${index}`,
    name: `销售属性${index + 1}`,
  }));
  const record = product({
    specDimensions: dimensions,
    skus: [
      {
        ...product().skus[0],
        salesAttributes: Object.fromEntries(dimensions.map((item) => [item.key, '天然石规格长内容'])),
      },
    ],
  });
  await page.route('**/api/admin/store-accessory-products/41', (route) => route.fulfill({ json: ok(record) }));
  await page.route('**/api/admin/store-accessory-products/41/edit-categories', (route) =>
    route.fulfill({ json: ok([{ id: 7, parentId: null, name: '门店餐桌', status: 'enabled', coefficient: 1.5 }]) }),
  );
  await page.goto('/store/accessory-management/41/edit');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: '编辑商品', exact: true })).toBeVisible();
  const noPageOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  await expect.poll(noPageOverflow).toBe(true);
  await main.getByRole('link', { name: '销售信息', exact: true }).click();
  await main.locator('.store-sale-price-input input').fill('180');
  await expect.poll(noPageOverflow).toBe(true);
  const bounds = await page.evaluate(() => {
    const content = document.querySelector('main')!.getBoundingClientRect();
    return ['.form-heading-card', '.form-anchor-card', '.form-submit-bar'].map((selector) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return rect.left >= content.left - 1 && rect.right <= content.right + 1;
    });
  });
  expect(bounds).toEqual([true, true, true]);
});

test('supply price attention stays on its product row, can be dismissed and returns after reload', async ({ page }) => {
  await storeLogin(page);
  await page.route('**/api/admin/store-accessory-products', (route) =>
    route.fulfill({
      json: ok([product({ salePriceAttention: true }), product({ id: 42, productId: 92, name: '正常价格商品' })]),
    }),
  );
  await page.goto('/store/accessory-management');
  const main = page.locator('main.page');
  const warning = main.locator('.finished-row-warning');
  await expect(warning).toHaveCount(1);
  await expect(warning).toContainText('供应链修改销售规格，商品售价待补齐');
  await expect(main.locator('tr[data-shelf-error-id="41"]')).toContainText('门店测试商品');
  await expect(main.locator('tr[data-shelf-error-id="42"]')).toHaveCount(0);
  await warning.locator('.t-alert__close').click();
  await expect(warning).toHaveCount(0);
  await page.reload();
  await expect(warning).toHaveCount(1);
  await expect(main.getByText('编辑', { exact: true }).first()).toBeEnabled();
});

for (const [status, tab] of [
  ['offShelf', '已下架'],
  ['recycle', '回收站'],
] as const) {
  test(`${status} read-only detail shows latest supply SKUs without an edit action`, async ({ page }) => {
    await storeLogin(page);
    await page.addInitScript((state) => {
      const user = JSON.parse(localStorage.getItem('zdm-admin-user')!);
      user.permissions.push(`store.accessory-management.${state === 'offShelf' ? 'off-shelf' : state}.detail`);
      localStorage.setItem('zdm-admin-user', JSON.stringify(user));
    }, status);
    const old = product({ status, effectiveStatus: status, salePriceAttention: true });
    const latest = {
      ...old,
      skus: [
        ...old.skus,
        {
          skuId: 102,
          label: '供应链新增规格',
          stock: 0,
          costPrice: 200,
          guidePrice: 300,
          salePrice: 400,
          saleCoefficient: 2,
          priceMode: 'auto',
        },
      ],
    };
    await page.route('**/api/admin/store-accessory-products', (route) => route.fulfill({ json: ok([old]) }));
    await page.route('**/api/admin/store-accessory-products/41', (route) => route.fulfill({ json: ok(latest) }));
    await page.goto('/store/accessory-management');
    const main = page.locator('main.page');
    await main.getByText(`${tab}（1）`, { exact: true }).click();
    await expect(main.getByText('编辑', { exact: true })).toHaveCount(0);
    await main.getByText('详情', { exact: true }).click();
    const drawer = page.locator('.t-drawer--open');
    await expect(drawer.getByText('供应链新增规格', { exact: true })).toBeVisible();
    await expect(drawer.locator('input')).toHaveCount(0);
    await expect(drawer.getByText('400', { exact: true })).toBeVisible();
  });
}

test('store log-only permission keeps its native toolbar entry without exposing list access', async ({ page }) => {
  await storeLogin(page);
  await page.addInitScript(() => {
    const user = JSON.parse(localStorage.getItem('zdm-admin-user')!);
    user.permissions = ['store.accessory-management.operation-log.view'];
    localStorage.setItem('zdm-admin-user', JSON.stringify(user));
  });
  await page.route('**/api/admin/store-accessory-products/operation-logs?**', (route) =>
    route.fulfill({ json: ok({ records: [], total: 0 }) }),
  );
  await page.goto('/store/accessory-management');
  const main = page.getByRole('main');
  const log = main.locator('.zdm-admin-list-toolbar__auxiliary').getByRole('button', { name: '操作日志', exact: true });
  await expect(log).toBeVisible();
  await expect(log).toHaveClass(/t-button--theme-default/);
  await expect(log).toHaveClass(/t-button--variant-outline/);
  await expect(main.locator('table')).toHaveCount(0);
  await expect(main.locator('.selection-info')).toHaveCount(0);
  await log.click();
  await expect(page.locator('.t-drawer--open .t-drawer__header')).toContainText('操作日志');
});

test('single off shelf marks the existing required reason and keeps details optional without optional copy', async ({
  page,
}) => {
  await storeLogin(page);
  let record = product({ status: 'selling', effectiveStatus: 'selling' });
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/admin/store-accessory-products**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/41/status') && route.request().method() === 'PUT') {
      payload = route.request().postDataJSON();
      record = product({ status: 'offShelf', effectiveStatus: 'offShelf' });
      return route.fulfill({ json: ok(record) });
    }
    if (path.endsWith('/categories')) return route.fulfill({ json: ok([]) });
    return route.fulfill({ json: ok([record]) });
  });
  await page.goto('/store/accessory-management');
  await page.getByRole('main').getByText('已上架（1）', { exact: true }).click();
  await page.locator('tr').filter({ hasText: '门店测试商品' }).getByText('下架', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  const reason = dialog.locator('.t-form__item').filter({ has: page.locator('label', { hasText: '下架原因' }) });
  const label = reason.locator('.t-form__label');
  await expect(label).toHaveClass(/t-form__label--required/);
  expect(await label.locator('label').evaluate((element) => getComputedStyle(element, '::before').content)).toContain(
    '*',
  );
  await expect(dialog.getByText('选填', { exact: true })).toHaveCount(0);
  await expect(
    dialog
      .locator('.t-form__item')
      .filter({ has: page.locator('label', { hasText: '详细说明' }) })
      .locator('.t-form__label'),
  ).not.toHaveClass(/t-form__label--required/);
  await dialog.getByRole('button', { name: '确认下架', exact: true }).click();
  await expect(dialog.getByText('请选择下架原因', { exact: true })).toBeVisible();
  expect(payload).toBeUndefined();
  await reason.locator('.t-select').click();
  await page.getByText('商品暂停售卖', { exact: true }).click();
  await dialog.getByRole('button', { name: '确认下架', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(payload).toEqual({ target: 'offShelf', reason: '商品暂停售卖', detail: '' });
});
