import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

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

for (const width of [768, 1689]) {
  test(`long native, manual, help, upload and price feedback grows without overlap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/tests/fixtures/official-ui/feedback-layout.html?long-errors=1');
    const fields = page.locator('.t-form > .t-form__item');
    await expect(fields).toHaveCount(8);
    const before = await fields.last().boundingBox();
    await page.getByRole('button', { name: '校验', exact: true }).click();
    const messages = page.locator(
      '.t-input__extra, .t-form-item-tips, .t-input__tips, .t-textarea__tips, .t-upload__tips',
    );
    await expect(messages).toHaveCount(7);
    for (const tip of await messages.all()) {
      const result = await tip.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const item = element.closest('.t-form__item')!;
        const next = item.nextElementSibling!.getBoundingClientRect();
        const style = getComputedStyle(element);
        const control = item
          .querySelector('.t-input, .t-textarea__inner, .t-upload__card-container')!
          .getBoundingClientRect();
        return {
          below: box.top >= control.bottom - 1,
          beforeNext: box.bottom <= next.top + 1,
          wrapped: box.height > 20,
          complete: element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth,
          nowrap: style.whiteSpace === 'nowrap',
        };
      });
      expect(result).toEqual({ below: true, beforeNext: true, wrapped: true, complete: true, nowrap: false });
    }
    expect((await fields.last().boundingBox())!.y).toBeGreaterThan(before!.y);
    await page.getByRole('button', { name: '清除反馈', exact: true }).click();
    expect(await fields.last().boundingBox()).toEqual(before);
  });
}

test('employee invite errors fit before the next field in both registration steps', async ({ page }) => {
  await installAdminApiMocks(page);
  await page.goto('/employee-invite?token=e2e-invite-token');
  const check = async () => {
    for (const tip of await page.locator('.t-input__extra').all()) {
      const geometry = await tip.evaluate((element) => ({
        bottom: element.getBoundingClientRect().bottom,
        next: element.closest('.t-form__item')!.nextElementSibling!.getBoundingClientRect().top,
      }));
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.next);
    }
  };
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.locator('.t-input__extra')).toHaveCount(2);
  await check();
  await page.getByPlaceholder('请输入手机号').fill('15926627771');
  await page.getByPlaceholder('请输入验证码').fill('888888');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '确认提交注册', exact: true }).click();
  await expect(page.locator('.t-input__extra')).toHaveCount(2);
  await check();
});

for (const inside of [false, true]) {
  test(`wrapped upload errors remain above the next card and following content (form=${inside})`, async ({ page }) => {
    await page.goto(
      `/tests/fixtures/official-ui/feedback-layout.html?wrapped-uploads=1${inside ? '&inside-form=1' : ''}`,
    );
    const area = page.getByTestId('wrapped-upload-area');
    const followingPosition = () =>
      page.getByTestId('after-uploads').evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
    const before = await followingPosition();
    await page.getByRole('button', { name: '校验', exact: true }).click();
    const tips = area.locator('.t-upload__tips');
    await expect(tips).toHaveCount(3);
    for (const tip of await tips.all()) {
      const result = await tip.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const root = element.closest('.admin-media-upload')!;
        const card = root.querySelector('.t-upload__card-container')!.getBoundingClientRect();
        const cards = [
          ...document.querySelectorAll('[data-testid="wrapped-upload-area"] .t-upload__card-container'),
        ].map((node) => node.getBoundingClientRect());
        const nextRow = cards.filter((rect) => rect.top > card.top + card.height).sort((a, b) => a.top - b.top)[0];
        return {
          below: box.top >= card.bottom,
          beforeRow: !nextRow || box.bottom <= nextRow.top,
          beforeFollowing:
            box.bottom <= document.querySelector('[data-testid="after-uploads"]')!.getBoundingClientRect().top,
          complete: element.scrollWidth <= element.clientWidth,
        };
      });
      expect(result).toEqual({ below: true, beforeRow: true, beforeFollowing: true, complete: true });
    }
    await page.getByRole('button', { name: '清除反馈', exact: true }).click();
    expect(await followingPosition()).toBe(before);
  });
}
