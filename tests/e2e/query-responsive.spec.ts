import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
import { installAdminApiMocks as installAccessoryApiMocks } from './accessory-api-mocks';
import { expectOfficialLayout } from './filter-layout-assertions';

// Accessory route wrappers reuse these exact existing query implementations.
// Include all three new routes in the same viewport/overlap assertions.
const sharedQuerySources: Record<string, string> = {
  '/accessory-management': 'src/pages/finished-stock/management/index.vue',
  '/supply-chain/accessory-management': 'src/pages/finished-stock/supply-chain/index.vue',
  '/store/accessory-management': 'src/pages/finished-stock/store/index.vue',
};
const routes = [
  ...readFileSync('src/router/index.ts', 'utf8').matchAll(
    /path: '([^']+)'[\s\S]*?component: \(\) => import\('([^']+)'\)/g,
  ),
]
  .filter(
    ([, route, file]) =>
      !route.includes(':') &&
      route !== '/store/customer-management' &&
      readFileSync(sharedQuerySources[route] ?? file.replace('@/', 'src/'), 'utf8').includes('zdm-admin-filter-form'),
  )
  .map(([, route]) => route);

for (const route of routes) {
  test(`shared query layout preserves desktop and adapts without overlap on ${route}`, async ({ page }) => {
    await page.addInitScript((route) => {
      const store = route.startsWith('/store/') || route === '/store-category-management';
      const clientCode = route.includes('supply-chain') || route === '/supplier-management' ? 'supply-chain' : 'admin';
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          clientCode,
          name: '韩健',
          roles: ['SUPER_ADMIN'],
          permissions: ['all'],
          dataPermission: 'all',
          ...(store ? { tenantId: 1, storeId: 1, storeType: 'cityPartner' } : {}),
        }),
      );
    }, route);
    if (route.includes('accessory-management')) await installAccessoryApiMocks(page);
    else await installAdminApiMocks(page);
    await page.goto(route);
    const forms = page.locator('.t-form.zdm-admin-filter-form:visible');
    await expect(forms.first()).toBeVisible();
    for (const width of [1366, 1024, 992, 991, 768, 619, 375]) {
      await page.setViewportSize({ width, height: 858 });
      await test.step(`viewport ${width}`, async () => {
        for (const form of await forms.all()) await expectOfficialLayout(page, form);
      });
    }
  });
}
