import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        name: '韩健',
        phone: '15926626945',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });
  await installAdminApiMocks(page);
});

async function expectUnifiedConfirmDialog(page: Page, options: { action: string; content: string; danger?: boolean }) {
  const dialog = page.locator('.zdm-admin-confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`确认${options.action}`);
  await expect(dialog).toContainText(options.content);

  const confirmButton = dialog.getByRole('button', { name: `确认${options.action}`, exact: true });
  await expect(confirmButton).toBeVisible();
  if (options.danger) await expect(confirmButton).toHaveClass(/t-button--theme-danger/);
  await expect(dialog).toHaveCSS('width', '440px');
}

async function selectProductOption(
  page: Page,
  productDialog: ReturnType<Page['locator']>,
  label: string,
  option: string,
) {
  await productDialog.locator('.t-form__item').filter({ hasText: label }).getByRole('textbox').click();
  await page.locator('.t-popup__content:visible').getByText(option, { exact: true }).click();
}

async function submitSlabProduct(page: Page) {
  const productDialog = page.locator('.t-dialog').filter({ hasText: '发布商品' });
  for (const [index, name] of ['main-image.svg', 'scan-image.svg', 'design-image.svg'].entries()) {
    await productDialog
      .locator('input[type="file"]')
      .nth(index)
      .setInputFiles({
        name,
        mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>'),
      });
  }

  await productDialog.getByText('基础信息', { exact: true }).click();
  await selectProductOption(page, productDialog, '品种', '潘多拉');
  await selectProductOption(page, productDialog, '产地', '巴西');
  await selectProductOption(page, productDialog, '纹理', '细纹');
  await productDialog.locator('.t-form__item').filter({ hasText: '色系' }).getByRole('textbox').click();
  await page.locator('.t-cascader__panel:visible').getByText('白色系', { exact: true }).hover();
  await page.locator('.t-cascader__panel:visible').getByText('奶白', { exact: true }).click();
  await selectProductOption(page, productDialog, '等级', 'A+');
  for (const [field, value] of [
    ['length', '3200'],
    ['width', '1800'],
    ['height', '18'],
  ] as const) {
    await productDialog.locator(`.t-form-item__${field}`).getByRole('textbox').fill(value);
  }

  await productDialog.getByText('销售信息', { exact: true }).click();
  await selectProductOption(page, productDialog, '供应商', '装点猫大板供应商');
  await productDialog.locator('.t-form__item').filter({ hasText: '库存' }).getByRole('textbox').fill('1');
  await productDialog.locator('.t-form__item').filter({ hasText: 'SKU' }).getByRole('textbox').fill('SLAB-PUBLISH-E2E');
  const costInput = productDialog
    .locator('.price-editor__row')
    .filter({ hasText: '成本价' })
    .getByRole('textbox')
    .last();
  await costInput.fill('100');
  await costInput.press('Tab');
  await productDialog.getByRole('button', { name: '提交商品信息', exact: true }).click();
}

test('uses the same action-specific confirmation foundation across modules', async ({ page }) => {
  await page.goto('/product-attribute');
  const attributeRow = page.locator('tbody tr').filter({ hasText: 'E2E 共享属性' });
  await attributeRow.getByText('删除', { exact: true }).click();
  await expectUnifiedConfirmDialog(page, {
    action: '删除',
    content: '是否删除属性“E2E 共享属性”？',
    danger: true,
  });
  await page.getByRole('button', { name: '取消', exact: true }).click();

  await page.goto('/supplier-management');
  const supplierRow = page.locator('tbody tr').filter({ hasText: '装点猫大板供应商' });
  await supplierRow.getByText('停用', { exact: true }).click();
  await expectUnifiedConfirmDialog(page, {
    action: '停用',
    content: '是否停用供应商“装点猫大板供应商”？',
  });
  await page.getByRole('button', { name: '取消', exact: true }).click();

  await page.route('**/api/admin/slab-markup-configurations/options', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: [] }),
    });
  });
  await page.goto('/slab-management');
  const slabRow = page.getByRole('row', { name: /雪花白大板 06/ });
  await slabRow.getByText('删除', { exact: true }).click();
  await expectUnifiedConfirmDialog(page, {
    action: '删除',
    content: '删除后大板将进入回收站，是否删除大板“雪花白大板 06”？',
    danger: true,
  });
});

test('warns immediately instead of opening confirmation when a slab is not ready for shelving', async ({ page }) => {
  await page.route('**/api/admin/slab-markup-configurations/options', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: [] }),
    });
  });
  await page.route('**/api/admin/slabs', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'ok',
        data: [
          {
            id: 30,
            supplierId: null,
            varietyId: 25,
            originId: 5,
            textureId: 14,
            colorId: 15,
            gradeId: 2,
            name: '接口新建-雅士白大板-待维护销售信息',
            serialNo: '',
            warehouse: '平台仓',
            publisherType: '接口获取',
            mainImageMediaId: 34,
            scanImageMediaId: 35,
            designImageMediaId: 36,
            createdByName: '外部系统',
            lengthMm: 2600,
            widthMm: 1400,
            thicknessMm: 20,
            costPrice: null,
            guidePrice: null,
            markupPrices: [],
            status: 'warehouse',
            createdAt: '2026-08-24T11:11:49',
          },
        ],
      }),
    });
  });

  await page.goto('/slab-management');
  const row = page.getByRole('row', { name: /接口新建-雅士白大板-待维护销售信息/ });
  await row.getByText('上架', { exact: true }).click();

  await expect(page.getByText('请完善大板销售信息后再上架', { exact: true })).toBeVisible();
  await expect(page.locator('.zdm-admin-confirm-dialog')).toHaveCount(0);
});

