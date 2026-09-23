import { expect, test, type Page } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

async function installFinishedMocks(page: Page, clientCode = 'supply-chain') {
  await page.addInitScript((client) => {
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        name: '测试员工',
        clientCode: client,
        roles: ['OPERATOR'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  }, clientCode);
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
  await page.goto('/supply-chain/finished-stock-management');
  const categoryFilter = page.locator('.list-controls .t-form__item').filter({ hasText: '商品分类' });
  await categoryFilter.locator('input').click();
  await expect(page.locator('.t-cascader__panel:visible').getByText('有效商品分类', { exact: true })).toBeVisible();
  await expect(page.getByText('已停用分类', { exact: true })).toHaveCount(0);
  await expect(page.getByText('辅料分类', { exact: true })).toHaveCount(0);
  await page.getByPlaceholder('商品名称 / ID', { exact: true }).click();

  await expect(page.getByText(/仓库中/)).toBeVisible();
  await expect(page.getByText('供应商', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('租户', { exact: true })).toHaveCount(0);
  await expect(page.getByText('门店', { exact: true })).toHaveCount(0);
  const firstProductRow = page.locator('tbody tr').filter({ hasText: 'ID：' }).first();
  await expect(firstProductRow).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '创建人', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '创建时间', exact: true })).toBeVisible();
  await expect(firstProductRow.getByText('韩健', { exact: true })).toBeVisible();
  await expect(firstProductRow.getByText('2026/07/27 17:00', { exact: true })).toBeVisible();
  await expect(page.getByText('流水', { exact: true })).toHaveCount(0);
  await expect(page.getByText('库存流水', { exact: true })).toHaveCount(0);
  const operationHeader = page.getByRole('columnheader', { name: '操作', exact: true });
  const operationWidth = await operationHeader.evaluate((element) => element.getBoundingClientRect().width);
  const keyword = page.getByPlaceholder('商品名称 / ID', { exact: true });
  for (const text of ['轻奢', '1', 'fp-20260727', '  岩板  ']) {
    await keyword.fill(text);
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(firstProductRow).toBeVisible();
    await expect(page.getByText('已按筛选条件刷新列表', { exact: true })).toHaveCount(0);
  }
  await keyword.fill('不存在的商品');
  await keyword.press('Enter');
  await expect(firstProductRow).toHaveCount(0);
  await expect
    .poll(() => operationHeader.evaluate((element) => element.getBoundingClientRect().width))
    .toBe(operationWidth);
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

  await page.goto('/supply-chain/finished-stock-management');

  await expect(page.getByText('仓库中 1', { exact: true })).toBeVisible();
  await expect(page.getByText('已上架', { exact: true })).toBeVisible();
  await expect(page.getByText('已上架 0', { exact: true })).toHaveCount(0);

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
  await expect(images.locator('input[type="file"]')).toHaveCount(5);
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
    await expect(emptyUploads).toHaveCount(5 - index);
    await emptyUploads
      .first()
      .locator('input[type="file"]')
      .setInputFiles({
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
  const preview = page.locator('.t-dialog:visible').filter({ has: page.locator('.image-preview-dialog') });
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

  await page.goto('/supply-chain/finished-stock-management');
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

  await page.goto('/supply-chain/finished-stock-management');
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
  await page.goto('/supply-chain/finished-stock-management');
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

test('source specification editor exposes cost and stock without operations prices', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page);
  await page.goto('/supply-chain/finished-stock-management');
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const picker = page.getByTestId('finished-category-picker');
  for (const name of ['成品现货', '餐桌', '石材餐桌', '奢石餐桌'])
    await picker.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: '确认，下一步' }).click();
  await page.getByRole('button', { name: '创建规格', exact: true }).click();
  await page.getByPlaceholder('请输入规格文本，如 1500*800*750mm').fill('测试规格');
  await page.getByRole('button', { name: '确认创建', exact: true }).click();
  const table = page.locator('.spec-table-block');
  await expect(table.getByRole('columnheader', { name: '成本价*', exact: true })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: /指导价/ })).toHaveCount(0);
  await page.getByText('批量填写', { exact: true }).click();
  await expect(page.locator('.batch-field-grid').getByText('成本价', { exact: true })).toBeVisible();
  await expect(page.locator('.batch-field-grid').getByText('指导价', { exact: true })).toHaveCount(0);
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
  await page.goto('/supply-chain/finished-stock-management');
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
  await switchSpecMode(page, 'layered', false);
  await expect(page.locator('.selected-tags .spec-attr-tag')).toHaveText(['销售测试属性']);
  await page.getByRole('button', { name: '重置', exact: true }).click();

  await page.getByPlaceholder('请输入规格文本，如 1500*800*750mm').fill('标准规格');
  await page.getByRole('button', { name: '确认创建', exact: true }).click();
  const table = page.locator('.spec-table-block');
  await expect(table.getByRole('columnheader', { name: '销售测试属性*', exact: true })).toBeVisible();
  for (const name of ['商品测试属性', '未绑定测试属性', '无角色测试属性', '大理石台面材质', '颜色分类', '尺寸'])
    await expect(table.getByRole('columnheader', { name, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '提交商品信息', exact: true }).click();
  const salesColumn = await table.getByRole('columnheader').allTextContents();
  const salesInput = table
    .locator('tbody tr')
    .first()
    .locator('td')
    .nth(salesColumn.findIndex((text) => text.includes('销售测试属性')))
    .getByRole('textbox');
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
  await page.getByPlaceholder('请输入规格文本，如 1500*800*750mm').fill('大号');
  await page.getByText('分层展示：选择标准属性构建规格', { exact: true }).click();
  await page.getByRole('button', { name: '确认切换', exact: true }).click();
  await expect(page.locator('.spec-attr-tag')).toHaveText(['销售测试属性']);
  // This product has not been saved, even though its single specifications were created.
  await expect(page.locator('.spec-attr-tag.active')).toHaveCount(0);
  await page.locator('.spec-attr-tag').getByText('销售测试属性', { exact: true }).click();
  await expect(page.getByPlaceholder('请输入属性值')).toHaveValue('');
  await page.getByPlaceholder('请输入属性值').fill('小号');
  await page.getByRole('button', { name: '确认创建', exact: true }).click();
  await expect(table.locator('tbody tr td').first()).toHaveText('小号');
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
  await page.goto('/supply-chain/finished-stock-management');
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
  const historyColumn = await table.getByRole('columnheader').allTextContents();
  await expect(
    table
      .locator('tbody tr')
      .first()
      .locator('td')
      .nth(historyColumn.findIndex((text) => text.includes('E2E 成品现货专属属性')))
      .getByRole('textbox'),
  ).toHaveValue('历史销售值');
});

