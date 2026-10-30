import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

for (const scenario of ['short', 'long', 'plain', 'narrow'] as const) {
  test(`batch shelf result content sizing: ${scenario}`, async ({ page }) => {
    await page.setViewportSize({ width: scenario === 'narrow' ? 440 : 1440, height: 800 });
    await installAdminApiMocks(page);
    await page.addInitScript(() => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          name: '结果布局测试',
          clientCode: 'admin',
          roles: ['OPERATOR'],
          dataPermission: 'all',
          permissions: [
            'admin.finished-stock-management.all.view',
            'admin.finished-stock-management.warehouse.view',
            'admin.finished-stock-management.selling.view',
            'admin.finished-stock-management.batch-shelf',
          ],
        }),
      );
    });
    const product = {
      id: 71,
      name: '布局验证商品',
      status: 'warehouse',
      sourceStatus: 'selling',
      sourceUnavailable: false,
      totalStock: 2,
      stock: 2,
      attributes: [],
      variants: [],
      offShelfRecords: [],
      specDimensions: [],
    };
    await page.route('**/api/admin/finished-products', (route) =>
      route.fulfill({ json: { code: 0, data: [product] } }),
    );
    for (const option of ['attribute-template-options', 'price-level-options'])
      await page.route(`**/api/admin/finished-products/${option}`, (route) =>
        route.fulfill({ json: { code: 0, data: [] } }),
      );
    const reason =
      scenario === 'long'
        ? `缺少指导价配置，无法上架。${'LongUnbrokenResult'.repeat(500)}`
        : '已处于上架状态，不能重复上架';
    let requests = 0;
    await page.route('**/api/admin/finished-products/batch-shelf', (route) => {
      requests++;
      return route.fulfill({
        json: {
          code: 0,
          data: {
            total: 1,
            successCount: scenario === 'plain' ? 1 : 0,
            failureCount: scenario === 'plain' ? 0 : 1,
            failures: scenario === 'plain' ? [] : [{ id: 71, code: 'VALIDATION_FAILED', reason }],
          },
        },
      });
    });
    await page.goto('/finished-stock-management?tab=all');
    const main = page.getByRole('main');
    await main.locator('thead .t-checkbox__input').click();
    await main.getByRole('button', { name: '批量上架', exact: true }).click();
    await page.locator('.t-dialog:visible').getByRole('button', { name: '确认批量上架', exact: true }).click();
    const dialog = page.locator('.zdm-operation-result-dialog:visible');
    await expect(dialog).toBeVisible();
    // Measure after the native opening animation; do not change its duration or styles.
    await expect
      .poll(() =>
        dialog.evaluate((element) => element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth),
      )
      .toBeCloseTo(1, 2);
    const metrics = await dialog.evaluate((element) => {
      const body = element.querySelector('.t-dialog__body') as HTMLElement;
      const table = element.querySelector('table');
      const rect = element.getBoundingClientRect();
      const cells = [...element.querySelectorAll('tbody tr:first-child td')];
      const headers = [...element.querySelectorAll('th')];
      return {
        width: rect.width,
        bottom: rect.bottom,
        top: rect.top,
        overflow: body.scrollWidth - body.clientWidth,
        scrollable: body.scrollHeight > body.clientHeight,
        tableWidth: table?.getBoundingClientRect().width,
        bodyWidth: body.clientWidth,
        widths: cells.map((cell) => cell.getBoundingClientRect().width),
        headerFonts: headers.map((cell) => getComputedStyle(cell).font),
        fonts: cells.map((cell) => getComputedStyle(cell).font),
      };
    });
    expect(metrics.width).toBeLessThanOrEqual(Math.min(960, (scenario === 'narrow' ? 440 : 1440) * 0.9) + 1);
    expect(metrics.width).toBeGreaterThanOrEqual(Math.min(480, (scenario === 'narrow' ? 440 : 1440) * 0.9) - 1);
    expect(metrics.top).toBeGreaterThanOrEqual(0);
    expect(metrics.bottom).toBeLessThanOrEqual(800);
    expect(metrics.overflow).toBeLessThanOrEqual(1);
    if (scenario !== 'plain') {
      await expect(dialog).toContainText(reason);
      expect(metrics.tableWidth).toBeCloseTo(metrics.bodyWidth, 0);
      expect(metrics.widths[1]).toBeGreaterThan(metrics.widths[0]);
    } else await expect(dialog.locator('table')).toHaveCount(0);
    if (scenario === 'long') {
      expect(metrics.width).toBeCloseTo(960, 0);
      expect(metrics.scrollable).toBe(true);
    }
    const confirm = dialog.getByRole('button', { name: '确认', exact: true });
    const buttonRect = await confirm.boundingBox();
    expect(buttonRect!.y + buttonRect!.height).toBeLessThanOrEqual(800);
    await confirm.click();
    await expect(dialog).toBeHidden();
    expect(requests).toBe(1);
  });
}
