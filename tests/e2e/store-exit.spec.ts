import { test, expect } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
import { productWarehouseUrl } from './product-test-navigation';

test.beforeEach(async ({ page }) => {
  await installAdminApiMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'store-exit-ui-test');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        name: '测试运营',
        phone: '',
        clientCode: 'admin',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });
});

test('store exit confirms the server plan and reports pending cleanup separately from database deletion', async ({
  page,
}) => {
  let deleted = false;
  await page.route('**/api/admin/stores?scope=*', async (route) => {
    if (deleted && new URL(route.request().url()).searchParams.get('scope') === 'archived') {
      await route.fulfill({ json: { code: 0, data: [] } });
    } else await route.fallback();
  });
  await page.route('**/api/admin/stores/2?planHash=*', async (route) => {
    expect(route.request().method()).toBe('DELETE');
    expect(new URL(route.request().url()).searchParams.get('planHash')).toBe('reviewed-store-plan');
    deleted = true;
    await route.fulfill({
      json: {
        code: 0,
        data: {
          operationId: 'isolated-ui-operation',
          storeId: 2,
          databaseStatus: 'CLEARED',
          cleanupStatus: 'PENDING',
          pendingTasks: 2,
          retained: ['共享商品及其他组织数据保留'],
        },
      },
    });
  });
  await page.goto(productWarehouseUrl('/tenant-store-management'));
  await page.getByRole('main').getByText('已归档', { exact: true }).click();
  await page.locator('tbody tr').filter({ hasText: '已归档门店' }).getByText('彻底删除', { exact: true }).click();
  await expect(page.getByText(/将清理门店“已归档门店”的独占业务数据/)).toBeVisible();
  expect(deleted).toBe(false);
  await page.getByRole('button', { name: '确认彻底删除', exact: true }).click();
  await expect(page.getByText('仍有2项收尾任务，系统将按规则处理', { exact: true })).toBeVisible();
  await expect(page.getByText('已清理', { exact: true })).toBeVisible();
  expect(deleted).toBe(true);
  await expect(page.locator('tbody tr').filter({ hasText: '已归档门店' })).toHaveCount(0);
});

test('an ineligible preflight blocks deletion without opening its confirmation', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/admin/stores/*/purge-preview', (route) =>
    route.fulfill({ json: { code: 0, data: { blockers: ['有未解决的跨组织引用'], eligible: false } } }),
  );
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/stores/') && request.method() === 'DELETE') writes++;
  });
  await page.goto(productWarehouseUrl('/tenant-store-management'));
  await page.getByRole('main').getByText('已归档', { exact: true }).click();
  await page.locator('tbody tr').filter({ hasText: '已归档门店' }).getByText('彻底删除', { exact: true }).click();
  await expect(page.getByText(/有未解决的跨组织引用/)).toBeVisible();
  await expect(page.getByRole('button', { name: '确认彻底删除', exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
});
