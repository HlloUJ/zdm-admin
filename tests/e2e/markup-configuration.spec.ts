import { expect, test } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

const seedLogin = async (page: import('@playwright/test').Page, permissions: string[], roles = ['ADMIN']) => {
  await page.addInitScript(
    ({ permissionValues, roleValues }) => {
      window.localStorage.setItem('zdm-admin-token', 'dev-token');
      window.localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          name: '运营管理员',
          roles: roleValues,
          permissions: permissionValues,
          dataPermission: 'self',
        }),
      );
    },
    { permissionValues: permissions, roleValues: roles },
  );
};

const mockMarkupConfigurations = async (page: import('@playwright/test').Page) => {
  const storeLevels = [
    { id: 11, name: '城市中心店', status: 'enabled', sortOrder: 1 },
    { id: 12, name: '区域合作店', status: 'enabled', sortOrder: 2 },
    { id: 13, name: '社区门店', status: 'enabled', sortOrder: 3 },
  ];
  const finished = [
    {
      id: 3,
      storeLevelId: 11,
      name: '城市中心店',
      priceCoefficient: 1.3,
      sortOrder: 1,
      createdByAccountId: 99,
      createdByName: '其他运营员工',
      status: 'enabled' as 'enabled' | 'disabled',
    },
    {
      id: 4,
      storeLevelId: 12,
      name: '区域合作店',
      priceCoefficient: 1.1,
      sortOrder: 2,
      createdByAccountId: 99,
      createdByName: '其他运营员工',
      status: 'enabled' as 'enabled' | 'disabled',
    },
  ];
  const slabs = [
    {
      id: 2,
      storeLevelId: 11,
      name: '城市中心店',
      priceCoefficient: 1.2,
      sortOrder: 1,
      createdByAccountId: 99,
      createdByName: '其他运营员工',
      status: 'enabled' as 'enabled' | 'disabled',
      autoReferenceCount: 4,
    },
    {
      id: 6,
      storeLevelId: 12,
      name: '区域合作店',
      priceCoefficient: 1.05,
      sortOrder: 2,
      createdByAccountId: 99,
      createdByName: '其他运营员工',
      status: 'enabled' as 'enabled' | 'disabled',
      autoReferenceCount: 0,
    },
  ];
  await page.route('**/api/admin/store-levels/pricing-options', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: storeLevels }),
    });
  });
  await page.route('**/api/admin/finished-markup-configurations**', async (route) => {
    if (route.request().method() === 'PATCH' && route.request().url().endsWith('/status')) {
      const id = Number(new URL(route.request().url()).pathname.split('/').at(-2));
      const row = finished.find((item) => item.id === id)!;
      row.status = route.request().postDataJSON().status;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'ok', data: row }),
      });
    }
    if (route.request().method() === 'PATCH' && route.request().url().endsWith('/reorder')) {
      const orderedIds = route.request().postDataJSON().orderedIds as number[];
      const orderedRows = orderedIds.map((id) => finished.find((item) => item.id === id)!);
      finished.splice(0, finished.length, ...orderedRows);
    }
    if (route.request().method() === 'DELETE') {
      const id = Number(new URL(route.request().url()).pathname.split('/').at(-1));
      const index = finished.findIndex((item) => item.id === id);
      if (index >= 0) finished.splice(index, 1);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'ok', data: true }),
      });
    }
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      const level = storeLevels.find((item) => item.id === payload.storeLevelId)!;
      finished.push({
        id: 5,
        name: level.name,
        createdByAccountId: 1,
        createdByName: '运营管理员',
        sortOrder: finished.length + 1,
        status: 'enabled',
        ...payload,
      });
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: finished }),
    });
  });
  await page.route('**/api/admin/slab-markup-configurations**', async (route) => {
    if (route.request().method() === 'PATCH' && route.request().url().endsWith('/reorder')) {
      const orderedIds = route.request().postDataJSON().orderedIds as number[];
      const orderedRows = orderedIds.map((id) => slabs.find((item) => item.id === id)!);
      slabs.splice(0, slabs.length, ...orderedRows);
    }
    if (route.request().method() === 'PATCH' && route.request().url().endsWith('/status')) {
      const id = Number(new URL(route.request().url()).pathname.split('/').at(-2));
      const row = slabs.find((item) => item.id === id)!;
      row.status = route.request().postDataJSON().status;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'ok', data: { ...row, synchronizedPriceCount: 0 } }),
      });
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: slabs }),
    });
  });
  await page.route('**/api/admin/finished-guide-price-setting', async (route) => {
    const coefficient = route.request().method() === 'PUT' ? route.request().postDataJSON().priceCoefficient : 1.5;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'ok',
        data: { id: 1, priceCoefficient: coefficient },
      }),
    });
  });
  await page.route('**/api/admin/slab-guide-price-setting', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: { id: 2, priceCoefficient: 1.4 } }),
    });
  });
};