test('physically deletes an interface slab with a reason and exposes an immutable operation log', async ({ page }) => {
  await page.route('**/api/admin/slab-markup-configurations/options', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: [] }),
    });
  });
  const interfaceSlab = {
    id: 9,
    supplierId: 1,
    varietyId: 1,
    originId: 1,
    textureId: 1,
    colorId: 1,
    gradeId: 1,
    name: '外部系统大板 09',
    serialNo: 'SLAB-E2E-009',
    warehouse: '接口仓',
    publisherType: '接口获取',
    lengthMm: 3200,
    widthMm: 1800,
    thicknessMm: 18,
    costPrice: 6800,
    guidePrice: 9800,
    status: 'warehouse',
    createdByName: '外部系统',
    createdAt: '2026-08-23T09:00:00',
  };
  await page.route('**/api/admin/slabs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: [interfaceSlab] }),
    });
  });
  let deletionPayload: { reason: string; detail: string } | undefined;
  await page.route('**/api/admin/slabs/9/delete', async (route) => {
    deletionPayload = route.request().postDataJSON() as { reason: string; detail: string };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: true }),
    });
  });
  const operationLogs = [
    {
      id: 1,
      slabId: 9,
      slabSerialNo: 'SLAB-E2E-009',
      slabName: '外部系统大板 09',
      publisherType: '接口获取',
      operationType: 'PHYSICAL_DELETE',
      operationSummary: '物理删除外部大板',
      standardReason: '资料不完整',
      detailReason: '',
      operationSource: 'MANUAL',
      operatorName: '韩健',
      operatedAt: '2026-08-23T10:00:00',
    },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: index + 2,
      slabId: index + 100,
      slabSerialNo: `SLAB-HISTORY-${index + 1}`,
      slabName: `历史操作大板 ${index + 1}`,
      publisherType: '平台发布',
      operationType: index === 0 ? 'PRICE_UPDATE' : 'DELETE_TO_RECYCLE',
      operationSummary: index === 0 ? '修改价格' : '删除至回收站',
      standardReason: '资料调整',
      detailReason: '',
      operationSource: 'MANUAL',
      operatorName: '韩健',
      operatedAt: '2026-08-22T10:00:00',
      changeDetails:
        index === 0
          ? JSON.stringify({
              大板名称: {
                before: '历史操作大板',
                after: '历史操作大板 1',
              },
              品种ID: { before: '潘多拉', after: '雅士白' },
              产地ID: { before: '巴西', after: '意大利' },
              纹理ID: { before: '细纹', after: '大花纹' },
              色系ID: { before: '白色系', after: '灰色系' },
              等级ID: { before: 'B级（二等品）', after: 'A级（优等品）' },
              供应商ID: { before: '原供应商', after: '新供应商' },
              面积: { before: 5.76, after: 5.94 },
              '1:1主图': {
                before: { available: false, mediaType: 'image' },
                after: {
                  available: true,
                  mediaType: 'image',
                  url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
                },
              },
              扫描图: {
                before: { available: false, mediaType: 'image' },
                after: {
                  available: true,
                  mediaType: 'image',
                  url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
                },
              },
              设计图: {
                before: { available: false, mediaType: 'image' },
                after: {
                  available: true,
                  mediaType: 'image',
                  url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
                },
              },
              商品视频: {
                before: { available: false, mediaType: 'video' },
                after: { available: true, mediaType: 'video', url: 'data:video/mp4;base64,AAAA' },
              },
              视频封面: {
                before: { available: false, mediaType: 'image' },
                after: {
                  available: true,
                  mediaType: 'image',
                  url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
                },
              },
              价格层级: {
                before: [{ configurationId: 2, priceCoefficient: 1.4, price: 140 }],
                after: [{ configurationId: 2, priceCoefficient: 1.45, price: 145 }],
              },
            })
          : undefined,
    })),
  ];
  await page.route('**/api/admin/slabs/operation-logs**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const keyword = requestUrl.searchParams.get('keyword') || '';
    const operatorName = requestUrl.searchParams.get('operatorName') || '';
    const pageNumber = Number(requestUrl.searchParams.get('page') || 1);
    const pageSize = Number(requestUrl.searchParams.get('pageSize') || 10);
    const filtered = operationLogs.filter(
      (item) =>
        (!keyword || item.slabName.includes(keyword) || item.slabSerialNo.includes(keyword)) &&
        (!operatorName || item.operatorName.includes(operatorName)),
    );
    const records = filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'ok',
        data: { records, total: filtered.length, page: pageNumber, pageSize },
      }),
    });
  });

  await page.goto('/slab-management');
  const row = page.getByRole('row', { name: /外部系统大板 09/ });
  await row.getByText('删除', { exact: true }).click();
  const dialog = page.locator('.t-dialog').filter({ hasText: '删除原因' });
  await expect(dialog).toContainText('该大板为外部系统创建，删除后将物理移除该大板，且不会进入回收站，操作不可恢复。');
  await expect(dialog.locator('.external-delete-warning')).toHaveCSS('margin-bottom', '16px');
  await expect(
    dialog.locator('.t-form__item').filter({ hasText: '详细说明' }).locator('.t-form__required-mark'),
  ).toHaveCount(0);
  await dialog.locator('.t-form__item').filter({ hasText: '删除原因' }).getByRole('textbox').click();
  await page.locator('.t-popup__content:visible').getByText('资料不完整', { exact: true }).click();
  await dialog.getByRole('button', { name: '提交', exact: true }).click();

  expect(deletionPayload).toEqual({ reason: '资料不完整', detail: '' });
  await expect(page.locator('.zdm-admin-confirm-dialog')).toHaveCount(0);
  await expect(page.getByText('已删除“外部系统大板 09”', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.locator('a.t-link').filter({ hasText: '操作日志' }).click();
  const logDrawer = page.locator('.t-drawer').filter({ hasText: '操作日志' });
  const operationLogRow = logDrawer.getByRole('row', { name: /外部系统大板 09/ });
  await expect(logDrawer.locator('.t-form__label').filter({ hasText: '创建方式' })).toHaveCount(0);
  await expect(logDrawer.getByRole('button', { name: '查询', exact: true })).toBeVisible();
  await expect(logDrawer.locator('.operation-log-keyword-filter')).toHaveCSS('width', '234px');
  await expect(logDrawer.locator('.operation-log-date-picker')).toHaveCSS('width', '260px');
  await expect(operationLogRow).toContainText('物理删除');
  await expect(logDrawer).toContainText('资料不完整');
  const priceOperationRow = logDrawer.getByRole('row', { name: /历史操作大板 1/ });
  await priceOperationRow.getByText('详情', { exact: true }).click();
  const detailDialog = page.locator('.t-dialog').filter({ hasText: '操作详情' });
  await expect(detailDialog.locator('.operation-log-diff-item')).toHaveCount(12);
  await expect(detailDialog.locator('.operation-log-diff-item__field')).toHaveText([
    '1:1主图',
    '扫描图',
    '设计图',
    '视频',
    '大板名称',
    '品种',
    '产地',
    '纹理',
    '色系',
    '等级',
    '供应商',
    '价格层级',
  ]);
  const nameComparison = detailDialog.locator('.operation-log-diff-item').filter({ hasText: '大板名称' });
  await expect(nameComparison.locator('.operation-log-diff-value--before')).toContainText('历史操作大板');
  await expect(nameComparison.locator('.operation-log-diff-value--after')).toContainText('历史操作大板 1');
  await expect(detailDialog.locator('.operation-log-diff-item').filter({ hasText: '品种' })).toContainText('雅士白');
  await expect(detailDialog.locator('.operation-log-diff-item').filter({ hasText: '产地' })).toContainText('意大利');
  await expect(detailDialog.locator('.operation-log-diff-item').filter({ hasText: '纹理' })).toContainText('大花纹');
  await expect(detailDialog.locator('.operation-log-diff-item').filter({ hasText: '色系' })).toContainText('灰色系');
  await expect(detailDialog.locator('.operation-log-diff-item').filter({ hasText: '等级' })).toContainText(
    'A级（优等品）',
  );
  await expect(detailDialog.locator('.operation-log-diff-item').filter({ hasText: '供应商' })).toContainText(
    '新供应商',
  );
  await expect(detailDialog.locator('.operation-log-diff-item').filter({ hasText: '面积' })).toHaveCount(0);
  await expect(detailDialog.locator('.operation-log-media-preview--image')).toHaveCount(3);
  await expect(detailDialog.locator('.operation-log-media-preview--video')).toHaveCount(1);
  await expect(detailDialog.getByText('媒体文件已清理', { exact: true })).toHaveCount(0);
  await expect(detailDialog.locator('.operation-log-media-after')).toHaveCount(4);
  await detailDialog.locator('.operation-log-media-preview--image').first().click();
  const mediaPreviewDialog = page.locator('.t-dialog').filter({ hasText: '1:1主图 - 修改后' });
  await expect(mediaPreviewDialog.locator('.upload-large-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await detailDialog.locator('.operation-log-media-preview--video').click();
  const videoPreviewDialog = page.locator('.t-dialog').filter({ hasText: '视频 - 修改后' });
  await expect(videoPreviewDialog.locator('video.upload-large-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  const priceComparison = detailDialog.locator('.operation-log-diff-item').filter({ hasText: '价格层级' });
  await expect(priceComparison.locator('.operation-log-diff-value--before')).toContainText('价格系数：1.40');
  await expect(priceComparison.locator('.operation-log-diff-value--before')).toContainText('价格：140.00');
  await expect(priceComparison.locator('.operation-log-diff-value--after')).toContainText('价格系数：1.45');
  await expect(priceComparison.locator('.operation-log-diff-value--after')).toContainText('价格：145.00');
  await expect(detailDialog).not.toContainText('"configurationId"');
  await detailDialog.getByRole('button', { name: '关闭', exact: true }).click();
  const operationLogPagination = logDrawer.locator('.zdm-admin-pagination .t-pagination');
  await expect(operationLogPagination).toBeVisible();
  await expect(logDrawer.getByRole('row', { name: /历史操作大板 10/ })).toHaveCount(0);
  await operationLogPagination.locator('.t-pagination__btn-next').click();
  await expect(logDrawer.getByRole('row', { name: /历史操作大板 10/ })).toBeVisible();
  const [operatorBox, dateFilterBox, searchButtonBox] = await Promise.all([
    logDrawer.locator('.operation-log-operator-filter').boundingBox(),
    logDrawer.locator('.operation-log-date-filter').boundingBox(),
    logDrawer.getByRole('button', { name: '查询', exact: true }).boundingBox(),
  ]);
  expect(operatorBox?.y).toBe(dateFilterBox?.y);
  expect(operatorBox?.y).toBe(searchButtonBox?.y);
  await logDrawer.getByPlaceholder('请输入操作人').fill('不存在的人员');
  await logDrawer.getByRole('button', { name: '查询', exact: true }).click();
  await expect(operationLogRow).toHaveCount(0);
  await logDrawer.getByRole('button', { name: '重置', exact: true }).click();
  await expect(operationLogRow).toBeVisible();
});

test('permanently deletes one or multiple slabs from the recycle tab after confirmation', async ({ page }) => {
  await page.goto('/slab-management');
  await page.getByText('回收站 2', { exact: true }).click();

  const singleRow = page.getByRole('row', { name: /回收站大板 07/ });
  await singleRow.getByText('彻底删除', { exact: true }).click();
  await expectUnifiedConfirmDialog(page, {
    action: '彻底删除',
    content: '彻底删除后无法恢复，是否彻底删除大板“回收站大板 07”？',
    danger: true,
  });
  const singleDelete = page.waitForRequest(
    (request) => request.method() === 'DELETE' && request.url().endsWith('/api/admin/slabs/7'),
  );
  await page.getByRole('button', { name: '确认彻底删除', exact: true }).click();
  await singleDelete;
  await expect(singleRow).toHaveCount(0);
  await expect(page.locator('.zdm-admin-confirm-dialog')).toBeHidden();

  const batchRow = page.getByRole('row', { name: /回收站大板 08/ });
  await batchRow.locator('.t-checkbox').click();
  await page.getByRole('button', { name: '批量彻底删除', exact: true }).click();
  await expectUnifiedConfirmDialog(page, {
    action: '批量彻底删除',
    content: '彻底删除后无法恢复，是否批量彻底删除所选大板？',
    danger: true,
  });
  const batchDelete = page.waitForRequest(
    (request) => request.method() === 'DELETE' && request.url().endsWith('/api/admin/slabs/batch-purge'),
  );
  await page.getByRole('button', { name: '确认批量彻底删除', exact: true }).click();
  expect((await batchDelete).postDataJSON()).toEqual([8]);
  await expect(batchRow).toHaveCount(0);
});

test('shows recycled slab prices without allowing edits', async ({ page }) => {
  await page.route('**/api/admin/slab-markup-configurations/options', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: [] }),
    });
  });
  await page.goto('/slab-management');
  await page.getByText('回收站 2', { exact: true }).click();

  const recycleRow = page.getByRole('row', { name: /回收站大板 07/ });
  await recycleRow.getByText('价格', { exact: true }).click();
  const priceDrawer = page.locator('.t-drawer').filter({ hasText: '价格编辑器' });
  await expect(priceDrawer).toBeVisible();
  await expect(priceDrawer.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  const priceInputs = priceDrawer.getByRole('textbox');
  await expect(priceInputs.first()).toBeDisabled();
  await expect(priceInputs.last()).toBeDisabled();
});

