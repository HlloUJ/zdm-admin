import { expect, type Locator, type Page } from '@playwright/test';

/** Check the shared image-only window contract, then dismiss via native outside click. */
export async function expectStandardImagePreviewAndDismiss(page: Page, preview: Locator) {
  await expect(preview).toBeVisible();
  const expectedWidth = Math.min(960, page.viewportSize()!.width * 0.94);
  await expect.poll(async () => Math.abs((await preview.boundingBox())!.width - expectedWidth)).toBeLessThanOrEqual(1);
  const image = preview.locator('img').first();
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS('max-width', '100%');
  await expect(image).toHaveCSS('max-height', 'none');
  await expect(image).toHaveCSS('border-top-width', '0px');
  const context = page.locator('.t-dialog__ctx').filter({ has: preview });
  await expect(context.locator('.t-dialog__mask')).toBeVisible();
  await image.click();
  await expect(preview).toBeVisible();
  await context.locator('.t-dialog__position').click({ position: { x: 5, y: 5 } });
  await expect(preview).not.toBeVisible();
}