test('edits prices in a specification table and preserves product details on save', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page, 'admin');
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
      id: index + 801,
      variantLabel: `规格${key}`,
      displayMode: 'single',
      stock: index + 2,
    })),
    guidePrices: ['A', 'B'].map((key, index) => ({
      skuId: index + 801,
      variantLabel: `规格${key}`,
      costPrice: 10,
      priceCoefficient: 2,
      price: 20,
    })),
    markupPrices: ['A', 'B'].map((key, index) => ({
      skuId: index + 801,
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
  await expect(visibleRows.nth(1).getByPlaceholder('价格', { exact: true })).toBeDisabled();
  await visibleRows.nth(2).getByPlaceholder('系数', { exact: true }).fill('3');
  await expect(visibleRows.nth(2).getByPlaceholder('价格', { exact: true })).toHaveValue('30.00');
  await expect(visibleRows.nth(3).getByPlaceholder('价格', { exact: true })).toHaveValue('30.00');
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
  await expect(
    page.locator('.t-dialog:visible').getByText('是否更改价格不跟随价格配置浮动？', { exact: true }),
  ).toBeVisible();
  await page.locator('.t-dialog:visible .t-dialog__cancel').click();
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
  await expect(visibleRows.nth(3).getByPlaceholder('价格', { exact: true })).toHaveValue('30.00');

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(saves).toBe(1);
  expect(product.guidePrices[1].price).toBe(20);
  await page.getByText('价格', { exact: true }).click();
  await expect(visibleRows.nth(1).getByPlaceholder('价格', { exact: true })).toHaveValue('10.00');
  await visibleRows.nth(3).getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(
    visibleRows.nth(3).getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true }),
  ).toBeVisible();
  expect(product.markupPrices[0].priceSource).toBe('auto');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.t-dialog:visible .t-dialog__cancel').click();
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

test('restores the initial horizontal layout after visiting the off-shelf tab', async ({ page }) => {
  await page.setViewportSize({ width: 1393, height: 868 });
  await page.addInitScript(() => window.localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page);
  await page.goto('/supply-chain/finished-stock-management');
  await expect(page.locator('tbody tr').filter({ hasText: 'ID：' }).first()).toBeVisible();
  const content = page.locator('main .t-table__content');
  const dimensions = () =>
    content.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
  const warehouse = await dimensions();
  await page.locator('.status-tabs .t-tabs__nav-item').filter({ hasText: '已上架' }).click();
  const selling = await dimensions();
  await page.locator('.status-tabs .t-tabs__nav-item').filter({ hasText: '已下架' }).click();
  await expect
    .poll(async () => {
      const size = await dimensions();
      return size.scrollWidth > size.width;
    })
    .toBe(true);
  await page.locator('.status-tabs .t-tabs__nav-item').filter({ hasText: '仓库中' }).click();
  await expect.poll(dimensions).toEqual(warehouse);
  await page.locator('.status-tabs .t-tabs__nav-item').filter({ hasText: '已上架' }).click();
  await expect.poll(dimensions).toEqual(selling);
});

for (const client of ['admin', 'supply-chain']) {
  test(`hides merchant codes in ${client} lists, publish forms and log details`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('zdm-admin-token', 'dev-token'));
    await installFinishedMocks(page, client);
    const path = client === 'admin' ? '/finished-stock-management' : '/supply-chain/finished-stock-management';
    const records = ['CREATE', 'UPDATE', ...(client === 'admin' ? ['SOURCE_SHELF'] : [])].map(
      (operationType, index) => ({
        id: index + 1,
        productId: 1,
        productName: '日志测试商品',
        merchantCode: 'hidden-product-code',
        operationType,
        operationSummary: operationType === 'SOURCE_SHELF' ? '供应链已上架，商品进入运营管理平台仓库' : '商品信息',
        operatorName: '测试人员',
        operatedAt: '2026-09-18T10:00:00',
        operationSource: 'MANUAL',
        changeDetails: JSON.stringify({
          商家编码: { before: 'hidden-old-code', after: 'hidden-product-code' },
          销售规格: {
            before: [{ variantKey: 'hidden-variant-code', variantLabel: '规格A', costPrice: 10, stock: 1 }],
            after: [{ variantKey: 'hidden-variant-code', variantLabel: '规格A', costPrice: 20, stock: 1 }],
          },
          入仓价格: { before: [], after: [{ variant_key: 'hidden-sql-code', cost_price: 20, price: 40 }] },
        }),
      }),
    );
    await page.route('**/api/admin/finished-products/operation-logs?*', (route) =>
      route.fulfill({ json: { code: 0, data: { records, total: records.length } } }),
    );
    await page.route(/\/api\/admin\/finished-products\/operation-logs\/\d+$/, (route) => {
      const id = Number(route.request().url().split('/').pop());
      return route.fulfill({ json: { code: 0, data: records.find((record) => record.id === id) } });
    });
    await page.goto(path);
    await expect(page.getByRole('main')).not.toContainText('商家编码');
    await page.getByRole('main').getByText('操作日志', { exact: true }).click();
    for (const record of records) {
      const row = page
        .getByRole('row')
        .filter({ hasText: '日志测试商品' })
        .nth(record.id - 1);
      await expect(row).not.toContainText('hidden-product-code');
      if (record.operationType === 'SOURCE_SHELF') {
        await expect(row).toContainText('供应链上架');
        await expect(row).toContainText(record.operationSummary);
      }
      await row.getByText('详情', { exact: true }).click();
      const detail = page.locator('.t-dialog:visible').filter({ hasText: '操作详情' });
      await expect(detail).toBeVisible();
      await expect(detail).not.toContainText('商家编码');
      await expect(detail).not.toContainText('hidden-');
      await detail.getByRole('button', { name: '关闭', exact: true }).click();
    }
    if (client !== 'supply-chain') return;
    await page.goto(path);
    await page.getByRole('button', { name: '发布商品', exact: true }).click();
    const picker = page.getByTestId('finished-category-picker');
    for (const name of ['成品现货', '餐桌', '石材餐桌', '奢石餐桌']) await picker.getByRole('button', { name }).click();
    await page.getByRole('button', { name: '确认，下一步' }).click();
    await expect(page.locator('.form-shell')).not.toContainText('商家编码');
  });
}

