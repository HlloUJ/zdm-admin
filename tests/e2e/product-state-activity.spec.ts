import { productWarehouseUrl } from './product-test-navigation';
import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
import { installAdminApiMocks as installAccessoryApiMocks } from './accessory-api-mocks';

async function installStateMocks(page: Page, kind: string) {
  const unmocked: string[] = [];
  await page.route('**/api/**', (route) => {
    unmocked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort('blockedbyclient');
  });
  await (kind === 'accessory' ? installAccessoryApiMocks : installAdminApiMocks)(page);
  return unmocked;
}

const surfaces = [
  { path: '/finished-stock-management', client: 'admin', kind: 'finished' },
  { path: '/supply-chain/finished-stock-management', client: 'supply-chain', kind: 'finished' },
  { path: '/accessory-management', client: 'admin', kind: 'accessory' },
  { path: '/supply-chain/accessory-management', client: 'supply-chain', kind: 'accessory' },
  { path: '/store/accessory-management', client: 'store', kind: 'store-accessory' },
  { path: '/slab-management', client: 'admin', kind: 'slab' },
  { path: '/supply-chain/slab-management', client: 'supply-chain', kind: 'slab' },
  { path: '/store/finished-stock-management', client: 'store', kind: 'store' },
];
const states = ['warehouse', 'selling', 'soldOut', 'recycle'];
const titles = ['仓库中', '已上架', '已售完', '回收站'];
const actorTitles = ['入库人', '上架人', '', '移入人'];
const timeTitles = ['入库时间', '上架时间', '售完时间', '移入时间'];

