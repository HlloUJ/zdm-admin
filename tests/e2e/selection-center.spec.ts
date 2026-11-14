import { expect, test, type Page } from '@playwright/test';
import type { CenterProduct, CenterCategory } from '../../src/services/storeSelectionCenter';
const ok = (data: unknown) => ({ code: 0, message: 'ok', data });
async function fixture(
  page: Page,
  options: {
    singlePermission?: boolean;
    basket?: boolean;
    media?: 'image' | 'video' | 'both';
    longNames?: boolean;
    categoryName?: string;
    longSalesHeaders?: boolean;
    longSingleSpec?: boolean;
    singleSpecs?: boolean;
    descriptionMedia?: 'image' | 'video';
    thumbnailRatios?: boolean;
    failMutation?: 'add' | 'remove' | 'join';
  } = {},
) {
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 7,
        name: '员工',
        tenantId: 1,
        storeId: 2,
        clientCode: 'admin',
        storeType: 'cityPartner',
        roles: ['STORE_ADMIN'],
        permissions: ['store.finished-stock-management.select'],
        dataPermission: 'all',
      }),
    );
  });
  const rows: CenterProduct[] = Array.from({ length: 31 }, (_, i) => ({
    type: i % 2 ? 'accessory' : 'finished',
    id: i + 1,
    name:
      options.longNames && i === 0
        ? '多行超长商品名称用于确认加入清单按钮始终在卡片右下角且不遮挡文字'
        : i % 2
          ? '金属桌脚'
          : '岩板餐桌',
    categoryId: i % 2 ? 5 : 4,
    sourceCreatedAt: '2026-01-01T00:00:00',
    imageUrl: null,
    priceMin: 10,
    priceMax: 20,
    soldOut: i === 4,
    addedToStore: i === 6,
    inSelection: false,
    canAdd: i !== 4 && i !== 6 && (!options.singlePermission || i % 2 === 0),
    reasons: [],
    selectionId: i + 100,
    addedAt: null,
  }));
  let selection: CenterProduct[] = options.basket ? rows.slice(0, 12).map((r) => ({ ...r, inSelection: true })) : [];
  const requests: { path: string; body: unknown }[] = [];
  await page.route('**/api/admin/store-product-center/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname.split('/store-product-center')[1];
    if (req.method() !== 'GET') requests.push({ path, body: req.postData() ? req.postDataJSON() : null });
    if (
      (options.failMutation === 'add' && path === '/selection' && req.method() === 'POST') ||
      (options.failMutation === 'remove' && req.method() === 'DELETE') ||
      (options.failMutation === 'join' && path === '/join-batches')
    )
      return route.fulfill({ status: 500, json: { code: 500, message: '操作失败测试' } });
    if (path === '/context')
      return route.fulfill({
        json: ok({
          key: '1:2:7',
          storeName: '真实接口门店',
          maintain: { finished: true, accessory: !options.singlePermission },
        }),
      });
    if (path === '/categories')
      return route.fulfill({
        json: ok([
          { id: 1, parentId: null, name: '桌类', type: 'finished' },
          { id: 2, parentId: 1, name: '餐桌', type: 'finished' },
          { id: 3, parentId: 2, name: '岩板', type: 'finished' },
          { id: 4, parentId: 3, name: '白色', type: 'finished' },
          { id: 5, parentId: null, name: '桌脚', type: 'accessory' },
        ]),
      });
    if (path === '/products') {
      const types = url.searchParams.get('types')?.split(',') ?? [],
        states = url.searchParams.get('states')?.split(',') ?? [],
        keyword = url.searchParams.get('keyword') || '';
      const filtered = rows
        .filter(
          (r) =>
            (!types.length || types.includes(r.type)) &&
            (!states.length || states.length === 2 || states.includes(r.addedToStore ? 'added' : 'unadded')) &&
            r.name.includes(keyword) &&
            (!url.searchParams.has('categoryId') || r.type === url.searchParams.get('categoryType')),
        )
        .map((r) => ({ ...r, inSelection: selection.some((s) => s.id === r.id && s.type === r.type) }));
      const pageNum = Number(url.searchParams.get('page')),
        size = Number(url.searchParams.get('pageSize'));
      return route.fulfill({
        json: ok({
          records: filtered.slice((pageNum - 1) * size, pageNum * size),
          total: filtered.length,
          page: pageNum,
          pageSize: size,
        }),
      });
    }
    if (path.startsWith('/products/')) {
      const id = Number(path.split('/').pop()),
        product = { ...rows.find((r) => r.id === id)!, inSelection: selection.some((s) => s.id === id) };
      return route.fulfill({
        json: ok({
          product,
          information: {
            name: product.name,
            categoryName: options.categoryName ?? '桌类 / 餐桌 / 岩板 / 白色',
            totalStock: 0,
            imageUrls:
              options.media === 'video'
                ? []
                : options.thumbnailRatios
                  ? [160, 40].map(
                      (width) =>
                        `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${200 - width}"><rect width="100%" height="100%" fill="blue"/></svg>`)}`,
                    )
                  : options.media
                    ? [
                        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6bEAAAAASUVORK5CYII=',
                      ]
                    : [],
            videoUrl: options.media === 'video' || options.media === 'both' ? '/selection-test.webm' : null,
            detail:
              options.descriptionMedia === 'image'
                ? '<img src="/description.png" />'
                : options.descriptionMedia === 'video'
                  ? '<video src="/description.webm"></video>'
                  : '',
            attributes: Array.from({ length: 24 }, (_, i) => ({
              attributeId: i + 1,
              attributeName: `属性${i + 1}`,
              value: String(i),
            })),
            attributeNames: {
              color: options.longSalesHeaders ? '非常完整的商品颜色销售属性标题' : '颜色',
              size: options.longSalesHeaders ? '商品实际规格尺寸及适配范围标题' : '尺寸',
            },
            specDimensions: [
              { key: 'color', name: '颜色', values: ['白', '黑'] },
              { key: 'size', name: '尺寸', values: ['小', '大'] },
            ],
            skus: [
              {
                skuId: 1,
                label: options.longSingleSpec ? '超长完整商品规格内容'.repeat(18) : '实际规格',
                stock: 0,
                partnerPrice: 10,
                displayMode: options.longSingleSpec || options.singleSpecs ? 'single' : 'layered',
                salesAttributes: { color: '白', size: '小' },
              },
              {
                skuId: 2,
                label: options.longSingleSpec ? '超长完整商品规格内容'.repeat(18) : '实际规格',
                stock: 2,
                partnerPrice: 20,
                displayMode: options.longSingleSpec || options.singleSpecs ? 'single' : 'layered',
                salesAttributes: { color: '白', size: '大' },
              },
            ],
          },
        }),
      });
    }
    if (path === '/selection' && req.method() === 'POST') {
      const body = req.postDataJSON();
      selection.push({ ...rows.find((r) => r.id === body.productId && r.type === body.type)!, inSelection: true });
      return route.fulfill({ json: ok(true) });
    }
    if (path.startsWith('/selection/') && req.method() === 'DELETE') {
      selection = selection.filter((r) => r.selectionId !== Number(path.split('/').pop()));
      return route.fulfill({ json: ok(true) });
    }
    if (path === '/selection') {
      const items = selection.filter((r) => r.type === url.searchParams.get('type')),
        size = Number(url.searchParams.get('pageSize')),
        pageNum = Number(url.searchParams.get('page'));
      return route.fulfill({
        json: ok({
          page: {
            records: items.slice((pageNum - 1) * size, pageNum * size),
            total: items.length,
            page: pageNum,
            pageSize: size,
          },
          counts: {
            finished: selection.filter((r) => r.type === 'finished').length,
            accessory: selection.filter((r) => r.type === 'accessory').length,
          },
        }),
      });
    }
    if (path === '/join-batches') {
      const total = selection.length,
        last = selection.at(-1)!;
      selection = [{ ...last, addedToStore: true, canAdd: false, reasons: ['该商品已加入门店，请勿重复添加。'] }];
      return route.fulfill({
        json: ok({
          id: 1,
          status: 'completed',
          total,
          successCount: total - 1,
          failureCount: 1,
          failures: [
            {
              type: last.type,
              productId: last.id,
              name: last.name,
              code: 'ALREADY_IN_STORE',
              reason: '该商品已加入门店，请勿重复添加。',
            },
          ],
        }),
      });
    }
    return route.fulfill({ json: ok([]) });
  });
  return requests;
}

test('real query parameters, literal name search, type filters and category clear', async ({ page }) => {
  await fixture(page);
  await page.goto('/store/selection-center');
  await expect(page.getByText('真实接口门店')).toBeVisible();
  await expect(page.locator('.product-card')).toHaveCount(20);
  await page.getByPlaceholder('请输入商品名称').fill('1');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.product-card')).toHaveCount(0);
  await page.getByPlaceholder('请输入商品名称').fill('岩板');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.product-card')).toHaveCount(15);
  await page.getByRole('button', { name: '商品分类', exact: true }).hover();
  await page.locator('.selection-category-panel').getByRole('button', { name: '桌类', exact: true }).click();
  await expect(page.getByRole('button', { name: '清除分类' })).toBeVisible();
  await page.getByRole('button', { name: '清除分类' }).click();
  await expect(page.getByRole('button', { name: '清除分类' })).toHaveCount(0);
});

test('dynamic details retain SKU grouping and scroll independently from background', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 1361, height: 600 });
  await page.goto('/store/selection-center');
  await page.locator('.product-card').first().click();
  const drawer = page.locator('.t-drawer--open');
  await expect(drawer.getByText('属性24', { exact: true })).toBeVisible();
  await expect(drawer.getByText('指导价', { exact: true })).toHaveCount(0);
  await expect(drawer.locator('.t-table tbody tr')).toHaveCount(2);
  const before = await page.evaluate(() => scrollY);
  await drawer.locator('.t-drawer__body').hover();
  await page.mouse.wheel(0, 450);
  await expect.poll(() => drawer.locator('.t-drawer__body').evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(before);
  await drawer.locator('.t-drawer__body').evaluate((e) => (e.scrollTop = e.scrollHeight));
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(before);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

test('whole basket submits across tabs and pages and reports only failed items', async ({ page }) => {
  const requests = await fixture(page, { basket: true });
  await page.goto('/store/selection-center?view=basket');
  await expect(page.locator('.basket-row')).toHaveCount(5);
  await page.locator('.zdm-admin-pagination .t-pagination__btn-next').click();
  await expect(page.locator('.basket-row')).toHaveCount(1);
  await page.getByRole('button', { name: '加入门店', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog).toContainText('本次加入 12 件商品，成功 11 件，失败 1 件');
  await expect(dialog.locator('tbody tr')).toHaveCount(1);
  await expect(dialog).toContainText('该商品已加入门店，请勿重复添加。');
  expect(requests.find((r) => r.path === '/join-batches')?.body).toMatchObject({ context: '1:2:7' });
});

test('unmaintainable type stays browsable with its add control disabled', async ({ page }) => {
  await fixture(page, { singlePermission: true });
  await page.goto('/store/selection-center');
  const accessory = page.locator('.product-card').filter({ hasText: '金属桌脚' }).first();
  await expect(accessory.getByText('无配件维护权限')).toBeVisible();
  await expect(accessory.getByRole('button', { name: '加入清单', exact: true })).toBeDisabled();
  await expect(
    page.locator('.product-card').first().getByRole('button', { name: '加入清单', exact: true }),
  ).toBeEnabled();
});

for (const media of ['image', 'video', 'both'] as const) {
  test('detail media mode ' + media, async ({ page }) => {
    await fixture(page, { media });
    await page.route('**/selection-test.webm', (r) =>
      r.fulfill({ status: 200, contentType: 'video/webm', body: Buffer.alloc(0) }),
    );
    await page.goto('/store/selection-center');
    await page.locator('.product-card').first().click();
    const drawer = page.locator('.t-drawer--open');
    if (media === 'image') await expect(drawer.locator('.media-stage > img')).toHaveCount(1);
    else {
      await expect(drawer.locator('.media-stage > video')).toHaveAttribute('autoplay', '');
      await expect(drawer.locator('.media-stage > video')).toHaveJSProperty('muted', true);
    }
    await expect(drawer.locator('.t-radio-group')).toHaveCount(media === 'both' ? 1 : 0);
    if (media === 'both') {
      await drawer.getByText('图集', { exact: true }).click();
      await expect(drawer.locator('.media-stage > img')).toHaveCount(1);
    }
  });
}
test('identity storage change clears old scope without submitting it to the new store', async ({ page }) => {
  const requests = await fixture(page, { basket: true });
  await page.goto('/store/selection-center?view=basket');
  await expect(page.locator('.basket-row')).toHaveCount(5);
  await page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem('zdm-admin-user')!);
    localStorage.setItem('zdm-admin-user', JSON.stringify({ ...user, storeId: 99 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'zdm-admin-user' }));
  });
  await expect(page.locator('.basket-row')).toHaveCount(0);
  await expect(page.locator('.t-alert')).toContainText('当前身份或门店已变更，请重新打开选品中心');
  await page.locator('.t-alert').getByRole('button', { name: '重试' }).click();
  await expect(page.locator('.basket-row')).toHaveCount(0);
  await expect(page.locator('.t-alert')).toContainText('当前身份或门店已变更，请重新打开选品中心');
  expect(requests.filter((r) => r.path === '/join-batches')).toHaveLength(0);
});
test('empty type hides headings and pagination while other type stays in summary', async ({ page }) => {
  await fixture(page, { basket: true });
  await page.goto('/store/selection-center?view=basket');
  for (let i = 0; i < 6; i++) {
    await page.locator('.basket-row').first().getByText('移除', { exact: true }).click();
    await expect(page.locator('.summary-total')).toContainText(String(11 - i));
  }
  await expect(page.locator('.basket-columns')).toHaveCount(0);
  await expect(page.locator('.zdm-admin-pagination')).toHaveCount(0);
  await expect(page.getByText('尚未选择该类型商品', { exact: true })).toBeVisible();
  await expect(page.locator('.summary-total')).toContainText('6');
});

for (const width of [1440, 1024, 640]) {
  test(`search and category controls remain pinned and usable after scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await fixture(page);
    await page.goto('/store/selection-center?view=browse');
    await expect(page.locator('.product-card')).toHaveCount(20);
    const chrome = page.locator('.sticky-chrome');
    const reserve = page.locator('.chrome-reserve');
    const initialHeight = await reserve.evaluate((el) => el.getBoundingClientRect().height);
    await page.evaluate(() => window.scrollTo(0, 450));
    await expect(chrome).toHaveClass(/is-compact/);
    await expect.poll(() => chrome.evaluate((el) => el.getBoundingClientRect().top)).toBe(0);
    expect(await reserve.evaluate((el) => el.getBoundingClientRect().height)).toBeCloseTo(initialHeight, 0);
    await expect(chrome.locator('.compact-brand')).toHaveText('装选品中心');
    const search = page.getByRole('search');
    const box = await search.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.getByPlaceholder('请输入商品名称').fill('岩板');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.locator('.product-card')).toHaveCount(15);
    await page.getByRole('button', { name: '商品分类', exact: true }).hover();
    const panel = page.locator('.selection-category-panel');
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();
    expect(panelBox!.y).toBeGreaterThanOrEqual(box!.y + box!.height);
    await panel.getByRole('button', { name: '桌类', exact: true }).click();
    await expect(page.getByRole('button', { name: '清除分类' })).toBeVisible();
    await page.getByRole('button', { name: '清除分类' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(chrome).not.toHaveClass(/is-compact/);
    await expect(chrome.locator('.platform-header')).toBeVisible();
  });
}

for (const width of [1440, 1024, 640]) {
  test(`long category names flow without overlap and keep their gap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    const longName = '加长名称的实木岩板餐桌分类';
    await page.route('**/api/admin/store-product-center/categories?**', (route) =>
      route.fulfill({
        json: ok([
          { id: 1, parentId: null, name: '成品餐桌根分类', type: 'finished' },
          { id: 2, parentId: 1, name: '现代风格餐桌二级分类', type: 'finished' },
          { id: 3, parentId: 2, name: '岩板三级分类', type: 'finished' },
          { id: 4, parentId: 3, name: longName, type: 'finished' },
          { id: 6, parentId: 3, name: '短类目', type: 'finished' },
          { id: 7, parentId: 3, name: '另一种中等长度分类', type: 'finished' },
          { id: 8, parentId: null, name: '浅层分类', type: 'finished' },
          { id: 9, parentId: 8, name: longName + '浅层', type: 'finished' },
          { id: 10, parentId: 8, name: '短', type: 'finished' },
        ]),
      }),
    );
    await page.goto('/store/selection-center');
    await expect(page.locator('.product-card')).toHaveCount(20);
    await page.getByRole('button', { name: '商品分类', exact: true }).hover();
    const panel = page.locator('.selection-category-panel');
    await expect(panel).toBeVisible();
    const geometry = await panel.evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      const buttons = [...el.querySelectorAll('.category-choice')].map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      const groups = [...el.querySelectorAll('.flat-leaves, .deep-terminal-options')].map((group) => ({
        gap: parseFloat(getComputedStyle(group).columnGap),
        boxes: [...group.children].map((child) => {
          const rect = child.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top };
        }),
      }));
      return { left: bounds.left, right: bounds.right, buttons, groups };
    });
    for (const [i, a] of geometry.buttons.entries()) {
      expect(a.left).toBeGreaterThanOrEqual(geometry.left);
      expect(a.right).toBeLessThanOrEqual(geometry.right);
      for (const b of geometry.buttons.slice(i + 1)) {
        expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
      }
    }
    for (const group of geometry.groups) {
      for (let i = 1; i < group.boxes.length; i++) {
        const a = group.boxes[i - 1],
          b = group.boxes[i];
        if (Math.abs(a.top - b.top) < 1) expect(b.left - a.right).toBeCloseTo(group.gap, 0);
      }
    }
    await panel.getByRole('button', { name: longName, exact: true }).click();
    await expect(page.getByRole('button', { name: '清除分类' })).toBeVisible();
  });
}

for (const width of [1440, 1024, 640]) {
  test(`product actions stay bottom right with mixed name lengths at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const requests = await fixture(page, { longNames: true });
    await page.goto('/store/selection-center');
    await expect(page.locator('.product-card')).toHaveCount(20);
    const cards = page.locator('.product-card');
    const geometry = await cards.evaluateAll((elements) =>
      elements.map((card) => {
        const box = card.getBoundingClientRect();
        const button = card.querySelector('.card-actions button')!.getBoundingClientRect();
        const price = card.querySelector('.price')!.getBoundingClientRect();
        const info = card.querySelector('.product-info')!;
        return {
          top: box.top,
          bottom: box.bottom,
          right: box.right,
          buttonBottom: button.bottom,
          buttonRight: button.right,
          buttonTop: button.top,
          priceBottom: price.bottom,
          paddingRight: parseFloat(getComputedStyle(info).paddingRight),
          paddingBottom: parseFloat(getComputedStyle(info).paddingBottom),
        };
      }),
    );
    for (const row of geometry) {
      expect(row.bottom - row.buttonBottom).toBeCloseTo(row.paddingBottom, 0);
      expect(row.right - row.buttonRight).toBeCloseTo(row.paddingRight, 0);
      expect(row.buttonTop).toBeGreaterThanOrEqual(row.priceBottom);
    }
    const firstRow = geometry.filter((row) => Math.abs(row.top - geometry[0].top) < 1);
    for (const row of firstRow) expect(row.buttonBottom).toBeCloseTo(firstRow[0].buttonBottom, 0);
    await cards.first().getByRole('button', { name: '加入清单', exact: true }).click();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    await expect(cards.first().getByText('已加入选品清单')).toBeVisible();
  });
}

test('page loading stays centered above content and disappears after the request', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page);
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/store-product-center/products?**', async (route) => {
    await pending;
    await route.fallback();
  });
  await page.goto('/store/selection-center');
  const loading = page.locator('.t-loading__fullscreen');
  await expect(loading).toBeVisible();
  const box = await loading.boundingBox();
  expect(box!.x).toBe(0);
  expect(box!.y).toBe(0);
  expect(box!.width).toBe(1440);
  expect(box!.height).toBe(900);
  const icon = loading.locator('.t-loading__gradient-conic');
  const iconBox = await icon.boundingBox();
  expect(iconBox!.x + iconBox!.width / 2).toBeCloseTo(720, 0);
  expect(iconBox!.y + iconBox!.height / 2).toBeCloseTo(450, 0);
  expect(await loading.evaluate((el) => Number(getComputedStyle(el).zIndex))).toBeGreaterThan(1500);
  release();
  await expect(loading).toBeHidden();
  await expect(page.locator('.product-card')).toHaveCount(20);
  await page.getByPlaceholder('请输入商品名称').fill('岩板');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.product-card')).toHaveCount(15);
});

