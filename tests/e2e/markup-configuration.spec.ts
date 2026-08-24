import { expect, test } from '@playwright/test';

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
  const finished = [
    {
      id: 1,
      name: '指导价',
      markupRate: 0,
      sortOrder: 1,
      status: 'enabled',
      createdByAccountId: 99,
      createdByName: '其他运营员工',
      referenced: false,
    },
    {
      id: 3,
      name: '1级合伙人价格',
      markupRate: 30,
      sortOrder: 2,
      status: 'enabled',
      createdByAccountId: 99,
      createdByName: '其他运营员工',
      referenced: false,
    },
  ];
  const slabs = [
    {
      id: 2,
      name: '1级合伙人价格',
      priceCoefficient: 0.5,
      sortOrder: 1,
      status: 'enabled',
      createdByAccountId: 99,
      createdByName: '其他运营员工',
      referenced: false,
    },
  ];
  await page.route('**/api/admin/finished-markup-configurations**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: finished }),
    });
  });
  await page.route('**/api/admin/slab-markup-configurations**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: slabs }),
    });
  });
};

test('运营平台可按成品和大板分别管理加价配置', async ({ page }) => {
  await seedLogin(page, ['all'], ['SUPER_ADMIN']);
  await mockMarkupConfigurations(page);
  await page.goto('/markup-configuration');

  await expect(page.getByText('平台供货价规则')).toBeVisible();
  await expect(page.getByText('成品加价配置', { exact: true })).toBeVisible();
  await expect(page.getByText('大板加价配置', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '1级合伙人价格', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '加价率' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '换算系数' })).toBeVisible();
  await expect(page.locator('thead').getByTitle('拖拽排序')).toBeVisible();

  const guideRow = page.getByRole('row').filter({ hasText: '指导价' });
  const partnerRow = page.getByRole('row').filter({ hasText: '1级合伙人价格' });
  const reorderRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' && request.url().endsWith('/api/admin/finished-markup-configurations/reorder'),
  );
  await guideRow.locator('.t-table__handle-draggable').dragTo(partnerRow.locator('.t-table__handle-draggable'));
  expect((await reorderRequest).postDataJSON()).toEqual({ orderedIds: [3, 1] });
  await expect(page.getByText('已更新排序“指导价”', { exact: true }).last()).toBeVisible();

  await page.getByRole('button', { name: '新增' }).click();
  const markupRateInput = page.locator('.markup-rate-input input');
  await expect(markupRateInput).toHaveValue('0.00');
  await markupRateInput.focus();
  await expect(markupRateInput).toHaveValue('');
  await markupRateInput.blur();
  await expect(markupRateInput).toHaveValue('0.00');
  await page.getByRole('button', { name: '取消' }).click();

  await page.getByRole('row').filter({ hasText: '1级合伙人价格' }).getByText('编辑', { exact: true }).click();
  await expect(markupRateInput).toHaveValue('30.00');
  await markupRateInput.focus();
  await expect(markupRateInput).toHaveValue('30');
  await markupRateInput.blur();
  await expect(markupRateInput).toHaveValue('30.00');
  await page.getByRole('button', { name: '取消' }).click();

  await page.getByText('大板加价配置', { exact: true }).click();
  await expect(page.getByRole('cell', { name: '1级合伙人价格', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '价格系数' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '0.5', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '加价率' })).toHaveCount(0);
});

test('只有一个 Tab 权限时隐藏 Tab 栏', async ({ page }) => {
  await seedLogin(page, ['admin.product-data-center.markup-configuration.finished.view']);
  await mockMarkupConfigurations(page);
  await page.goto('/markup-configuration');

  await expect(page).toHaveURL(/markup-configuration/);
  await expect(page.locator('.t-tabs')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '指导价', exact: true })).toBeVisible();
});

test('忽略数据权限查看全部配置但不能操作他人数据', async ({ page }) => {
  await seedLogin(
    page,
    [
      'admin.product-data-center.markup-configuration.finished.view',
      'admin.product-data-center.markup-configuration.finished.edit',
      'admin.product-data-center.markup-configuration.finished.sort',
      'admin.product-data-center.markup-configuration.finished.toggle-status',
      'admin.product-data-center.markup-configuration.finished.delete',
    ],
    ['MARKUP_OPERATOR'],
  );
  await mockMarkupConfigurations(page);
  await page.goto('/markup-configuration');

  await expect(page.getByRole('cell', { name: '指导价', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '1级合伙人价格', exact: true })).toBeVisible();
  const otherCreatorRow = page.getByRole('row').filter({ hasText: '1级合伙人价格' });

  await otherCreatorRow.getByText('编辑', { exact: true }).click();
  await expect(page.getByText('不可操作其他用户添加的数据', { exact: true }).last()).toBeVisible();
  await expect(page.locator('.t-dialog').filter({ hasText: '编辑加价配置' })).toHaveCount(0);

  await otherCreatorRow.getByText('停用', { exact: true }).click();
  await expect(page.getByText('不可操作其他用户添加的数据', { exact: true }).last()).toBeVisible();
  await expect(page.locator('.t-dialog').filter({ hasText: '停用加价配置' })).toHaveCount(0);

  const guideRow = page.getByRole('row').filter({ hasText: '指导价' });
  await otherCreatorRow.locator('.t-table__handle-draggable').dragTo(guideRow.locator('.t-table__handle-draggable'));
  await expect(page.getByText('不可操作其他用户添加的数据', { exact: true }).last()).toBeVisible();
});