test('restores the guide price coefficient from the slab independent price', async ({ page }) => {
  await page.route('**/api/admin/slab-markup-configurations/options', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'ok',
        data: [],
      }),
    });
  });
  await page.route('**/api/admin/slabs', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'ok',
        data: [
          {
            id: 32,
            supplierId: 1,
            varietyId: 1,
            name: '宝格丽黑大板',
            serialNo: 'SLAB-E2E-032',
            warehouse: '云浮仓',
            publisherType: '平台发布',
            lengthMm: 3200,
            widthMm: 1800,
            thicknessMm: 18,
            costPrice: 2000,
            guidePrice: 100,
            guidePriceCoefficient: 0.05,
            markupPrices: [],
            status: 'warehouse',
            createdAt: '2026-08-24T16:06:28',
          },
        ],
      }),
    });
  });

  await page.goto('/slab-management');
  const slabRow = page.getByRole('row', { name: /宝格丽黑大板/ });
  await slabRow.getByText('价格', { exact: true }).click();

  const priceDrawer = page.locator('.t-drawer').filter({ hasText: '价格编辑器' });
  const guideRow = priceDrawer.locator('.price-table__row').filter({ hasText: '指导价' });
  const guideInputs = guideRow.getByRole('textbox');
  await expect(guideInputs.nth(0)).toHaveValue('0.05');
  await expect(guideInputs.nth(1)).toHaveValue('100.00');
});

