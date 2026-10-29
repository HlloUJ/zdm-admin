import { productWarehouseUrl } from './product-test-navigation';
import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

for (const scopes of [
  [],
  ['finished-stock-management'],
  ['accessory-management'],
  ['finished-stock-management', 'accessory-management'],
]) {
  test(`store product group retains existing grants: ${scopes.join(',') || 'none'}`, async ({ page }) => {
    await installAdminApiMocks(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript((scopes) => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 7,
          name: '门店员工',
          clientCode: 'admin',
          tenantId: 1,
          storeId: 2,
          storeType: 'cityPartner',
          roles: ['STORE_EMPLOYEE'],
          permissions: scopes.map((scope) => `store.${scope}.warehouse.view`),
          dataPermission: 'all',
        }),
      );
    }, scopes);
    await page.goto(productWarehouseUrl(scopes.length ? `/store/${scopes[0]}` : '/dashboard'));
    const sidebar = page.locator('.side-nav');
    const group = sidebar.locator('.menu-level-one').filter({ hasText: '商品管理' });
    await expect(group).toHaveCount(scopes.length ? 1 : 0);
    for (const [scope, label] of [
      ['finished-stock-management', '成品现货管理'],
      ['accessory-management', '配件管理'],
    ]) {
      const item = sidebar.locator(`[data-menu-path="/store/${scope}"]`);
      if (scopes.includes(scope)) {
        await expect(item).toBeVisible();
        await expect(item).toHaveClass(/menu-level-two-item/);
        await expect(item).toHaveText(label);
      } else {
        await expect(item).toHaveCount(0);
      }
    }
    if (scopes.length === 2) {
      await group.getByText('配件管理', { exact: true }).click();
      await expect(page).toHaveURL('/store/accessory-management');
      await expect(group.locator('[data-menu-path="/store/accessory-management"]')).toHaveClass(/t-is-active/);
    }
  });
}