for (const width of [1440, 640]) {
  test(`detail category occupies the first full row without wrapping at ${width}px`, async ({ page }) => {
    const categoryName = Array.from({ length: 16 }, (_, i) => `完整分类路径第${i + 1}级`).join(' / ');
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { categoryName });
    await page.goto('/store/selection-center');
    await page.locator('.product-card').first().click();
    const drawer = page.locator('.t-drawer--open');
    const table = drawer.locator('.t-descriptions__body');
    const first = table.locator('tr').first();
    await expect(first.locator('td')).toHaveCount(2);
    await expect(first.locator('td').first()).toHaveText('分类');
    await expect(first.locator('td').first()).toHaveAttribute('colspan', '1');
    await expect(first.locator('td').nth(1)).toHaveAttribute('colspan', '7');
    const path = first.getByRole('region', { name: '分类路径' });
    await expect(path).toHaveText(categoryName);
    const geometry = await path.evaluate((el) => ({
      whiteSpace: getComputedStyle(el).whiteSpace,
      height: el.clientHeight,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      overflow: el.scrollWidth > el.clientWidth,
    }));
    expect(geometry.whiteSpace).toBe('nowrap');
    expect(geometry.height).toBeLessThanOrEqual(geometry.lineHeight + 1);
    expect(geometry.overflow).toBe(true);
    await path.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => path.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await expect(table.locator('tr').nth(1)).toContainText('商品类型');
    await expect(drawer.getByText('属性24', { exact: true })).toBeVisible();
    expect(await drawer.evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });
}

