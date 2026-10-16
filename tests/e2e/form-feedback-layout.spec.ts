import { expect, test } from '@playwright/test';

for (const width of [1689, 1024, 768]) {
  test(`field, help, upload and price feedback retain row geometry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/tests/fixtures/official-ui/feedback-layout.html');
    const fields = page.locator('.t-form > .t-form__item');
    const geometry = () =>
      fields.evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, height: rect.height, margin: getComputedStyle(element).marginBottom };
        }),
      );
    await expect(fields).toHaveCount(7);
    const price = page.getByTestId('price-row');
    const centered = async () => {
      const input = await price.locator('.t-input').boundingBox();
      const row = await price.boundingBox();
      const label = await page.getByTestId('price-label').boundingBox();
      expect(Math.abs(input!.y + input!.height / 2 - (row!.y + row!.height / 2))).toBeLessThan(1);
      expect(Math.abs(input!.y + input!.height / 2 - (label!.y + label!.height / 2))).toBeLessThan(1);
    };
    await centered();
    const before = await geometry();
    const help = fields.first().locator('.t-input__help');
    const originalHelpBox = await help.boundingBox();
    const contentHelp = fields.nth(1).locator('.t-input__help');
    const contentHelpBox = await contentHelp.boundingBox();
    await expect(fields.first()).toHaveCSS('margin-bottom', '4px');
    await expect(fields.nth(1)).toHaveCSS('margin-bottom', '4px');

    await page.getByRole('button', { name: '校验', exact: true }).click();
    for (const message of ['请输入名称', '请输入具体内容', '请上传封面图', '请输入价格', '请输入编码', '请输入说明']) {
      await expect(page.getByText(message, { exact: true })).toBeVisible();
    }
    expect(await geometry()).toEqual(before);
    await expect(help).toBeHidden();
    await expect(contentHelp).toBeHidden();
    const nativeErrorBox = await fields.first().getByText('请输入名称', { exact: true }).boundingBox();
    const manualErrorBox = await fields.nth(1).getByText('请输入具体内容', { exact: true }).boundingBox();
    expect(nativeErrorBox!.y).toBe(originalHelpBox!.y);
    expect(manualErrorBox!.y).toBe(contentHelpBox!.y);
    expect(nativeErrorBox!.y + nativeErrorBox!.height).toBeLessThanOrEqual((await fields.nth(1).boundingBox())!.y);
    expect(manualErrorBox!.y + manualErrorBox!.height).toBeLessThanOrEqual((await fields.nth(2).boundingBox())!.y);
    await centered();
    for (const [index, text] of [
      [4, '请输入编码'],
      [5, '请输入说明'],
    ] as const) {
      const field = fields.nth(index);
      await expect(field.locator('.t-input__help')).toBeHidden();
      const error = field.getByText(text, { exact: true });
      const input = field.locator(index === 4 ? '.t-input' : '.t-textarea__inner');
      await expect(input).toHaveCSS(
        'border-top-color',
        await error.evaluate((element) => getComputedStyle(element).color),
      );
      const errorBox = await error.boundingBox();
      const controlBox = await field.locator('.t-form__controls-content').boundingBox();
      expect(errorBox!.y).toBe(controlBox!.y + controlBox!.height);
      expect(errorBox!.y + errorBox!.height).toBeLessThanOrEqual((await fields.nth(index + 1).boundingBox())!.y);
    }
    const manual = fields.nth(1);
    const errorColor = await manual.getByText('请输入具体内容').evaluate((element) => getComputedStyle(element).color);
    await expect(manual.locator('textarea')).toHaveCSS('border-top-color', errorColor);
    const upload = fields.nth(2);
    const uploadColor = await upload.getByText('请上传封面图').evaluate((element) => getComputedStyle(element).color);
    await expect(upload.locator('.t-upload__card-container')).toHaveCSS('border-top-color', uploadColor);
    const tip = await upload.getByText('请上传封面图').boundingBox();
    const card = await upload.locator('.t-upload__card-container').boundingBox();
    const following = await fields.nth(3).boundingBox();
    expect(tip!.y).toBeGreaterThanOrEqual(card!.y + card!.height);
    expect(tip!.y + tip!.height).toBeLessThanOrEqual(following!.y);
    await page.getByRole('button', { name: '清除反馈', exact: true }).click();
    await expect(page.getByText('请输入具体内容', { exact: true })).toHaveCount(0);
    await expect(help).toBeVisible();
    await expect(contentHelp).toBeVisible();
    await expect(fields.nth(4).locator('.t-input__help')).toBeVisible();
    await expect(fields.nth(5).locator('.t-input__help')).toBeVisible();
    expect(await geometry()).toEqual(before);
    await centered();
  });
}
