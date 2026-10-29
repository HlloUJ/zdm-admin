import { productWarehouseUrl } from './product-test-navigation';
import { expectStandardImagePreviewAndDismiss } from './image-preview-assertions';
import { checkDecimalEditing } from './decimal-editing';
import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

test.beforeEach(async ({ page }) => {
  await installAdminApiMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        clientCode: 'supply-chain',
        name: '大板发布测试',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });
  await page.goto(productWarehouseUrl('/supply-chain/slab-management'));
});

test('发布直接进入三段整页表单，导航固定且返回保留列表状态', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.status-tabs .t-tabs__nav-item').filter({ hasText: '已上架' }).click();
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const form = page.locator('.slab-publish-page');
  await expect(form).toBeVisible();
  await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
  await expect(form.getByRole('heading', { level: 2 })).toHaveText(['图文描述', '基础信息', '销售信息']);
  for (const title of await form.locator('.form-section-title').all()) {
    await expect(title).toHaveCSS('font-size', '18px');
    await expect(title).toHaveCSS('line-height', '26px');
    await expect(title).toHaveCSS('font-weight', '400');
    await expect(title).toHaveCSS('margin-top', '24px');
    await expect(title).toHaveCSS('margin-bottom', '20px');
  }
  await expect(form.locator('.t-breadcrumb')).toHaveCount(0);
  const grid = form.locator('.publish-base-grid');
  await expect(grid).toHaveCSS('row-gap', '24px');
  await expect(grid).toHaveCSS('column-gap', '32px');
  for (const item of await grid.locator(':scope > .t-form__item').all())
    await expect(item).toHaveCSS('margin-bottom', '0px');
  const card = form.locator('.t-upload__card-container').first();
  const frame = await card.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.width, height: style.height, radius: style.borderRadius, border: style.borderTopStyle };
  });
  expect(frame).toEqual({ width: '110px', height: '110px', radius: '3px', border: 'dashed' });
  const sales = form.locator('#slab-product-sales');
  await expect(sales.locator('.t-form__label')).toHaveText([/成本价/, /供应商/, /库存/, /大板编号/, /上架/]);
  await expect(sales.locator('.t-form-item__cost').getByRole('textbox')).toHaveCount(1);
  await checkDecimalEditing(sales.locator('.t-form-item__cost input'));
  await expect(sales.locator('.price-editor')).toHaveCount(0);
  await expect(form.getByRole('navigation').getByRole('link')).toHaveText(['图文描述', '基础信息', '销售信息']);
  await expect(form.getByText('当前分类', { exact: false })).toHaveCount(0);
  await expect(form.getByText('选择商品分类', { exact: true })).toHaveCount(0);
  await expect(form.locator('input[type="file"]')).toHaveCount(4);
  await form.getByRole('link', { name: '销售信息', exact: true }).click();
  await expect(form.getByRole('link', { name: '销售信息', exact: true })).toHaveAttribute('aria-current', 'location');
  await expect(form.getByRole('radio', { name: '暂不上架', exact: true })).toBeChecked();
  await expect(form.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true })).toBeInViewport();
  await expect(form.getByRole('navigation')).toBeInViewport();
  expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
  await form.getByRole('button', { name: '返回列表', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.locator('.status-tabs .t-tabs__nav-item').filter({ hasText: '已上架' })).toHaveClass(/t-is-active/);
});

test('缺少必填媒体时回到图文描述并保留已填内容', async ({ page }) => {
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const form = page.locator('.slab-publish-page');
  await form.getByRole('link', { name: '销售信息', exact: true }).click();
  await form.locator('.t-form-item__sku').getByRole('textbox').fill('KEEP-SLAB-01');
  const cost = form.locator('.t-form-item__cost');
  const originalCostHeight = await cost.evaluate((element) => element.getBoundingClientRect().height);
  const originalSupplierOffset = await form
    .locator('.t-form-item__supplier')
    .evaluate((element) => element.getBoundingClientRect().top - element.closest('form')!.getBoundingClientRect().top);
  await form.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true }).click();
  await expect(cost.getByText('请输入成本价', { exact: true })).toHaveCount(1);
  expect(await cost.evaluate((element) => element.getBoundingClientRect().height)).toBe(originalCostHeight);
  expect(
    await form
      .locator('.t-form-item__supplier')
      .evaluate(
        (element) => element.getBoundingClientRect().top - element.closest('form')!.getBoundingClientRect().top,
      ),
  ).toBe(originalSupplierOffset);
  await expect(page.locator('.zdm-admin-feedback')).toHaveText('表单校验未通过，请检查标红字段');
  await expect(form.getByRole('link', { name: '图文描述', exact: true })).toHaveAttribute('aria-current', 'location');
  await expect(form.locator('.admin-media-upload--invalid').first()).toBeInViewport();
  await expect(form.locator('.t-form-item__sku').getByRole('textbox')).toHaveValue('KEEP-SLAB-01');
  for (const [field, message] of [
    ['variety', '请选择品种'],
    ['origin', '请选择产地'],
    ['textureId', '请选择纹理'],
    ['colorId', '请选择色系'],
    ['gradeId', '请选择等级'],
    ['length', '请输入长度'],
    ['width', '请输入宽度'],
    ['height', '请输入高度'],
    ['supplier', '请选择供应商'],
    ['stock', '请输入库存'],
  ]) {
    const item = form.locator(`.t-form-item__${field}`);
    await expect(item.locator('.t-form__controls')).toHaveClass(/t-is-error/);
    await expect(item.getByText(message, { exact: true })).toHaveCount(1);
  }
  await expect(form.getByRole('radio', { name: '暂不上架', exact: true })).toBeChecked();
});

