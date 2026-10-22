import { expect, type Locator, type Page } from '@playwright/test';

export async function expectOfficialLayout(page: Page, form: Locator) {
  const width = page.viewportSize()!.width;
  await expect(form).toBeVisible();
  await expect(page.locator('.admin-shell')).toHaveCSS('display', 'flex');
  await expect(page.locator('.admin-shell > .page')).toHaveCSS('min-width', width <= 991 ? '0px' : '760px');
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
  expect(count).toBe(width <= 991 ? 1 : 2);
  if (width <= 991) {
    const actions = form.locator('.filter-actions');
    await expect(row).toHaveCSS('row-gap', '24px');
    const fieldsBox = (await fields.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    expect(actionsBox.y - fieldsBox.y - fieldsBox.height).toBeCloseTo(24, 0);
  }
  // Intermediate desktop widths retain the existing 760px scrolling canvas.
  if (width <= 991 || width >= 1366) await expectQueryControlsUnobstructed(form, width);
}

/** Check the actual controls, since a squeezed parent can conceal overflow. */
export async function expectQueryControlsUnobstructed(form: Locator, width: number) {
  const issues = await form.evaluate((element, width) => {
    const visible = (control: Element) => {
      const box = control.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(control).visibility !== 'hidden';
    };
    const fields = [...element.querySelectorAll('.t-form__label, .t-input, .t-select, .t-date-range-picker')].filter(
      visible,
    );
    const buttons = [...element.querySelectorAll('button')]
      .filter((button) => /^(查询|重置)$/.test(button.textContent?.trim() ?? ''))
      .filter(visible);
    const issues: string[] = [];
    for (const control of [element, ...fields, ...buttons]) {
      const box = control.getBoundingClientRect();
      if (box.left < -0.5 || box.right > width + 0.5) issues.push(`overflow: ${control.className}`);
    }
    for (const button of buttons) {
      const box = button.getBoundingClientRect();
      if (Math.abs(box.height - 32) > 0.5) issues.push('native button height');
      for (const field of fields) {
        const other = field.getBoundingClientRect();
        if (
          Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1 &&
          Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1
        )
          issues.push(`button overlaps field: ${field.className}`);
      }
    }
    return issues;
  }, width);
  expect(issues).toEqual([]);
}
