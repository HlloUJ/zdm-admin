import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
import { installAdminApiMocks as installAccessoryApiMocks } from './accessory-api-mocks';
import { clickOpenedDialogConfirmation } from './dialog-confirmation';
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
  for (const tab of ['all', 'warehouse', 'selling']) {
    test(`${path} ${tab} deletes with confirmation only and a grouped partial result`, async ({ page }) => {
      await (resource.includes('accessory') ? installAccessoryApiMocks : installAdminApiMocks)(page);
      const prefix = `${client}.${path.split('/').at(-1)}`;
      await page.addInitScript(
        ({ prefix, client }) => {
          localStorage.setItem('zdm-admin-token', 'dev-token');
          localStorage.setItem(
            'zdm-admin-user',
            JSON.stringify({
              id: 1,
              name: '批量删除测试',
              clientCode: client === 'store' ? 'admin' : client,
              ...(client === 'store' ? { tenantId: 1, storeId: 2, storeType: 'cityPartner' } : {}),
              roles: ['OPERATOR'],
              dataPermission: 'all',
              permissions: [
                `${prefix}.all.view`,
                `${prefix}.warehouse.view`,
                `${prefix}.selling.view`,
                `${prefix}.warehouse.delete`,
                `${prefix}.selling.delete`,
              ],
            }),
          );
        },
        { prefix, client },
      );
      const state = tab === 'selling' ? 'selling' : 'warehouse';
      const products = [71, 72, 73].map((id) => ({
        id,
        productId: id + 1000,
        name: `删除商品${id}`,
        status: state,
        sourceStatus: state,
        effectiveStatus: state,
        sourceUnavailable: false,
        stock: 2,
        quantity: 2,
        totalStock: 2,
        attributes: [],
        variants: [],
        prices: [],
        markupPrices: [],
        offShelfRecords: [],
        price: { cost: 10, guide: 20 },
      }));
      for (const option of ['attribute-template-options', 'price-level-options', 'categories'])
        await page.route(`**/api/admin/${resource}/${option}`, (route) =>
          route.fulfill({ json: { code: 0, data: [] } }),
        );
      for (const option of ['attribute-template-options', 'price-level-options', 'categories'])
        await page.route(`**/api/admin/${resource}/${option}`, (route) =>
          route.fulfill({ json: { code: 0, data: [] } }),
        );
      await page.route(`**/api/admin/${resource}`, (route) => route.fulfill({ json: { code: 0, data: products } }));
      let requests = 0;
      await page.route(`**/api/admin/${resource}/batch-delete`, (route) => {
        requests++;
        expect(route.request().postDataJSON()).toEqual({ ids: expect.arrayContaining([71, 72, 73]) });
        products[0].status = 'recycle';
        products[0].sourceStatus = 'recycle';
        products[0].effectiveStatus = 'recycle';
        return route.fulfill({
          json: {
            code: 0,
            data: {
              total: 3,
              successCount: 1,
              failureCount: 2,
              failures: [
                { id: 72, code: 'VALIDATION_FAILED', reason: '来源商品已失效' },
                { id: 73, code: 'VALIDATION_FAILED', reason: '来源商品已失效' },
              ],
            },
          },
        });
      });
      await page.goto(`${path}?tab=${tab}`);
      const main = page.getByRole('main');
      const button = main.getByRole('button', { name: '批量删除', exact: true });
      await expect(button).toBeDisabled();
      await expect(main.locator('tbody tr')).toHaveCount(3);
      await main.locator('thead .t-checkbox__input').click();
      await button.click();
      const confirm = page.locator('.t-dialog:visible').filter({ hasText: '是否批量删除所选' });
      await expect(confirm.locator('input, textarea')).toHaveCount(0);
      await expect(confirm).toBeVisible();
      // The result opens before the list refresh finishes; keep its async options mock alive.
      const optionsReady =
        resource === 'finished-products'
          ? page.waitForResponse((response) => response.url().endsWith('/api/admin/finished-products/form-options'))
          : null;
      const responseReady = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().endsWith(`/api/admin/${resource}/batch-delete`),
      );
      const [, response, options] = await Promise.all([
        clickOpenedDialogConfirmation(confirm, '确认批量删除'),
        responseReady,
        optionsReady,
      ]);
      expect(response.status()).toBe(200);
      expect((await response.json()).data).toMatchObject({ total: 3, successCount: 1, failureCount: 2 });
      const result = page.locator('.t-dialog:visible').filter({ hasText: '批量删除结果' });
      await expect(result).toContainText('成功删除1件，失败2件。');
      await expect(result.getByRole('columnheader')).toHaveText(['商品ID', '失败原因']);
      await expect(result.locator('tbody tr')).toHaveCount(1);
      await expect(result.locator('tbody')).toContainText(client === 'store' ? '1072、1073' : '72、73');
      await expect(main.locator('tbody input[type="checkbox"]:checked')).toHaveCount(0);
      if (options) expect(await options.finished()).toBeNull();
      expect(requests).toBe(1);
    });
  }
  test(`${path} All row deletion stays state-specific while batch requires both grants`, async ({ page }) => {
    await (resource.includes('accessory') ? installAccessoryApiMocks : installAdminApiMocks)(page);
    const prefix = `${client}.${path.split('/').at(-1)}`;
    await page.addInitScript(
      ({ prefix, client }) => {
        localStorage.setItem('zdm-admin-token', 'dev-token');
        localStorage.setItem(
          'zdm-admin-user',
          JSON.stringify({
            id: 1,
            name: '受限删除测试',
            clientCode: client === 'store' ? 'admin' : client,
            ...(client === 'store' ? { tenantId: 1, storeId: 2, storeType: 'cityPartner' } : {}),
            roles: ['OPERATOR'],
            dataPermission: 'all',
            permissions: [
              `${prefix}.all.view`,
              `${prefix}.warehouse.view`,
              `${prefix}.selling.view`,
              `${prefix}.warehouse.delete`,
            ],
          }),
        );
      },
      { prefix, client },
    );
    const products = ['warehouse', 'selling'].map((status, i) => ({
      id: 71 + i,
      productId: 1071 + i,
      name: `受限商品${i}`,
      status,
      sourceStatus: status,
      effectiveStatus: status,
      sourceUnavailable: false,
      stock: 2,
      quantity: 2,
      totalStock: 2,
      attributes: [],
      variants: [],
      markupPrices: [],
      offShelfRecords: [],
    }));
    for (const option of ['attribute-template-options', 'price-level-options', 'categories'])
      await page.route(`**/api/admin/${resource}/${option}`, (route) => route.fulfill({ json: { code: 0, data: [] } }));
    await page.route(`**/api/admin/${resource}`, (route) => route.fulfill({ json: { code: 0, data: products } }));
    await page.goto(`${path}?tab=all`);
    const main = page.getByRole('main');
    await expect(main.locator('tbody tr')).toHaveCount(2);
    await expect(main.getByRole('button', { name: '批量删除', exact: true })).toHaveCount(0);
    await expect(
      main.locator('tbody tr').filter({ hasText: '受限商品0' }).getByText('删除', { exact: true }),
    ).toBeVisible();
    await expect(
      main.locator('tbody tr').filter({ hasText: '受限商品1' }).getByText('删除', { exact: true }),
    ).toHaveCount(0);
  });
}