for (const width of [1440, 1024, 640]) {
  test(`detail drawer uses the wider responsive layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.goto('/store/selection-center');
    await page.locator('.product-card').first().click();
    const drawer = page.locator('.t-drawer--open');
    await expect(drawer.getByText('基础信息', { exact: true })).toBeVisible();
    const content = drawer.locator('.t-drawer__content-wrapper');
    await expect.poll(async () => (await content.boundingBox())?.width).toBe(Math.min(1120, width));
    await expect
      .poll(async () => {
        const rect = await content.boundingBox();
        return rect!.x + rect!.width;
      })
      .toBeLessThanOrEqual(width);
    const bounds = await content.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    const body = drawer.locator('.t-drawer__body');
    expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await expect(drawer.getByRole('region', { name: '分类路径' })).toHaveText('桌类 / 餐桌 / 岩板 / 白色');
    await expect(drawer.locator('.t-descriptions__body tr').first().locator('td').nth(1)).toHaveAttribute(
      'colspan',
      '7',
    );
    await expect(drawer.getByText('属性24', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });
}

for (const width of [1440, 640]) {
  for (const productIndex of [0, 1]) {
    test(`sales specs are flat complete rows with unwrapped headers at ${width}px for product ${productIndex}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await fixture(page, { longSalesHeaders: true });
      await page.goto('/store/selection-center');
      await page.locator('.product-card').nth(productIndex).click();
      const drawer = page.locator('.t-drawer--open');
      const table = drawer.locator('.selection-sales-table');
      await table.scrollIntoViewIfNeeded();
      const rows = table.locator('tbody tr');
      await expect(rows).toHaveCount(2);
      for (const row of await rows.all()) {
        await expect(row.locator('td')).toHaveCount(4);
        await expect(row.locator('td').first()).toHaveText('白');
        expect(
          await row
            .locator('td')
            .evaluateAll((cells) =>
              cells.every(
                (cell) => (cell as HTMLTableCellElement).rowSpan === 1 && (cell as HTMLTableCellElement).colSpan === 1,
              ),
            ),
        ).toBe(true);
      }
      await expect(rows.nth(0)).toContainText('小');
      await expect(rows.nth(1)).toContainText('大');
      const headings = await table.locator('th').evaluateAll((cells) =>
        cells.map((cell) => ({
          nowrap: getComputedStyle(cell).whiteSpace,
          width: cell.clientWidth,
          contentWidth: cell.scrollWidth,
        })),
      );
      expect(headings).toHaveLength(4);
      for (const heading of headings) {
        expect(heading.nowrap).toBe('nowrap');
        expect(heading.contentWidth).toBeLessThanOrEqual(heading.width + 1);
      }
      const scroller = table.locator('.t-table__content');
      if (width === 640) {
        expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
        await scroller.hover();
        await page.mouse.wheel(900, 0);
        await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
        await expect(table.locator('th').last()).toBeInViewport();
      }
      expect(
        await drawer.locator('.t-drawer__body').evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
    });
  }
}

