import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

async function setup(page: Page, store = false) {
  await installAdminApiMocks(page);
  await page.addInitScript((store) => {
    localStorage.setItem('zdm-admin-token', 'pagination-regression');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: store ? 7 : 1,
        identityId: store ? 7 : 1,
        name: '分页测试',
        clientCode: 'admin',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
        ...(store ? { tenantId: 1, storeId: 2, storeType: 'cityPartner' } : {}),
      }),
    );
  }, store);
}

async function chooseTwenty(page: Page) {
  const pager = page.locator('main .t-pagination:visible').first();
  await pager.locator('.t-pagination__select').click();
  const option = page.locator('.t-select-option:visible').filter({ hasText: /^20 条\/页$/ });
  await expect(option).toBeVisible();
  // Wait for the native Popup animation so the pointer cannot land on the row below it.
  await expect(option).toHaveCSS('opacity', '1');
  await page.waitForTimeout(400);
  await option.click();
  await expect(pager.locator('.t-pagination__select input')).toHaveValue('20 条/页');
}

for (const width of [1366, 768, 390]) {
  test(`public pagination stays inside the viewport at ${width}px without resizing native buttons`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await page.route('**/api/admin/roles', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: Array.from({ length: 90 }, (_, index) => ({
            id: index + 10,
            name: `角色${index}`,
            code: `role-${index}`,
            dataScope: 'all',
            functionPermissions: 'all',
            status: 'enabled',
            createdAt: '2026-10-01T10:00:00',
          })),
        },
      }),
    );
    await page.goto('/role-management');
    const pager = page.locator('main .t-pagination');
    await expect(pager).toBeVisible();
    await expect(page.locator('.zdm-admin-list-layout__pagination')).toHaveCSS('padding', '16px');
    await expect
      .poll(() =>
        pager.evaluate((el) =>
          [el, ...el.querySelectorAll('.t-pagination__btn, .t-pagination__select')].every((control) => {
            const box = control.getBoundingClientRect();
            return box.left >= 0 && box.right <= innerWidth;
          }),
        ),
      )
      .toBe(true);
    await expect(pager.locator('.t-pagination__btn-next')).toHaveCSS('height', '32px');
    await expect(pager.locator('.t-pagination__btn-next')).toHaveCSS('width', '32px');
  });

  test(`order tables keep independent page sizes and correct totals at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, true);
    await page.goto('/store/order-management/sales');
    await expect(page.getByText(/^XS\d{13}$/).first()).toBeVisible();
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((key) => key.startsWith('zdm-order-prototype-v1:'))!;
      const state = JSON.parse(localStorage.getItem(key)!);
      const original = state.orders.find((order: { status: string }) => order.status === 'pending');
      state.orders = Array.from({ length: 30 }, (_, index) => ({
        ...structuredClone(original),
        id: `XS${String(index + 1).padStart(13, '0')}`,
        plans: [
          {
            id: `plan${index}`,
            sku: original.lines[0].sku,
            source: 'local',
            route: 'store',
            quantity: 1,
            shipped: 0,
            received: 0,
            voided: false,
          },
        ],
        logs: Array.from({ length: 25 }, (_, logIndex) => ({
          id: `log${logIndex}`,
          at: '2026-10-01T10:00:00',
          actor: '分页测试',
          action: `分页日志${logIndex}`,
          before: '{}',
          after: '{}',
        })),
      }));
      state.settings = Array.from({ length: 45 }, (_, index) => ({
        id: `setting${index}`,
        group: 'nature',
        name: `款项${index}`,
        enabled: true,
      }));
      localStorage.setItem(key, JSON.stringify(state));
    });
    for (const [route, total] of [
      ['fulfillment', 30],
      ['settings', 45],
    ] as const) {
      await page.goto(`/store/order-management/${route}`);
      const pager = page.locator('main .t-pagination');
      const table = page.locator('main .t-table:has(.t-pagination)');
      await expect(pager.locator('.t-pagination__total')).toHaveText(`共 ${total} 条数据`);
      await expect(table.locator('tbody > tr')).toHaveCount(10);
      await pager.locator('.t-pagination__btn-next').click();
      await expect(pager.locator('.t-pagination__number.t-is-current')).toHaveText('2');
      await pager.locator('.t-pagination__btn-prev').click();
      await chooseTwenty(page);
      await expect(table.locator('tbody > tr')).toHaveCount(20);
    }
    await page.goto('/store/order-management/sales');
    await page.getByRole('button', { name: '详情', exact: true }).first().click();
    await expect(page.getByRole('main').getByText('金额计算过程', { exact: true })).toBeVisible();
    const pager = page.locator('main .t-pagination');
    const table = page.locator('main .t-table:has(.t-pagination)');
    await expect(pager.locator('.t-pagination__total')).toHaveText('共 25 条数据');
    await expect(table.locator('tbody > tr')).toHaveCount(5);
    await pager.locator('.t-pagination__btn-next').click();
    await expect(table.getByText('分页日志5', { exact: true })).toBeVisible();
    await pager.locator('.t-pagination__btn-prev').click();
    await chooseTwenty(page);
    await expect(table.locator('tbody > tr')).toHaveCount(20);
  });
}