for (const scenario of ['unknown-result', 'refresh-failure', 'duplicate-confirm'] as const) {
  test(`batch delete ${scenario} keeps execution results accurate and never resubmits automatically`, async ({
    page,
  }) => {
    await installAdminApiMocks(page);
    await page.addInitScript(() => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          name: '异常验证',
          roles: ['SUPER_ADMIN'],
          permissions: ['all'],
          dataPermission: 'all',
        }),
      );
    });
    for (const option of ['attribute-template-options', 'price-level-options'])
      await page.route(`**/api/admin/finished-products/${option}`, (route) =>
        route.fulfill({ json: { code: 0, data: [] } }),
      );
    let loads = 0;
    await page.route('**/api/admin/finished-products', (route) => {
      loads++;
      return scenario === 'refresh-failure' && loads > 1
        ? route.fulfill({ status: 500, json: { code: 500, message: '列表刷新失败' } })
        : route.fulfill({
            json: {
              code: 0,
              data: [
                {
                  id: 71,
                  name: '异常测试商品',
                  status: 'warehouse',
                  sourceStatus: 'selling',
                  totalStock: 2,
                  attributes: [],
                  variants: [],
                  markupPrices: [],
                },
              ],
            },
          });
    });
    let requests = 0;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/admin/finished-products/batch-delete', async (route) => {
      requests++;
      if (scenario === 'duplicate-confirm') await pending;
      return scenario === 'unknown-result'
        ? route.fulfill({ status: 500, json: { code: 500, message: '响应中断' } })
        : route.fulfill({ json: { code: 0, data: { total: 1, successCount: 1, failureCount: 0, failures: [] } } });
    });
    await page.goto('/finished-stock-management?tab=warehouse');
    const main = page.getByRole('main');
    await expect(main.getByText('异常测试商品', { exact: true })).toBeVisible();
    await main.locator('thead .t-checkbox__input').click();
    await main.getByRole('button', { name: '批量删除', exact: true }).click();
    const button = page.locator('.t-dialog:visible').getByRole('button', { name: '确认批量删除', exact: true });
    // Successful deletion starts a separate list/options refresh after showing the result.
    const optionsReady =
      scenario === 'unknown-result'
        ? null
        : page.waitForResponse((response) => response.url().endsWith('/api/admin/finished-products/form-options'));
    await button.click();
    if (scenario === 'duplicate-confirm') {
      await expect(button).toHaveClass(/t-is-loading/);
      await button.dispatchEvent('click');
      release!();
    }
    if (scenario === 'unknown-result') {
      await expect(page.getByText('未能获取完整删除结果，请刷新列表核对商品状态。', { exact: true })).toBeVisible();
      await expect(page.locator('.t-dialog:visible').filter({ hasText: '批量删除结果' })).toHaveCount(0);
    } else {
      await expect(page.locator('.t-dialog:visible').filter({ hasText: '批量删除结果' })).toContainText(
        '成功删除1件，失败0件。',
      );
      if (scenario === 'refresh-failure') await expect(page.getByText('列表刷新失败', { exact: true })).toBeVisible();
    }
    if (optionsReady) expect(await (await optionsReady).finished()).toBeNull();
    expect(requests).toBe(1);
  });
}
