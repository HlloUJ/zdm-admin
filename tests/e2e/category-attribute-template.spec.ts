import { expect, test, type Page, type Route } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

const apiOk = (data: unknown) => ({ code: 0, message: 'ok', data });
const fulfillJson = (route: Route, data: unknown) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(apiOk(data)),
  });

async function installCategoryAttributeMocks(page: Page) {
  await page.route('**/api/admin/product-categories', (route) =>
    fulfillJson(route, [
      { id: 1, scope: 'finished', name: '成品现货', sortOrder: 1, status: 'enabled' },
      { id: 2, parentId: 1, scope: 'finished', name: '岩板茶几', sortOrder: 1, status: 'enabled' },
    ]),
  );
  await page.route('**/api/admin/product-attributes', (route) =>
    fulfillJson(route, [{ id: 1, scope: 'shared', name: '材质', valueType: 'select', status: 'enabled' }]),
  );
  await page.route('**/api/admin/category-attributes', (route) =>
    fulfillJson(route, [
      {
        id: 1,
        categoryId: 2,
        attributeId: 1,
        requiredFlag: true,
        skuFlag: false,
        sortOrder: 1,
        status: 'enabled',
        createdByName: '韩健',
        createdAt: '2026-08-04T09:30:00',
      },
    ]),
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
  await installAdminApiMocks(page);
  await installCategoryAttributeMocks(page);
});

test('aligns the template list layout and shows creator metadata after status', async ({ page }) => {
  await page.goto('/category-attribute-template');

  const main = page.getByRole('main');
  await expect(main.locator('.zdm-admin-list-layout')).toHaveCount(1);
  await expect(main.locator('.zdm-admin-list-layout__filters')).toHaveCount(0);

  const headers = main.getByRole('columnheader');
  await expect(headers.nth(5)).toContainText('状态');
  await expect(headers.nth(6)).toContainText('创建人');
  await expect(headers.nth(7)).toContainText('创建时间');
  await expect(main.locator('tbody tr').filter({ hasText: '材质' }).first()).toContainText('韩健');

  const styles = await main.locator('.zdm-admin-list-layout__pagination').evaluate((host) => {
    const pagination = host.querySelector<HTMLElement>('.zdm-admin-pagination');
    if (!pagination) return null;
    return {
      hostMarginTop: getComputedStyle(host).marginTop,
      paginationMarginTop: getComputedStyle(pagination).marginTop,
    };
  });
  expect(styles).toEqual({ hostMarginTop: '16px', paginationMarginTop: '0px' });
});