for (const fails of [false, true]) {
  test(`adding from a scrolled catalog updates locally without refresh, failure=${fails}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await fixture(page, { failMutation: fails ? 'add' : undefined });
    let productReads = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/admin/store-product-center/products') productReads++;
    });
    await page.goto('/store/selection-center');
    await expect(page.locator('.product-card')).toHaveCount(20);
    const card = page.locator('.product-card').nth(10);
    const button = card.getByRole('button', { name: '加入清单', exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(page.locator('.sticky-chrome')).toHaveClass(/is-compact/);
    await button.hover();
    let before = await page.evaluate(() => scrollY);
    expect(before).toBeGreaterThan(300);
    const reads = productReads;
    await page.evaluate(() => {
      (window as any).__mutationLoads = 0;
      new MutationObserver(() => {
        if (document.querySelector('.t-loading__fullscreen')) (window as any).__mutationLoads++;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await button.evaluate((el) =>
      el.addEventListener(
        'pointerdown',
        () => {
          (window as any).__beforeMutationScroll = scrollY;
        },
        { once: true },
      ),
    );
    await button.click();
    before = await page.evaluate(() => (window as any).__beforeMutationScroll);
    expect(before).toBeGreaterThan(300);
    if (fails) {
      await expect(page.getByText('操作失败测试').first()).toBeVisible();
      await expect(button).toBeEnabled();
      await expect(card.getByText('已加入选品清单')).toHaveCount(0);
    } else {
      await expect(button).toBeDisabled();
      await expect(card.getByText('已加入选品清单')).toBeVisible();
      await expect(page.locator('.header-tools .t-badge')).toContainText('1');
    }
    expect(productReads).toBe(reads);
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
    expect(await page.evaluate(() => (window as any).__mutationLoads)).toBe(0);
    const actionBox = await button.boundingBox();
    await page.mouse.click(actionBox!.x + actionBox!.width / 2, actionBox!.y - 12);
    await expect(page.locator('.t-drawer--open')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
  });
}
for (const action of ['remove', 'join'] as const) {
  for (const fails of [false, true]) {
    test(`basket ${action} stays local and reports mutation failure=${fails}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 500 });
      await fixture(page, { basket: true, failMutation: fails ? action : undefined });
      let productReads = 0;
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/admin/store-product-center/products') productReads++;
      });
      await page.goto('/store/selection-center?view=basket');
      await expect(page.locator('.basket-row')).toHaveCount(5);
      const scroll = page.locator('.selection-scroll');
      await scroll.evaluate((el) => {
        el.scrollTop = 100;
      });
      const before = await scroll.evaluate((el) => el.scrollTop),
        reads = productReads;
      await page.evaluate(() => {
        (window as any).__mutationLoads = 0;
        new MutationObserver(() => {
          if (document.querySelector('.t-loading__fullscreen')) (window as any).__mutationLoads++;
        }).observe(document.body, { childList: true, subtree: true });
      });
      if (action === 'remove') await page.locator('.basket-row').nth(1).getByText('移除', { exact: true }).click();
      else await page.getByRole('button', { name: '加入门店', exact: true }).click();
      if (fails) {
        await expect(page.getByText('操作失败测试').first()).toBeVisible();
        await expect(page.locator('.summary-total')).toContainText('12');
        await expect(page.locator('.basket-row')).toHaveCount(5);
      } else if (action === 'remove') {
        await expect(page.locator('.summary-total')).toContainText('11');
        await expect(page.locator('.basket-row')).toHaveCount(5);
      } else {
        await expect(page.locator('.t-dialog:visible')).toContainText('成功 11 件，失败 1 件');
        await expect(page.locator('.summary-total')).toContainText('1');
      }
      expect(productReads).toBe(reads);
      expect(await page.evaluate(() => (window as any).__mutationLoads)).toBe(0);
      if (action === 'remove' || fails) expect(await scroll.evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0);
    });
  }
}

