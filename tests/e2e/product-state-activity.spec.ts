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