test('shows complete warehouse arrival snapshot with creation log layout', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page, 'admin');
  const snapshot = {
    商品ID: 91,
    商品名称: '入仓历史商品',
    商品分类: '成品现货 / 餐桌',
    供应商: '入仓时供应商',
    宝贝详情: '<p>入仓时的宝贝详情</p>',
    总库存: 5,
    状态: 'warehouse',
    商品属性: [{ attributeId: 8, attributeName: '材质', value: '石材' }],
    销售规格: [{ skuId: 811, variantLabel: '入仓规格', stock: 5, costPrice: 10, displayMode: 'single' }],
    指导价: [{ skuId: 811, variantLabel: '入仓规格', priceCoefficient: 2, costPrice: 10, price: 20 }],
    层级价格: [
      {
        skuId: 811,
        variantLabel: '入仓规格',
        storeLevelId: 7,
        storeLevelName: '城市合伙人',
        priceCoefficient: 3,
        costPrice: 10,
        price: 30,
        priceSource: 'auto',
      },
    ],
    媒体: [
      {
        field: 'mainImage',
        mediaId: 1,
        resource: {
          available: true,
          mediaType: 'image',
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        },
      },
    ],
  };
  const record = {
    id: 601,
    productId: 91,
    productName: '入仓历史商品',
    operationType: 'SOURCE_SHELF',
    operationSource: 'SUPPLY_CHAIN',
    operationSummary: '供应链已上架，商品进入运营管理平台仓库',
    afterStatus: 'warehouse',
    operatorName: '供应链人员',
    changeDetails: JSON.stringify(
      Object.fromEntries(Object.entries(snapshot).map(([key, after]) => [key, { before: null, after }])),
    ),
  };
  await page.route('**/api/admin/finished-products/operation-logs?*', (route) =>
    route.fulfill({ json: { code: 0, data: { records: [record], total: 1 } } }),
  );
  await page.route('**/api/admin/finished-products/operation-logs/601', (route) =>
    route.fulfill({ json: { code: 0, data: record } }),
  );
  await page.goto('/finished-stock-management');
  await page.getByRole('main').getByText('操作日志', { exact: true }).click();
  await page.getByRole('row').filter({ hasText: '入仓历史商品' }).getByText('详情', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '操作详情' });
  await expect(dialog.locator('.creation-section-title')).toHaveText(['图文描述', '基础信息', '销售信息']);
  for (const text of ['入仓时供应商', '入仓时的宝贝详情', '入仓规格', '城市合伙人'])
    await expect(dialog).toContainText(text);
  for (const text of ['修改前', '修改后', '入仓价格']) await expect(dialog).not.toContainText(text);
  await dialog.getByRole('button', { name: '查看商品主图', exact: true }).click();
  await expect(page.locator('.t-dialog:visible').filter({ hasText: '历史媒体' })).toBeVisible();
});

test('shows initial warehouse prices without comparison and stacks later prices with fullscreen', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page, 'admin');
  const priceRows = (cost: number) => [
    { variant_key: 'private-key', variant_label: '规格A', cost_price: cost, price_coefficient: 2, price: cost * 2 },
    {
      variant_key: 'private-key',
      variant_label: '规格A',
      store_level_id: 7,
      store_level_name: '城市合伙人',
      cost_price: cost,
      price_coefficient: 3,
      price: cost * 3,
    },
  ];
  const records = [
    {
      id: 101,
      productId: 1,
      productName: '首次入仓商品',
      operationType: 'SOURCE_SHELF',
      operationSource: 'SUPPLY_CHAIN',
      operationSummary: '供应链已上架，商品进入运营管理平台仓库',
      beforeStatus: null,
      afterStatus: 'warehouse',
      operatorName: '供应链人员',
      changeDetails: JSON.stringify({
        来源状态: { before: 'warehouse', after: 'selling' },
        入仓价格: { before: [], after: priceRows(10) },
      }),
    },
    {
      id: 102,
      productId: 1,
      productName: '价格联动商品',
      operationType: 'PRICE_UPDATE',
      operationSource: 'SUPPLY_CHAIN',
      operationSummary: '供应链成本变更，按当前系数重算售价',
      beforeStatus: 'warehouse',
      afterStatus: 'warehouse',
      operatorName: '供应链人员',
      changeDetails: JSON.stringify({ 价格联动: { before: priceRows(10), after: priceRows(20) } }),
    },
  ];
  await page.route('**/api/admin/finished-products/operation-logs?*', (route) =>
    route.fulfill({ json: { code: 0, data: { records, total: 2 } } }),
  );
  await page.route(/\/api\/admin\/finished-products\/operation-logs\/\d+$/, (route) =>
    route.fulfill({
      json: { code: 0, data: records.find((row) => row.id === Number(route.request().url().split('/').pop())) },
    }),
  );
  await page.goto('/finished-stock-management');
  await page.getByRole('main').getByText('操作日志', { exact: true }).click();
  await page.getByRole('row').filter({ hasText: '首次入仓商品' }).getByText('详情', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '操作详情' });
  await expect(dialog).toContainText('— → 仓库中');
  for (const text of ['修改前', '修改后', '来源状态', '商家编码', 'variant_key'])
    await expect(dialog).not.toContainText(text);
  await expect(dialog.getByRole('columnheader')).toHaveText(['商品规格', '成本价', '指导价', '城市合伙人']);
  await expect(
    dialog.getByRole('row').filter({ hasText: '操作来源' }).getByRole('cell', { name: '供应链协同系统', exact: true }),
  ).toHaveAttribute('colspan', '1');
  await dialog.getByRole('button', { name: '全屏显示', exact: true }).click();
  const fullscreen = page.locator('.sales-fullscreen-panel.is-fullscreen');
  await expect(fullscreen).toContainText('价格：20.00');
  const tableWidth = await fullscreen.locator('table').evaluate((el) => el.getBoundingClientRect().width);
  const contentWidth = await fullscreen.locator('.t-table__content').evaluate((el) => el.getBoundingClientRect().width);
  expect(tableWidth).toBeGreaterThanOrEqual(contentWidth - 2);
  await fullscreen.getByRole('button', { name: '还原', exact: true }).click();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '价格联动商品' }).getByText('详情', { exact: true }).click();
  await expect(dialog.locator('.change-side-title')).toHaveText(['修改前', '修改后']);
  const before = await dialog.locator('.change-side--before').boundingBox();
  const after = await dialog.locator('.change-side--after').boundingBox();
  expect(after!.y).toBeGreaterThanOrEqual(before!.y + before!.height);
  await dialog.getByRole('button', { name: '全屏显示', exact: true }).click();
  await expect(fullscreen.locator('.change-side--before')).toContainText('价格：20.00');
  await expect(fullscreen.locator('.change-side--after')).toContainText('价格：40.00');
  await fullscreen.getByRole('button', { name: '还原', exact: true }).click();
});

