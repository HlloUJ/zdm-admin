import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

for (const permissions of [
  ['all'],
  ['admin.product-data-center.master-data.view', 'admin.product-data-center.master-data.create'],
]) {
  test(`retired unit URL cannot restore a business page with ${permissions[0]}`, async ({ page }) => {
    await installAdminApiMocks(page);
    await page.addInitScript((permissions) => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          name: '测试',
          clientCode: 'admin',
          roles: permissions[0] === 'all' ? ['SUPER_ADMIN'] : ['EMPLOYEE'],
          permissions,
        }),
      );
    }, permissions);
    const calls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/admin/master-data')) calls.push(request.url());
    });
    await page.goto('/unit-management');
    await expect(page.getByText('计量单位管理', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新增计量单位', exact: true })).toHaveCount(0);
    expect(calls).toEqual([]);
  });
}
