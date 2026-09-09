import { expect, test, type Page } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

async function installFinishedMocks(page: Page) {
  await installAdminApiMocks(page);
  await page.route('**/api/admin/finished-products/attribute-template-options', (route) =>
    route.fulfill({
      json: {
        code: 0,
        message: 'ok',
        data: [
          {
            categoryId: 5,
            content: [
              {
                attributeId: 1,
                name: 'E2E 共享属性',
                valueType: 'select',
                attributeRole: 'product',
                requiredFlag: true,
                sortOrder: 1,
                options: [{ id: 1, value: 'E2E 共享属性值' }],
              },
              {
                attributeId: 2,
                name: 'E2E 成品现货专属属性',
                valueType: 'select',
                attributeRole: 'product',
                requiredFlag: false,
                sortOrder: 2,
                options: [{ id: 2, value: 'E2E 成品现货专属属性值' }],
              },
            ],
          },
          {
            categoryId: 6,
            content: [
              {
                attributeId: 2,
                name: 'E2E 成品现货专属属性',
                valueType: 'select',
                attributeRole: 'product',
                requiredFlag: true,
                sortOrder: 1,
                options: [{ id: 2, value: 'E2E 成品现货专属属性值' }],
              },
            ],
          },
        ],
      },
    }),
  );
}

test('shows finished stock actions without inventory movements', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
  await installFinishedMocks(page);
  await page.route('**/api/admin/finished-products/price-level-options', (route) =>
    route.fulfill({ json: { code: 0, message: 'ok', data: [] } }),
  );

  await page.route('**/api/admin/product-categories', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: [
          { id: 101, parentId: null, scope: 'finished', name: '有效商品分类', status: 'enabled' },
          { id: 102, parentId: null, scope: 'finished', name: '已停用分类', status: 'disabled' },
          { id: 103, parentId: null, scope: 'accessory', name: '辅料分类', status: 'enabled' },
        ],
      },
    }),
  );
  await page.goto('/finished-stock-management');
  const categoryFilter = page.locator('.filter-card .t-form__item').filter({ hasText: '商品分类' });
  await categoryFilter.locator('input').click();
  await expect(page.getByText('有效商品分类', { exact: true })).toBeVisible();
  await expect(page.getByText('已停用分类', { exact: true })).toHaveCount(0);
  await expect(page.getByText('辅料分类', { exact: true })).toHaveCount(0);
  await page.getByPlaceholder('商品名称 / ID / 编码', { exact: true }).click();

  await expect(page.getByText(/仓库中/)).toBeVisible();
  await expect(page.getByText('供应商', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('租户', { exact: true })).toHaveCount(0);
  await expect(page.getByText('门店', { exact: true })).toHaveCount(0);
  const firstProductRow = page.locator('tbody tr').filter({ hasText: '编码：' }).first();
  await expect(firstProductRow).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '创建人', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '创建时间', exact: true })).toBeVisible();
  await expect(firstProductRow.getByText('韩健', { exact: true })).toBeVisible();
  await expect(firstProductRow.getByText('2026/07/27 17:00', { exact: true })).toBeVisible();
  await expect(page.getByText('流水', { exact: true })).toHaveCount(0);
  await expect(page.getByText('库存流水', { exact: true })).toHaveCount(0);
  const keyword = page.getByPlaceholder('商品名称 / ID / 编码', { exact: true });
  for (const text of ['轻奢', '1', 'fp-20260727', '  岩板  ']) {
    await keyword.fill(text);
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(firstProductRow).toBeVisible();
    await expect(page.getByText('已按筛选条件刷新列表', { exact: true })).toHaveCount(0);
  }
  await keyword.fill('不存在的商品');
  await keyword.press('Enter');
  await expect(firstProductRow).toHaveCount(0);
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(keyword).toHaveValue('');
  await expect(firstProductRow).toBeVisible();
});