test('aligns layered log cells on first display and after fullscreen without a corrective click', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page, 'supply-chain');
  const dimensions = ['a', 'b', 'c'].map((key) => ({ key, name: `销售属性${key}`, values: ['选项1', '选项2'] }));
  const variants = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
    variantKey: `key-${i}`,
    variantLabel: `规格${i}`,
    displayMode: 'layered',
    stock: 1,
    costPrice: 10,
    salesAttributes: {
      a: `选项${Math.floor(i / 4) + 1}`,
      b: `选项${(Math.floor(i / 2) % 2) + 1}`,
      c: `选项${(i % 2) + 1}`,
      extra: '额外销售属性',
    },
  }));
  const record = {
    id: 501,
    productId: 1,
    productName: '分层日志',
    operationType: 'UPDATE',
    operationSource: 'MANUAL',
    operatorName: '测试人员',
    changeDetails: JSON.stringify({
      销售规格: { before: variants, after: variants.map((v) => ({ ...v, costPrice: 20 })) },
      规格维度: { before: dimensions, after: dimensions },
    }),
  };
  await page.route('**/api/admin/finished-products/operation-logs?*', (route) =>
    route.fulfill({ json: { code: 0, data: { records: [record], total: 1 } } }),
  );
  await page.route('**/api/admin/finished-products/operation-logs/501', (route) =>
    route.fulfill({ json: { code: 0, data: record } }),
  );
  await page.goto('/supply-chain/finished-stock-management');
  await page.getByRole('main').getByText('操作日志', { exact: true }).click();
  await page.getByRole('row').filter({ hasText: '分层日志' }).getByText('详情', { exact: true }).click();
  const tables = page.locator('.sales-log-table');
  const aligned = async () => {
    await expect
      .poll(() =>
        tables.evaluateAll((elements) =>
          elements.every((el) => {
            const headers = Array.from(el.querySelectorAll('thead th')).slice(0, 3);
            const cells = Array.from(el.querySelectorAll('tbody tr:first-child td')).slice(0, 3);
            return (
              headers.length === 3 &&
              cells.length === 3 &&
              headers.every((header, i) => {
                const rect = header.getBoundingClientRect();
                const cell = cells[i].getBoundingClientRect();
                const expectedLeft = headers.slice(0, i).reduce((sum, h) => sum + h.getBoundingClientRect().width, 0);
                return (
                  rect.width >= 129 &&
                  Math.abs(cell.x - rect.x) < 2 &&
                  Math.abs(parseFloat(getComputedStyle(header).left) - expectedLeft) < 2
                );
              })
            );
          }),
        ),
      )
      .toBe(true);
    await expect(tables.first().locator('tbody tr:first-child td').first()).toHaveAttribute('rowspan', '4');
  };
  await aligned();
  await page.getByRole('button', { name: '全屏显示', exact: true }).click();
  await aligned();
  await page.getByRole('button', { name: '还原', exact: true }).click();
  await aligned();
});