test('价格配置引用统一门店级别并仅配置系数', async ({ page }) => {
  await seedLogin(page, ['all'], ['SUPER_ADMIN']);
  await mockMarkupConfigurations(page);
  await page.goto('/markup-configuration');

  await expect(page.getByText('商品默认价格规则')).toBeVisible();
  await expect(page.getByText('指导价设置', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '门店级别' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '状态' })).toBeVisible();
  await expect(page.locator('thead').getByTitle('拖拽排序')).toBeVisible();
  await expect(page.getByRole('cell', { name: '城市中心店', exact: true })).toBeVisible();

  const finishedRow = page.getByRole('row').filter({ hasText: '城市中心店' });
  const finishedStatusRequest = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith('/finished-markup-configurations/3/status'),
  );
  await finishedRow.getByText('停用', { exact: true }).click();
  await expect(page.locator('.zdm-admin-confirm-dialog')).toContainText('确认停用成品价格配置“城市中心店”吗？');
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  expect((await finishedStatusRequest).postDataJSON()).toEqual({ status: 'disabled' });
  await expect(page.getByText('已停用“城市中心店”', { exact: true })).toBeVisible();
  await expect(finishedRow.getByText('已停用', { exact: true })).toBeVisible();
  await expect(finishedRow.locator('.t-tag').filter({ hasText: '已停用' })).toHaveClass(/t-tag--danger/);
  await expect(finishedRow.getByText('编辑', { exact: true })).toBeVisible();

  const finishedReorderRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' && request.url().endsWith('/api/admin/finished-markup-configurations/reorder'),
  );
  await page
    .getByRole('row')
    .filter({ hasText: '城市中心店' })
    .locator('.t-table__handle-draggable')
    .dragTo(page.getByRole('row').filter({ hasText: '区域合作店' }).locator('.t-table__handle-draggable'));
  expect((await finishedReorderRequest).postDataJSON()).toEqual({ orderedIds: [4, 3] });
  await expect(page.getByText('已更新排序“城市中心店”', { exact: true })).toBeVisible();

  const guideCoefficientInput = page.locator('.guide-coefficient-input input');
  await expect(guideCoefficientInput).toHaveValue('1.50');
  await guideCoefficientInput.fill('0.5');
  await guideCoefficientInput.blur();
  await expect(page.getByText('价格系数不能小于1.00', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '新增', exact: true }).click();
  const createDialog = page.locator('.t-dialog').filter({ has: page.getByText('新增', { exact: true }) });
  await createDialog.getByPlaceholder('请选择', { exact: true }).click();
  const levelDropdown = page.locator('.t-select__dropdown:visible');
  await expect(levelDropdown.getByText('城市中心店', { exact: true })).toBeVisible();
  await expect(levelDropdown.getByText('区域合作店', { exact: true })).toBeVisible();
  await levelDropdown.getByText('社区门店', { exact: true }).click();
  await expect(createDialog.locator('.price-level-select')).toHaveCSS(
    'width',
    await createDialog.locator('.price-coefficient-input').evaluate((element) => getComputedStyle(element).width),
  );
  await createDialog.locator('.price-coefficient-input input').fill('-1');
  await createDialog.locator('.price-coefficient-input input').blur();
  await expect(createDialog.getByText('请输入正确的价格系数', { exact: true })).toBeVisible();
  await createDialog.locator('.price-coefficient-input input').fill('0');
  await createDialog.locator('.price-coefficient-input input').blur();
  await expect(createDialog.getByText('请输入正确的价格系数', { exact: true })).toHaveCount(0);
  await createDialog.locator('.price-coefficient-input input').fill('0.50');
  const createRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/admin/finished-markup-configurations'),
  );
  await createDialog.getByRole('button', { name: '提交' }).click();
  expect((await createRequest).postDataJSON()).toEqual({ storeLevelId: 13, priceCoefficient: 0.5 });

  await page.getByText('大板价格配置', { exact: true }).click();
  await expect(page.getByRole('columnheader', { name: '状态' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '城市中心店', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '1.2', exact: true })).toBeVisible();
  const slabReorderRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' && request.url().endsWith('/api/admin/slab-markup-configurations/reorder'),
  );
  await page
    .getByRole('row')
    .filter({ hasText: '城市中心店' })
    .locator('.t-table__handle-draggable')
    .dragTo(page.getByRole('row').filter({ hasText: '区域合作店' }).locator('.t-table__handle-draggable'));
  expect((await slabReorderRequest).postDataJSON()).toEqual({ orderedIds: [6, 2] });
  await expect(page.getByText('已更新排序“城市中心店”', { exact: true })).toBeVisible();

  const slabRow = page.getByRole('row').filter({ hasText: '城市中心店' });
  const statusRequest = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith('/slab-markup-configurations/2/status'),
  );
  await slabRow.getByText('停用', { exact: true }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  expect((await statusRequest).postDataJSON()).toEqual({ status: 'disabled' });
  await expect(page.getByText('已停用“城市中心店”', { exact: true })).toBeVisible();
  await expect(slabRow.locator('.t-tag').filter({ hasText: '已停用' })).toHaveClass(/t-tag--danger/);
  await expect(slabRow.getByText('编辑', { exact: true })).toBeVisible();

  await slabRow.getByText('删除', { exact: true }).click();
  await expect(page.getByText('该价格配置正在被4条大板价格使用，不能删除，请先停用', { exact: true })).toBeVisible();
  await expect(page.locator('.zdm-admin-confirm-dialog')).toHaveCount(0);

  const unusedSlabRow = page.getByRole('row').filter({ hasText: '区域合作店' });
  await unusedSlabRow.getByText('删除', { exact: true }).click();
  await expect(page.locator('.zdm-admin-confirm-dialog')).toContainText('确认删除价格配置“区域合作店”吗？');
});

