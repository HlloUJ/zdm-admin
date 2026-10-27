import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

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
const states = ['warehouse', 'selling', 'offShelf', 'soldOut', 'recycle'];
const titles = ['仓库中', '已上架', '已下架', '已售完', '回收站'];
const actorTitles = ['入库人', '上架人', '下架人', '', '移入人'];
const timeTitles = ['入库时间', '上架时间', '下架时间', '售完时间', '移入时间'];

for (const surface of surfaces) {
  test(`${surface.path} shows state activity without source tags and keeps complete-list ordering`, async ({
    page,
  }) => {
    await installAdminApiMocks(page);
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
    await page.goto(surface.path);
    const main = page.getByRole('main');
    for (let index = 0; index < states.length; index++) {
      await main.locator('.t-tabs__nav-item').filter({ hasText: titles[index] }).click();
      await expect(main.getByRole('columnheader', { name: timeTitles[index], exact: true })).toBeVisible();
      await expect(main.getByRole('columnheader', { name: '创建人', exact: true })).toHaveCount(0);
      await expect(main.getByRole('columnheader', { name: '创建时间', exact: true })).toHaveCount(0);
      const rows = main.locator('tbody tr');
      await expect(rows.first()).toContainText(`${states[index]}-最近变更`);
      await expect(rows.last()).toContainText(`${states[index]}-新创建`);
      if (actorTitles[index]) {
        await expect(main.getByRole('columnheader', { name: actorTitles[index], exact: true })).toBeVisible();
        await expect(rows.first()).toContainText('状态操作员');
        await expect(rows.first().locator('td').filter({ hasText: '状态操作员' }).locator('.t-tag')).toHaveCount(0);
      } else {
        await expect(rows.first()).not.toContainText('状态操作员');
      }
    }
  });
}

for (const surface of surfaces) {
  for (const batch of [false, true]) {
    test(`${surface.path} ${batch ? 'batch' : 'single'} restore immediately shows server actor and time`, async ({
      page,
    }) => {
      await installAdminApiMocks(page);
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
        status: 'offShelf',
        effectiveStatus: 'offShelf',
        sourceStatus: surface.client === 'supply-chain' ? 'offShelf' : 'selling',
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
      await page.goto(surface.path);
      const main = page.getByRole('main');
      await main.locator('.t-tabs__nav-item').filter({ hasText: '已下架' }).click();
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
    });
  }
}