test('shows only assigned slab tabs and operations', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 9,
        name: '回收站查看员',
        phone: '15926626949',
        roles: ['SLAB_RECYCLE_VIEWER'],
        permissions: ['admin.slab-management.recycle.view', 'admin.slab-management.recycle.price'],
        dataPermission: 'all',
      }),
    );
  });
  await page.route('**/api/admin/slab-markup-configurations/options', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: [] }),
    });
  });

  await page.goto('/slab-management');
  await expect(page.locator('.status-tabs')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /回收站大板 07/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /雪花白大板 06/ })).toHaveCount(0);
  await expect(page.locator('.toolbar-buttons button')).toHaveCount(0);
  const recycleActions = page.getByRole('row', { name: /回收站大板 07/ }).locator('.table-actions .t-link');
  expect((await recycleActions.allTextContents()).map((text) => text.trim())).toEqual(['价格']);
});

test('places clear recycle after batch purge and permanently deletes every recycled slab', async ({ page }) => {
  await page.goto('/slab-management');
  await page.getByText('回收站 2', { exact: true }).click();

  expect((await page.locator('.toolbar-buttons button').allTextContents()).map((text) => text.trim())).toEqual([
    '批量放回仓库',
    '批量彻底删除',
    '清空回收站',
  ]);
  await page.getByRole('button', { name: '清空回收站', exact: true }).click();
  await expectUnifiedConfirmDialog(page, {
    action: '清空回收站',
    content: '清空后所有回收站大板将无法恢复，是否清空回收站？',
    danger: true,
  });

  const clearRequest = page.waitForRequest(
    (request) => request.method() === 'DELETE' && request.url().endsWith('/api/admin/slabs/clear-recycle'),
  );
  await page.getByRole('button', { name: '确认清空回收站', exact: true }).click();
  expect((await clearRequest).postData()).toBeNull();
  await expect(page.getByRole('row', { name: /回收站大板/ })).toHaveCount(0);
  await expect(page.getByText('已清空回收站“2 个大板”', { exact: true })).toBeVisible();
});