for (const surface of surfaces) {
  test(`${surface.path} shows state activity without source tags and keeps complete-list ordering`, async ({
    page,
  }) => {
    const unmocked = await installStateMocks(page, surface.kind);
    await page.addInitScript((surface) => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          name: '状态测试员工',
          clientCode: surface.client === 'store' ? 'admin' : surface.client,
          roles: [surface.client === 'store' ? 'STORE_ADMIN' : 'OPERATOR'],
          permissions: ['all'],
          dataPermission: 'all',
          ...(surface.client === 'store' ? { tenantId: 1, storeId: 2, storeType: 'cityPartner' } : {}),
        }),
      );
    }, surface);
    const records = states.flatMap((state, index) =>
      [0, 1].map((recent) => ({
        id: index * 2 + recent + 100,
        productId: index * 2 + recent + 100,
        name: `${state}-${recent ? '最近变更' : '新创建'}`,
        sku: `ACT-${index}-${recent}`,
        serialNo: `ACT-${index}-${recent}`,
        status: state,
        sourceStatus: surface.client === 'supply-chain' ? state : 'selling',
        effectiveStatus: state,
        sourceUnavailable: false,
        stock: 2,
        totalStock: 2,
        createdByName: '创建人不展示',
        createdAt: recent ? '2020-01-01T00:00:00' : '2026-10-01T00:00:00',
        stateOperatedAt: recent ? '2026-10-12T02:00:00.000000Z' : '2026-10-01T02:00:00.000000Z',
        stateOperatorName: '状态操作员',
        warehouseEntryType: state === 'warehouse' ? (recent ? 'offShelf' : 'firstEntry') : null,
        warehouseEntryReason: state === 'warehouse' && recent ? '价格调整' : null,
        warehouseEntryDetail: null,
        variants: [],
        attributes: [],
        specDimensions: [],
        markupPrices: [],
        guidePrices: [],
        skus: [],
        offShelfRecords: [],
        imageUrls: [],
        mainImageUrls: [],
        attributeNames: {},
        categoryName: '',
      })),
    );
    const endpoint =
      surface.kind === 'slab'
        ? 'slabs'
        : surface.kind === 'accessory'
          ? 'accessory-products'
          : surface.kind === 'store-accessory'
            ? 'store-accessory-products'
            : surface.kind === 'store'
              ? 'store-finished-products'
              : 'finished-products';
    await page.route(`**/api/admin/${endpoint}`, (route) => route.fulfill({ json: { code: 0, data: records } }));
    if (surface.client === 'store') {
      await page.route(`**/api/admin/${endpoint}/categories`, (route) =>
        route.fulfill({ json: { code: 0, data: [] } }),
      );
    }
    await page.route(`**/api/admin/${endpoint}/attribute-template-options`, (route) =>
      route.fulfill({ json: { code: 0, data: [] } }),
    );
    await page.goto(productWarehouseUrl(surface.path));
    const main = page.getByRole('main');
    for (let index = 0; index < states.length; index++) {
      await main.locator('.t-tabs__nav-item').filter({ hasText: titles[index] }).click();
      await expect(main.getByRole('columnheader', { name: timeTitles[index], exact: true })).toBeVisible();
      if (states[index] === 'warehouse') {
        await expect(main.locator('.zdm-admin-filter-form').getByText('入库类型', { exact: true })).toHaveCount(0);
        await expect(main.locator('.zdm-admin-filter-form').getByText('入库人', { exact: true })).toHaveCount(0);
        const columnKeys = await main
          .locator('thead th')
          .evaluateAll((headers) => headers.map((header) => header.getAttribute('data-colkey')));
        const entryIndex = columnKeys.indexOf('warehouseEntry');
        expect(entryIndex).toBeGreaterThanOrEqual(0);
        expect(columnKeys.slice(entryIndex, entryIndex + 3)).toEqual([
          'warehouseEntry',
          'stateOperatorName',
          'stateOperatedAt',
        ]);
      }
      const timeHeader = main.getByRole('columnheader', { name: timeTitles[index], exact: true });
      const sortIcons = timeHeader.locator('.t-table__sort-icon');
      await expect(sortIcons.locator('svg.t-icon-caret-down-small.t-size-s')).toHaveCount(2);
      const headerLayout = await timeHeader.evaluate((header) => {
        const title = header.querySelector<HTMLButtonElement>('.product-state-time-title')!;
        const icons = header.querySelector<HTMLElement>('.t-table__double-icons')!;
        const typography = (element: Element) => {
          const style = getComputedStyle(element);
          return {
            family: style.fontFamily,
            size: style.fontSize,
            weight: style.fontWeight,
            line: style.lineHeight,
            color: style.color,
          };
        };
        const textBox = title.getBoundingClientRect();
        const iconBox = icons.getBoundingClientRect();
        return {
          title: typography(title),
          header: typography(header),
          gap: iconBox.left - textBox.right,
          centerDifference: Math.abs(iconBox.y + iconBox.height / 2 - textBox.y - textBox.height / 2),
          iconHeight: iconBox.height,
          textSize: parseFloat(getComputedStyle(title).fontSize),
        };
      });
      expect(headerLayout.title).toEqual(headerLayout.header);
      expect(headerLayout.gap).toBeGreaterThanOrEqual(0);
      expect(headerLayout.gap).toBeLessThanOrEqual(6);
      expect(headerLayout.centerDifference).toBeLessThanOrEqual(1);
      expect(headerLayout.iconHeight).toBeLessThanOrEqual(headerLayout.textSize);

      await expect(sortIcons.last()).toHaveClass(/t-table__sort-icon--active/);
      await sortIcons.first().click();
      await expect(sortIcons.first()).toHaveClass(/t-table__sort-icon--active/);
      await sortIcons.last().click();
      await expect(sortIcons.last()).toHaveClass(/t-table__sort-icon--active/);
      await expect(main.getByRole('columnheader', { name: '创建人', exact: true })).toHaveCount(0);
      await expect(main.getByRole('columnheader', { name: '创建时间', exact: true })).toHaveCount(0);
      const rows = main.locator('tbody tr');
      await expect(rows.first()).toContainText(`${states[index]}-最近变更`);
      await expect(rows.last()).toContainText(`${states[index]}-新创建`);
      await main.getByRole('button', { name: timeTitles[index], exact: true }).click();
      await expect(rows.first()).toContainText(`${states[index]}-新创建`);
      await main.getByRole('button', { name: timeTitles[index], exact: true }).click();
      await expect(rows.first()).toContainText(`${states[index]}-最近变更`);
      if (actorTitles[index]) {
        await expect(main.getByRole('columnheader', { name: actorTitles[index], exact: true })).toBeVisible();
        await expect(rows.first()).toContainText('状态操作员');
        await expect(rows.first().locator('td').filter({ hasText: '状态操作员' }).locator('.t-tag')).toHaveCount(0);
      } else {
        await expect(rows.first()).not.toContainText('状态操作员');
      }
    }
    expect(unmocked).toEqual([]);
  });
}