for (const coefficient of [1.8, 0, undefined]) {
  test(`price editor displays persisted level prices with coefficient ${coefficient ?? 'unconfigured'}`, async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('zdm-admin-token', 'dev-token'));
    await installFinishedMocks(page, 'admin');
    let levelEnabled = false;
    const product = {
      id: 91,
      name: '级别恢复价格商品',
      status: 'warehouse',
      sourceStatus: 'selling',
      totalStock: 3,
      attributes: [],
      variants: [1000, 2000, 0].map((costPrice, index) => ({
        id: 901 + index,
        variantLabel: `规格${index + 1}`,
        displayMode: 'single',
        costPrice,
        stock: 1,
      })),
      guidePrices: [1000, 2000, 0].map((costPrice, index) => ({
        skuId: 901 + index,
        costPrice,
        priceCoefficient: 2,
        price: costPrice * 2,
      })),
      markupPrices: [
        {
          skuId: 901,
          storeLevelId: 4,
          storeLevelName: '4级合伙人',
          costPrice: 1000,
          priceCoefficient: 1.6,
          price: 1600,
          priceSource: 'manual',
          sourceConfigurationId: undefined as number | undefined,
        },
      ],
    };
    await page.route('**/api/admin/finished-products', (route) =>
      route.fulfill({ json: { code: 0, data: [product] } }),
    );
    await page.route('**/api/admin/finished-products/price-level-options', (route) =>
      route.fulfill({
        json: { code: 0, data: levelEnabled ? [{ id: 4, name: '4级合伙人' }] : [] },
      }),
    );
    await page.route('**/api/admin/finished-markup-configurations/options', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data:
            coefficient == null
              ? []
              : [
                  {
                    id: 84,
                    storeLevelId: 4,
                    name: '4级合伙人',
                    priceCoefficient: coefficient,
                    status: 'enabled',
                  },
                ],
        },
      }),
    );
    const saves: {
      markupPrices: {
        skuId: number;
        price: number;
        priceCoefficient: number;
        priceSource: string;
        sourceConfigurationId?: number;
      }[];
    }[] = [];
    await page.route('**/api/admin/finished-products/91', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { code: 0, data: product } });
      const payload = route.request().postDataJSON();
      saves.push(payload);
      return route.fulfill({ json: { code: 0, data: { ...product, ...payload } } });
    });
    await page.goto('/finished-stock-management');
    await page.getByRole('row').filter({ hasText: product.name }).getByText('详情', { exact: true }).click();
    await expect(page.locator('.product-detail')).toBeVisible();
    await expect(page.locator('.product-detail thead')).not.toContainText('4级合伙人');
    await page.locator('.t-drawer:visible .t-drawer__close-btn').click();
    await page.getByText('价格', { exact: true }).click();
    const editor = page.locator('.product-price-editor');
    const firstLevel = editor.locator('tbody tr').nth(0).locator('td').nth(3);
    const missingLevel = editor.locator('tbody tr').nth(1).locator('td').nth(3);
    const zeroCostLevel = editor.locator('tbody tr').nth(2).locator('td').nth(3);
    await expect(editor.locator('thead')).not.toContainText('4级合伙人');
    await page.locator('.price-editor-footer').getByRole('button', { name: '取消', exact: true }).click();
    await expect(editor).not.toBeVisible();
    levelEnabled = true;
    await page.getByText('价格', { exact: true }).click();
    await expect(editor.locator('thead')).toContainText('4级合伙人');
    await expect(firstLevel.getByPlaceholder('价格', { exact: true })).toHaveValue('1600.00');
    // Configuration alone must not invent a price absent from the server response.
    await expect(missingLevel.getByPlaceholder('价格', { exact: true })).toHaveValue('');
    await page.locator('.price-editor-footer').getByRole('button', { name: '取消', exact: true }).click();
    await expect(editor).not.toBeVisible();
    if (coefficient != null) {
      product.markupPrices.push(
        ...product.variants.slice(1).map((variant) => ({
          skuId: variant.id,
          storeLevelId: 4,
          storeLevelName: '4级合伙人',
          costPrice: variant.costPrice,
          priceCoefficient: coefficient,
          price: variant.costPrice * coefficient,
          priceSource: 'auto',
          sourceConfigurationId: 84,
        })),
      );
    }
    await page.getByText('价格', { exact: true }).click();
    await expect(firstLevel.getByPlaceholder('价格', { exact: true })).toHaveValue('1600.00');
    await expect(firstLevel.getByPlaceholder('系数', { exact: true })).toHaveValue('1.60');
    await expect(firstLevel.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true })).toBeVisible();
    expect(saves).toHaveLength(0);
    if (coefficient == null) {
      await expect(missingLevel.getByPlaceholder('价格', { exact: true })).toHaveValue('');
      await expect(zeroCostLevel.getByPlaceholder('价格', { exact: true })).toHaveValue('');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await expect(page.getByText('请完善价格信息', { exact: true })).toBeVisible();
      await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
      expect(saves).toHaveLength(0);
      return;
    }
    await expect(missingLevel.getByPlaceholder('价格', { exact: true })).toHaveValue((2000 * coefficient).toFixed(2));
    await expect(zeroCostLevel.getByPlaceholder('价格', { exact: true })).toHaveValue('0.00');
    await expect(missingLevel.getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(editor).not.toBeVisible();
    expect(saves).toHaveLength(1);
    expect(saves[0].markupPrices).toEqual([
      expect.objectContaining({ skuId: 901, price: 1600, priceCoefficient: 1.6, priceSource: 'manual' }),
      expect.objectContaining({
        skuId: 902,
        price: 2000 * coefficient,
        priceCoefficient: coefficient,
        priceSource: 'auto',
        sourceConfigurationId: 84,
      }),
      expect.objectContaining({
        skuId: 903,
        price: 0,
        priceCoefficient: coefficient,
        priceSource: 'auto',
        sourceConfigurationId: 84,
      }),
    ]);
  });
}