for (const type of ['finished', 'accessory'] as const) {
  test(`second-level category arrows only indicate actual children for ${type}`, async ({ page }) => {
    await fixture(page);
    await page.route('**/api/admin/store-product-center/categories?**', (route) =>
      route.fulfill({
        json: ok([
          { id: 1, parentId: null, name: '根类目', type },
          { id: 2, parentId: 1, name: '有下级', type },
          { id: 3, parentId: 2, name: '三级', type },
          { id: 4, parentId: 3, name: '四级', type },
          { id: 5, parentId: 1, name: '无下级', type },
        ]),
      }),
    );
    await page.goto('/store/selection-center');
    await expect(page.locator('.product-card')).toHaveCount(20);
    await page.getByRole('button', { name: '商品分类', exact: true }).hover();
    const panel = page.locator('.selection-category-panel');
    await panel.getByRole('tab', { name: type === 'finished' ? '成品现货' : '配件', exact: true }).hover();
    const withChildren = panel
      .locator('.deep-second-title')
      .filter({ has: page.getByRole('button', { name: '有下级', exact: true }) });
    const withoutChildren = panel
      .locator('.deep-second-title')
      .filter({ has: page.getByRole('button', { name: '无下级', exact: true }) });
    await expect(withChildren.locator('.level-connector')).toHaveCount(1);
    await expect(withoutChildren.locator('.level-connector')).toHaveCount(0);
    await withoutChildren.getByRole('button').click();
    await expect(page.getByRole('button', { name: '商品分类', exact: true })).toContainText('无下级');
    await page.getByRole('button', { name: '商品分类', exact: true }).hover();
    await panel.getByRole('button', { name: '有下级', exact: true }).click();
    await expect(page.getByRole('button', { name: '商品分类', exact: true })).toContainText('有下级');
  });
}

