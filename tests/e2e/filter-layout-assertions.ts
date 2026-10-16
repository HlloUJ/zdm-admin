import { expect, type Locator, type Page } from '@playwright/test';

export async function expectOfficialLayout(page: Page, form: Locator) {
  const width = page.viewportSize()!.width;
  await expect(form).toBeVisible();
  await expect(page.locator('.admin-shell')).toHaveCSS('display', 'flex');
  await expect(page.locator('.admin-shell > .page')).toHaveCSS('min-width', '760px');
  await expect(page.locator('.top-nav')).toHaveCSS('height', '64px');
  await expect(page.locator('.top-nav')).toHaveCSS('flex-direction', 'row');
  await expect(page.locator('.side-nav')).toHaveCSS('width', width <= 991 ? '72px' : '232px');
  await expect(page.locator('.side-nav > .t-default-menu')).toHaveClass(
    width <= 991 ? /t-is-collapsed/ : /^(?!.*t-is-collapsed)/,
  );
  const columns = await form
    .locator('.filter-fields, .supply-type-filter-fields')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        display: style.display,
        columns: style.gridTemplateColumns.split(' ').length,
        grouped: !!element.querySelector(':scope > .filter-primary-row'),
      };
    });
  expect(columns.display).toBe('grid');
  const fields = form.locator('.filter-fields');
  const available = await fields.evaluate((el) => el.getBoundingClientRect().width);
  const fieldCount = await fields.locator(':scope > *').count();
  const expectedColumns = Math.max(1, Math.min(Math.max(3, Math.min(fieldCount, 4)), Math.floor(available / 238)));
  expect(columns.columns).toBe(expectedColumns);
  const row = form.locator('.filter-row, .supply-type-filter-row').first();
  await expect(row).toHaveCSS('display', 'grid');
  const count = await row.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(count).toBe(2);
}
