import { expect, type Locator } from '@playwright/test';

/** Compare coordinates inside the real table so validation's page scrolling cannot mask cell movement. */
export async function priceTableGeometry(table: Locator) {
  return table.locator('tbody tr').evaluateAll((rows) =>
    rows.map((row) => {
      const bounds = row.getBoundingClientRect();
      return {
        height: bounds.height,
        cells: [...row.querySelectorAll('td')].map((cell) => {
          const rect = cell.getBoundingClientRect();
          return { left: rect.left - bounds.left, width: rect.width };
        }),
        controls: [...row.querySelectorAll('.t-input, button')].map((control) => {
          const rect = control.getBoundingClientRect();
          return { left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height };
        }),
      };
    }),
  );
}

export async function expectPriceTableStable(table: Locator, before: Awaited<ReturnType<typeof priceTableGeometry>>) {
  expect(await priceTableGeometry(table)).toEqual(before);
  const tips = table.locator('.t-input__tips');
  for (const tip of await tips.all()) {
    const layout = await tip.evaluate((element) => {
      const message = element.getBoundingClientRect();
      const input = element.closest('.t-input__wrap, .t-select-input')!.querySelector('.t-input')!;
      const control = input.getBoundingClientRect();
      const row = element.closest('tr')!.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        belowInput: message.top >= control.bottom - 1,
        insideRow: message.bottom <= row.bottom + 1 && message.left >= row.left - 1 && message.right <= row.right + 1,
        unclipped:
          element.scrollHeight <= element.clientHeight && style.display !== 'none' && style.visibility === 'visible',
        color: style.color,
      };
    });
    expect(layout.belowInput).toBe(true);
    expect(layout.insideRow).toBe(true);
    expect(layout.unclipped).toBe(true);
    await expect
      .poll(() =>
        tip.evaluate(
          (element) =>
            getComputedStyle(element.closest('.t-input__wrap, .t-select-input')!.querySelector('.t-input')!)
              .borderTopColor,
        ),
      )
      .toBe(layout.color);
  }
}
