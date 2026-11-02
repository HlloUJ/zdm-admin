import { expect, test, type Page } from '@playwright/test';
import { productWarehouseUrl } from './product-test-navigation';

export function registerStoreBatchSalePriceTests(
  module: 'finished-stock-management' | 'accessory-management',
  login: (page: Page) => Promise<void>,
  base: Record<string, unknown>,
) {
  async function open(page: Page, layered = false, count = 3) {
    await login(page);
    const resource = module === 'finished-stock-management' ? 'store-finished-products' : 'store-accessory-products';
    const record = {
      ...base,
      specDimensions: layered
        ? [
            { key: 'color', name: '门店销售规格颜色属性（共享）', values: ['白色', '黑色'] },
            { key: 'sizeValue', name: '尺寸', values: ['大', '小'] },
          ]
        : [],
      skus: Array.from({ length: count }, (_, index) => ({
        skuId: 101 + index,
        label: ['规格A', '规格B', '规格C'][index] ?? `规格${index + 1}`,
        stock: index + 1,
        costPrice: [100, 200, 50][index] ?? 100,
        guidePrice: 300,
        salePrice: [150, 300, 75][index] ?? 150,
        saleCoefficient: 1.5,
        priceMode: 'auto',
        displayMode: layered ? 'layered' : 'single',
        salesAttributes: { color: index === 1 ? '黑色' : '白色', sizeValue: index === 2 ? '小' : '大' },
      })),
    };
    const writes: { storeCategoryId: number; skus: Record<string, unknown>[] }[] = [];
    await page.route(`**/api/admin/${resource}**`, (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET') {
        writes.push(request.postDataJSON());
        return route.fulfill({ json: { code: 0, data: record } });
      }
      const data = path.endsWith('/edit-categories')
        ? [{ id: 7, parentId: null, name: '门店分类', status: 'enabled', coefficient: 1.5 }]
        : path.endsWith('/41')
          ? record
          : path.endsWith(`/${resource}`)
            ? [record]
            : [];
      return route.fulfill({ json: { code: 0, data } });
    });
    await page.goto(productWarehouseUrl(`/store/${module}/41/edit`));
    const main = page.getByRole('main');
    const button = main.getByRole('button', { name: '批量填写', exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    const drawer = page.locator('.t-drawer--open').filter({ hasText: '批量填写' });
    return { main, drawer, button, writes, record, price: drawer.getByPlaceholder('请输入商品售价', { exact: true }) };
  }

  test('store batch sale price applies only selected single specifications and saves through the original page', async ({
    page,
  }) => {
    const { main, drawer, writes, price } = await open(page);
    expect(
      await main.getByRole('button', { name: '批量填写', exact: true }).evaluate((button) => {
        const table = button.closest('.spec-table-block')!.querySelector('.t-table')!;
        return button.getBoundingClientRect().top - table.getBoundingClientRect().bottom;
      }),
    ).toBe(24);
    await expect(drawer.getByText('当前将批量填充 3 条规格', { exact: true })).toBeVisible();
    await drawer
      .locator('.batch-filter-values .t-tag')
      .filter({ hasText: /^规格B$/ })
      .click();
    await expect(drawer.getByText('当前将批量填充 1 条规格', { exact: true })).toBeVisible();
    await price.fill('120');
    await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(drawer).toBeHidden();
    const prices = main.locator('.store-sale-price-input input');
    await expect(prices.nth(0)).toHaveValue('150.00');
    await expect(prices.nth(1)).toHaveValue('120.00');
    await expect(prices.nth(2)).toHaveValue('75.00');
    await expect(main.locator('.store-sale-coefficient-input input').nth(1)).toHaveValue('0.60');
    expect(writes).toHaveLength(0);
    await main.locator('.form-submit-bar').getByRole('button', { name: '确认保存', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      storeCategoryId: 7,
      skus: [
        { skuId: 101, salePrice: 150, priceMode: 'auto', saleCoefficient: 1.5 },
        { skuId: 102, salePrice: 120, priceMode: 'manual', saleCoefficient: 0.6 },
        { skuId: 103, salePrice: 75, priceMode: 'auto', saleCoefficient: 1.5 },
      ],
    });
  });

  test('store batch sale price matches layered ranges and rejects invalid input without partial changes', async ({
    page,
  }) => {
    const { main, drawer, button, writes, price } = await open(page, true);
    const titleLayout = await drawer.locator('.batch-filter-row').evaluateAll((elements) =>
      elements.map((element) => {
        const label = element.querySelector('.batch-filter-label')!;
        return {
          width: label.getBoundingClientRect().width,
          height: label.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(label).lineHeight),
          complete: label.scrollWidth <= label.clientWidth,
          optionLeft: element.querySelector('.batch-filter-values')!.getBoundingClientRect().left,
        };
      }),
    );
    expect(titleLayout).toHaveLength(2);
    expect(titleLayout[0]!.width).toBeGreaterThan(100);
    expect(titleLayout[0]!.width).toBe(titleLayout[1]!.width);
    expect(titleLayout[0]!.optionLeft).toBe(titleLayout[1]!.optionLeft);
    for (const row of titleLayout) {
      expect(row.complete).toBe(true);
      expect(row.height).toBe(row.lineHeight);
    }
    const color = drawer.locator('.batch-filter-row').filter({ hasText: '颜色' });
    const size = drawer.locator('.batch-filter-row').filter({ hasText: '尺寸' });
    await color
      .locator('.t-tag')
      .filter({ hasText: /^白色$/ })
      .click();
    await size.locator('.t-tag').filter({ hasText: /^大$/ }).click();
    await expect(drawer.getByText('当前将批量填充 1 条规格', { exact: true })).toBeVisible();
    await price.fill('-1');
    await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('请输入正确的商品售价', { exact: true })).toBeVisible();
    await expect(page.getByText('表单校验未通过，请检查标红字段', { exact: true })).toHaveCount(1);
    const prices = main.locator('.store-sale-price-input input');
    await expect(prices.nth(0)).toHaveValue('150.00');
    await expect(prices.nth(1)).toHaveValue('300.00');
    await expect(prices.nth(2)).toHaveValue('75.00');
    expect(writes).toHaveLength(0);
    await price.fill('180');
    await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(prices.nth(0)).toHaveValue('180.00');
    await expect(prices.nth(1)).toHaveValue('300.00');
    await expect(prices.nth(2)).toHaveValue('75.00');
    await expect(main.locator('.store-sale-coefficient-input input').nth(0)).toHaveValue('1.80');
    await button.click();
    await expect(drawer.getByText('当前将批量填充 3 条规格', { exact: true })).toBeVisible();
    await expect(price).toHaveValue('');
    await color
      .locator('.t-tag')
      .filter({ hasText: /^白色$/ })
      .click();
    await color
      .locator('.t-tag')
      .filter({ hasText: /^黑色$/ })
      .click();
    await size.locator('.t-tag').filter({ hasText: /^小$/ }).click();
    await expect(drawer.getByText('当前将批量填充 1 条规格', { exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(prices.nth(2)).toHaveValue('75.00');
    await button.click();
    await color
      .locator('.t-tag')
      .filter({ hasText: /^黑色$/ })
      .click();
    await size.locator('.t-tag').filter({ hasText: /^小$/ }).click();
    await price.fill('200');
    await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(drawer.getByText('当前将批量填充 0 条规格', { exact: true })).toBeVisible();
    await expect(page.getByText('当前条件下没有可批量填写的规格', { exact: true })).toBeVisible();
    expect(writes).toHaveLength(0);
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    await expect(prices.nth(0)).toHaveValue('180.00');
    await expect(prices.nth(1)).toHaveValue('300.00');
    await expect(prices.nth(2)).toHaveValue('75.00');
  });

  test('store batch sale price follows native drawer layout, wraps ranges and cancels without applying', async ({
    page,
  }) => {
    const { main, drawer, button, writes, price } = await open(page, false, 60);
    const geometry = await drawer.evaluate((element) => {
      const label = element.querySelector('.batch-filter-label')!.getBoundingClientRect();
      const values = element.querySelector('.batch-filter-values')!;
      const tags = Array.from(values.querySelectorAll('.t-tag')).map((tag) => tag.getBoundingClientRect());
      const lines = [...new Set(tags.map((tag) => Math.round(tag.top)))].sort((a, b) => a - b);
      const first = tags[0]!;
      const box = element.getBoundingClientRect();
      return {
        centerDifference: Math.abs(label.top + label.height / 2 - first.top - first.height / 2),
        lines: lines.length,
        gaps: lines.slice(1).map((top, index) => top - lines[index]! - first.height),
        expectedGap: parseFloat(getComputedStyle(values).rowGap),
        inViewport: box.left >= 0 && box.right <= document.documentElement.clientWidth + 1,
      };
    });
    expect(geometry.inViewport).toBe(true);
    expect(geometry.lines).toBeGreaterThanOrEqual(3);
    expect(geometry.centerDifference).toBeLessThanOrEqual(1);
    for (const gap of geometry.gaps) expect(Math.abs(gap - geometry.expectedGap)).toBeLessThanOrEqual(1);
    await expect(drawer.getByRole('button', { name: '确认保存', exact: true })).toBeVisible();
    await expect(drawer.locator('.t-drawer__footer button')).toHaveText(['确认保存', '取消']);
    await expect(drawer.locator('.t-card')).toHaveCount(2);
    await expect(drawer.getByText('成本价', { exact: true })).toHaveCount(0);
    await expect(drawer.getByText('数量', { exact: true })).toHaveCount(0);
    await price.fill('-1');
    await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
    const tip = drawer.getByText('请输入正确的商品售价', { exact: true });
    await expect(tip).toBeVisible();
    expect(
      await tip.evaluate((element) => {
        const body = element.closest('.t-card__body')!;
        return (
          body.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom >=
          parseFloat(getComputedStyle(body).paddingBottom) - 1
        );
      }),
    ).toBe(true);
    await price.fill('999');
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(main.locator('.store-sale-price-input input').first()).toHaveValue('150.00');
    await button.click();
    await expect(price).toHaveValue('');
    expect(writes).toHaveLength(0);
  });
}