test('只有一个 Tab 权限时隐藏 Tab 栏', async ({ page }) => {
  await seedLogin(page, ['admin.product-data-center.markup-configuration.finished.view']);
  await mockMarkupConfigurations(page);
  await page.goto('/markup-configuration');

  await expect(page.locator('.t-tabs')).toHaveCount(0);
  await expect(page.getByText('指导价设置', { exact: true })).toBeVisible();
  await expect(page.locator('.guide-coefficient-input input')).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存指导价' })).toHaveCount(0);
});

test('价格配置无排序和停启权限时隐藏对应操作', async ({ page }) => {
  await seedLogin(
    page,
    [
      'admin.product-data-center.markup-configuration.finished.view',
      'admin.product-data-center.markup-configuration.finished.edit',
      'admin.product-data-center.markup-configuration.finished.delete',
    ],
    ['MARKUP_OPERATOR'],
  );
  await mockMarkupConfigurations(page);
  await page.goto('/markup-configuration');

  const row = page.getByRole('row').filter({ hasText: '城市中心店' });
  await expect(row.getByText('编辑', { exact: true })).toBeVisible();
  await expect(row.getByText('删除', { exact: true })).toBeVisible();
  await expect(row.getByText('停用', { exact: true })).toHaveCount(0);
  await expect(page.locator('.t-table__handle-draggable')).toHaveCount(0);

  await row.getByText('删除', { exact: true }).click();
  await expect(page.locator('.zdm-admin-confirm-dialog')).toContainText('确认删除价格配置“城市中心店”吗？');
  const deleteRequest = page.waitForRequest(
    (request) => request.method() === 'DELETE' && request.url().endsWith('/api/admin/finished-markup-configurations/3'),
  );
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await deleteRequest;
  await expect(page.getByRole('row').filter({ hasText: '城市中心店' })).toHaveCount(0);
});

test('已发布大板始终展示自己的价格而不读取当前价格配置', async ({ page }) => {
  await seedLogin(page, ['all'], ['SUPER_ADMIN']);
  await installAdminApiMocks(page);
  await page.route('**/api/admin/slab-markup-configurations/options', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'ok',
        data: [{ id: 8, storeLevelId: 1, name: '当前发布模板', priceCoefficient: 1.2 }],
      }),
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
            id: 901,
            name: '独立价格大板',
            serialNo: 'SLAB-SNAPSHOT-901',
            warehouse: '平台仓',
            publisherType: '平台发布',
            createdByName: '运营管理员',
            costPrice: 100,
            guidePrice: 150,
            guidePriceCoefficient: 1.5,
            markupPrices: [
              {
                storeLevelId: 99,
                storeLevelName: '历史门店级别',
                priceCoefficient: 1.75,
                costPrice: 100,
                price: 175,
                priceSource: 'manual',
              },
            ],
            status: 'warehouse',
          },
        ],
      }),
    });
  });

  await page.goto('/slab-management');
  const row = page.getByRole('row', { name: /独立价格大板/ });
  await row.getByText('价格', { exact: true }).click();
  const drawer = page.locator('.t-drawer').filter({ hasText: '价格编辑器' });
  await expect(drawer.getByText('历史门店级别', { exact: false })).toBeVisible();
  await expect(drawer.getByText('当前发布模板', { exact: true })).toHaveCount(0);
  await expect(drawer.locator('input[value="175.00"]')).toBeVisible();

  await page.reload();
  await page
    .getByRole('row', { name: /独立价格大板/ })
    .getByText('编辑', { exact: true })
    .click();
  const productDialog = page.locator('.t-dialog').filter({ hasText: '编辑商品' });
  await productDialog.getByText('销售信息', { exact: true }).click();
  const historicalRow = productDialog.locator('.price-editor__row').filter({ hasText: '历史门店级别' });
  await expect(historicalRow.getByRole('textbox').first()).toHaveValue('1.75');
  await expect(historicalRow.getByRole('textbox').last()).toHaveValue('175.00');
  const configuredCurrentLevel = productDialog.locator('.price-editor__row').filter({ hasText: '1级' });
  await expect(configuredCurrentLevel.getByRole('textbox').first()).toHaveValue('1.20');
  await expect(configuredCurrentLevel.getByRole('textbox').last()).toHaveValue('120.00');
  const unconfiguredCurrentLevel = productDialog.locator('.price-editor__row').filter({ hasText: '2级' });
  await expect(unconfiguredCurrentLevel.getByRole('textbox').first()).toHaveValue('');
  await expect(unconfiguredCurrentLevel.getByRole('textbox').last()).toHaveValue('');
});
