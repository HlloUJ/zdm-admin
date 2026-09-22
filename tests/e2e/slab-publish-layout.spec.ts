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
  await page.goto('/supply-chain/slab-management');
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
  await expect(form.locator('.t-breadcrumb')).toContainText('大板管理');
  await expect(form.locator('.t-breadcrumb')).toContainText('发布商品');
  const sales = form.locator('#slab-product-sales');
  await expect(sales.locator('.t-form__label')).toHaveText([/成本价/, /供应商/, /库存/, /大板编号/, /上架/]);
  await expect(sales.locator('.t-form-item__cost').getByRole('textbox')).toHaveCount(1);
  await expect(sales.locator('.price-editor')).toHaveCount(0);
  await expect(form.getByRole('navigation').getByRole('link')).toHaveText(['图文描述', '基础信息', '销售信息']);
  await expect(form.getByText('当前分类', { exact: false })).toHaveCount(0);
  await expect(form.getByText('选择商品分类', { exact: true })).toHaveCount(0);
  await expect(form.locator('input[type="file"]')).toHaveCount(4);
  await form.getByRole('link', { name: '销售信息', exact: true }).click();
  await expect(form.getByRole('link', { name: '销售信息', exact: true })).toHaveAttribute('aria-current', 'location');
  await expect(form.getByRole('radio', { name: '暂不上架', exact: true })).toBeChecked();
  await expect(form.getByRole('button', { name: '提交商品信息', exact: true })).toBeInViewport();
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
  await form.getByRole('button', { name: '提交商品信息', exact: true }).click();
  await expect(page.getByText('请上传必填图片', { exact: true })).toBeVisible();
  await expect(form.getByRole('link', { name: '图文描述', exact: true })).toHaveAttribute('aria-current', 'location');
  await expect(form.getByRole('heading', { name: '图文描述', exact: true })).toBeInViewport();
  await expect(form.locator('.t-form-item__sku').getByRole('textbox')).toHaveValue('KEEP-SLAB-01');
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
  await page.route('**/api/admin/slabs', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: [
          {
            id: 6,
            name: '视频大板',
            status: 'warehouse',
            sourceStatus: 'warehouse',
            videoUrl: '/test-slab.mp4',
            videoMediaId: 42,
          },
        ],
      },
    }),
  );
  await page.reload();
  await page
    .getByRole('row', { name: /视频大板/ })
    .getByText('编辑', { exact: true })
    .click();
  const dialog = page.locator('.slab-publish-page');
  const box = dialog.locator('.admin-media-upload').filter({ hasText: '商品视频' });
  let choosers = 0;
  page.on('filechooser', () => choosers++);
  await box.click({ position: { x: 8, y: 80 } });
  const player = page.locator('video.upload-large-preview');
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute('src', '/test-slab.mp4');
  expect(choosers).toBe(0);
  await page.locator('.t-dialog:visible').filter({ has: player }).locator('.t-dialog__close').click();
  await box.getByRole('button', { name: '删除', exact: true }).click();
  await expect(box.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
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
