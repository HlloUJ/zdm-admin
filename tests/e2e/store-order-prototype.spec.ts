import { test, expect, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
async function setup(page: Page, audience = 'store', permissions = ['all']) {
  await installAdminApiMocks(page);
  await page.addInitScript(
    ({ audience, permissions }) => {
      localStorage.setItem('zdm-admin-token', 'prototype-test-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 7,
          identityId: 7,
          name: '原型导购',
          phone: '13800000000',
          clientCode: audience === 'supply-chain' ? 'supply-chain' : 'admin',
          roles: [],
          permissions,
          dataPermission: 'all',
          tenantId: audience === 'admin' ? undefined : 1,
          storeId: audience === 'admin' || audience === 'supply-chain' ? undefined : 2,
          storeType: audience === 'supplier' ? 'slabSupplier' : 'cityPartner',
          storeName: '原型门店',
        }),
      );
    },
    { audience, permissions },
  );
}
test('store order prototype has five status views and drill-down without business writes', async ({ page }) => {
  await setup(page);
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(r.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/store/order-management/sales');
  await expect(page.getByText('订单管理', { exact: true })).toBeVisible();
  for (const label of ['待确认', '已确认', '已发货', '已完成', '已取消'])
    await expect(page.locator('.t-tabs__nav-item').filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible();
  await expect(page.getByText('XS-DEMO-001', { exact: true })).toBeVisible();
  await page
    .locator('.t-tabs__nav-item')
    .filter({ hasText: /^已发货$/ })
    .click();
  await expect(page.getByText('部分发货', { exact: true }).last()).toBeVisible();
  await page.getByText('XS-DEMO-003', { exact: true }).click();
  await expect(page.getByText('金额计算过程', { exact: true })).toBeVisible();
  await expect(page.getByText('操作记录', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
test('creates a local pending order using the real form and persists its snapshot', async ({ page }) => {
  await setup(page);
  await page.goto('/store/order-management/sales');
  await page.getByRole('button', { name: '新增订单', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增订单' });
  await dialog.getByPlaceholder('请输入联系电话', { exact: true }).fill('13800000088');
  await dialog.getByPlaceholder('请输入客户姓名', { exact: true }).fill('原型客户');
  await dialog.getByPlaceholder('请选择商品', { exact: true }).click();
  await page
    .getByText(/云雾白大理石餐桌 · CT-001 · 可售/)
    .last()
    .click();
  await dialog.getByRole('button', { name: '添加商品', exact: true }).click();
  await dialog.getByRole('button', { name: '确认新增', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('原型客户', { exact: true }).first()).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('zdm-order-prototype-v1:1:2:7:7') || 'null'),
  );
  expect(stored.orders[0].status).toBe('pending');
  expect(stored.orders[0].lines[0].sku).toBe('CT-001');
  expect(stored.orders[0].lines[0].reserved).toBe(0);
});
test('single granted status hides tabs and all ungranted mutations', async ({ page }) => {
  await setup(page, 'store', ['store.order-management.sales.completed.view']);
  await page.goto('/store/order-management/sales');
  await expect(page.getByText('XS-DEMO-004', { exact: true })).toBeVisible();
  await expect(page.locator('.t-tabs__nav-item')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增订单', exact: true })).toHaveCount(0);
  await expect(page.getByText('确认订单', { exact: true })).toHaveCount(0);
});
for (const audience of ['admin', 'supplier', 'supply-chain'])
  test(`${audience} cannot enter the store order prototype`, async ({ page }) => {
    await setup(page, audience);
    await page.goto('/store/order-management/sales');
    await expect(page).not.toHaveURL(/order-management/);
    await expect(page.getByText('订单管理', { exact: true })).toHaveCount(0);
  });