test('requires an off-shelf reason before batch off-shelving slabs', async ({ page }) => {
  let slabStatus = 'selling';
  const latestDetailReason = '盘点数量不一致，需要重新核对仓库中的实际库存数量和对应大板编码后再恢复销售';
  const offShelfRecords = [
    {
      id: 1,
      slabId: 61,
      standardReason: '供应商申请',
      detailReason: '供应商要求暂停销售',
      offShelvedAt: '2026-08-20T10:00:00',
      offShelvedByName: '李雷',
      offShelvedByAccountId: 2,
    },
  ];
  await page.route('**/api/admin/slab-markup-configurations/options', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: [] }),
    });
  });
  await page.route('**/api/admin/slabs', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'ok',
        data: [
          {
            id: 61,
            supplierId: 1,
            varietyId: 1,
            name: '批量下架大板 61',
            serialNo: 'SLAB-E2E-061',
            warehouse: '云浮仓',
            publisherType: '平台发布',
            lengthMm: 3200,
            widthMm: 1800,
            thicknessMm: 18,
            areaSquareMeter: 5.76,
            costPrice: 6800,
            guidePrice: 9800,
            status: slabStatus,
            offShelfRecords,
            createdAt: '2026-07-27T09:00:00',
          },
          {
            id: 62,
            supplierId: 1,
            varietyId: 1,
            name: '已下架大板 62',
            serialNo: 'SLAB-E2E-062',
            warehouse: '云浮仓',
            publisherType: '平台发布',
            lengthMm: 3000,
            widthMm: 1600,
            thicknessMm: 18,
            areaSquareMeter: 4.8,
            status: 'offShelf',
            offShelfRecords: [
              {
                id: 3,
                slabId: 62,
                standardReason: '价格调整',
                detailReason: '等待重新定价',
                offShelvedAt: '2026-08-22T10:00:00',
                offShelvedByName: '王芳',
                offShelvedByAccountId: 3,
              },
            ],
            createdAt: '2026-07-28T09:00:00',
          },
        ],
      }),
    });
  });

  let statusPayload: unknown;
  await page.route('**/api/admin/slabs/batch-status', async (route) => {
    statusPayload = route.request().postDataJSON();
    slabStatus = 'offShelf';
    offShelfRecords.unshift({
      id: 2,
      slabId: 61,
      standardReason: '库存异常',
      detailReason: latestDetailReason,
      offShelvedAt: '2026-08-23T10:00:00',
      offShelvedByName: '韩健',
      offShelvedByAccountId: 1,
    });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: true }),
    });
  });

  await page.goto('/slab-management');
  await page.getByText('出售中 1', { exact: true }).click();
  const row = page.getByRole('row', { name: /批量下架大板 61/ });
  await row.locator('.t-checkbox').click();
  await page.getByRole('button', { name: '批量下架', exact: true }).click();

  const dialog = page.locator('.t-dialog').filter({ hasText: '批量下架' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('下架原因', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByText('请选择下架原因', { exact: true })).toBeVisible();
  expect(statusPayload).toBeUndefined();

  await dialog.getByRole('textbox').first().click();
  await page.locator('.t-popup__content:visible').getByText('库存异常', { exact: true }).click();
  await dialog.locator('textarea').fill(latestDetailReason);
  await dialog.getByRole('button', { name: '提交', exact: true }).click();

  await expect
    .poll(() => statusPayload)
    .toEqual({
      ids: [61],
      status: 'offShelf',
      reason: '库存异常',
      detail: latestDetailReason,
    });
  await expect(dialog).toBeHidden();
  await expect(page.getByText('已批量下架“1 个大板”', { exact: true })).toBeVisible();

  await page.getByText('已下架 2', { exact: true }).click();
  const filterCard = page.locator('.filter-card');
  await expect(filterCard.getByText('下架原因', { exact: true })).toBeVisible();
  await expect(filterCard.getByText('下架人', { exact: true })).toBeVisible();
  await expect(filterCard.getByText('下架时间', { exact: true })).toBeVisible();
  await expect(filterCard.getByText('产地', { exact: true })).toHaveCount(0);
  await expect(filterCard.getByText('纹理', { exact: true })).toHaveCount(0);
  await expect(filterCard.getByText('色系', { exact: true })).toHaveCount(0);
  await expect(filterCard.getByText('等级', { exact: true })).toHaveCount(0);
  await expect(filterCard.getByText('供应商', { exact: true })).toHaveCount(0);
  expect((await page.locator('.table-card thead th').allTextContents()).map((text) => text.trim())).toEqual([
    '',
    '商品主图',
    '大板名称/ID/SKU',
    '品种',
    '下架原因/详细说明',
    '下架人',
    '下架时间',
    '操作',
  ]);
  const offShelfRows = page.locator('.table-card tbody tr');
  await expect(offShelfRows).toHaveCount(2);
  await expect(offShelfRows.nth(0)).toContainText('批量下架大板 61');
  await expect(offShelfRows.nth(1)).toContainText('已下架大板 62');

  const reasonFilter = filterCard.locator('.t-form__item').filter({ hasText: '下架原因' });
  await reasonFilter.locator('input').click();
  await page.locator('.t-popup__content:visible').getByText('价格调整', { exact: true }).click();
  await filterCard.getByRole('button', { name: '查询', exact: true }).click();
  await expect(offShelfRows).toHaveCount(1);
  await expect(offShelfRows.nth(0)).toContainText('已下架大板 62');
  await filterCard.getByRole('button', { name: '重置', exact: true }).click();
  await expect(offShelfRows).toHaveCount(2);

  const personFilter = filterCard.locator('.t-form__item').filter({ hasText: '下架人' });
  await personFilter.locator('input').fill('韩健');
  const dateInputs = filterCard.locator('.off-shelf-date-filter input');
  await dateInputs.nth(0).fill('2026-08-23');
  await dateInputs.nth(1).fill('2026-08-23');
  await dateInputs.nth(1).press('Tab');
  await filterCard.getByRole('button', { name: '查询', exact: true }).click();
  await expect(offShelfRows).toHaveCount(1);
  await expect(offShelfRows.nth(0)).toContainText('批量下架大板 61');
  await filterCard.getByRole('button', { name: '重置', exact: true }).click();
  await expect(offShelfRows).toHaveCount(2);

  const offShelfRow = page.getByRole('row', { name: /批量下架大板 61/ });
  await expect(offShelfRow).toContainText('库存异常');
  await expect(offShelfRow).toContainText(latestDetailReason);
  await expect(offShelfRow).toContainText('韩健');
  await expect(offShelfRow).not.toContainText('供应商申请');
  const historyTrigger = offShelfRow.getByRole('button', { name: '查看历史下架原因', exact: true });
  await expect(historyTrigger).toHaveCSS('opacity', '0');
  const detailText = offShelfRow.locator('.off-shelf-reason-secondary');
  await detailText.hover();
  await expect(page.locator('.t-popup__content:visible').getByText(latestDetailReason, { exact: true })).toBeVisible();
  await expect(historyTrigger).toHaveCSS('opacity', '1');
  await historyTrigger.click();
  const historyDialog = page.locator('.t-dialog').filter({ hasText: '历史下架原因' });
  await expect(historyDialog).toBeVisible();
  const historyRows = historyDialog.locator('tbody tr');
  await expect(historyRows).toHaveCount(2);
  await expect(historyRows.nth(0)).toContainText('库存异常');
  await expect(historyRows.nth(0)).toContainText('韩健');
  await expect(historyRows.nth(0).locator('.off-shelf-history-detail')).toHaveCSS('white-space', 'normal');
  await expect(historyRows.nth(0)).toContainText(latestDetailReason);
  await expect(historyRows.nth(1)).toContainText('供应商申请');
  await expect(historyRows.nth(1)).toContainText('李雷');
  await historyDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(historyDialog).toBeHidden();
  expect((await offShelfRow.locator('.table-actions .t-link').allTextContents()).map((text) => text.trim())).toEqual([
    '详情',
    '放回仓库',
    '删除',
  ]);
  await offShelfRow.getByText('详情', { exact: true }).click();
  const detailDrawer = page.locator('.t-drawer').filter({ hasText: '大板详情' });
  await expect(detailDrawer).toBeVisible();
  await expect(detailDrawer).toContainText('批量下架大板 61');
  await expect(detailDrawer).toContainText('SLAB-E2E-061');
  await expect(detailDrawer).toContainText('3200 x 1800 x 18mm');
  await expect(detailDrawer).toContainText('云浮仓');
  await expect(detailDrawer.getByText('图片', { exact: true })).toBeVisible();
  await expect(detailDrawer.getByText('销售信息', { exact: true })).toBeVisible();
  await expect(detailDrawer.getByText('成本价', { exact: true })).toBeVisible();
  await expect(detailDrawer.getByText('指导价', { exact: true })).toBeVisible();
  await expect(detailDrawer.getByText('6800', { exact: true })).toBeVisible();
  await expect(detailDrawer.getByText('9800', { exact: true })).toBeVisible();
});

