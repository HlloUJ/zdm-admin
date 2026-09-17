import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

async function setup(page: Page, permissions: string[], clientCode = 'admin') {
  await installAdminApiMocks(page);
  await page.route('**/api/admin/finished-products/price-level-options', (route) =>
    route.fulfill({ json: { code: 0, message: 'ok', data: [] } }),
  );
  await page.route('**/api/admin/finished-products/attribute-template-options', (route) =>
    route.fulfill({ json: { code: 0, message: 'ok', data: [] } }),
  );
  await page.addInitScript(
    ({ permissions, clientCode }) => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 2,
          clientCode,
          name: '目录测试',
          roles: ['ADMIN_MANAGER'],
          permissions,
          dataPermission: 'all',
        }),
      );
    },
    { permissions, clientCode },
  );
}
const prefix = 'admin.finished-stock-management.';
test('hides finished stock menu without its permissions', async ({ page }) => {
  await setup(page, ['admin.slab-management.warehouse.view']);
  await page.goto('/slab-management');
  await expect(page.locator('.admin-side-menu').getByText('成品现货管理', { exact: true })).toHaveCount(0);
});
test('one tab hides rail and only grants requested row operation', async ({ page }) => {
  await setup(
    page,
    ['supply-chain.finished-stock-management.warehouse.view', 'supply-chain.finished-stock-management.warehouse.edit'],
    'supply-chain',
  );
  await page.goto('/supply-chain/finished-stock-management');
  const main = page.getByRole('main');
  await expect(main.getByText('意式轻奢岩板餐桌', { exact: true })).toBeVisible();
  await expect(main.locator('.status-tabs')).toHaveCount(0);
  await expect(main.locator('.table-actions .t-link')).toHaveText(['编辑']);
  await expect(main.getByRole('button', { name: '发布商品' })).toHaveCount(0);
  await expect(main.getByText('操作日志', { exact: true })).toHaveCount(0);
  await main.locator('.table-actions .t-link').getByText('编辑', { exact: true }).click();
  await expect(main.getByRole('radio', { name: '立刻上架', exact: true })).toBeDisabled();
  await expect(main.getByRole('radio', { name: '暂不上架', exact: true })).toBeEnabled();
});
test('multiple tabs exclude unauthorized default and fall back to selling', async ({ page }) => {
  await setup(page, [prefix + 'selling.view', prefix + 'sold-out.view']);
  await page.goto('/finished-stock-management');
  const main = page.getByRole('main');
  await expect(main.locator('.status-tabs .t-tabs__nav-item')).toHaveText([/出售中/, /已售完/]);
  await expect(main.locator('.status-tabs .t-tabs__nav-item.t-is-active')).toContainText('出售中');
  await expect(main.locator('.table-actions .t-link')).toHaveCount(0);
});

test('log-only access does not expose unauthorized warehouse content', async ({ page }) => {
  await setup(page, [prefix + 'operation-log.view']);
  let listRequested = false;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/admin/finished-products') listRequested = true;
  });
  await page.goto('/finished-stock-management');
  const main = page.getByRole('main');
  await expect(main.getByText('操作日志', { exact: true })).toBeVisible();
  await expect(main.locator('.status-tabs')).toHaveCount(0);
  await expect(main.locator('table')).toHaveCount(0);
  await expect(main.getByRole('button', { name: '提交' })).toHaveCount(0);
  expect(listRequested).toBe(false);
});
