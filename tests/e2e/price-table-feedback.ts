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

/** Check real column edges, including a fixed action column at the scrolled right edge. */
export async function expectSpecTableFillsContainer(table: Locator) {
  await expect
    .poll(() =>
      table.evaluate(async (element) => {
        // ResizeObserver measures columns through nextTick + requestAnimationFrame.
        // A filled table can still be an intermediate layout, so require actual
        // geometry to remain equal across rendering frames before taking a baseline.
        const geometry = () =>
          JSON.stringify(
            [element, ...element.querySelectorAll('table, th, td')].map((node) => {
              const { x, y, width, height } = node.getBoundingClientRect();
              return { x, y, width, height };
            }),
          );
        let previous = geometry();
        for (let frame = 0; frame < 3; frame += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const current = geometry();
          if (current !== previous) return false;
          previous = current;
        }
        const content = element.querySelector('.t-table__content')!;
        content.scrollLeft = content.scrollWidth;
        const grid = content.querySelector('table')!;
        const header = grid.querySelector('thead th:last-child')!;
        const cell = grid.querySelector('tbody tr:first-child td:last-child')!;
        const bounds = grid.getBoundingClientRect();
        if (!header || !cell) return false;
        return (
          bounds.width >= content.clientWidth - 2 &&
          Math.abs(bounds.right - header.getBoundingClientRect().right) <= 2 &&
          Math.abs(bounds.right - cell.getBoundingClientRect().right) <= 2
        );
      }),
    )
    .toBe(true);
  await table.locator('.t-table__content').evaluate((element) => {
    element.scrollLeft = 0;
  });
}
