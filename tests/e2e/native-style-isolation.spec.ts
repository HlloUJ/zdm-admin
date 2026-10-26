import { expect, test } from '@playwright/test';

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
