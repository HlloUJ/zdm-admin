import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
import { installAdminApiMocks as installAccessoryApiMocks } from './accessory-api-mocks';

const surfaces = [
  ['admin', '/finished-stock-management', 'finished-products'],
  ['admin', '/accessory-management', 'accessory-products'],
  ['admin', '/slab-management', 'slabs'],
  ['supply-chain', '/supply-chain/finished-stock-management', 'finished-products'],
  ['supply-chain', '/supply-chain/accessory-management', 'accessory-products'],
  ['supply-chain', '/supply-chain/slab-management', 'slabs'],
  ['store', '/store/finished-stock-management', 'store-finished-products'],
  ['store', '/store/accessory-management', 'store-accessory-products'],
] as const;
for (const [client, path, resource] of surfaces) {
  test(`${path} selection follows available batch capabilities in every status`, async ({ page }) => {
    await (resource.includes('accessory') ? installAccessoryApiMocks : installAdminApiMocks)(page);
    const prefix = `${client}.${path.split('/').at(-1)}`;
    await page.addInitScript(
      ({ client, prefix }) => {
        localStorage.setItem('zdm-admin-token', 'dev-token');
        localStorage.setItem(
          'zdm-admin-user',
          JSON.stringify({
            id: 7,
            name: '选择权限测试',
            clientCode: client === 'store' ? 'admin' : client,
            ...(client === 'store' ? { tenantId: 1, storeId: 2, storeType: 'cityPartner' } : {}),
            roles: ['OPERATOR'],
            dataPermission: 'all',
            permissions: [
              ...['all', 'warehouse', 'selling', 'sold-out', 'recycle'].map((tab) => `${prefix}.${tab}.view`),
              ...(localStorage.getItem('selection-test-granted') === 'yes'
                ? [`${prefix}.warehouse.delete`, `${prefix}.recycle.clear`]
                : []),
            ],
          }),
        );
      },
      { client, prefix },
    );
    for (const option of ['attribute-template-options', 'price-level-options', 'categories']) {
      await page.route(`**/api/admin/${resource}/${option}`, (route) => route.fulfill({ json: { code: 0, data: [] } }));
    }
    const products = ['warehouse', 'selling', 'soldOut', 'recycle'].map((status, i) => ({
      id: 71 + i,
      productId: 1071 + i,
      name: `选择规则商品${status}`,
      status,
      effectiveStatus: status,
      sourceStatus: client === 'supply-chain' ? status : 'selling',
      sourceUnavailable: false,
      totalStock: 2,
      stock: 2,
      quantity: 2,
      imageUrls: [],
      attributes: [],
      variants: [],
      prices: [],
      markupPrices: [],
      offShelfRecords: [],
      specDimensions: [],
      skus: [],
      attributeNames: {},
      price: { cost: 10, guide: 20 },
    }));
    let writes = 0;
    page.on('request', (request) => {
      if (request.url().includes(`/api/admin/${resource}`) && request.method() !== 'GET') writes++;
    });
    await page.route(`**/api/admin/${resource}`, (route) => route.fulfill({ json: { code: 0, data: products } }));
    const main = page.getByRole('main');
    for (const tab of ['all', 'warehouse', 'selling', 'soldOut', 'recycle']) {
      await page.goto(`${path}?tab=${tab}`);
      await expect(main.getByText(`选择规则商品${tab === 'all' ? 'warehouse' : tab}`, { exact: true })).toBeVisible();
      await expect(main.getByRole('checkbox')).toHaveCount(0);
    }
    await page.evaluate(() => localStorage.setItem('selection-test-granted', 'yes'));
    await page.goto(`${path}?tab=warehouse`);
    const batchDelete = main.getByRole('button', { name: '批量删除', exact: true });
    await expect(batchDelete).toBeDisabled();
    await expect(main.getByRole('checkbox')).toHaveCount(2);
    await main.locator('tbody .t-checkbox__input').click();
    await expect(main.locator('tbody input[type=checkbox]:checked')).toHaveCount(1);
    await expect(batchDelete).toBeEnabled();
    await expect(main.getByText('已选 1 项', { exact: true })).toBeVisible();
    await main
      .locator('.t-tabs__nav-item')
      .filter({ hasText: /^已上架/ })
      .click();
    await expect(main.getByRole('checkbox')).toHaveCount(0);
    await expect(main.getByText('已选 1 项', { exact: true })).toHaveCount(0);
    await main
      .locator('.t-tabs__nav-item')
      .filter({ hasText: /^仓库中/ })
      .click();
    await expect(batchDelete).toBeDisabled();
    for (const tab of ['all', 'recycle']) {
      await page.goto(`${path}?tab=${tab}`);
      await expect(main.getByRole('checkbox')).toHaveCount(0);
    }
    await expect(main.getByRole('button', { name: '清空回收站', exact: true })).toBeEnabled();
    await page.evaluate(() => localStorage.removeItem('selection-test-granted'));
    await page.goto(`${path}?tab=warehouse`);
    await expect(main.getByText('选择规则商品warehouse', { exact: true })).toBeVisible();
    await expect(main.getByRole('checkbox')).toHaveCount(0);
    if (client === 'store') {
      await page.evaluate(() => localStorage.setItem('selection-test-granted', 'yes'));
      for (const target of ['row', 'page'] as const) {
        for (const roundTrip of [false, true]) {
          await page.goto(`${path}?tab=warehouse`);
          await expect(main.getByText('选择规则商品warehouse', { exact: true })).toBeVisible();
          let release!: () => void;
          let entered!: () => void;
          const pending = new Promise<void>((resolve) => {
            release = resolve;
          });
          const requested = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const endpoint = `**/api/admin/${resource}`;
          const delayed = async (route: import('@playwright/test').Route) => {
            entered();
            await pending;
            await route.fulfill({
              json: { code: 0, data: products.map((product) => ({ ...product, name: `过期回包${product.status}` })) },
            });
          };
          await page.route(endpoint, delayed);
          await main.locator(`${target === 'row' ? 'tbody' : 'thead'} .t-checkbox__input`).click();
          await requested;
          await main
            .locator('.t-tabs__nav-item')
            .filter({ hasText: /^已上架/ })
            .click();
          if (roundTrip)
            await main
              .locator('.t-tabs__nav-item')
              .filter({ hasText: /^仓库中/ })
              .click();
          const returned = page.waitForResponse((response) => response.url().endsWith(`/api/admin/${resource}`));
          release();
          await (await returned).finished();
          // Let the response continuation and Vue rendering finish before checking stale writes.
          await page.evaluate(
            () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
          );
          await expect(
            main.getByText(`选择规则商品${roundTrip ? 'warehouse' : 'selling'}`, { exact: true }),
          ).toBeVisible();
          await expect(main.getByText(/^过期回包/)).toHaveCount(0);
          await expect(main.locator('input[type=checkbox]:checked')).toHaveCount(0);
          await expect(main.getByText('已选 1 项', { exact: true })).toHaveCount(0);
          if (!roundTrip)
            await main
              .locator('.t-tabs__nav-item')
              .filter({ hasText: /^仓库中/ })
              .click();
          await expect(batchDelete).toBeDisabled();
          await page.unroute(endpoint, delayed);
        }
      }
    }
    expect(writes).toBe(0);
  });
}
