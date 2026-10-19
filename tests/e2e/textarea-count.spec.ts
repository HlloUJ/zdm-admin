import { expect, test } from '@playwright/test';

for (const width of [1689, 1024, 375]) {
  test(`native counters stay inside without covering input or feedback at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/tests/fixtures/official-ui/textarea-count.html');
    const fields = page.locator('.t-textarea');
    const check = async () => {
      for (let i = 0; i < 4; i++) {
        const layout = await fields.nth(i).evaluate((root) => {
          const input = root.querySelector('textarea')!;
          const count = root.querySelector('.t-textarea__limit')!;
          const a = input.getBoundingClientRect(),
            b = count.getBoundingClientRect();
          return {
            inside: b.left >= a.left && b.right < a.right && b.top >= a.top && b.bottom < a.bottom,
            reserved: parseFloat(getComputedStyle(input).paddingBottom) >= b.height + (a.bottom - b.bottom),
            rightGap: a.right - b.right,
            text: count.textContent,
          };
        });
        expect(layout.inside).toBe(true);
        expect(layout.reserved).toBe(true);
        expect(layout.rightGap).toBeGreaterThanOrEqual(16);
      }
    };
    await check();
    await fields.first().locator('textarea').fill('字'.repeat(101));
    await expect(fields.first().locator('textarea')).toHaveValue('字'.repeat(100));
    await expect(fields.first().locator('.t-textarea__limit')).toHaveText('100/100');
    const growing = fields.nth(1).locator('textarea');
    const initial = await growing.boundingBox();
    for (let index = 0; index < 4; index++)
      await expect(fields.nth(index).locator('textarea')).toHaveCSS('resize', 'none');
    await growing.fill('换行\n'.repeat(30));
    await expect.poll(async () => (await growing.boundingBox())!.height).toBeGreaterThan(initial!.height + 400);
    expect(await growing.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    await fields
      .nth(1)
      .locator('textarea')
      .evaluate((input) => {
        input.scrollTop = input.scrollHeight;
      });
    await check();
    await growing.fill('短内容');
    await expect.poll(async () => (await growing.boundingBox())!.height).toBe(initial!.height);
    await check();
    await expect(fields.nth(3).locator('textarea')).toHaveValue('历史'.repeat(70));
    await expect(fields.nth(4).locator('textarea')).toHaveValue('历史'.repeat(70));
    await expect(fields.nth(4).locator('.t-textarea__limit')).toHaveCount(0);
    await fields.first().locator('textarea').fill('');
    const errorField = page.locator('.t-form__item').nth(2);
    const before = await errorField.boundingBox();
    await page.getByRole('button', { name: '校验', exact: true }).click();
    await expect(page.getByText('请输入普通内容', { exact: true })).toBeVisible();
    await expect(page.getByText('请输入内容', { exact: true })).toBeVisible();
    expect(await errorField.boundingBox()).toEqual(before);
    await check();
    const error = await fields.nth(2).locator('.t-textarea__tips').boundingBox();
    const input = await fields.nth(2).locator('textarea').boundingBox();
    expect(error!.y).toBeGreaterThanOrEqual(input!.y + input!.height);
  });
}
