import { test, expect } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({ id: 1, name: '测试运营', roles: ['SUPER_ADMIN'], permissions: ['all'], dataPermission: 'all' }),
    );
  });
  await installAdminApiMocks(page);
});

test('single deletion is blocked by Toast before confirmation and never sends DELETE', async ({ page }) => {
  let checks = 0,
    deletes = 0;
  await page.route('**/api/admin/slab-origins/*/delete-check', async (route) => {
    checks++;
    await route.fulfill({
      status: 400,
      json: { code: 400, message: '该产地已被大板库存引用，不能删除，请先停用该产地' },
    });
  });
  await page.route(/\/api\/admin\/slab-origins\/\d+$/, async (route) => {
    if (route.request().method() === 'DELETE') deletes++;
    await route.fallback();
  });
  await page.goto('/slab-origin');
  await page.getByRole('row').filter({ hasText: '巴西' }).getByText('删除', { exact: true }).click();
  await expect(page.locator('.zdm-admin-feedback')).toContainText('该产地已被大板库存引用');
  await expect(page.locator('.zdm-admin-confirm-dialog:visible')).toHaveCount(0);
  expect(checks).toBe(1);
  expect(deletes).toBe(0);
  await expect(page.getByRole('button', { name: '我知道了', exact: true })).toHaveCount(0);
});

test('successful preflight opens confirmation and cancellation does not mutate', async ({ page }) => {
  let deletes = 0;
  await page.route('**/api/admin/slab-origins/*/delete-check', (route) =>
    route.fulfill({ json: { code: 0, data: true } }),
  );
  await page.route(/\/api\/admin\/slab-origins\/\d+$/, async (route) => {
    if (route.request().method() === 'DELETE') deletes++;
    await route.fallback();
  });
  await page.goto('/slab-origin');
  await page.getByRole('row').filter({ hasText: '巴西' }).getByText('删除', { exact: true }).click();
  await expect(page.locator('.zdm-admin-confirm-dialog:visible')).toContainText('是否删除产地');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.zdm-admin-confirm-dialog:visible')).toHaveCount(0);
  expect(deletes).toBe(0);
});

test('preflight server error shows error Toast and leaves execution confirmation closed', async ({ page }) => {
  await page.route('**/api/admin/slab-origins/*/delete-check', (route) =>
    route.fulfill({ status: 503, json: { code: 503, message: '操作条件检查失败，请稍后重试' } }),
  );
  await page.goto('/slab-origin');
  await page.getByRole('row').filter({ hasText: '巴西' }).getByText('删除', { exact: true }).click();
  await expect(page.locator('.zdm-admin-feedback')).toContainText('操作条件检查失败，请稍后重试');
  await expect(page.locator('.zdm-admin-confirm-dialog:visible')).toHaveCount(0);
});

for (const scope of ['finished-stock', 'accessory'] as const) {
  for (const allowed of [false, true]) {
    test(`${scope} single shelf checks before confirmation and rechecks at submission: ${allowed}`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
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
            permissions: ['all'],
            dataPermission: 'all',
          }),
        );
      });
      const resource = scope === 'accessory' ? 'store-accessory-products' : 'store-finished-products';
      const product = {
        id: 41,
        productId: 91,
        name: '门店预检商品',
        status: 'warehouse',
        effectiveStatus: 'warehouse',
        sourceUnavailable: false,
        totalStock: 3,
        imageUrls: [],
        createdByName: '门店员工',
        createdAt: '2026-11-05T01:00:00',
        storeCategoryId: null,
        skus: [],
        attributes: [],
        specDimensions: [],
      };
      let checks = 0,
        writes = 0;
      await page.route(`**/api/admin/${resource}**`, async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.endsWith('/shelf-check')) {
          checks++;
          return route.fulfill({
            status: allowed ? 200 : 400,
            json: allowed ? { code: 0, data: true } : { code: 400, message: '请先选择门店分类并完善商品售价后再上架' },
          });
        }
        if (route.request().method() !== 'GET') {
          writes++;
          return route.fulfill({ status: 400, json: { code: 400, message: '商品状态已变化，请刷新后重试' } });
        }
        return route.fulfill({ json: { code: 0, data: pathname.endsWith(resource) ? [product] : [] } });
      });
      await page.goto(`/store/${scope === 'accessory' ? 'accessory-management' : 'finished-stock-management'}`);
      await page.getByRole('row').filter({ hasText: '门店预检商品' }).getByText('上架', { exact: true }).click();
      if (!allowed) {
        await expect(page.locator('.zdm-admin-feedback')).toContainText('请先选择门店分类并完善商品售价后再上架');
        await expect(page.locator('.zdm-admin-confirm-dialog:visible')).toHaveCount(0);
        expect(writes).toBe(0);
      } else {
        await expect(page.locator('.zdm-admin-confirm-dialog:visible')).toBeVisible();
        expect(writes).toBe(0);
        await page.getByRole('button', { name: '确认上架', exact: true }).click();
        await expect(page.locator('.zdm-admin-feedback')).toContainText('商品状态已变化，请刷新后重试');
        expect(writes).toBe(1);
      }
      expect(checks).toBe(1);
    });
  }
}

test('repeated execution confirmation sends one mutation while pending', async ({ page }) => {
  let deletes = 0;
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  await page.route('**/api/admin/slab-origins/*/delete-check', (route) =>
    route.fulfill({ json: { code: 0, data: true } }),
  );
  await page.route(/\/api\/admin\/slab-origins\/\d+$/, async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    deletes++;
    await pending;
    await route.fulfill({ json: { code: 0, data: true } });
  });
  await page.goto('/slab-origin');
  await page.getByRole('row').filter({ hasText: '巴西' }).getByText('删除', { exact: true }).click();
  const confirm = page.getByRole('button', { name: '确认删除', exact: true });
  await confirm.dispatchEvent('click');
  await expect(confirm).toBeDisabled();
  await confirm.dispatchEvent('click');
  await expect.poll(() => deletes).toBe(1);
  release();
  await expect(page.locator('.zdm-admin-confirm-dialog:visible')).toHaveCount(0);
  expect(deletes).toBe(1);
});