for (const type of ['finished', 'accessory'] as const) {
  for (const deep of [false, true]) {
    test(`category branch and terminal styles follow confirmed hierarchy for ${type}, deep=${deep}`, async ({
      page,
    }) => {
      await fixture(page);
      await page.route('**/api/admin/store-product-center/categories?**', (route) =>
        route.fulfill({
          json: ok([
            { id: 1, parentId: null, name: '根类目', type },
            { id: 2, parentId: 1, name: '有下级类目', type },
            { id: 3, parentId: 2, name: '三级', type },
            ...(deep ? [{ id: 4, parentId: 3, name: '四级', type }] : []),
            { id: 5, parentId: 1, name: '无下级类目', type },
          ]),
        }),
      );
      await page.goto('/store/selection-center');
      await expect(page.locator('.product-card')).toHaveCount(20);
      await page.getByRole('button', { name: '商品分类', exact: true }).hover();
      const panel = page.locator('.selection-category-panel');
      await panel.getByRole('tab', { name: type === 'finished' ? '成品现货' : '配件', exact: true }).hover();
      const branch = panel.getByRole('button', { name: '有下级类目', exact: true });
      const leaf = panel.getByRole('button', { name: '无下级类目', exact: true });
      const style = (element: HTMLElement) => {
        const s = getComputedStyle(element);
        return { color: s.color, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight };
      };
      expect((await branch.evaluate(style)).fontSize).toBe((await leaf.evaluate(style)).fontSize);
      await expect(branch).toHaveAttribute('data-category-level', '2');
      await expect(leaf).toHaveAttribute('data-category-level', '2');
      await expect(branch.locator('.level-connector')).toHaveCount(1);
      await expect(leaf.locator('.level-connector')).toHaveCount(0);
      const secondaryColor = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--td-text-color-secondary)';
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      expect((await branch.evaluate(style)).color).toBe(secondaryColor);
      expect((await leaf.evaluate(style)).color).not.toBe(secondaryColor);
      const third = panel.getByRole('button', { name: '三级', exact: true });
      await expect(third).toHaveAttribute('data-category-level', '3');
      await expect(third.locator('.level-connector')).toHaveCount(0);
      if (deep) expect((await third.evaluate(style)).color).toBe(secondaryColor);
      else expect((await third.evaluate(style)).color).not.toBe(secondaryColor);
      const labelBox = await branch.locator('.category-label').boundingBox();
      const arrowBox = await branch.locator('.level-connector').boundingBox();
      expect(Math.abs(labelBox!.y + labelBox!.height / 2 - arrowBox!.y - arrowBox!.height / 2)).toBeLessThanOrEqual(1);
      await third.click();
      await page.getByRole('button', { name: '商品分类', exact: true }).hover();
      await expect(third).toHaveAttribute('aria-pressed', 'true');
      expect((await third.evaluate(style)).color).not.toBe(secondaryColor);

      await leaf.click();
      await page.getByRole('button', { name: '商品分类', exact: true }).hover();
      await expect(leaf).toHaveAttribute('aria-pressed', 'true');
      await expect(branch).toHaveAttribute('aria-pressed', 'false');
      expect((await leaf.evaluate(style)).color).not.toBe((await branch.evaluate(style)).color);
    });
  }
}