test('opens the file chooser directly, shows a thumbnail, and previews the uploaded image', async ({ page }) => {
  const previewDataUrl =
    'data:image/svg+xml;base64,' +
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#567"/></svg>',
    ).toString('base64');
  await page.route('**/api/admin/slabs/images', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'ok',
        data: { id: 9001, url: previewDataUrl, mediaType: 'image', mimeType: 'image/svg+xml' },
      }),
    });
  });
  await page.goto('/slab-management');
  await page.getByRole('button', { name: '发布商品', exact: true }).click();

  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('input[type="file"]').first().click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'slab-preview.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#567"/></svg>',
    ),
  });

  await expect(page.getByText('已上传“1:1主图”', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '提交', exact: true })).toHaveCount(0);
  const preview = page.locator('.admin-media-upload__preview[alt="1:1主图"]');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', previewDataUrl);
  await preview.click();
  await expect(page.locator('.upload-large-preview[alt="1:1主图"]')).toBeVisible();
});

for (const scenario of [
  { tab: '仓库中 1', expectedStatus: 'warehouse', expectedTab: /仓库中/ },
  { tab: '出售中', expectedStatus: 'selling', expectedTab: /出售中/ },
] as const) {
  test(`publishes a slab into ${scenario.expectedStatus} from its current tab`, async ({ page }) => {
    await page.route('**/api/admin/slabs/form-options', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            varieties: [{ id: 1, label: '潘多拉', status: 'enabled' }],
            origins: [{ id: 1, label: '巴西', status: 'enabled' }],
            textures: [{ id: 1, label: '细纹', status: 'enabled' }],
            colorCategories: [
              {
                id: 1,
                label: '白色系',
                status: 'enabled',
                children: [{ id: 1, label: '奶白', status: 'enabled' }],
              },
            ],
            grades: [{ id: 1, label: 'A+', status: 'enabled' }],
            suppliers: [{ id: 1, label: '装点猫大板供应商', status: 'enabled' }],
          },
        }),
      });
    });
    await page.route('**/api/admin/slab-markup-configurations/options', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'ok', data: [] }),
      });
    });
    await page.route('**/api/admin/slabs/images', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          message: 'ok',
          data: { id: 9100, url: 'data:image/svg+xml;base64,PHN2Zy8+', mediaType: 'image', mimeType: 'image/svg+xml' },
        }),
      });
    });
    let submittedStatus = '';
    await page.route('**/api/admin/slabs', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      submittedStatus = String(payload.status);
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'ok', data: { id: 99, ...payload } }),
      });
    });

    await page.goto('/slab-management');
    await page.getByText(scenario.tab, { exact: true }).click();
    await page.getByRole('button', { name: '发布商品', exact: true }).click();
    const createRequest = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/api/admin/slabs'),
    );
    await submitSlabProduct(page);
    await createRequest;

    expect(submittedStatus).toBe(scenario.expectedStatus);
    await expect(page.locator('.status-tabs .t-tabs__nav-item.t-is-active')).toContainText(scenario.expectedTab);
  });
}