for (const surface of surfaces) {
  for (const batch of [false, true]) {
    test(`${surface.path} ${batch ? 'batch' : 'single'} restore immediately shows server actor and time`, async ({
      page,
    }) => {
      const unmocked = await installStateMocks(page, surface.kind);
      await page.addInitScript((client) => {
        localStorage.setItem('zdm-admin-token', 'dev-token');
        localStorage.setItem(
          'zdm-admin-user',
          JSON.stringify({
            id: 1,
            name: '当前登录人',
            clientCode: client === 'store' ? 'admin' : client,
            roles: [client === 'store' ? 'STORE_ADMIN' : 'OPERATOR'],
            permissions: ['all'],
            dataPermission: 'all',
            ...(client === 'store' ? { tenantId: 1, storeId: 2, storeType: 'cityPartner' } : {}),
          }),
        );
      }, surface.client);
      const records = [801, 802].map((id) => ({
        id,
        productId: id,
        name: `状态同步${id}`,
        sku: `SYNC-${id}`,
        serialNo: `SYNC-${id}`,
        status: 'recycle',
        effectiveStatus: 'recycle',
        sourceStatus: surface.client === 'supply-chain' ? 'recycle' : 'selling',
        sourceUnavailable: false,
        stock: 2,
        totalStock: 2,
        stateOperatorName: '旧操作人',
        stateOperatedAt: '2026-10-01T01:00:00.000000Z',
        variants: [],
        skus: [],
        attributes: [],
        specDimensions: [],
        markupPrices: [],
        guidePrices: [],
        offShelfRecords: [],
        imageUrls: [],
        mainImageUrls: [],
        attributeNames: {},
      }));
      const endpoint =
        surface.kind === 'slab'
          ? 'slabs'
          : surface.kind === 'accessory'
            ? 'accessory-products'
            : surface.kind === 'store-accessory'
              ? 'store-accessory-products'
              : surface.kind === 'store'
                ? 'store-finished-products'
                : 'finished-products';
      let mutations = 0;
      await page.route(`**/api/admin/${endpoint}**`, async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path.endsWith('/action-check')) return route.fulfill({ json: { code: 0, data: true } });
        if (request.method() !== 'GET') {
          const payload = request.postDataJSON();
          const ids: number[] = payload.ids ?? [Number(path.split('/').find((part) => /^80[12]$/.test(part)))];
          const target = payload.target ?? payload.status;
          expect(target).toBe('warehouse');
          mutations++;
          for (const record of records.filter((item) => ids.includes(item.id))) {
            record.status = record.effectiveStatus = target;
            if (surface.client === 'supply-chain') record.sourceStatus = target;
            record.stateOperatorName = `真实入库人${record.id}`;
            record.stateOperatedAt = '2026-10-27T06:01:27.644508Z';
          }
          return route.fulfill({
            json: {
              code: 0,
              data:
                surface.client === 'store'
                  ? records.filter((item) => ids.includes(item.id))
                  : surface.kind === 'slab'
                    ? true
                    : records.find((item) => ids.includes(item.id)),
            },
          });
        }
        if (path === `/api/admin/${endpoint}`) return route.fulfill({ json: { code: 0, data: records } });
        if (/\/80[12]$/.test(path))
          return route.fulfill({ json: { code: 0, data: records.find((item) => path.endsWith(`/${item.id}`)) } });
        if (path.endsWith('/categories') || path.endsWith('/attribute-template-options'))
          return route.fulfill({ json: { code: 0, data: [] } });
        return route.fallback();
      });
      await page.goto(productWarehouseUrl(surface.path));
      const main = page.getByRole('main');
      await main.locator('.t-tabs__nav-item').filter({ hasText: '回收站' }).click();
      if (batch) {
        await main.locator('thead .t-checkbox').click();
        await main.getByRole('button', { name: '批量放回到仓库', exact: true }).click();
      } else {
        await main
          .locator('tbody tr')
          .filter({ hasText: '状态同步801' })
          .getByText('放回仓库', { exact: true })
          .click();
      }
      await page.locator('.t-dialog:visible').getByRole('button', { name: /^确认/ }).click();
      await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
      await main.locator('.t-tabs__nav-item').filter({ hasText: '仓库中' }).click();
      for (const id of batch ? [801, 802] : [801]) {
        const row = main.locator('tbody tr').filter({ hasText: `状态同步${id}` });
        await expect(row).toContainText(`真实入库人${id}`);
        await expect(row).toContainText('2026/10/27 14:01');
        await expect(row).not.toContainText('旧操作人');
      }
      expect(mutations).toBeGreaterThan(0);
      expect(unmocked).toEqual([]);
    });
  }
}