for (const width of [1440, 640]) {
  test(`long SKU values grow the column without wrapping at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { longSingleSpec: true });
    await page.goto('/store/selection-center');
    await page.locator('.product-card').first().click();
    const drawer = page.locator('.t-drawer--open'),
      table = drawer.locator('.selection-sales-table');
    await table.scrollIntoViewIfNeeded();
    await expect(table.locator('tbody tr')).toHaveCount(2);
    const cells = table.locator('tbody tr td').filter({ hasText: '超长完整商品规格内容' });
    await expect(cells).toHaveCount(2);
    for (const cell of await cells.all()) {
      await expect(cell).toHaveText('超长完整商品规格内容'.repeat(18));
      const box = await cell.evaluate((el) => ({
        whiteSpace: getComputedStyle(el).whiteSpace,
        width: el.clientWidth,
        full: el.scrollWidth,
      }));
      expect(box.whiteSpace).toBe('nowrap');
      expect(box.width).toBeGreaterThan(1120);
      expect(box.full).toBeLessThanOrEqual(box.width + 1);
    }
    await expect(table.locator('th').first()).toHaveText('商品规格');
    const scroller = table.locator('.t-table__content');
    await scroller.hover();
    await page.mouse.wheel(10000, 0);
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await expect(table.locator('th').last()).toBeInViewport();
    expect(
      await drawer.locator('.t-drawer__body').evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.mouse.wheel(-10000, 0);
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(0);
    await expect(table.locator('th').first()).toBeInViewport();
  });
}

for (const productIndex of [0, 1]) {
  for (const singleSpecs of [false, true]) {
    test(`price follows specifications without changing values, product=${productIndex}, single=${singleSpecs}`, async ({
      page,
    }) => {
      await fixture(page, { singleSpecs });
      await page.goto('/store/selection-center');
      await page.locator('.product-card').nth(productIndex).click();
      const table = page.locator('.selection-sales-table');
      await expect(table.getByRole('columnheader', { name: '价格', exact: true })).toBeVisible();
      const headings = await table.locator('th').allTextContents();
      const priceIndex = singleSpecs ? 1 : 2;
      expect(headings[priceIndex].trim()).toBe('价格');
      expect(headings[priceIndex - 1].trim()).toBe(singleSpecs ? '商品规格' : '尺寸');
      expect(headings).not.toContain('门店适用价格');
      await expect(table.locator('tbody tr').nth(0).locator('td').nth(priceIndex)).toHaveText('¥ 10');
      await expect(table.locator('tbody tr').nth(1).locator('td').nth(priceIndex)).toHaveText('¥ 20');
    });
  }
}

test('basket price heading is concise for both product types without changing values', async ({ page }) => {
  await fixture(page, { basket: true });
  await page.goto('/store/selection-center?view=basket');
  for (const type of ['成品现货', '配件']) {
    await page.locator('.selection-tabs').getByText(`${type}（6）`, { exact: true }).click();
    await expect(page.locator('.basket-row')).toHaveCount(5);
    await expect(page.locator('.basket-columns')).toHaveText('商品信息价格操作');
    await expect(page.locator('.basket-price').first()).toHaveText('¥ 10 – 20');
    await expect(page.locator('.basket-price')).toHaveCount(5);
  }
});

for (const type of ['finished', 'accessory'] as const) {
  test(`real mixed category depths preserve fourth-level color and connectors: ${type}`, async ({ page }) => {
    await fixture(page);
    await page.route('**/api/admin/store-product-center/categories?**', (route) =>
      route.fulfill({
        json: ok([
          { id: 140, parentId: null, name: '电视柜', type },
          { id: 141, parentId: 140, name: '落地式电视柜', type },
          { id: 142, parentId: 140, name: '壁挂式电视柜', type },
          { id: 63, parentId: null, name: '茶几', type },
          { id: 78, parentId: 63, name: '组合茶几', type },
          { id: 79, parentId: 78, name: '圆形组合茶几', type },
          { id: 133, parentId: null, name: '浴室柜', type },
          { id: 134, parentId: 133, name: '壁挂式浴室柜', type },
          { id: 135, parentId: 134, name: '单盆壁挂式浴室柜', type },
          { id: 136, parentId: 135, name: '台上盆单盆壁挂式浴室柜', type },
          { id: 137, parentId: 135, name: '台下盆单盆壁挂式浴室柜', type },
          { id: 151, parentId: 136, name: '四级父项的下级', type },
        ]),
      }),
    );
    await page.goto('/store/selection-center');
    await expect(page.locator('.product-card')).toHaveCount(20);
    await page.getByRole('button', { name: '商品分类', exact: true }).hover();
    const panel = page.locator('.selection-category-panel');
    await panel.getByRole('tab', { name: type === 'finished' ? '成品现货' : '配件', exact: true }).hover();
    const button = (name: string) => panel.getByRole('button', { name, exact: true });
    const colors = await page.evaluate(() => {
      const el = document.createElement('span');
      document.body.append(el);
      const get = (token: string) => {
        el.style.color = `var(${token})`;
        return getComputedStyle(el).color;
      };
      const result = { primary: get('--td-text-color-primary'), secondary: get('--td-text-color-secondary') };
      el.remove();
      return result;
    });
    for (const name of ['台上盆单盆壁挂式浴室柜', '台下盆单盆壁挂式浴室柜']) {
      await expect(button(name)).toHaveAttribute('data-category-level', '4');
      await expect(button(name)).toHaveCSS('color', colors.primary);
      await expect(button(name).locator('.level-connector')).toHaveCount(0);
    }
    await page.screenshot({
      path: test.info().outputPath('mixed-category.png'),
      fullPage: true,
      animations: 'disabled',
    });
    for (const name of ['组合茶几', '壁挂式浴室柜', '单盆壁挂式浴室柜'])
      await expect(button(name)).toHaveCSS('color', colors.secondary);
    for (const name of ['落地式电视柜', '壁挂式电视柜', '圆形组合茶几'])
      await expect(button(name)).toHaveCSS('color', colors.primary);
    for (const name of ['电视柜', '组合茶几', '壁挂式浴室柜'])
      await expect(button(name).locator('.level-connector')).toHaveCount(1);
    for (const name of ['落地式电视柜', '壁挂式电视柜', '圆形组合茶几', '单盆壁挂式浴室柜'])
      await expect(button(name).locator('.level-connector')).toHaveCount(0);
    await button('台上盆单盆壁挂式浴室柜').click();
    await page.getByRole('button', { name: '商品分类', exact: true }).hover();
    await expect(button('台上盆单盆壁挂式浴室柜')).toHaveAttribute('aria-pressed', 'true');
    await expect(button('台上盆单盆壁挂式浴室柜')).not.toHaveCSS('color', colors.primary);
  });
}

test('quick filters use secondary typography and preserve selected feedback', async ({ page }) => {
  await fixture(page);
  await page.goto('/store/selection-center');
  const filters = page.locator('.quick-filter-row');
  for (const name of ['成品现货', '配件', '未加入门店', '已加入门店']) {
    const button = filters.getByRole('button', { name, exact: true });
    await expect(button).toHaveCSS('font-size', '12px');
    await expect(button).toHaveCSS('line-height', '20px');
    const before = await button.getAttribute('aria-pressed');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  }
  const target = filters.getByRole('button', { name: '成品现货', exact: true });
  if ((await target.getAttribute('aria-pressed')) !== 'true') await target.click();
  const selectedColor = await target.evaluate((el) => getComputedStyle(el).color);
  await target.click();
  await expect(target).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(() => target.locator('.filter-secondary-label').evaluate((el) => getComputedStyle(el).color))
    .not.toBe(selectedColor);
});

for (const media of ['image', 'video'] as const) {
  test(`description ${media} preview hides visible caption but retains accessible action`, async ({ page }) => {
    await fixture(page, { descriptionMedia: media });
    await page.goto('/store/selection-center');
    await page.locator('.product-card').first().click();
    const button = page
      .locator('.selection-description')
      .getByRole('button', { name: media === 'image' ? '详情图片 点击查看大图' : '点击播放视频' });
    await expect(button).toHaveCount(1);
    const label = button.locator('span');
    await expect(label).toHaveCSS('clip-path', 'inset(50%)');
    await expect(label).toHaveCSS('position', 'absolute');
    await button.click();
    const dialog = page.locator('.t-dialog:visible');
    await expect(dialog).toContainText('商品媒体');
    await expect(dialog.locator(media === 'image' ? 'img' : 'video')).toHaveAttribute(
      'src',
      media === 'image' ? '/description.png' : '/description.webm',
    );
  });
}

for (const width of [1440, 640]) {
  test(`detail thumbnails and video marker center inside selected surfaces at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { media: 'both', thumbnailRatios: true });
    await page.goto('/store/selection-center');
    await page.locator('.product-card').first().click();
    const drawer = page.locator('.t-drawer--open');
    await expect(drawer.locator('.media-thumb')).toHaveCount(3);
    await expect.poll(async () => (await drawer.boundingBox())!.x).toBeGreaterThanOrEqual(0);
    for (const surface of await drawer.locator('.media-thumbnails > .t-tag').all()) {
      const delta = await surface.evaluate((el) => {
        const box = el.getBoundingClientRect(),
          thumb = el.querySelector('.media-thumb')!.getBoundingClientRect();
        return [
          Math.abs(box.x + box.width / 2 - thumb.x - thumb.width / 2),
          Math.abs(box.y + box.height / 2 - thumb.y - thumb.height / 2),
        ];
      });
      expect(delta[0]).toBeLessThanOrEqual(1);
      expect(delta[1]).toBeLessThanOrEqual(1);
    }
    const offsets = await drawer
      .locator('.media-thumb')
      .first()
      .evaluate((el) => {
        const thumb = el.getBoundingClientRect(),
          icon = el.querySelector('.thumbnail-play-icon')!.getBoundingClientRect();
        return [
          Math.abs(icon.x + icon.width / 2 - thumb.x - thumb.width / 2),
          Math.abs(icon.y + icon.height / 2 - thumb.y - thumb.height / 2),
        ];
      });
    expect(offsets[0]).toBeLessThanOrEqual(1);
    expect(offsets[1]).toBeLessThanOrEqual(1);
    await expect(drawer.locator('.media-thumb img').nth(0)).toHaveCSS('object-position', '50% 50%');
    await drawer.getByLabel('查看商品图片1', { exact: true }).click();
    await expect(drawer.locator('.media-stage > img')).toHaveCount(1);
    await drawer.getByLabel('播放商品视频', { exact: true }).click();
    await expect(drawer.locator('.media-stage > video')).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('thumbnail-alignment.png'), animations: 'disabled' });
  });
}