test('leaves SKU blank for operations staff when publishing a product', async ({ page }) => {
  await page.route('**/api/admin/slab-markup-configurations/options', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: [] }),
    });
  });
  await page.goto('/slab-management');
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  const productDialog = page.locator('.t-dialog').filter({ hasText: '发布商品' });
  await productDialog.getByText('销售信息', { exact: true }).click();
  await expect(productDialog.locator('.t-form__item').filter({ hasText: 'SKU' }).getByRole('textbox')).toHaveValue('');
});

test('filters slab varieties and origins by search text when publishing a product', async ({ page }) => {
  await page.goto('/slab-management');
  await page.getByRole('button', { name: '发布商品', exact: true }).click();
  await page.getByText('基础信息', { exact: true }).click();

  const productDialog = page.locator('.t-dialog').filter({ hasText: '发布商品' });
  const varietyInput = productDialog.locator('.t-form__item').filter({ hasText: '品种' }).getByRole('textbox');
  await varietyInput.fill('潘多');
  const varietyDropdown = page.locator('.t-select__dropdown:visible');
  await expect(varietyDropdown.getByText('潘多拉', { exact: true })).toBeVisible();
  await varietyInput.fill('不存在的品种');
  await expect(varietyDropdown.getByText('潘多拉', { exact: true })).toHaveCount(0);

  const originInput = productDialog.locator('.t-form__item').filter({ hasText: '产地' }).getByRole('textbox');
  await originInput.fill('巴');
  const originDropdown = page.locator('.t-select__dropdown:visible');
  await expect(originDropdown.getByText('巴西', { exact: true })).toBeVisible();
  await originInput.fill('不存在的产地');
  await expect(originDropdown.getByText('巴西', { exact: true })).toHaveCount(0);
});

