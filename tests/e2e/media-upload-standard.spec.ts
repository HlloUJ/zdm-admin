import { expectStandardImagePreviewAndDismiss } from './image-preview-assertions';
import { expect, test } from '@playwright/test';
import { installAdminApiMocks, setMockBusinessClient } from './admin-api-mocks';

const image =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="blue"/></svg>',
  ).toString('base64');
const file = {
  name: 'image.svg',
  mimeType: 'image/svg+xml',
  buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        clientCode: localStorage.getItem('zdm-e2e-client') ?? 'admin',
        name: '上传回归',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });
  await installAdminApiMocks(page);
});
for (const client of ['supply-chain'] as const) {
  test(`${client} slab uses shared native cards and keeps only its three images required`, async ({ page }) => {
    await setMockBusinessClient(page, client);
    await page.route('**/api/admin/slabs/images**', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data:
            route.request().method() === 'DELETE'
              ? true
              : { id: 501, mediaType: 'image', url: image, mimeType: 'image/svg+xml' },
        },
      }),
    );
    await page.goto('/supply-chain/slab-management');
    await page.getByRole('button', { name: '发布商品', exact: true }).click();
    const form = page.locator('.slab-publish-page');
    const cards = form.locator('.admin-media-upload.t-upload');
    await expect(cards).toHaveCount(4);
    await page.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true }).click();
    await expect(form.locator('.admin-media-upload--invalid')).toHaveCount(3);
    await expect(cards.last()).not.toHaveClass(/--invalid/);
    await cards.first().locator('input[type="file"]').setInputFiles(file);
    await expect(form.locator('.admin-media-upload--invalid')).toHaveCount(2);
    await expect(cards.first().locator('.t-upload__card-image img')).toHaveAttribute('src', image);
    const released = page.waitForRequest(
      (request) => request.method() === 'DELETE' && request.url().endsWith('/slabs/images?mediaId=501'),
    );
    await cards.first().hover();
    await cards.first().locator('.t-icon-delete').click();
    await released;
    await expect(cards.first().locator('.t-upload__image-add')).toBeVisible();
  });
}

test('craft image retains required validation, preview and cancellation release with native Upload', async ({
  page,
}) => {
  await setMockBusinessClient(page, 'admin');
  await page.route('**/api/admin/crafts/images**', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data:
          route.request().method() === 'DELETE'
            ? true
            : { id: 601, mediaType: 'image', url: image, mimeType: 'image/svg+xml' },
      },
    }),
  );
  await page.goto('/finished-stock-craft');
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  const upload = dialog.locator('.admin-media-upload.t-upload');
  await expect(upload).toHaveCount(1);
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(dialog.getByText('请上传工艺图片', { exact: true })).toBeVisible();
  const errorColor = await dialog
    .getByText('请上传工艺图片', { exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  await expect(upload.locator('.t-upload__card-container')).toHaveCSS('border-top-color', errorColor);
  await upload.locator('input[type="file"]').setInputFiles(file);
  await expect(dialog.getByText('请上传工艺图片', { exact: true })).toHaveCount(0);
  await upload.click({ position: { x: 8, y: 80 } });
  const preview = page.locator('.t-dialog:visible').filter({ has: page.locator('img.image-preview__img') });
  await expectStandardImagePreviewAndDismiss(page, preview);
  await expect(dialog).toBeVisible();
  await upload.click({ position: { x: 8, y: 80 } });
  await expect(preview).toBeVisible();
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await expectStandardImagePreviewAndDismiss(page, preview);
  await page.setViewportSize(originalViewport);
  await expect(dialog).toBeVisible();
  const released = page.waitForRequest(
    (request) => request.method() === 'DELETE' && request.url().endsWith('/crafts/images?mediaId=601'),
  );
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await released;
});

test('operations slab retains read-only image/video cards and the stored video cover', async ({ page }) => {
  await setMockBusinessClient(page, 'admin');
  const slab = {
    id: 6,
    name: '只读媒体大板',
    status: 'warehouse',
    sourceStatus: 'selling',
    stock: 1,
    costPrice: 100,
    guidePrice: 200,
    mainImageMediaId: 1,
    mainImageUrl: image,
    scanImageMediaId: 2,
    scanImageUrl: image,
    designImageMediaId: 3,
    designImageUrl: image,
    videoMediaId: 4,
    videoUrl: '/test-slab.mp4',
    videoCoverMediaId: 5,
    videoCoverUrl: image,
  };
  await page.route('**/api/admin/slabs', (route) => route.fulfill({ json: { code: 0, data: [slab] } }));
  await page.route('**/api/admin/slabs/6', (route) => route.fulfill({ json: { code: 0, data: slab } }));
  await page.goto('/slab-management');
  await expect(page.getByRole('button', { name: '发布商品', exact: true })).toHaveCount(0);
  await page.getByRole('main').locator('.table-actions').getByText('编辑', { exact: true }).click();
  const form = page.locator('.slab-publish-page');
  const cards = form.locator('.admin-media-upload.t-upload');
  await expect(cards).toHaveCount(4);
  await expect(cards.locator('.t-icon-delete')).toHaveCount(0);
  await expect(cards.locator('input[type="file"]:enabled')).toHaveCount(0);
  await expect(cards.last().locator('.t-upload__card-image img')).toHaveAttribute('src', image);
  await cards.first().click({ position: { x: 8, y: 80 } });
  await expect(page.locator('img.upload-large-preview')).toHaveAttribute('src', image);
  const preview = page.locator('.t-dialog:visible').filter({ has: page.locator('img.upload-large-preview') });
  await expectStandardImagePreviewAndDismiss(page, preview);
  await expect(form).toBeVisible();
  await expect(cards.locator('input[type="file"]:enabled')).toHaveCount(0);
});