test('供应链编辑复用发布页三段表单并回填数据', async ({ page }) => {
  await page
    .getByRole('row', { name: /雪花白大板 06/ })
    .getByText('编辑', { exact: true })
    .click();
  const dialog = page.locator('.slab-publish-page');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(['图文描述', '基础信息', '销售信息']);
  await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
  await dialog.getByRole('link', { name: '销售信息', exact: true }).click();
  await expect(dialog.locator('.t-form-item__cost input')).toHaveValue('6800.00');
  await expect(dialog.locator('.t-form-item__cost').getByRole('textbox')).toHaveCount(1);
  await expect(dialog.getByText('价格系数', { exact: true })).toHaveCount(0);
});

test('已上传视频点击空白区域打开播放器，删除后才允许重新上传', async ({ page }) => {
  const videoSlab = {
    id: 6,
    name: '视频大板',
    status: 'warehouse',
    sourceStatus: 'warehouse',
    mainImageUrl: '/test-slab.png',
    mainImageMediaId: 41,
    videoUrl: '/test-slab.mp4',
    videoMediaId: 42,
  };
  await page.route('**/api/admin/slabs', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: [videoSlab],
      },
    }),
  );
  await page.route('**/api/admin/slabs/6', (route) => route.fulfill({ json: { code: 0, data: videoSlab } }));
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 500 });
  await page
    .getByRole('row', { name: /视频大板/ })
    .getByText('编辑', { exact: true })
    .click();
  const dialog = page.locator('.slab-publish-page');
  const image = dialog.getByRole('button', { name: '1:1主图', exact: true });
  await image.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const scrollBeforeImagePreview = await page.evaluate(() => window.scrollY);
  expect(scrollBeforeImagePreview).toBeGreaterThan(0);
  await image.click();
  const imagePreview = page.locator('.t-dialog:visible').filter({ has: page.locator('img.upload-large-preview') });
  await expect(imagePreview.locator('img.upload-large-preview')).toHaveAttribute('src', '/test-slab.png');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBeforeImagePreview);
  await expectStandardImagePreviewAndDismiss(page, imagePreview);
  await expect(imagePreview).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBeforeImagePreview);
  const box = dialog.locator('.admin-media-upload[aria-label="播放商品视频"]');
  await box.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const scrollBeforePreview = await page.evaluate(() => window.scrollY);
  expect(scrollBeforePreview).toBeGreaterThan(0);
  let choosers = 0;
  page.on('filechooser', () => choosers++);
  await box.click({ position: { x: 8, y: 80 } });
  const player = page.locator('video.upload-large-preview');
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute('src', '/test-slab.mp4');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBeforePreview);
  expect(choosers).toBe(0);
  await page.locator('.t-dialog:visible').filter({ has: player }).locator('.t-dialog__close').click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBeforePreview);
  await box.hover();
  await box.locator('.t-icon-delete').click();
  await expect(box.locator('.t-icon-delete')).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser');
  await box.click({ position: { x: 8, y: 80 } });
  await chooser;
  expect(choosers).toBe(1);
});

test('发布尺寸实时计算只读面积，误差位于下一行', async ({ page }) => {
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const form = page.locator('.slab-publish-page');
  await form.getByRole('link', { name: '基础信息', exact: true }).click();
  const dimensions = form.locator('.dimension-grid');
  const area = dimensions.locator('.t-form-item__area input');
  await expect(area).toBeDisabled();
  await expect(area).toHaveAttribute('placeholder', '');
  await expect(area).toHaveValue('');
  await dimensions.locator('.t-form-item__length input').fill('3000');
  await dimensions.locator('.t-form-item__width input').fill('2000');
  await expect(area).toHaveValue('6.00');
  await dimensions.locator('.t-form-item__height input').fill('20');
  await expect(area).toHaveValue('6.00');
  await dimensions.locator('.t-form-item__width input').fill('1700');
  await expect(area).toHaveValue('5.10');
  const areaBox = await dimensions.locator('.t-form-item__area').boundingBox();
  const toleranceBox = await dimensions.locator('.t-form-item__tolerance').boundingBox();
  expect(toleranceBox!.y).toBeGreaterThan(areaBox!.y);
  await dimensions.locator('.t-form-item__width input').fill('');
  await expect(area).toHaveValue('');
});

test('供应链大板库存禁止零值输入而保留正常整数和清空校验', async ({ page }) => {
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const item = page.locator('.slab-publish-page .t-form-item__stock');
  const stock = item.getByPlaceholder('请输入库存', { exact: true });
  await stock.click();
  await stock.pressSequentially('0');
  await expect(stock).toHaveValue('');
  await stock.pressSequentially('10');
  await expect(stock).toHaveValue('10');
  const rejected = await stock.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.select();
    const data = new DataTransfer();
    data.setData('text/plain', '0');
    return !input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  expect(rejected).toBe(true);
  await expect(stock).toHaveValue('10');
  await stock.fill('1');
  await stock.press('ArrowDown');
  await expect(stock).toHaveValue('1');
  await stock.fill('');
  await page.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true }).click();
  await expect(item.getByText('请输入库存', { exact: true })).toBeVisible();
});