test('switches empty and cleared select attributes to single mode without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page);
  await page.route('**/api/admin/finished-products/attribute-template-options', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: [
          {
            categoryId: 5,
            content: [
              {
                attributeId: 2,
                name: '颜色',
                valueType: 'select',
                attributeRole: 'sales',
                skuFlag: true,
                sortOrder: 1,
                options: [{ id: 21, value: '白色' }],
              },
              {
                attributeId: 3,
                name: '尺寸',
                valueType: 'input',
                attributeRole: 'sales',
                skuFlag: true,
                sortOrder: 2,
                options: [],
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto('/supply-chain/finished-stock-management');
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const picker = page.getByTestId('finished-category-picker');
  for (const name of ['成品现货', '餐桌', '石材餐桌', '奢石餐桌'])
    await picker.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: '确认，下一步' }).click();
  await page.getByRole('button', { name: '创建规格', exact: true }).click();
  const dialog = page.locator('.spec-dialog');
  const singles = dialog.getByPlaceholder('请输入规格文本，如 1500*800*750mm');
  await switchSpecMode(page, 'layered', false);
  for (const name of ['颜色', '尺寸']) await dialog.locator('.spec-attr-tag').getByText(name, { exact: true }).click();
  const color = dialog.locator('.spec-group').filter({ hasText: '颜色' });
  const size = dialog.locator('.spec-group').filter({ hasText: '尺寸' });
  await switchSpecMode(page, 'single');
  await expect(singles).toHaveValue('');
  await switchSpecMode(page, 'layered', false);
  for (const name of ['颜色', '尺寸']) await dialog.locator('.spec-attr-tag').getByText(name, { exact: true }).click();
  await color.getByPlaceholder('请选择属性值').click();
  await page.getByRole('listitem', { name: '白色', exact: true }).click();
  await color.locator('.t-select').hover();
  await color.locator('.t-input__suffix-clear').click();
  await expect(color.getByPlaceholder('请选择属性值')).toHaveValue('');
  await switchSpecMode(page, 'single');
  await expect(singles).toHaveValue('');
  await switchSpecMode(page, 'layered', false);
  for (const name of ['颜色', '尺寸']) await dialog.locator('.spec-attr-tag').getByText(name, { exact: true }).click();
  await dialog.getByRole('button', { name: '确认创建', exact: true }).click();
  await expect(dialog.locator('.t-alert')).toContainText('请填写所有规格属性值后再确认创建');
  await size.getByPlaceholder('请输入属性值').fill('大号');
  await switchSpecMode(page, 'single');
  await expect(singles).toHaveValue('');
  expect(errors).toEqual([]);
});

test('clears unsaved specification drafts on mode changes and preserves confirmation and reset rules', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page);
  await page.route('**/api/admin/finished-products/attribute-template-options', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: [
          {
            categoryId: 5,
            content: ['尺寸', '颜色'].map((name, index) => ({
              attributeId: index + 2,
              name,
              valueType: 'input',
              attributeRole: 'sales',
              skuFlag: true,
              sortOrder: index,
              options: [],
            })),
          },
        ],
      },
    }),
  );
  await page.goto('/supply-chain/finished-stock-management');
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const picker = page.getByTestId('finished-category-picker');
  for (const name of ['成品现货', '餐桌', '石材餐桌', '奢石餐桌'])
    await picker.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: '确认，下一步' }).click();
  await page.getByRole('button', { name: '创建规格', exact: true }).click();
  const dialog = page.locator('.spec-dialog');
  const singles = dialog.getByPlaceholder('请输入规格文本，如 1500*800*750mm');
  const size = dialog.locator('.spec-group').filter({ hasText: '尺寸' });
  const color = dialog.locator('.spec-group').filter({ hasText: '颜色' });
  await singles.fill('大号 白色');
  await dialog.getByText('分层展示：选择标准属性构建规格', { exact: true }).click();
  const confirmation = page.locator('.t-dialog:visible').filter({ hasText: '本次切换将清空已填写的规格数据' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(singles).toHaveValue('大号 白色');
  await switchSpecMode(page, 'layered');
  await expect(dialog.locator('.spec-attr-tag.active')).toHaveCount(0);
  await expect(dialog.getByTestId('spec-combination-editor')).toHaveCount(0);
  for (const name of ['尺寸', '颜色']) await dialog.locator('.spec-attr-tag').getByText(name, { exact: true }).click();
  await expect(size.getByPlaceholder('请输入属性值')).toHaveValue('');
  await expect(color.getByPlaceholder('请输入属性值')).toHaveValue('');
  await size.getByPlaceholder('请输入属性值').fill('大号');
  await color.getByPlaceholder('请输入属性值').fill('白色');
  // Deselect/reselect also clears just that dimension's input.
  const colorTag = dialog.locator('.spec-attr-tag').getByText('颜色', { exact: true });
  await colorTag.click();
  await colorTag.click();
  await expect(color.getByPlaceholder('请输入属性值')).toHaveValue('');
  await expect(size.getByPlaceholder('请输入属性值')).toHaveValue('大号');
  await switchSpecMode(page, 'single');
  await expect(singles).toHaveCount(1);
  await expect(singles).toHaveValue('');
  await singles.fill('重新填写');
  await switchSpecMode(page, 'layered');
  await expect(dialog.locator('.spec-group')).toHaveCount(0);
  await dialog.getByRole('button', { name: '重置', exact: true }).click();
  await expect(singles).toHaveCount(1);
  await expect(singles).toHaveValue('');
  // Empty and whitespace-only specifications still switch without confirmation.
  for (const emptyText of ['', '   ']) {
    await singles.fill(emptyText);
    await switchSpecMode(page, 'layered', false);
    await switchSpecMode(page, 'single');
    await expect(singles).toHaveValue('');
  }
  await singles.fill('新规格');
  await dialog.getByRole('button', { name: '确认创建', exact: true }).click();
  const table = page.locator('.spec-table-block');
  await table.getByPlaceholder('价格', { exact: true }).fill('30');
  await table.locator('.quantity-editor input').fill('4');
  await page.getByRole('button', { name: '编辑规格', exact: true }).click();
  await switchSpecMode(page, 'layered');
  await dialog.locator('.spec-attr-tag').getByText('尺寸', { exact: true }).click();
  await size.getByPlaceholder('请输入属性值').fill('新规格');
  await dialog.getByRole('button', { name: '确认创建', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.getByPlaceholder('价格', { exact: true })).toHaveValue('');
  await expect(table.locator('.quantity-editor input')).toHaveValue('');
});

async function openSpecConversionFixture(
  page: Page,
  mode: 'single' | 'layered',
  dimensions = ['颜色', '尺寸'],
  extraAttributes: Record<string, string> = {},
) {
  await page.addInitScript(() => localStorage.setItem('zdm-admin-token', 'dev-token'));
  await installFinishedMocks(page);
  const product = {
    id: 95,
    categoryId: 5,
    supplierId: 2,
    name: '规格转换商品',
    status: 'warehouse',
    totalStock: 5,
    mainImageMediaId: 1,
    mainImageMediaIds: [1],
    videoMediaId: 2,
    detail: '<p>保留商品详情</p>',
    attributes: [],
    specDimensions:
      mode === 'layered'
        ? [
            { key: 'attribute_2', name: '颜色', values: ['白色', '黑色'] },
            { key: 'attribute_3', name: '尺寸', values: ['大号', '小号'] },
          ]
        : [],
    variants: [0, 1].map((index) => ({
      id: 951 + index,
      displayMode: mode,
      variantLabel: index === 0 ? '标准款' : '加长款',
      costPrice: (index + 1) * 10,
      stock: index + 2,
      salesAttributes: {
        ...(mode === 'layered'
          ? { attribute_2: index === 0 ? '白色' : '黑色', attribute_3: index === 0 ? '大号' : '小号' }
          : {}),
        ...extraAttributes,
      },
    })),
  };
  await page.route('**/api/admin/finished-products', (route) => route.fulfill({ json: { code: 0, data: [product] } }));
  await page.route('**/api/admin/finished-products/95', (route) =>
    route.fulfill({ json: { code: 0, data: { ...product, ...route.request().postDataJSON() } } }),
  );
  await page.route('**/api/admin/finished-products/price-level-options', (route) =>
    route.fulfill({ json: { code: 0, data: [] } }),
  );
  await page.route('**/api/admin/finished-products/attribute-template-options', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: [
          {
            categoryId: 5,
            content: dimensions.map((name, index) => ({
              attributeId: index + 2,
              name,
              valueType: 'input',
              attributeRole: 'sales',
              skuFlag: true,
              sortOrder: index,
              options: [],
            })),
          },
        ],
      },
    }),
  );
  await page.goto('/supply-chain/finished-stock-management');
  await page.getByText('编辑', { exact: true }).first().click();
  await page.getByRole('button', { name: '编辑规格', exact: true }).click();
  return page.locator('.spec-dialog');
}

