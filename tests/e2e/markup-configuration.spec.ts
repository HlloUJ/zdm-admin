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
      id: 3,
      name: '1级合伙人价格',
      priceCoefficient: 1.3,
      sortOrder: 1,
      status: 'enabled',
      createdByAccountId: 99,
      createdByName: '其他运营员工',
      referenced: false,
    },
    {
      id: 4,
      name: '2级合伙人价格',
      priceCoefficient: 1.1,
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
  await page.route('**/api/admin/finished-guide-price-setting', async (route) => {
    const coefficient = route.request().method() === 'PUT' ? route.request().postDataJSON().priceCoefficient : null;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'ok',
        data: coefficient == null ? null : { id: 1, priceCoefficient: coefficient },
      }),
    });
  });
  await page.route('**/api/admin/slab-guide-price-setting', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: null }),
    });
  });
};

test('运营平台可分别配置指导价和合伙人阶梯价', async ({ page }) => {
  await seedLogin(page, ['all'], ['SUPER_ADMIN']);
  await mockMarkupConfigurations(page);
  await page.goto('/markup-configuration');

  await expect(page.getByText('商品默认价格规则')).toBeVisible();
  await expect(page.getByText('成品价格配置', { exact: true })).toBeVisible();
  await expect(page.getByText('大板价格配置', { exact: true })).toBeVisible();
  await expect(page.getByText('指导价设置', { exact: true })).toBeVisible();
  const guideCard = page.locator('.guide-card');
  const partnerCard = page.locator('.partner-card');
  await expect(guideCard.locator('.guide-setting-form')).toContainText('价格系数');
  await expect(guideCard.getByText('等级名称', { exact: true })).toHaveCount(0);
  await expect(partnerCard.getByText('合伙人阶梯价', { exact: true })).toBeVisible();
  await expect(partnerCard.getByText('等级名称', { exact: true })).toBeVisible();
  const guideCoefficientInput = page.locator('.guide-coefficient-input input');
  await expect(guideCoefficientInput).toHaveValue('');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(guideCard.getByText('请输入价格系数', { exact: true })).toBeVisible();
  await guideCoefficientInput.fill('01');
  await guideCoefficientInput.blur();
  await expect(guideCard.getByText('请输入正确的价格系数', { exact: true })).toBeVisible();
  await guideCoefficientInput.fill('0.5');
  await expect(guideCard.getByText('请输入正确的价格系数', { exact: true })).toHaveCount(0);
  await guideCoefficientInput.fill('');
  await guideCoefficientInput.press('a');
  await guideCoefficientInput.press('-');
  await guideCoefficientInput.press('e');
  await guideCoefficientInput.press('Space');
  await expect(guideCoefficientInput).toHaveValue('');
  await guideCoefficientInput.pressSequentially('1.2');
  await guideCoefficientInput.press('.');
  await guideCoefficientInput.press('a');
  await expect(guideCoefficientInput).toHaveValue('1.2');
  await expect(page.getByRole('cell', { name: '1级合伙人价格', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '价格系数' })).toBeVisible();
  await expect(page.locator('thead').getByTitle('拖拽排序')).toBeVisible();

  const partnerRow = page.getByRole('row').filter({ hasText: '1级合伙人价格' });
  const secondPartnerRow = page.getByRole('row').filter({ hasText: '2级合伙人价格' });
  const reorderRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' && request.url().endsWith('/api/admin/finished-markup-configurations/reorder'),
  );
  await partnerRow.locator('.t-table__handle-draggable').dragTo(secondPartnerRow.locator('.t-table__handle-draggable'));
  expect((await reorderRequest).postDataJSON()).toEqual({ orderedIds: [4, 3] });
  await expect(page.getByText('已更新排序“1级合伙人价格”', { exact: true }).last()).toBeVisible();

  await page.getByRole('button', { name: '新增阶梯价' }).click();
  const priceCoefficientInput = page.locator('.price-coefficient-input input');
  await expect(priceCoefficientInput).toHaveValue('');
  await priceCoefficientInput.focus();
  await priceCoefficientInput.blur();
  await expect(priceCoefficientInput).toHaveValue('');
  const createDialog = page.locator('.t-dialog').filter({ hasText: '新增合伙人阶梯价' });
  await expect(createDialog.getByText('请输入价格系数', { exact: true })).toBeVisible();
  await priceCoefficientInput.fill('01');
  await priceCoefficientInput.blur();
  await expect(createDialog.getByText('请输入正确的价格系数', { exact: true })).toBeVisible();
  await priceCoefficientInput.fill('0.5');
  await expect(createDialog.getByText('请输入正确的价格系数', { exact: true })).toHaveCount(0);
  await priceCoefficientInput.press('a');
  await priceCoefficientInput.press('-');
  await expect(priceCoefficientInput).toHaveValue('0.5');
  await page.getByRole('button', { name: '取消' }).click();

  await page.getByRole('row').filter({ hasText: '1级合伙人价格' }).getByText('编辑', { exact: true }).click();
  await expect(priceCoefficientInput).toHaveValue('1.30');
  await priceCoefficientInput.fill('01');
  await priceCoefficientInput.blur();
  const editDialog = page.locator('.t-dialog').filter({ hasText: '编辑合伙人阶梯价' });
  await expect(editDialog.getByText('请输入正确的价格系数', { exact: true })).toBeVisible();
  await priceCoefficientInput.fill('0.50');
  await expect(editDialog.getByText('请输入正确的价格系数', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '取消' }).click();

  await page.getByText('大板价格配置', { exact: true }).click();
  await expect(page.getByRole('cell', { name: '1级合伙人价格', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '价格系数' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '0.5', exact: true })).toBeVisible();
});

test('只有一个 Tab 权限时隐藏 Tab 栏', async ({ page }) => {
  await seedLogin(page, ['admin.product-data-center.markup-configuration.finished.view']);
  await mockMarkupConfigurations(page);
  await page.goto('/markup-configuration');

  await expect(page).toHaveURL(/markup-configuration/);
  await expect(page.locator('.t-tabs')).toHaveCount(0);
  await expect(page.getByText('指导价设置', { exact: true })).toBeVisible();
  await expect(page.locator('.guide-coefficient-input input')).toHaveValue('');
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

  await expect(page.getByRole('cell', { name: '1级合伙人价格', exact: true })).toBeVisible();
  const otherCreatorRow = page.getByRole('row').filter({ hasText: '1级合伙人价格' });

  await otherCreatorRow.getByText('编辑', { exact: true }).click();
  await expect(page.getByText('不可操作其他用户添加的数据', { exact: true }).last()).toBeVisible();
  await expect(page.locator('.t-dialog').filter({ hasText: '编辑合伙人阶梯价' })).toHaveCount(0);

  await otherCreatorRow.getByText('停用', { exact: true }).click();
  await expect(page.getByText('不可操作其他用户添加的数据', { exact: true }).last()).toBeVisible();
  await expect(page.locator('.t-dialog').filter({ hasText: '停用合伙人阶梯价' })).toHaveCount(0);

  const secondPartnerRow = page.getByRole('row').filter({ hasText: '2级合伙人价格' });
  await otherCreatorRow
    .locator('.t-table__handle-draggable')
    .dragTo(secondPartnerRow.locator('.t-table__handle-draggable'));
  await expect(page.getByText('不可操作其他用户添加的数据', { exact: true }).last()).toBeVisible();
});