for (const surface of surfaces) {
  test(`${surface.path} deletes selling directly to recycle without an intermediate down-shelf request`, async ({
    page,
  }) => {
    await installStateMocks(page, surface.kind);
    await page.addInitScript((client) => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          name: '删除流程测试员工',
          clientCode: client === 'store' ? 'admin' : client,
          roles: [client === 'store' ? 'STORE_ADMIN' : 'OPERATOR'],
          permissions: ['all'],
          dataPermission: 'all',
          ...(client === 'store' ? { tenantId: 1, storeId: 2, storeType: 'cityPartner' } : {}),
        }),
      );
    }, surface.client);
    const endpoint =
      surface.kind === 'slab'
        ? 'slabs'
        : surface.kind === 'store'
          ? 'store-finished-products'
          : surface.kind === 'store-accessory'
            ? 'store-accessory-products'
            : `${surface.kind}-products`;
    const record = {
      id: 801,
      productId: 801,
      name: '直接删除商品',
      serialNo: 'DELETE-801',
      status: 'selling',
      effectiveStatus: 'selling',
      sourceStatus: 'selling',
      totalStock: 2,
      stock: 2,
      publisherType: '平台发布',
      attributes: [],
      variants: [],
      skus: [],
      guidePrices: [],
      markupPrices: [],
      offShelfRecords: [],
      imageUrls: [],
      mainImageUrls: [],
      attributeNames: {},
    };
    let writes = 0;
    await page.route(`**/api/admin/${endpoint}**`, async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/action-check')) return route.fulfill({ json: { code: 0, data: true } });
      if (request.method() !== 'GET') {
        writes++;
        const body = request.postDataJSON();
        if (surface.kind === 'slab') expect(path).toBe(`/api/admin/${endpoint}/801/delete`);
        else {
          expect(body.target ?? body.status).toBe('recycle');
          expect(body.operation).toBeUndefined();
        }
        record.status = record.effectiveStatus = 'recycle';
        if (surface.client === 'supply-chain') record.sourceStatus = 'recycle';
        return route.fulfill({ json: { code: 0, data: surface.kind === 'slab' ? true : record } });
      }
      if (path === `/api/admin/${endpoint}`) return route.fulfill({ json: { code: 0, data: [record] } });
      if (path.endsWith('/801')) return route.fulfill({ json: { code: 0, data: record } });
      if (path.endsWith('/categories') || path.endsWith('/attribute-template-options'))
        return route.fulfill({ json: { code: 0, data: [] } });
      return route.fallback();
    });
    await page.goto(productWarehouseUrl(surface.path));
    const main = page.getByRole('main');
    await expect(main.locator('.t-tabs__nav-item').filter({ hasText: '已下架' })).toHaveCount(0);
    await main.locator('.t-tabs__nav-item').filter({ hasText: '已上架' }).click();
    await main.locator('tbody tr').filter({ hasText: '直接删除商品' }).getByText('删除', { exact: true }).click();
    await page
      .locator('.t-dialog:visible')
      .getByRole('button', { name: /^确认删除(?:至回收站)?$/, exact: true })
      .click();
    await expect(main.locator('tbody tr').filter({ hasText: '直接删除商品' })).toHaveCount(0);
    expect(writes).toBe(1);
    await main.locator('.t-tabs__nav-item').filter({ hasText: '回收站' }).click();
    await expect(main.locator('tbody tr').filter({ hasText: '直接删除商品' })).toHaveCount(1);
  });
}