async function switchSpecMode(page: Page, mode: 'single' | 'layered', expectConfirmation = mode === 'layered') {
  const label = mode === 'single' ? '单层展示：自定义填写规格' : '分层展示：选择标准属性构建规格';
  const dialog = page.locator('.spec-dialog');
  await dialog.getByText(label, { exact: true }).click();
  if (expectConfirmation) {
    await expect(page.getByText(/您正在从【单层展示】切换至【分层展示】/)).toBeVisible();
    await page.getByRole('button', { name: '确认切换', exact: true }).click();
  }
  await expect(dialog.getByRole('radio', { name: label, exact: true })).toBeChecked();
  await expect(dialog.locator('.t-alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认切换', exact: true })).toHaveCount(0);
}

for (const originalMode of ['single', 'layered'] as const) {
  test(`clears saved ${originalMode} specifications on mode change and restores only on reset or cancel`, async ({
    page,
  }) => {
    const dialog = await openSpecConversionFixture(page, originalMode, ['颜色', '尺寸', '说明'], {
      attribute_4: '原规格说明',
    });
    const targetMode = originalMode === 'single' ? 'layered' : 'single';
    const singles = dialog.getByPlaceholder('请输入规格文本，如 1500*800*750mm');
    const table = page.locator('.spec-table-block');
    const expectBlank = async () => {
      if (targetMode === 'single') {
        await expect(singles).toHaveCount(1);
        await expect(singles).toHaveValue('');
      } else {
        await expect(dialog.locator('.spec-group')).toHaveCount(0);
        await expect(dialog.locator('.spec-attr-tag.active')).toHaveCount(0);
      }
      await expect(dialog.getByTestId('spec-combination-editor')).toHaveCount(0);
    };
    await switchSpecMode(page, targetMode);
    await expectBlank();
    await dialog.getByRole('button', { name: '重置', exact: true }).click();
    if (originalMode === 'single') {
      await expect(singles).toHaveCount(2);
      await expect(singles.first()).toHaveValue('标准款');
      await expect(singles.nth(1)).toHaveValue('加长款');
    } else {
      await expect(dialog.locator('.spec-group-title')).toHaveText(['颜色', '尺寸']);
      await expect(dialog.locator('.spec-group').first().getByPlaceholder('请输入属性值').first()).toHaveValue('白色');
    }
    await switchSpecMode(page, targetMode);
    await expectBlank();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(table.getByPlaceholder('价格', { exact: true }).nth(0)).toHaveValue('10.00');
    await expect(table.getByPlaceholder('价格', { exact: true }).nth(1)).toHaveValue('20.00');
    await page.getByRole('button', { name: '编辑规格', exact: true }).click();
    await switchSpecMode(page, targetMode);
    await expectBlank();
    // Re-enter matching old values: switching mode must not revive old SKU data.
    if (targetMode === 'single') await singles.fill('标准款');
    else {
      for (const [name, value] of [
        ['颜色', '白色'],
        ['尺寸', '大号'],
      ]) {
        await dialog.locator('.spec-attr-tag').getByText(name, { exact: true }).click();
        await dialog.locator('.spec-group').filter({ hasText: name }).getByPlaceholder('请输入属性值').fill(value);
      }
    }
    await dialog.getByRole('button', { name: '确认创建', exact: true }).click();
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table.getByPlaceholder('价格', { exact: true })).toHaveValue('');
    await expect(table.locator('.quantity-editor input')).toHaveValue('');
    await table.getByPlaceholder('价格', { exact: true }).fill('30');
    await table.locator('.quantity-editor input').fill('1');
    const requestPromise = page.waitForRequest(
      (request) => request.url().endsWith('/finished-products/95') && request.method() === 'PUT',
    );
    await page.getByRole('button', { name: '提交商品信息', exact: true }).click();
    const variants = (await requestPromise).postDataJSON().variants;
    expect(variants).toHaveLength(1);
    expect(variants[0]).not.toHaveProperty('id');
    expect(variants[0]).toMatchObject({ displayMode: targetMode, costPrice: 30, stock: 1 });
    expect(variants[0].salesAttributes.attribute_4).toBe('');
  });
}

test('preserves sparse SKU identities and values when editing without changing display mode', async ({ page }) => {
  const dialog = await openSpecConversionFixture(page, 'layered');
  const color = dialog.locator('.spec-group').filter({ hasText: '颜色' });
  const size = dialog.locator('.spec-group').filter({ hasText: '尺寸' });
  await color.getByPlaceholder('请输入属性值').first().fill('未确认颜色');
  await size.locator('.spec-group-head').dragTo(color.locator('.spec-group-head'));
  await expect(dialog.locator('.spec-group-title')).toHaveText(['尺寸', '颜色']);
  await dialog.getByRole('button', { name: '重置', exact: true }).click();
  await expect(dialog.locator('.spec-group-title')).toHaveText(['颜色', '尺寸']);
  await expect(color.getByPlaceholder('请输入属性值').first()).toHaveValue('白色');
  await color.getByPlaceholder('请输入属性值').first().fill('米白色');
  await dialog.getByRole('button', { name: '确认创建', exact: true }).click();
  await expect(page.locator('.spec-table-block tbody tr')).toHaveCount(2);
  const requestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/finished-products/95') && request.method() === 'PUT',
  );
  await page.getByRole('button', { name: '提交商品信息', exact: true }).click();
  const variants = (await requestPromise).postDataJSON().variants;
  expect(variants).toEqual([
    expect.objectContaining({
      id: 951,
      costPrice: 10,
      stock: 2,
      salesAttributes: { attribute_2: '米白色', attribute_3: '大号' },
    }),
    expect.objectContaining({
      id: 952,
      costPrice: 20,
      stock: 3,
      salesAttributes: { attribute_2: '黑色', attribute_3: '小号' },
    }),
  ]);
});

