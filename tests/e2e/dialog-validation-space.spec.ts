import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

test('pure native Dialog and Form reproduce last-field error overflow without application styles', async ({ page }) => {
  await page.goto('/tests/fixtures/official-ui/dialog-validation.html?kind=native');
  const dialog = page.locator('.t-dialog:visible');
  const body = dialog.locator('.t-dialog__body');
  await expect(dialog).toBeVisible();
  const before = await body.evaluate((element) => ({ height: element.clientHeight, scroll: element.scrollHeight }));
  await dialog
    .getByRole('button', {
      name: '提交',
      exact: true,
    })
    .click();
  await expect(dialog.getByText('请选择所属属性', { exact: true })).toBeVisible();
  await expect(dialog.getByText('请输入值名称', { exact: true })).toBeVisible();
  const after = await body.evaluate((element) => ({
    height: element.clientHeight,
    scroll: element.scrollHeight,
    overflow: getComputedStyle(element).overflowY,
  }));
  console.log('native-dialog-validation', JSON.stringify({ before, after }));
  expect(before.scroll).toBeLessThanOrEqual(before.height);
  expect(after.scroll).toBeGreaterThan(after.height);
  expect(after.overflow).toBe('auto');
  expect(
    await page
      .locator('style, link[rel="stylesheet"]')
      .evaluateAll((elements) =>
        elements.some((element) =>
          (element.getAttribute('data-vite-dev-id') ?? element.getAttribute('href') ?? '').includes('/src/styles/'),
        ),
      ),
  ).toBe(false);
});

for (const kind of ['public', 'foundation']) {
  test(`${kind} short form reserves final error space before validation and retains visible feedback`, async ({
    page,
  }) => {
    await page.goto(`/tests/fixtures/official-ui/dialog-validation.html?kind=${kind}`);
    const dialog = page.locator('.t-dialog:visible');
    const body = dialog.locator('.t-dialog__body');
    await expect(dialog).toBeVisible();
    const geometry = () => body.evaluate((element) => ({ height: element.clientHeight, scroll: element.scrollHeight }));
    const before = await geometry();
    expect(before.scroll).toBeLessThanOrEqual(before.height);
    await dialog
      .getByRole('button', {
        name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
        exact: true,
      })
      .click();
    await expect(dialog.getByText('请输入值名称', { exact: true })).toBeVisible();
    expect(await geometry()).toEqual(before);
    const field = dialog.locator('.t-form__item').last();
    const color = await field
      .getByText('请输入值名称', { exact: true })
      .evaluate((element) => getComputedStyle(element).color);
    await expect(field.locator('.t-input')).toHaveCSS('border-top-color', color);
    const textBox = await field.getByText('请输入值名称', { exact: true }).boundingBox();
    const bodyBox = await body.boundingBox();
    expect(textBox!.y + textBox!.height).toBeLessThanOrEqual(bodyBox!.y + bodyBox!.height);
    await field.getByRole('textbox').fill('有效值');
    await dialog.locator('.t-dialog__header').click();
    await expect(field.getByText('请输入值名称', { exact: true })).toHaveCount(0);
    expect(await geometry()).toEqual(before);
  });

  test(`${kind} long form preserves native scrolling and reaches the final field and footer`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(`/tests/fixtures/official-ui/dialog-validation.html?kind=${kind}&long=1`);
    const dialog = page.locator('.t-dialog:visible');
    await expect(dialog).toBeVisible();
    const hasScroll = () =>
      page
        .locator('.t-dialog__ctx, .t-dialog__wrap, .t-dialog__position, .t-dialog__body')
        .evaluateAll((elements) =>
          elements.some(
            (element) =>
              ['auto', 'scroll'].includes(getComputedStyle(element).overflowY) &&
              element.scrollHeight > element.clientHeight,
          ),
        );
    expect(await hasScroll()).toBe(true);
    await dialog
      .getByRole('button', {
        name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
        exact: true,
      })
      .click();
    const field = dialog.locator('.t-form__item').last();
    await field.getByText('请输入值名称', { exact: true }).scrollIntoViewIfNeeded();
    await expect(field.getByText('请输入值名称', { exact: true })).toBeInViewport();
    expect(await hasScroll()).toBe(true);
    await dialog
      .getByRole('button', {
        name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
        exact: true,
      })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole('button', {
        name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
        exact: true,
      }),
    ).toBeInViewport();
  });
}

test('attribute value create dialog keeps its final field error visible without introducing a scrollbar', async ({
  page,
}) => {
  await installAdminApiMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        clientCode: 'admin',
        name: '弹窗校验测试',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });
  await page.goto('/product-attribute-value');
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  const body = dialog.locator('.t-dialog__body');
  const geometry = () => body.evaluate((element) => ({ height: element.clientHeight, scroll: element.scrollHeight }));
  const before = await geometry();
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(dialog.getByText('请选择所属属性', { exact: true })).toBeVisible();
  await expect(dialog.getByText('请输入值名称', { exact: true })).toBeVisible();
  const after = await geometry();
  expect(after).toEqual(before);
  expect(after.scroll).toBeLessThanOrEqual(after.height);
  const errorColor = await dialog
    .getByText('请输入值名称', { exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  await expect(dialog.locator('.t-form-item__name .t-input')).toHaveCSS('border-top-color', errorColor);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
});