for (const surface of surfaces) {
  test(`${surface.path} current entry labels and complete-list time sorting survive pagination`, async ({ page }) => {
    const unmocked = await installStateMocks(page, surface.kind);
    await page.addInitScript((surface) => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          name: '入库测试人员',
          clientCode: surface.client === 'store' ? 'admin' : surface.client,
          roles: [surface.client === 'store' ? 'STORE_ADMIN' : 'OPERATOR'],
          permissions: ['all'],
          dataPermission: 'all',
          ...(surface.client === 'store' ? { tenantId: 1, storeId: 2, storeType: 'cityPartner' } : {}),
        }),
      );
    }, surface);
    const records = Array.from({ length: 15 }, (_, index) => ({
      id: 700 + index,
      productId: 700 + index,
      name: `入库验证商品-${String(index).padStart(2, '0')}`,
      sku: `ENTRY-${index}`,
      serialNo: `ENTRY-${index}`,
      status: 'warehouse',
      sourceStatus: surface.client === 'supply-chain' ? 'warehouse' : 'selling',
      effectiveStatus: 'warehouse',
      stock: 2,
      totalStock: 2,
      sourceUnavailable: false,
      stateOperatorName: '入库操作人',
      stateOperatedAt: `2026-10-${String(index + 1).padStart(2, '0')}T02:00:00Z`,
      warehouseEntryType: index === 13 ? 'offShelf' : index === 12 ? 'recycleRestore' : 'firstEntry',
      warehouseEntryReason: index === 13 ? '价格调整' : null,
      warehouseEntryDetail: null,
      variants: [],
      attributes: [],
      specDimensions: [],
      markupPrices: [],
      guidePrices: [],
      skus: [],
      offShelfRecords: [],
      imageUrls: [],
      mainImageUrls: [],
      attributeNames: {},
      categoryName: '',
    }));
    const endpoint =
      surface.kind === 'slab'
        ? 'slabs'
        : surface.kind === 'accessory'
          ? 'accessory-products'
          : surface.kind === 'store-accessory'
            ? 'store-accessory-products'
            : surface.kind === 'store'
              ? 'store-finished-products'
              : 'finished-products';
    await page.route(`**/api/admin/${endpoint}`, (route) => route.fulfill({ json: { code: 0, data: records } }));
    if (surface.client === 'store')
      await page.route(`**/api/admin/${endpoint}/categories`, (route) =>
        route.fulfill({ json: { code: 0, data: [] } }),
      );
    await page.route(`**/api/admin/${endpoint}/attribute-template-options`, (route) =>
      route.fulfill({ json: { code: 0, data: [] } }),
    );
    await page.goto(productWarehouseUrl(surface.path));
    const main = page.getByRole('main');
    const rows = main.locator('tbody tr');
    await expect(rows.first()).toContainText('入库验证商品-14');
    const cell = (name: string) =>
      rows
        .filter({ hasText: name })
        .locator('td')
        .filter({ has: page.locator('.t-tag') });
    await expect(cell('入库验证商品-14')).toHaveText('首次入库');
    await expect(cell('入库验证商品-12')).toHaveText('回收恢复');
    await expect(cell('入库验证商品-13')).toContainText('下架入库');
    await expect(cell('入库验证商品-13')).toContainText('价格调整');
    await expect(cell('入库验证商品-13')).toContainText('未填写详细说明');
    await main.locator('.t-pagination__btn-next').click();
    await expect(main.locator('.t-pagination__number.t-is-current')).toHaveText('2');
    await main.getByRole('button', { name: '入库时间', exact: true }).click();
    await expect(main.locator('.t-pagination__number.t-is-current')).toHaveText('1');
    await expect(rows.first()).toContainText('入库验证商品-00');
    await main.getByRole('button', { name: '入库时间', exact: true }).click();
    await expect(rows.first()).toContainText('入库验证商品-14');
    expect(unmocked).toEqual([]);
  });
}