test('rebuilds eight distinct specifications from three edited dimensions without old duplicate bindings', async ({
  page,
}) => {
  const dimensions = ['颜色', '尺寸', '材质'];
  const dialog = await openSpecConversionFixture(page, 'single', dimensions);
  await switchSpecMode(page, 'layered');
  for (const [index, name] of dimensions.entries()) {
    await dialog.locator('.spec-attr-tag').getByText(name, { exact: true }).click();
    const group = dialog.locator('.spec-group').filter({ hasText: name });
    await group.getByPlaceholder('请输入属性值').fill(`${index + 1}甲`);
    await group.getByRole('button', { name: '新增属性值', exact: true }).click();
    await group
      .getByPlaceholder('请输入属性值')
      .nth(1)
      .fill(`${index + 1}乙`);
  }
  await expect(dialog.getByTestId('spec-combination-editor')).toHaveCount(0);
  await dialog.getByRole('button', { name: '确认创建', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const table = page.locator('.spec-table-block');
  await expect(table.locator('tbody tr')).toHaveCount(8);
  // Unknown old labels cannot transfer old SKU prices or stock to an arbitrary new combination.
  for (const row of await table.locator('tbody tr').all()) {
    await expect(row.getByPlaceholder('价格', { exact: true })).toHaveValue('');
    await expect(row.locator('.quantity-editor input')).toHaveValue('');
  }
  for (const row of await table.locator('tbody tr').all()) {
    await row.getByPlaceholder('价格', { exact: true }).fill('30');
    await row.locator('.quantity-editor input').fill('1');
  }
  const requestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/finished-products/95') && request.method() === 'PUT',
  );
  await page.getByRole('button', { name: '提交商品信息', exact: true }).click();
  const variants = (await requestPromise).postDataJSON().variants;
  expect(variants).toHaveLength(8);
  const combinations = variants.map((variant: { salesAttributes: Record<string, string> }) =>
    JSON.stringify(variant.salesAttributes),
  );
  expect(new Set(combinations).size).toBe(8);
});

test('retains matched specification attributes and SKU data when adding and removing attribute values', async ({
  page,
}) => {
  const dialog = await openSpecConversionFixture(page, 'layered', ['颜色', '尺寸', '说明'], {
    attribute_4: '原规格说明',
  });
  const size = dialog.locator('.spec-group').filter({ hasText: '尺寸' });
  await size.getByRole('button', { name: '新增属性值', exact: true }).last().click();
  await size.getByPlaceholder('请输入属性值').nth(2).fill('中号');
  await dialog.getByRole('button', { name: '重置', exact: true }).click();
  await expect(size.getByPlaceholder('请输入属性值')).toHaveCount(2);
  await size.getByRole('button', { name: '新增属性值', exact: true }).last().click();
  await size.getByPlaceholder('请输入属性值').nth(2).fill('中号');
  await dialog.getByRole('button', { name: '确认创建', exact: true }).click();
  const table = page.locator('.spec-table-block');
  await expect(table.locator('tbody tr')).toHaveCount(6);
  await page.getByRole('button', { name: '编辑规格', exact: true }).click();
  await size.locator('.layered-value-row').nth(2).getByRole('button').first().click();
  await dialog.getByRole('button', { name: '确认创建', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(4);
  for (const row of await table.locator('tbody tr').all()) {
    if ((await row.getByPlaceholder('价格', { exact: true }).inputValue()) === '') {
      await row.getByPlaceholder('价格', { exact: true }).fill('30');
      await row.locator('.quantity-editor input').fill('1');
    }
  }
  const requestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/finished-products/95') && request.method() === 'PUT',
  );
  await page.getByRole('button', { name: '提交商品信息', exact: true }).click();
  const variants = (await requestPromise).postDataJSON().variants;
  expect(variants).toHaveLength(4);
  expect(variants).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 951,
        costPrice: 10,
        stock: 2,
        salesAttributes: { attribute_2: '白色', attribute_3: '大号', attribute_4: '原规格说明' },
      }),
      expect.objectContaining({
        id: 952,
        costPrice: 20,
        stock: 3,
        salesAttributes: { attribute_2: '黑色', attribute_3: '小号', attribute_4: '原规格说明' },
      }),
    ]),
  );
  expect(variants.filter((variant: { id?: number }) => variant.id)).toHaveLength(2);
});

test('prefills corresponding non-dimension attributes when a saved specification splits into new combinations', async ({
  page,
}) => {
  const dialog = await openSpecConversionFixture(page, 'layered', ['颜色', '尺寸', '材质', '说明'], {
    attribute_5: '对应的原属性值',
  });
  await dialog.locator('.spec-attr-tag').getByText('材质', { exact: true }).click();
  const material = dialog.locator('.spec-group').filter({ hasText: '材质' });
  await material.getByPlaceholder('请输入属性值').fill('石材');
  await material.getByRole('button', { name: '新增属性值', exact: true }).click();
  await material.getByPlaceholder('请输入属性值').nth(1).fill('木材');
  await dialog.getByRole('button', { name: '确认创建', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const table = page.locator('.spec-table-block');
  await expect(table.locator('tbody tr')).toHaveCount(8);
  for (const row of await table.locator('tbody tr').all()) {
    await expect(row.getByPlaceholder('价格', { exact: true })).toHaveValue('');
    await expect(row.locator('.quantity-editor input')).toHaveValue('');
    await row.getByPlaceholder('价格', { exact: true }).fill('30');
    await row.locator('.quantity-editor input').fill('1');
  }
  const requestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/finished-products/95') && request.method() === 'PUT',
  );
  await page.getByRole('button', { name: '提交商品信息', exact: true }).click();
  const variants = (await requestPromise).postDataJSON().variants;
  expect(variants).toHaveLength(8);
  for (const variant of variants) {
    const attributes = variant.salesAttributes;
    const correspondsToOriginal =
      (attributes.attribute_2 === '白色' && attributes.attribute_3 === '大号') ||
      (attributes.attribute_2 === '黑色' && attributes.attribute_3 === '小号');
    expect(attributes.attribute_5).toBe(correspondsToOriginal ? '对应的原属性值' : '');
    expect(variant).not.toHaveProperty('id');
    expect(variant.stock).toBe(1);
  }
});