for (const type of ['finished', 'accessory'] as const) {
  test(`actual preview categories render correct levels colors and arrows: ${type}`, async ({ page }) => {
    const fs = await import('node:fs');
    // Read-only preview category snapshot captured 2026-11-13; no account or session data.
    const rows: CenterCategory[] = JSON.parse(fs.readFileSync('tests/fixtures/selection-category-tree.json', 'utf8'));
    await fixture(page);
    await page.route('**/api/admin/store-product-center/categories?**', (route) => route.fulfill({ json: ok(rows) }));
    await page.goto('/store/selection-center');
    await expect(page.locator('.product-card')).toHaveCount(20);
    await page.getByRole('button', { name: '商品分类', exact: true }).hover();
    const panel = page.locator('.selection-category-panel');
    await panel.getByRole('tab', { name: type === 'finished' ? '成品现货' : '配件', exact: true }).hover();
    const items = rows.filter((r) => r.type === type),
      byId = new Map(items.map((r) => [r.id, r]));
    const depth = (r: any): number => (r.parentId ? 1 + depth(byId.get(r.parentId)) : 1);
    const colors = await page.evaluate(() => {
      const p = document.createElement('span');
      document.body.append(p);
      p.style.color = 'var(--td-text-color-primary)';
      const primary = getComputedStyle(p).color;
      p.style.color = 'var(--td-text-color-secondary)';
      const secondary = getComputedStyle(p).color;
      p.remove();
      return { primary, secondary };
    });
    const observed = [];
    await expect(panel.locator('[data-category-level]')).toHaveCount(items.length);
    for (const r of items) {
      const level = depth(r),
        children = items.filter((x) => x.parentId === r.id);
      const b = panel.getByRole('button', { name: r.name, exact: true });
      await expect(b).toHaveAttribute('data-category-level', String(level));
      await expect(b).toHaveCSS(
        'color',
        (level === 2 || level === 3) && children.length > 0 ? colors.secondary : colors.primary,
      );
      await expect(b).toHaveCSS('font-weight', level === 1 ? '600' : '400');
      const arrows =
        children.length &&
        (level === 2 || (level === 1 && children.every((c) => !items.some((x) => x.parentId === c.id))))
          ? 1
          : 0;
      await expect(b.locator('.level-connector')).toHaveCount(arrows);
      observed.push({
        name: r.name,
        id: r.id,
        parent: r.parentId,
        level,
        color: await b.evaluate((el) => getComputedStyle(el).color),
        arrows,
      });
    }
    fs.writeFileSync(
      test.info().outputPath('actual-category-computed.json'),
      JSON.stringify(
        { type, source: 'read-only preview database; isolated browser, not user authenticated page', observed },
        null,
        2,
      ),
    );
    await page.screenshot({ path: test.info().outputPath('actual-category-top.png'), animations: 'disabled' });
    await panel.locator('.catalog-hover-content').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.screenshot({ path: test.info().outputPath('actual-category-bottom.png'), animations: 'disabled' });
  });
}