test('shows the same object-specific success copy for category, store category, and employee status changes', async ({
  page,
}) => {
  await page.goto('/supplier-management');
  const supplierRow = page.getByRole('row', { name: /装点猫大板供应商/ });
  await supplierRow.getByText('停用', { exact: true }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByText('已停用“装点猫大板供应商”', { exact: true })).toBeVisible();
  await supplierRow.getByText('启用', { exact: true }).click();
  await page.getByRole('button', { name: '确认启用', exact: true }).click();
  await expect(page.getByText('已启用“装点猫大板供应商”', { exact: true })).toBeVisible();

  await page.goto('/product-category');
  const productCategoryRow = page.getByRole('row', { name: /成品现货 一级分类/ });
  await productCategoryRow.getByText('停用', { exact: true }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  const productCategoryFeedback = page.getByText('已停用“成品现货”', { exact: true });
  await expect(productCategoryFeedback).toBeVisible();
  const feedbackBox = await productCategoryFeedback.locator('..').boundingBox();
  expect(feedbackBox?.width).toBeLessThan(320);

  await page.goto('/store-category-management');
  await page
    .getByRole('row', { name: /石材 1级分类/ })
    .getByRole('button', { name: '展开下级分类' })
    .click();
  const storeCategoryRow = page.getByRole('row', { name: /大理石 2级分类/ });
  await storeCategoryRow.getByText('停用', { exact: true }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByText('已停用“大理石”', { exact: true })).toBeVisible();

  await page.goto('/employee-management');
  const employeeRow = page.getByRole('row', { name: /测试员工/ });
  await employeeRow.getByText('停用', { exact: true }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByText('已停用“测试员工”', { exact: true })).toBeVisible();
});

test('shows object-specific success copy in craft, slab variety, attribute, and attribute value modules', async ({
  page,
}) => {
  const cases = [
    { path: '/finished-stock-craft', target: 'E2E 边工艺' },
    { path: '/slab-variety', target: '潘多拉' },
    { path: '/product-attribute', target: 'E2E 共享属性' },
    { path: '/product-attribute-value', target: 'E2E 共享属性值' },
  ];

  for (const item of cases) {
    await page.goto(item.path);
    const row = page.locator('tbody tr').filter({ hasText: item.target });
    await row.getByText('停用', { exact: true }).click();
    await page.getByRole('button', { name: '确认停用', exact: true }).click();
    await expect(page.getByText(`已停用“${item.target}”`, { exact: true })).toBeVisible();
  }
});

test('shows 已新增加名称 after creating an item', async ({ page }) => {
  await page.goto('/product-attribute');
  await page.getByRole('main').getByRole('button', { name: '新增', exact: true }).click();

  await page.getByPlaceholder('请输入属性名称').fill('E2E 新增属性');
  await page.getByText('文本输入', { exact: true }).click();
  await page.getByRole('button', { name: '提交', exact: true }).click();

  await expect(page.getByText('已新增“E2E 新增属性”', { exact: true })).toBeVisible();
});

const deletionCases = [
  { path: '/supplier-management', target: '装点猫大板供应商' },
  { path: '/role-management', target: '运营管理平台角色' },
  { path: '/employee-management', target: '测试员工' },
  { path: '/finished-stock-craft', target: 'E2E 边工艺' },
  { path: '/slab-variety', target: '潘多拉' },
  { path: '/product-attribute', target: 'E2E 共享属性', targetPattern: /E2E (?:全局)?共享属性/ },
  { path: '/product-attribute-value', target: 'E2E 共享属性值', targetPattern: /E2E (?:全局)?共享属性值/ },
];

test('archives an operating store and warns before permanently deleting an archived store', async ({ page }) => {
  await page.goto('/tenant-store-management');
  const row = page.locator('tbody tr').filter({ hasText: '杭州体验门店' });
  await row.getByText('归档', { exact: true }).click();
  await expect(page.getByText('归档后，该门店的全部员工将无法登录或切换到该门店。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();

  await page.getByRole('main').getByText('已归档', { exact: true }).click();
  const archivedRow = page.locator('tbody tr').filter({ hasText: '已归档门店' });
  await expect(archivedRow.getByText('恢复运营', { exact: true })).toBeVisible();
  await archivedRow.getByText('彻底删除', { exact: true }).click();
  await expect(page.getByText('彻底删除后，该门店的经营数据永久不可恢复，请谨慎操作', { exact: true })).toBeVisible();
});

test('shows the duplicate store name error on the edit form', async ({ page }) => {
  await page.route('**/api/admin/stores/1', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 400, message: '店铺名称已存在', data: null }),
    });
  });

  await page.goto('/tenant-store-management');
  const row = page.locator('tbody tr').filter({ hasText: '杭州体验门店' });
  await row.getByText('编辑', { exact: true }).click();
  const dialog = page.locator('.t-dialog').filter({ hasText: '编辑' });
  await dialog.locator('.t-form__item').filter({ hasText: '门店名称' }).getByPlaceholder('请输入').fill('已归档门店');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();

  await expect(dialog.locator('.t-form__item').filter({ hasText: '门店名称' })).toContainText('门店名称已存在');
  await expect(page.getByText('编辑“已归档门店”失败：门店名称已存在', { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
});

for (const item of deletionCases) {
  test(`shows 已删除加名称 after deleting ${item.target}`, async ({ page }) => {
    await page.goto(item.path);
    const row = page.locator('tbody tr').filter({ hasText: item.targetPattern ?? item.target });
    const targetName = item.targetPattern ? await row.locator('td').first().innerText() : item.target;
    await row.getByText('删除', { exact: true }).click();
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page.getByText(`已删除“${targetName}”`, { exact: true })).toBeVisible();
  });
}
