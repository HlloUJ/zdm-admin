import { expect, test } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

test('preserves sidebar scroll position on navigation, reselect and browser back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({ id: 1, name: '测试', roles: ['SUPER_ADMIN'], permissions: ['all'], dataPermission: 'all' }),
    );
    localStorage.setItem(
      'zdm-admin-side-menu-expanded',
      JSON.stringify([
        'product-management',
        'product-common-base-data',
        'slab-base-data-management',
        'finished-stock-base-data',
        'tenant-management',
        'permission-management',
      ]),
    );
  });
  await installAdminApiMocks(page);
  await page.goto('/slab-color');
  const sidebar = page.locator('.side-nav');
  const target = sidebar.locator('[data-menu-path="/slab-grade"]');
  await target.scrollIntoViewIfNeeded();
  const readPosition = () =>
    sidebar.evaluate((element) => ({
      top: element.scrollTop,
      menuTop: element.querySelector('.t-menu--scroll')?.scrollTop ?? 0,
    }));
  const position = await readPosition();
  expect(position.top + position.menuTop).toBeGreaterThan(0);
  const targetTop = (await target.boundingBox())!.y;
  await target.click();
  await expect(page).toHaveURL(/\/slab-grade$/);
  await expect.poll(readPosition).toEqual(position);
  expect((await target.boundingBox())!.y).toBe(targetTop);
  await target.click();
  await expect.poll(readPosition).toEqual(position);
  await page.goBack();
  await expect(page).toHaveURL(/\/slab-color$/);
  await expect.poll(readPosition).toEqual(position);
});