test('matches slab tab counts and selects a fourth-level category in columns', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
  await installFinishedMocks(page);
  await page.route('**/api/admin/finished-products/price-level-options', (route) =>
    route.fulfill({ json: { code: 0, message: 'ok', data: [] } }),
  );

  await page.goto('/finished-stock-management');

  await expect(page.getByText('仓库中 1', { exact: true })).toBeVisible();
  await expect(page.getByText('出售中', { exact: true })).toBeVisible();
  await expect(page.getByText('出售中 0', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const picker = page.getByTestId('finished-category-picker');
  await expect(picker.locator('.category-column')).toHaveCount(3);
  await picker.getByRole('button', { name: '成品现货' }).click();
  await picker.getByRole('button', { name: '餐桌' }).click();
  await picker.getByRole('button', { name: '石材餐桌' }).click();
  await expect(picker.locator('.category-column')).toHaveCount(4);
  await picker.getByRole('button', { name: '奢石餐桌' }).click();
  await page.getByRole('button', { name: '确认，下一步' }).click();

  await expect(page.getByText('当前分类：成品现货 > 餐桌 > 石材餐桌 > 奢石餐桌')).toBeVisible();
  const images = page.locator('.t-form__item').filter({ hasText: '最多上传5张图片' });
  const video = page.locator('.t-form__item').filter({ hasText: '最多上传1段视频' });
  await expect(images.locator('input[type="file"]')).toHaveCount(1);
  await expect(video.locator('input[type="file"]')).toHaveCount(1);
  await expect(images.locator('.t-form__label')).toContainText('商品主图');
  await expect(video.locator('.t-form__label')).toContainText('商品视频');
  const imageBounds = await images.boundingBox();
  const videoBounds = await video.boundingBox();
  expect(videoBounds!.y).toBeGreaterThanOrEqual(imageBounds!.y + imageBounds!.height);

  let mediaId = 100;
  await page.route('**/api/admin/finished-products/media**', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data:
          route.request().method() === 'DELETE'
            ? true
            : { id: mediaId++, mediaType: 'image', url: '/test-product.png', mimeType: 'image/png' },
      },
    }),
  );
  const emptyUploads = images
    .locator('.admin-media-upload')
    .filter({ has: page.getByText('点击上传', { exact: true }) });
  for (let index = 0; index < 5; index++) {
    await expect(emptyUploads).toHaveCount(1);
    await emptyUploads.locator('input[type="file"]').setInputFiles({
      name: `product-${index}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from('test-image'),
    });
    await expect(images.getByRole('button', { name: '删除', exact: true })).toHaveCount(index + 1);
  }
  await expect(emptyUploads).toHaveCount(0);
  await images.getByRole('button', { name: '删除', exact: true }).first().click();
  await expect(emptyUploads).toHaveCount(1);
  await expect(images.getByRole('button', { name: '删除', exact: true })).toHaveCount(4);

  await images.getByRole('button', { name: '商品主图2', exact: true }).click();
  const preview = page.locator('.t-dialog').filter({ has: page.locator('.image-preview-dialog') });
  await expect(preview).toBeVisible();
  await expect(preview.locator('.image-preview-dialog img')).toHaveAttribute('src', '/test-product.png');
  await preview.locator('.t-dialog__close').click();
  await expect(preview).not.toBeVisible();

  const videoBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const completed = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start();
    context.fillRect(0, 0, 64, 64);
    await new Promise((resolve) => setTimeout(resolve, 500));
    context.clearRect(0, 0, 64, 64);
    await new Promise((resolve) => setTimeout(resolve, 500));
    recorder.stop();
    await completed;
    stream.getTracks().forEach((track) => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
  });
  await page.route('**/test-product.webm', (route) =>
    route.fulfill({ contentType: 'video/webm', body: Buffer.from(videoBytes) }),
  );
  await page.route('**/api/admin/finished-products/media', (route) =>
    route.fulfill({ json: { code: 0, data: { id: 200, mediaType: 'video', url: '/test-product.webm' } } }),
  );
  await video.locator('input[type="file"]').setInputFiles({
    name: 'product.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(videoBytes),
  });
  await video.getByRole('button', { name: '播放商品视频' }).click();
  const player = preview.locator('video');
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute('controls', '');
  await expect.poll(() => player.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
  await preview.locator('.t-dialog__close').click();
  await expect(player).toHaveCount(0);
});

test('edits an initially empty rich product description with real toolbar actions', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page);
  await page.route('**/api/admin/finished-products/price-level-options', (route) =>
    route.fulfill({ json: { code: 0, message: 'ok', data: [] } }),
  );

  await page.goto('/finished-stock-management');
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const picker = page.getByTestId('finished-category-picker');
  for (const name of ['成品现货', '餐桌', '石材餐桌', '奢石餐桌']) {
    await picker.getByRole('button', { name }).click();
  }
  await page.getByRole('button', { name: '确认，下一步' }).click();
  const rich = page.getByTestId('product-rich-editor');
  const editable = rich.locator('[contenteditable="true"]');
  await expect(editable).toBeVisible();
  await expect(editable).toHaveText('');
  await expect(rich.locator('img, video')).toHaveCount(0);
  await editable.fill('商品详情测试');
  await editable.press('ControlOrMeta+a');
  await rich.locator('.w-e-toolbar button[data-menu-key="bold"]').click();
  await expect(editable.locator('strong')).toHaveText('商品详情测试');
  await rich.locator('.w-e-toolbar button[data-menu-key="fontFamily"]').click();
  await rich.getByText('Arial', { exact: true }).click();
  await expect(editable.locator('[style*="font-family"]')).toContainText('商品详情测试');
  await expect(rich.locator('.w-e-toolbar button[data-menu-key="fontFamily"]')).toContainText('Arial');
  await rich.locator('.w-e-toolbar button[data-menu-key="fontSize"]').click();
  await rich.getByText('24px', { exact: true }).click();
  await expect(editable.locator('[style*="font-size: 24px"]')).toContainText('商品详情测试');
  await expect(rich.locator('.w-e-toolbar button[data-menu-key="fontSize"]')).toContainText('24px');
  await editable.click();
  await editable.press('ControlOrMeta+End');
  await editable.press('Enter');
  await rich.locator('.w-e-toolbar button[data-menu-key="insertLink"]').click();
  // wangEditor ignores closing a newly opened panel for its first 200ms.
  await page.waitForTimeout(220);
  await rich.getByRole('textbox', { name: '链接文本' }).fill('商品链接');
  await rich.getByRole('textbox', { name: '链接地址' }).fill('https://example.com/product');
  await rich.getByRole('button', { name: '确定', exact: true }).click();
  await expect(editable.locator('a')).toHaveAttribute('href', 'https://example.com/product');
  await expect(rich.getByRole('textbox', { name: '链接地址' })).not.toBeVisible();
  await editable.click();
  await editable.press('ControlOrMeta+End');
  await editable.press('Enter');
  await page.route('**/api/admin/finished-products/media', (route) =>
    route.fulfill({
      json: { code: 0, data: { id: 300, mediaType: 'image', url: '/api/open/media/rich-photo' } },
    }),
  );
  await expect(rich.locator('.w-e-toolbar button[data-menu-key="uploadImage"]')).not.toHaveClass(/disabled/);
  const fileChooser = page.waitForEvent('filechooser');
  await rich.locator('.w-e-toolbar button[data-menu-key="uploadImage"]').click();
  await (
    await fileChooser
  ).setFiles({ name: 'detail.png', mimeType: 'image/png', buffer: Buffer.from('detail-image') });
  await expect(editable.locator('img')).toHaveAttribute('src', '/api/open/media/rich-photo');
  await editable.press('ControlOrMeta+End');
  await editable.press('ArrowRight');
  await editable.press('Enter');
  await expect(rich.locator('.w-e-toolbar button[data-menu-key="uploadVideo"]')).not.toHaveClass(/disabled/);
  await page.route('**/api/admin/finished-products/media', (route) =>
    route.fulfill({ json: { code: 0, data: { id: 301, mediaType: 'video', url: '/api/open/media/rich-video' } } }),
  );
  const videoChooser = page.waitForEvent('filechooser');
  await rich.locator('.w-e-toolbar button[data-menu-key="uploadVideo"]').click();
  await (
    await videoChooser
  ).setFiles({ name: 'detail.webm', mimeType: 'video/webm', buffer: Buffer.from('detail-video') });
  await expect(editable.locator('video source')).toHaveAttribute('src', '/api/open/media/rich-video');
});

test('shows every publish section and navigates anchors without losing form input', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page);
  await page.route('**/api/admin/finished-products/price-level-options', (route) =>
    route.fulfill({ json: { code: 0, message: 'ok', data: [] } }),
  );

  await page.goto('/finished-stock-management');
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const picker = page.getByTestId('finished-category-picker');
  for (const name of ['成品现货', '餐桌', '石材餐桌', '奢石餐桌']) {
    await picker.getByRole('button', { name }).click();
  }
  await page.getByRole('button', { name: '确认，下一步' }).click();
  const navigation = page.getByRole('navigation', { name: '商品信息分区导航' });
  const form = page.locator('.form-shell');
  await expect(form.getByRole('tab')).toHaveCount(0);
  await expect(form.locator(':scope > .zdm-admin-section-card.form-section')).toHaveCount(3);
  await expect(form.getByRole('region', { name: '发布商品信息', exact: true })).toBeVisible();
  await expect(navigation.locator('..')).toHaveCSS('position', 'fixed');
  await expect(navigation).toBeInViewport();
  await expect(picker).not.toBeVisible();
  await page.screenshot({ path: '/tmp/finished-product-cards-top.png' });
  for (const name of ['图文描述', '基础信息', '销售信息']) {
    await expect(form.getByRole('region', { name, exact: true })).toBeVisible();
  }
  await navigation.getByRole('link', { name: '基础信息', exact: true }).click();
  await expect(form.getByRole('heading', { name: '基础信息', exact: true })).toBeInViewport();
  await expect(navigation.getByRole('link', { name: '基础信息', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  );
  const nameInput = form.locator('.t-form__item').filter({ hasText: '商品名称' }).getByRole('textbox');
  await nameInput.fill('锚点跳转保留商品名称');
  await navigation.getByRole('link', { name: '销售信息', exact: true }).click();
  await expect(form.getByRole('heading', { name: '销售信息', exact: true })).toBeInViewport();
  await expect(navigation.getByRole('link', { name: '销售信息', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const createSpecButton = form.getByRole('button', { name: '创建规格', exact: true });
  await createSpecButton.scrollIntoViewIfNeeded();
  const scrollBeforeDialog = await page.evaluate(() => window.scrollY);
  await createSpecButton.click();
  await expect(page.locator('.t-dialog__header').filter({ hasText: '创建规格' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBeforeDialog);
  await page.locator('.spec-dialog-footer').getByRole('button', { name: '取消', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBeforeDialog);
  await navigation.getByRole('link', { name: '图文描述', exact: true }).click();
  await expect(form.getByRole('heading', { name: '图文描述', exact: true })).toBeInViewport();
  await expect(nameInput).toHaveValue('锚点跳转保留商品名称');
  await expect(navigation).toBeInViewport();
  await expect
    .poll(async () => {
      const heading = await form.getByRole('heading', { name: '图文描述', exact: true }).boundingBox();
      const nav = await navigation.locator('..').boundingBox();
      return Boolean(heading && nav && heading.y >= nav.y + nav.height);
    })
    .toBe(true);
  await page.screenshot({ path: '/tmp/finished-product-cards-scrolled.png' });
  await form.getByRole('button', { name: '提交商品信息', exact: true }).click();
  await expect(form.getByRole('heading', { name: '图文描述', exact: true })).toBeInViewport();
  await expect(page.getByText('请上传商品主图', { exact: true })).toBeVisible();
  await nameInput.fill('');
  await expect(nameInput.locator('..')).toHaveClass(/t-is-error/);
  await expect(form.locator('.supplier-form .t-input')).not.toHaveClass(/t-is-error/);
  const requiredAttribute = form.locator('.product-attributes-grid .t-form__item').filter({ hasText: 'E2E 共享属性' });
  const optionalAttribute = form
    .locator('.product-attributes-grid .t-form__item')
    .filter({ hasText: 'E2E 成品现货专属属性' });
  await expect(requiredAttribute.locator('.t-input')).toHaveClass(/t-is-error/);
  await expect(optionalAttribute.locator('.t-input')).not.toHaveClass(/t-is-error/);
  await requiredAttribute.locator('.t-select').click();
  await page.getByText('E2E 共享属性值', { exact: true }).click();
  await expect(requiredAttribute.locator('.t-input')).not.toHaveClass(/t-is-error/);

  await expect(form.getByTestId('product-rich-editor')).toHaveAttribute('aria-invalid', 'true');
  await nameInput.fill('已补全商品名称');
  await expect(nameInput.locator('..')).not.toHaveClass(/t-is-error/);
});

test('confirms category changes and replaces the cleared form attributes', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page);
  await page.route('**/api/admin/finished-products/price-level-options', (route) =>
    route.fulfill({ json: { code: 0, message: 'ok', data: [] } }),
  );

  await page.route('**/api/admin/product-categories', (route) =>
    route.fulfill({
      json: {
        code: 0,
        message: 'ok',
        data: [
          { id: 1, name: '成品现货', scope: 'finished', status: 'enabled' },
          { id: 3, parentId: 1, name: '餐桌', scope: 'finished', status: 'enabled' },
          { id: 5, parentId: 3, name: '分类甲', scope: 'finished', status: 'enabled' },
          { id: 6, parentId: 3, name: '分类乙', scope: 'finished', status: 'enabled' },
        ],
      },
    }),
  );
  await page.goto('/finished-stock-management');
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const picker = page.getByTestId('finished-category-picker');
  for (const name of ['成品现货', '餐桌', '分类甲']) await picker.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: '确认，下一步' }).click();
  await expect(picker).not.toBeVisible();
  await page.getByRole('button', { name: '切换分类', exact: true }).click();
  await expect(picker).toBeVisible();
  await expect(page.getByText('切换分类后，表单填写的内容将清空', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).last().click();
  const nameInput = page
    .locator('#finished-product-base .t-form__item')
    .filter({ hasText: '商品名称' })
    .getByRole('textbox');
  await nameInput.fill('需要保留的名称');
  await page.getByRole('button', { name: '切换分类', exact: true }).click();
  const warning = page.getByText('切换分类后，表单填写的内容将清空', { exact: true });
  await expect(warning).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).last().click();
  await expect(nameInput).toHaveValue('需要保留的名称');
  await page.getByRole('button', { name: '切换分类', exact: true }).click();
  await page.getByRole('button', { name: '确认切换', exact: true }).click();
  await picker.getByRole('button', { name: '分类乙', exact: true }).click();
  await page.getByRole('button', { name: '确认，下一步' }).click();
  await expect(nameInput).toHaveValue('');
  await expect(page.locator('.product-attributes-grid .t-form__label')).toHaveText(['E2E 成品现货专属属性']);
  await expect(page.locator('.product-attributes-grid .t-form__label')).toHaveClass(/t-form__label--required/);
});

test('refreshes configured finished prices and calculates dynamic specification and batch prices', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page);
  await page.route('**/api/admin/finished-products/price-level-options', (route) =>
    route.fulfill({ json: { code: 0, message: 'ok', data: [] } }),
  );

  let priceOptions: object[] = [];
  await page.route('**/api/admin/finished-products/price-level-options', (route) =>
    route.fulfill({
      json: {
        code: 0,
        message: 'ok',
        data: [
          { id: 25, name: '经销商价格', sortOrder: 1 },
          { id: 26, name: '未配置级别', sortOrder: 2 },
        ],
      },
    }),
  );
  await page.route('**/api/admin/finished-markup-configurations/options', (route) =>
    route.fulfill({ json: { code: 0, message: 'ok', data: priceOptions } }),
  );
  await page.goto('/finished-stock-management');
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const picker = page.getByTestId('finished-category-picker');
  for (const name of ['成品现货', '餐桌', '石材餐桌', '奢石餐桌'])
    await picker.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: '确认，下一步' }).click();
  priceOptions = [
    { id: 11, storeLevelId: 25, name: '经销商价格', priceCoefficient: 1.1, sortOrder: 1, status: 'enabled' },
  ];
  await page.getByRole('button', { name: '创建规格', exact: true }).click();
  await page.getByPlaceholder('请输入规格文本，如 1500*800*750mm').fill('测试规格');
  await page.getByRole('button', { name: '确认创建', exact: true }).click();
  const table = page.locator('.spec-table-block');
  for (const name of ['商品规格', '成本价*', '指导价*', '经销商价格*'])
    await expect(table.getByRole('columnheader', { name, exact: true })).toBeVisible();
  const row = table.locator('tbody tr');
  await row.locator('td').nth(1).getByRole('textbox').fill('100');
  const configuredCell = row.locator('td').nth(3);
  const manualCell = row.locator('td').nth(4);
  const focusCoefficient = configuredCell.getByPlaceholder('系数', { exact: true });
  const originalCoefficient = await focusCoefficient.inputValue();
  await focusCoefficient.fill('9');
  await expect(configuredCell.getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true })).toBeVisible();
  await focusCoefficient.fill(originalCoefficient);
  await focusCoefficient.press('Tab');
  await expect(configuredCell.getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true })).toBeVisible();

  for (const placeholder of ['系数', '价格']) {
    const input = configuredCell.getByPlaceholder(placeholder, { exact: true });
    const beforeFocus = await input.inputValue();
    await input.focus();
    await expect(input).toHaveValue(beforeFocus);
    await input.press('Tab');
    await expect(configuredCell.getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true })).toBeVisible();
  }

  const following = configuredCell.getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true });
  const manual = configuredCell.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true });
  await following.click();
  await expect(page.getByText('确定更改价格不跟随价格配置浮动？', { exact: true })).toBeVisible();
  await page.locator('.t-dialog__cancel:visible').click();
  await expect(following).toBeVisible();
  await following.click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(manual).toBeVisible();
  await manual.click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(following).toBeVisible();

  await expect(table.locator('.spec-required-star').first()).toHaveCSS('color', 'rgb(213, 73, 65)');
  const manualCoefficient = manualCell.getByPlaceholder('系数', { exact: true });
  const priceInputWidths = () =>
    row
      .locator('.spec-price-input')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  const initialWidths = await priceInputWidths();
  const priceInputsFit = await row.locator('.spec-price-input').evaluateAll((elements) =>
    elements.every((element) => {
      const input = element.getBoundingClientRect();
      const cell = element.closest('td')!.getBoundingClientRect();
      return input.x >= cell.x && input.right <= cell.right;
    }),
  );
  expect(priceInputsFit).toBe(true);

  await manualCoefficient.focus();
  await expect.poll(priceInputWidths).toEqual(initialWidths);

  await manualCoefficient.fill('-1');
  await expect.poll(priceInputWidths).toEqual(initialWidths);
  await manualCoefficient.press('Tab');
  await expect(manualCell.getByText('请输入正确的系数', { exact: true })).toBeVisible();
  const specErrorBounds = await manualCell.getByText('请输入正确的系数', { exact: true }).boundingBox();
  const specCellBounds = await manualCell.boundingBox();
  expect(specErrorBounds!.y + specErrorBounds!.height).toBeLessThanOrEqual(specCellBounds!.y + specCellBounds!.height);

  await manualCoefficient.fill('');
  await manualCoefficient.press('Tab');
  await expect(manualCell.getByText('请输入系数', { exact: true })).toBeVisible();

  await expect(table.getByRole('columnheader', { name: '未配置级别*', exact: true })).toBeVisible();
  await expect(manualCell.getByPlaceholder('系数', { exact: true })).toHaveValue('');
  await expect(manualCell.getByPlaceholder('价格', { exact: true })).toHaveValue('');
  await manualCell.getByPlaceholder('系数', { exact: true }).fill('1.3');
  await expect(manualCell.getByPlaceholder('价格', { exact: true })).toHaveValue('130.00');

  await expect(configuredCell.getByPlaceholder('价格', { exact: true })).toHaveValue('110.00');
  await configuredCell.getByPlaceholder('价格', { exact: true }).fill('150');
  await expect(configuredCell.getByPlaceholder('系数', { exact: true })).toHaveValue('1.50');
  await page.getByRole('button', { name: '批量填写', exact: true }).click();
  const batchPrice = page.locator('.batch-field-grid .t-form__item').filter({ hasText: '经销商价格' });
  await expect(batchPrice).toBeVisible();
  const batchCoefficient = batchPrice.getByPlaceholder('系数', { exact: true });
  await batchCoefficient.fill('-1');
  await batchCoefficient.press('Tab');
  await expect(batchPrice.getByText('请输入正确的系数', { exact: true })).toBeVisible();
  const errorBounds = await batchPrice.getByText('请输入正确的系数', { exact: true }).boundingBox();
  const fieldBounds = await batchPrice.boundingBox();
  expect(errorBounds!.y + errorBounds!.height).toBeLessThanOrEqual(fieldBounds!.y + fieldBounds!.height + 1);

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('请输入正确的价格或系数', { exact: true })).toBeVisible();
  await expect(batchPrice).toBeVisible();
  await batchCoefficient.fill('');
  await batchCoefficient.press('Tab');
  await expect(batchPrice.getByText('请输入系数', { exact: true })).toHaveCount(0);
  const batchAmount = batchPrice.getByPlaceholder('价格', { exact: true });
  await batchAmount.fill('-1');
  await batchAmount.press('Tab');
  await expect(batchPrice.getByText('请输入正确的价格', { exact: true })).toBeVisible();
  await batchAmount.fill('');
  await batchCoefficient.fill('2');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(configuredCell.getByPlaceholder('价格', { exact: true })).toHaveValue('200.00');
  await expect(configuredCell.getByPlaceholder('系数', { exact: true })).toHaveValue('2.00');
  await page.getByRole('button', { name: '编辑规格', exact: true }).click();
  await page.getByRole('button', { name: '新增规格项', exact: true }).click();
  await page.getByPlaceholder('请输入规格文本，如 1500*800*750mm').last().fill('新增规格');
  await page.getByRole('button', { name: '确认创建', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  const retained = table.locator('tbody tr').filter({ hasText: '测试规格' });
  await expect(retained.locator('td').nth(1).getByPlaceholder('价格', { exact: true })).toHaveValue('100.00');
  await expect(retained.locator('td').nth(3).getByPlaceholder('价格', { exact: true })).toHaveValue('200.00');
  await expect(retained.locator('td').nth(3).getByPlaceholder('系数', { exact: true })).toHaveValue('2.00');
  await expect(
    retained.locator('td').nth(3).getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true }),
  ).toBeVisible();
  await expect(
    table
      .locator('tbody tr')
      .filter({ hasText: '新增规格' })
      .locator('td')
      .nth(1)
      .getByPlaceholder('价格', { exact: true }),
  ).toHaveValue('');
});

test('uses only template-bound role attributes and builds dynamic sales specifications', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page);
  const respond = (data: unknown) => ({ json: { code: 0, message: 'ok', data } });
  await page.route('**/api/admin/finished-products/price-level-options', (route) => route.fulfill(respond([])));
  await page.route('**/api/admin/product-attributes', (route) =>
    route.fulfill(
      respond([
        { id: 1, name: '商品测试属性', scope: 'shared', status: 'enabled', valueType: 'input' },
        { id: 2, name: '销售测试属性', scope: 'finished', status: 'enabled', valueType: 'input' },
        { id: 3, name: '未绑定测试属性', scope: 'finished', status: 'enabled', valueType: 'input' },
        { id: 4, name: '无角色测试属性', scope: 'shared', status: 'enabled', valueType: 'input' },
        { id: 5, name: '不参与组合属性', scope: 'finished', status: 'enabled', valueType: 'input' },
        { id: 6, name: '未发布组合属性', scope: 'finished', status: 'enabled', valueType: 'input' },
      ]),
    ),
  );
  await page.route('**/api/admin/finished-products/attribute-template-options', (route) =>
    route.fulfill(
      respond([
        {
          categoryId: 5,
          content: [
            {
              attributeId: 1,
              name: '商品测试属性',
              valueType: 'input',
              attributeRole: 'product',
              requiredFlag: true,
              sortOrder: 1,
              options: [],
            },
            {
              attributeId: 2,
              name: '销售测试属性',
              valueType: 'input',
              attributeRole: 'sales',
              requiredFlag: true,
              skuFlag: true,
              sortOrder: 2,
              options: [],
            },
            {
              attributeId: 5,
              name: '不参与组合属性',
              valueType: 'input',
              attributeRole: 'sales',
              skuFlag: false,
              sortOrder: 3,
              options: [],
            },
          ],
        },
      ]),
    ),
  );
  await page.goto('/finished-stock-management');
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const picker = page.getByTestId('finished-category-picker');
  for (const name of ['成品现货', '餐桌', '石材餐桌', '奢石餐桌'])
    await picker.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: '确认，下一步' }).click();
  await expect(page.locator('.product-attributes-grid .t-form__label')).toHaveText(['商品测试属性']);
  for (const name of ['未绑定测试属性', '无角色测试属性'])
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await expect(page.locator('#finished-product-sales')).not.toContainText('销售测试属性');
  await page.getByRole('button', { name: '创建规格', exact: true }).click();
  await page.getByText('分层展示：选择标准属性构建规格', { exact: true }).click();
  await expect(page.locator('.selected-tags .spec-attr-tag')).toHaveText(['销售测试属性']);
  await page.getByText('单层展示', { exact: false }).last().click();

  await page.getByPlaceholder('请输入规格文本，如 1500*800*750mm').fill('标准规格');
  await page.getByRole('button', { name: '确认创建', exact: true }).click();
  const table = page.locator('.spec-table-block');
  await expect(table.getByRole('columnheader', { name: '销售测试属性*', exact: true })).toBeVisible();
  for (const name of ['商品测试属性', '未绑定测试属性', '无角色测试属性', '大理石台面材质', '颜色分类', '尺寸'])
    await expect(table.getByRole('columnheader', { name, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '提交商品信息', exact: true }).click();
  const salesInput = table.locator('tbody tr td').nth(4).getByRole('textbox');
  await expect(salesInput.locator('..')).toHaveClass(/t-is-error/);
  await page.getByRole('button', { name: '批量填写', exact: true }).click();
  const batchFields = page.locator('.batch-field-grid');
  await expect(batchFields).not.toContainText('商品测试属性');
  await expect(batchFields).not.toContainText('无角色测试属性');
  await batchFields.locator('.t-form__item').filter({ hasText: '销售测试属性' }).getByRole('textbox').fill('大号');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(salesInput).toHaveValue('大号');
  await page.getByRole('button', { name: '批量填写', exact: true }).click();
  await expect(
    batchFields.locator('.t-form__item').filter({ hasText: '销售测试属性' }).getByRole('textbox'),
  ).toHaveValue('');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(salesInput).toHaveValue('大号');
  await expect(salesInput.locator('..')).not.toHaveClass(/t-is-error/);
  await page.getByRole('button', { name: '编辑规格', exact: true }).click();
  await page.getByText('分层展示：选择标准属性构建规格', { exact: true }).click();
  await expect(page.locator('.spec-attr-tag')).toHaveText(['销售测试属性']);
  await page.getByPlaceholder('请输入属性值').fill('小号');
  await page.getByRole('button', { name: '确认创建', exact: true }).click();
  await expect(table.locator('tbody tr td').nth(3).getByRole('textbox')).toHaveValue('小号');
});

test('uses published bindings for new products and keeps unpublished historical attributes on edit', async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page);
  const respond = (data: unknown) => ({ json: { code: 0, message: 'ok', data } });
  await page.route('**/api/admin/finished-products/price-level-options', (route) => route.fulfill(respond([])));
  await page.route('**/api/admin/finished-products/attribute-template-options', (route) => route.fulfill(respond([])));
  await page.route('**/api/admin/finished-products', (route) =>
    route.fulfill(
      respond([
        {
          id: 1,
          categoryId: 5,
          supplierId: 2,
          name: '历史模板商品',
          sku: 'history-product',
          status: 'warehouse',
          totalStock: 1,
          attributes: [{ attributeId: 1, attributeName: 'E2E 共享属性', value: '历史商品值' }],
          variants: [
            {
              variantKey: 'history-sku',
              variantLabel: '历史规格',
              displayMode: 'single',
              stock: 1,
              salesAttributes: { attribute_2: '历史销售值' },
            },
          ],
        },
      ]),
    ),
  );
  await page.goto('/finished-stock-management');
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const picker = page.getByTestId('finished-category-picker');
  for (const name of ['成品现货', '餐桌', '石材餐桌', '奢石餐桌'])
    await picker.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: '确认，下一步' }).click();
  await expect(page.locator('.product-attributes-grid .t-form__item')).toHaveCount(0);
  await expect(page.locator('#finished-product-sales')).not.toContainText('当前分类未配置销售属性');
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  await page.getByText('编辑', { exact: true }).first().click();
  await expect(page.locator('.product-attributes-grid .t-form__item')).toHaveCount(1);
  await expect(page.locator('.product-attributes-grid').getByRole('textbox')).toHaveValue('历史商品值');
  const table = page.locator('.spec-table-block');
  await expect(table.getByRole('columnheader', { name: 'E2E 成品现货专属属性', exact: true })).toBeVisible();
  await expect(table.locator('tbody tr td').nth(4).getByRole('textbox')).toHaveValue('历史销售值');
});

test('edits prices in a specification table and preserves product details on save', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page);
  let product = {
    id: 71,
    name: '多规格价格商品',
    sku: 'PRICE-71',
    status: 'warehouse',
    categoryId: 5,
    mainImageMediaId: 1,
    videoMediaId: 2,
    detail: '<p>保留详情</p>',
    totalStock: 5,
    attributes: [{ attributeId: 1, attributeName: '商品属性', value: '保留属性' }],
    variants: ['A', 'B'].map((key, index) => ({
      variantKey: key,
      variantLabel: `规格${key}`,
      displayMode: 'single',
      stock: index + 2,
    })),
    guidePrices: ['A', 'B'].map((key) => ({
      variantKey: key,
      variantLabel: `规格${key}`,
      costPrice: 10,
      priceCoefficient: 2,
      price: 20,
    })),
    markupPrices: ['A', 'B'].map((key) => ({
      variantKey: key,
      variantLabel: `规格${key}`,
      storeLevelId: 1,
      storeLevelName: '一级价格',
      priceSource: 'auto',
      sourceConfigurationId: 81,
      costPrice: 10,
      priceCoefficient: 3,
      price: 30,
    })),
  };
  let saves = 0;
  await page.route('**/api/admin/finished-products', (route) => route.fulfill({ json: { code: 0, data: [product] } }));
  await page.route('**/api/admin/finished-products/price-level-options', (route) =>
    route.fulfill({ json: { code: 0, data: [{ id: 1, name: '一级价格' }] } }),
  );
  await page.route('**/api/admin/finished-markup-configurations/options', (route) =>
    route.fulfill({
      json: { code: 0, data: [{ id: 81, storeLevelId: 1, name: '一级价格', priceCoefficient: 3, status: 'enabled' }] },
    }),
  );
  await page.route('**/api/admin/finished-products/71', async (route) => {
    saves += 1;
    const payload = route.request().postDataJSON();
    expect(payload.detail).toBe('<p>保留详情</p>');
    expect(payload.variants).toEqual(product.variants);
    expect(payload.attributes).toEqual(product.attributes);
    product = { ...product, ...payload };
    await route.fulfill({ json: { code: 0, data: product } });
  });
  await page.goto('/finished-stock-management');
  await page.getByText('价格', { exact: true }).click();
  const editor = page.locator('.product-price-editor');
  const visibleRows = editor.locator('tbody tr').first().locator('td');
  await expect(editor.locator('tbody tr')).toHaveCount(2);
  await expect(editor.locator('thead th')).toHaveText(['商品规格', '成本价*', '指导价*', '一级价格*']);
  await expect(editor.locator('.t-select')).toHaveCount(0);
  await expect(editor.locator('tbody tr').nth(1)).toContainText('规格B');
  await expect(visibleRows.nth(1).getByPlaceholder('价格', { exact: true })).toHaveValue('10.00');
  await visibleRows.nth(1).getByPlaceholder('价格', { exact: true }).fill('');
  await visibleRows.nth(1).getByPlaceholder('价格', { exact: true }).fill('12');
  await expect(visibleRows.nth(2).getByPlaceholder('价格', { exact: true })).toHaveValue('24.00');
  await expect(visibleRows.nth(3).getByPlaceholder('价格', { exact: true })).toHaveValue('36.00');
  for (const placeholder of ['系数', '价格']) {
    const input = visibleRows.nth(3).getByPlaceholder(placeholder, { exact: true });
    const beforeFocus = await input.inputValue();
    await input.focus();
    await expect(input).toHaveValue(beforeFocus);
    await input.press('Tab');
    await expect(
      visibleRows.nth(3).getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true }),
    ).toBeVisible();
  }

  await visibleRows.nth(3).getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true }).click();
  await expect(page.getByText('确定更改价格不跟随价格配置浮动？', { exact: true })).toBeVisible();
  await page.locator('.t-dialog__cancel').click();
  expect(saves).toBe(0);
  await expect(
    visibleRows.nth(3).getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true }),
  ).toBeVisible();
  await visibleRows.nth(3).getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(saves).toBe(0);
  expect(product.markupPrices[0].priceSource).toBe('auto');
  await visibleRows.nth(3).getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(saves).toBe(0);
  expect(product.markupPrices[0].priceSource).toBe('auto');
  await expect(visibleRows.nth(3).getByPlaceholder('价格', { exact: true })).toHaveValue('36.00');

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(saves).toBe(1);
  expect(product.guidePrices[1].price).toBe(20);
  await page.getByText('价格', { exact: true }).click();
  await expect(visibleRows.nth(1).getByPlaceholder('价格', { exact: true })).toHaveValue('12.00');
  await visibleRows.nth(3).getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(
    visibleRows.nth(3).getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true }),
  ).toBeVisible();
  expect(product.markupPrices[0].priceSource).toBe('auto');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.t-dialog__cancel').click();
  await page.locator('.price-editor-footer').getByRole('button', { name: '取消', exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(saves).toBe(1);
  await page.getByText('价格', { exact: true }).click();
  await expect(
    visibleRows.nth(3).getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true }),
  ).toBeVisible();
  await page.locator('.price-editor-footer').getByRole('button', { name: '取消', exact: true }).click();
  product.status = 'recycle';
  await page.reload();
  await page
    .locator('.status-tabs')
    .getByText(/回收站/)
    .click();
  await page.getByText('价格', { exact: true }).click();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await expect(visibleRows.nth(1).getByPlaceholder('价格', { exact: true })).toBeDisabled();
});
