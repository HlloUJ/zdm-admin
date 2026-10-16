import { expect, test } from '@playwright/test';
import { installAdminApiMocks, setMockBusinessClient } from './admin-api-mocks';

test.beforeEach(async ({ page }) => {
  await installAdminApiMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        clientCode: localStorage.getItem('zdm-e2e-client') ?? 'admin',
        name: '表单宽度测试',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });
});

for (const route of [
  '/product-attribute',
  '/product-attribute-value',
  '/slab-variety',
  '/slab-grade',
  '/supplier-management',
  '/finished-stock-craft',
]) {
  test(`${route} ordinary create form uses native 480px dialog and equal available control widths`, async ({
    page,
  }) => {
    if (route === '/supplier-management') await setMockBusinessClient(page, 'supply-chain');
    await page.goto(route);
    await page.getByRole('button', { name: '新增', exact: true }).click();
    const dialog = page.locator('.t-dialog:visible');
    await expect(dialog).toHaveCSS('width', '480px');
    await expect.poll(() => dialog.evaluate((element) => element.getBoundingClientRect().width)).toBe(480);
    await expect(dialog).toHaveClass(/zdm-admin-single-form/);
    const geometry = () =>
      dialog.locator('.t-form__controls-content').evaluateAll((fields) =>
        fields.flatMap((field) =>
          [
            ...field.querySelectorAll(
              ':scope > .t-input__wrap, :scope > .t-input-number, :scope > .t-select__wrap, :scope > .t-cascader, :scope > .t-date-picker, :scope > .t-textarea',
            ),
          ].map((control) => ({
            available: field.getBoundingClientRect().width,
            width: control.getBoundingClientRect().width,
          })),
        ),
      );
    const before = await geometry();
    expect(before.length).toBeGreaterThan(0);
    for (const item of before) expect(Math.abs(item.available - item.width)).toBeLessThanOrEqual(1);
    for (const label of await dialog.locator('.t-form__label').all()) await expect(label).toHaveCSS('width', '100px');
    await dialog
      .getByRole('button', {
        name: '确认新增',
        exact: true,
      })
      .click();
    expect(await geometry()).toEqual(before);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toBeHidden();
    if (route === '/slab-variety' || route === '/slab-grade') {
      await page.getByRole('main').getByText('编辑', { exact: true }).first().click();
      await expect(dialog.getByRole('button', { name: '确认保存', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: '确认新增', exact: true })).toHaveCount(0);
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
    }
  });
}

test('store level edit uses the shared dialog standard even without edit in its title', async ({ page }) => {
  await page.goto('/tenant-store-management');
  const row = page.getByRole('main').locator('tbody tr').filter({ hasText: '杭州体验门店' });
  await row.getByRole('button', { name: '修改门店级别' }).click({ force: true });
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog).toHaveClass(/zdm-admin-single-form/);
  await expect.poll(() => dialog.evaluate((element) => element.getBoundingClientRect().width)).toBe(480);
  await expect(dialog.locator('.t-form__label')).toHaveCSS('width', '100px');
  const widths = await dialog.locator('.t-form__controls-content').evaluate((element) => ({
    available: element.getBoundingClientRect().width,
    actual: element.querySelector('.t-select__wrap')!.getBoundingClientRect().width,
  }));
  expect(Math.abs(widths.actual - widths.available)).toBeLessThanOrEqual(1);
  await dialog.locator('.t-select').click();
  await page.locator('.t-select__dropdown:visible').getByText('2级', { exact: true }).click();
  const request = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith('/admin/stores/1/level'),
  );
  await dialog
    .getByRole('button', {
      name: '确认调整门店级别',
      exact: true,
    })
    .click();
  expect((await request).postDataJSON()).toEqual({ storeLevelId: 2 });
  await expect(dialog).toBeHidden();
  await expect(page.getByText('已调整门店等级', { exact: true })).toBeVisible();
});
