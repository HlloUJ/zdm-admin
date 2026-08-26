import { expect, test } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

const categoryCatalogActionLabels = ['查看', '新增一级分类', '新增下级', '编辑', '上移', '下移', '停用/启用', '删除'];
const productSecondMenuLabels = ['商品公共基础数据', '成品现货基础数据', '大板基础数据'];
const adminProductSecondMenuLabels = ['大板管理', ...productSecondMenuLabels];
const productThirdMenuLabels = [
  '商品分类管理',
  '属性库管理',
  '属性值管理',
  '分类属性模板',
  '工艺管理',
  '品种管理',
  '产地管理',
  '纹理管理',
  '色系管理',
  '等级管理',
];
const adminProductThirdMenuLabels = [
  '—',
  ...productThirdMenuLabels.slice(0, 4),
  '价格配置',
  ...productThirdMenuLabels.slice(4),
];

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

test('shows global attribute data and only granted attribute operation buttons', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 11,
        name: '受限属性库管理员',
        phone: '15926620011',
        roles: ['ATTRIBUTE_STATUS_OPERATOR'],
        permissions: [
          'admin.product-data-center.attribute.shared.view',
          'admin.product-data-center.attribute.shared.toggle-status',
        ],
        dataPermission: 'self',
      }),
    );
  });

  await page.goto('/product-attribute');
  const main = page.getByRole('main');
  const attributeRow = main.locator('tbody tr').filter({ hasText: 'E2E 全局共享属性' });
  const attributeActions = attributeRow.locator('.table-actions');

  await expect(attributeRow).toContainText('其他管理员');
  await expect(main.getByRole('button', { name: '新增' })).toHaveCount(0);
  await expect(attributeActions.locator('.t-link')).toHaveCount(1);
  await expect(attributeActions.locator('.t-link')).toHaveText(/^(停用|启用)$/);
  await expect(attributeActions.getByText('删除', { exact: true })).toHaveCount(0);
  await expect(main.locator('.scope-controls .t-tabs')).toHaveCount(0);
});

test('shows only granted attribute tabs and falls back to the first accessible tab', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 12,
        name: '属性库多 Tab 管理员',
        phone: '15926620012',
        roles: ['ATTRIBUTE_TAB_VIEWER'],
        permissions: [
          'admin.product-data-center.attribute.finished.view',
          'admin.product-data-center.attribute.accessory.view',
        ],
        dataPermission: 'self',
      }),
    );
  });

  await page.goto('/product-attribute');
  const main = page.getByRole('main');

  await expect(main.locator('.scope-controls .t-tabs__nav-item')).toHaveText(['成品现货专属属性', '配件专属属性']);
  await expect(main.getByText('E2E 成品现货专属属性', { exact: true })).toBeVisible();
  await expect(main.getByText('E2E 全局共享属性', { exact: true })).toHaveCount(0);
  await expect(main.getByText('成品现货属性库', { exact: true })).toBeVisible();
});

test('shows global attribute values and only granted attribute-value operation buttons', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 13,
        name: '受限属性值管理员',
        phone: '15926620013',
        roles: ['ATTRIBUTE_VALUE_STATUS_OPERATOR'],
        permissions: [
          'admin.product-data-center.attribute-value.shared.view',
          'admin.product-data-center.attribute-value.shared.toggle-status',
        ],
        dataPermission: 'self',
      }),
    );
  });

  await page.goto('/product-attribute-value');
  const main = page.getByRole('main');
  const valueRow = main.locator('tbody tr').filter({ hasText: 'E2E 全局共享属性值' });
  const valueActions = valueRow.locator('.table-actions');

  await expect(valueRow).toContainText('其他管理员');
  await expect(main.getByRole('button', { name: '新增' })).toHaveCount(0);
  await expect(valueActions.locator('.t-link')).toHaveCount(1);
  await expect(valueActions.locator('.t-link')).toHaveText(/^(停用|启用)$/);
  await expect(valueActions.getByText('删除', { exact: true })).toHaveCount(0);
  await expect(main.locator('.scope-controls .t-tabs')).toHaveCount(0);
});

test('shows only granted attribute-value tabs and falls back to the first accessible tab', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 14,
        name: '属性值多 Tab 管理员',
        phone: '15926620014',
        roles: ['ATTRIBUTE_VALUE_TAB_VIEWER'],
        permissions: [
          'admin.product-data-center.attribute-value.finished.view',
          'admin.product-data-center.attribute-value.accessory.view',
        ],
        dataPermission: 'self',
      }),
    );
  });

  await page.goto('/product-attribute-value');
  const main = page.getByRole('main');

  await expect(main.locator('.scope-controls .t-tabs__nav-item')).toHaveText(['成品现货专属值', '配件专属值']);
  await expect(main.getByText('E2E 成品现货专属值', { exact: true })).toBeVisible();
  await expect(main.getByText('E2E 全局共享属性值', { exact: true })).toHaveCount(0);
});

test('shows only granted craft operation buttons for a restricted account', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 9,
        name: '受限工艺管理员',
        phone: '15926620009',
        roles: ['CRAFT_EDITOR'],
        permissions: [
          'admin.product-data-center.finished-stock-craft.view',
          'admin.product-data-center.finished-stock-craft.edit',
        ],
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/finished-stock-craft');
  const main = page.getByRole('main');
  const craftRow = main.locator('tbody tr').filter({ hasText: 'E2E 边工艺' });
  const craftActions = craftRow.locator('.table-actions');

  await expect(craftRow).toBeVisible();
  await expect(main.getByRole('button', { name: '新增' })).toHaveCount(0);
  await expect(craftActions.getByText('编辑', { exact: true })).toBeVisible();
  await expect(craftActions.getByText('停用', { exact: true })).toHaveCount(0);
  await expect(craftActions.getByText('启用', { exact: true })).toHaveCount(0);
  await expect(craftActions.getByText('删除', { exact: true })).toHaveCount(0);
});

test('shows only granted category operation buttons for a restricted account', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 10,
        name: '受限分类管理员',
        phone: '15926620010',
        roles: ['CATEGORY_EDITOR'],
        permissions: [
          'admin.product-data-center.category.finished.view',
          'admin.product-data-center.category.finished.edit',
          'admin.product-data-center.category.finished.move-up',
          'admin.product-data-center.category.finished.move-down',
          'admin.product-data-center.category.finished.disable',
          'admin.product-data-center.category.accessory.view',
        ],
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/product-category');
  const main = page.getByRole('main');
  const categoryRow = main.locator('tbody tr').filter({ hasText: '成品现货' });
  const categoryActions = categoryRow.locator('.table-actions');

  await expect(categoryRow).toBeVisible();
  await expect(main.getByRole('button', { name: '新增一级分类' })).toHaveCount(0);
  await expect(categoryActions.getByText('新增下级', { exact: true })).toHaveCount(0);
  await expect(categoryActions.getByText('编辑', { exact: true })).toBeVisible();
  await expect(categoryActions.getByText('上移', { exact: true })).toBeVisible();
  await expect(categoryActions.getByText('下移', { exact: true })).toBeVisible();
  await expect(categoryActions.locator('.t-link').filter({ hasText: /^(停用|启用)$/ })).toBeVisible();
  await expect(categoryActions.getByText('删除', { exact: true })).toHaveCount(0);
  await expect(main.locator('.scope-tabs')).toContainText('成品现货分类');
  await expect(main.locator('.scope-tabs')).toContainText('配件分类');
});

test('shows the finished category buttons granted to account 15900000001', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 3,
        name: '张飞',
        phone: '15900000001',
        roles: ['CATEGORY_OPERATOR'],
        permissions: [
          'admin.product-data-center.category.finished.view',
          'admin.product-data-center.category.finished.create-root',
          'admin.product-data-center.category.finished.disable',
          'admin.product-data-center.category.finished.enable',
          'admin.product-data-center.category.finished.delete',
        ],
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/product-category');
  const main = page.getByRole('main');
  const rootRow = main.locator('tbody tr').filter({ hasText: '成品现货' });
  const rootActions = rootRow.locator('.table-actions');

  await expect(main.locator('.scope-tabs')).toHaveCount(0);
  await expect(main.getByRole('button', { name: '新增一级分类' })).toBeVisible();
  await expect(rootActions.getByText('新增下级', { exact: true })).toHaveCount(0);
  await expect(rootActions.getByText('编辑', { exact: true })).toHaveCount(0);
  await expect(rootActions.getByText('上移', { exact: true })).toHaveCount(0);
  await expect(rootActions.getByText('下移', { exact: true })).toHaveCount(0);
  await expect(rootActions.locator('.t-link').filter({ hasText: /^(停用|启用)$/ })).toBeVisible();
  await expect(rootActions.getByText('删除', { exact: true })).toBeVisible();

  await rootRow.getByRole('button', { name: '展开下级分类' }).click();
  const childRow = main.locator('tbody tr').filter({ hasText: '岩板餐桌' });
  await expect(childRow.locator('.table-actions .t-link').filter({ hasText: /^(停用|启用)$/ })).toBeVisible();
});

test('shows only the granted product category tab', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 12,
        name: '成品现货分类查看员',
        phone: '15926620012',
        roles: ['FINISHED_CATEGORY_VIEWER'],
        permissions: ['admin.product-data-center.category.finished.view'],
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/product-category');
  const main = page.getByRole('main');

  await expect(main.locator('.scope-tabs')).toHaveCount(0);
  await expect(main.locator('.zdm-admin-page-header')).toContainText('成品现货分类');
  await expect(main.getByText('配件分类', { exact: true })).toHaveCount(0);
});

test('falls back to the only granted product category tab', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 13,
        name: '配件分类查看员',
        phone: '15926620013',
        roles: ['ACCESSORY_CATEGORY_VIEWER'],
        permissions: ['admin.product-data-center.category.accessory.view'],
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/product-category');
  const main = page.getByRole('main');

  await expect(main.locator('.scope-tabs')).toHaveCount(0);
  await expect(main.locator('.zdm-admin-page-header')).toContainText('配件分类');
  await expect(main.getByText('成品现货分类', { exact: true })).toHaveCount(0);
});

test('shows slab variety edit without status operation for an edit-only account', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 11,
        name: '受限品种管理员',
        phone: '15926620011',
        roles: ['SLAB_VARIETY_EDITOR'],
        permissions: ['admin.product-data-center.slab-variety.view', 'admin.product-data-center.slab-variety.edit'],
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/slab-variety');
  const main = page.getByRole('main');
  const varietyRow = main.locator('tbody tr').filter({ hasText: '潘多拉' });
  const varietyActions = varietyRow.locator('.table-actions');

  await expect(varietyRow).toBeVisible();
  await expect(main.locator('thead')).toContainText('创建人');
  await expect(varietyRow).toContainText('韩健');
  await expect(main.getByRole('button', { name: '新增' })).toHaveCount(0);
  await expect(varietyActions.getByText('编辑', { exact: true })).toBeVisible();
  await expect(varietyActions.getByText('停用', { exact: true })).toHaveCount(0);
  await expect(varietyActions.getByText('删除', { exact: true })).toHaveCount(0);
});

test('shows slab variety status without edit operation for a status-only account', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 12,
        name: '受限品种管理员',
        phone: '15926620012',
        roles: ['SLAB_VARIETY_STATUS_MANAGER'],
        permissions: [
          'admin.product-data-center.slab-variety.view',
          'admin.product-data-center.slab-variety.toggle-status',
        ],
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/slab-variety');
  const main = page.getByRole('main');
  const varietyRow = main.locator('tbody tr').filter({ hasText: '潘多拉' });
  const varietyActions = varietyRow.locator('.table-actions');

  await expect(varietyRow).toBeVisible();
  await expect(main.getByRole('button', { name: '新增' })).toHaveCount(0);
  await expect(varietyActions.getByText('编辑', { exact: true })).toHaveCount(0);
  await expect(varietyActions.getByText('删除', { exact: true })).toHaveCount(0);
  await expect(varietyActions.locator('.t-link')).toHaveCount(1);
  await expect(varietyActions.locator('.t-link')).toHaveText(/^(停用|启用)$/);
});

test('shows supplier status without unrelated operations for a status-only account', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 13,
        name: '受限供应商管理员',
        phone: '15926620013',
        roles: ['SUPPLIER_STATUS_MANAGER'],
        permissions: ['admin.supplier-management.view', 'admin.supplier-management.toggle-status'],
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/supplier-management');
  const main = page.getByRole('main');
  const supplierRow = main.locator('tbody tr').filter({ hasText: '装点猫大板供应商' }).first();
  const supplierActions = supplierRow.locator('.table-actions');

  await expect(supplierRow).toBeVisible();
  await expect(main.getByRole('button', { name: '新增' })).toHaveCount(0);
  await expect(supplierActions.getByText('编辑', { exact: true })).toHaveCount(0);
  await expect(supplierActions.getByText('删除', { exact: true })).toHaveCount(0);
  await expect(supplierActions.locator('.t-link')).toHaveCount(1);
  await expect(supplierActions.locator('.t-link')).toHaveText(/^(停用|启用)$/);
});

test('allows account 15900000002 with self data scope to view all suppliers', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 4,
        name: '张飞',
        phone: '15900000002',
        roles: ['OPERATION_MANAGER'],
        permissions: ['admin.supplier-management.view'],
        dataPermission: 'self',
      }),
    );
  });

  await page.goto('/supplier-management');
  const main = page.getByRole('main');

  await expect(main.getByText('装点猫大板供应商', { exact: true })).toBeVisible();
  await expect(main.getByText('装点猫成品供应商', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: '新增' })).toHaveCount(0);
  await expect(main.locator('.table-actions .t-link')).toHaveCount(0);
});

test('opens employee invite and edit dialogs', async ({ page }) => {
  await page.goto('/employee-management');
  const main = page.getByRole('main');

  await expect(main.getByText('员工管理')).toBeVisible();
  await expect(main.getByText(/共 \d+ 条数据/)).toBeVisible();
  await expect(main.locator('thead')).toContainText('创建人');
  await expect(main.locator('thead')).toContainText('注册时间');

  await main.getByRole('button', { name: /邀请员工/ }).click();
  const inviteDialog = page.locator('.t-dialog').filter({ hasText: '邀请员工' });
  await expect(inviteDialog).toBeVisible();
  await expect(inviteDialog.getByText('员工邀请链接')).toBeVisible();
  await expect(inviteDialog.locator('textarea')).toHaveValue(/\/employee-invite\?token=e2e-invite-token/);
  await inviteDialog.getByRole('button', { name: '关闭' }).click();

  const firstEmployeeRow = page.locator('tbody tr').filter({ hasText: '15926626945' }).first();
  await expect(firstEmployeeRow).toBeVisible();
  await expect(firstEmployeeRow).toContainText('韩健');
  await expect(firstEmployeeRow).toContainText('2026/07/27 09:00');
  await expect(firstEmployeeRow.locator('.remark-cell')).toHaveCSS('max-width', '150px');
  await expect(firstEmployeeRow.locator('.remark-cell')).toHaveCSS('text-overflow', 'ellipsis');
  await firstEmployeeRow.locator('.remark-cell').hover();
  await expect(page.locator('.t-popup').filter({ hasText: '系统内置超管' }).last()).toBeVisible();
  await firstEmployeeRow.getByText('编辑', { exact: true }).click();
  const profileDialog = page.locator('.t-dialog').filter({ hasText: '编辑资料' });
  await expect(profileDialog).toBeVisible();
  await expect(profileDialog.locator('label').filter({ hasText: '姓名' })).toBeVisible();
  await expect(profileDialog.locator('label').filter({ hasText: '性别' })).toBeVisible();
  await expect(profileDialog.locator('label').filter({ hasText: '手机号码' })).toHaveCount(0);
  await expect(profileDialog.locator('label').filter({ hasText: '备注' })).toBeVisible();
  await expect(profileDialog.locator('label').filter({ hasText: '角色' })).toHaveCount(0);
  await expect(profileDialog.getByText('数据权限')).toHaveCount(0);
  await profileDialog.locator('textarea').fill('备注'.repeat(50));
  const profileUpdateRequest = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().endsWith('/api/admin/employees/1'),
  );
  await profileDialog.getByRole('button', { name: '提交' }).click();
  await expect((await profileUpdateRequest).postDataJSON()).toMatchObject({ phone: '15926626945' });
  await expect(page.getByText('备注最多输入100个字符')).toHaveCount(0);
  await expect(profileDialog).toBeHidden();

  const firstEmployeeActions = firstEmployeeRow.locator('.table-actions');
  await expect(firstEmployeeActions.getByText('角色', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeActions.getByText('停用', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeActions.getByText('启用', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeActions.getByText('删除', { exact: true })).toHaveCount(0);

  const pendingEmployeeRow = page.locator('tbody tr').filter({ hasText: '15926628888' }).first();
  await expect(pendingEmployeeRow).toBeVisible();
  await pendingEmployeeRow.getByText('角色', { exact: true }).click();
  const employeePermissionDialog = page.locator('.t-dialog').filter({ hasText: '配置权限' });
  await expect(employeePermissionDialog).toBeVisible();
  await expect(employeePermissionDialog.locator('label').filter({ hasText: '角色' })).toBeVisible();
  await expect(employeePermissionDialog.getByText('数据权限')).toBeVisible();
  await expect(employeePermissionDialog.locator('label').filter({ hasText: '姓名' })).toHaveCount(0);
  await expect(employeePermissionDialog.locator('label').filter({ hasText: '性别' })).toHaveCount(0);
  await expect(employeePermissionDialog.locator('label').filter({ hasText: '备注' })).toHaveCount(0);
  await employeePermissionDialog.locator('.t-select').click();
  await expect(page.getByRole('listitem', { name: '运营管理平台角色' })).toBeVisible();
  await expect(page.getByRole('listitem', { name: '未配置权限角色' })).toHaveCount(0);
  await employeePermissionDialog.getByRole('button', { name: '取消' }).click();
});

test('registers from employee invite link', async ({ page }) => {
  await page.goto('/employee-invite?token=e2e-invite-token');

  await expect(page.getByRole('heading', { name: '员工注册' })).toBeVisible();
  await page.getByPlaceholder('请输入手机号').fill('15926629999');
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.getByText('验证码已发送')).toBeVisible();
  await page.getByPlaceholder('请输入验证码').fill('888888');
  await page.getByRole('button', { name: '下一步' }).click();

  await page.getByPlaceholder('请输入姓名').fill('待审核员工');
  await page.locator('.gender-radio').getByText('男').click();
  await page.getByRole('button', { name: '提交注册' }).click();

  await expect(page.getByRole('heading', { name: '注册信息已提交' })).toBeVisible();
  await expect(page.getByText('请等待超级管理员确认信息并启用账号。')).toBeVisible();
});

test('rejects an existing organization employee before requesting a verification code', async ({ page }) => {
  await page.goto('/employee-invite?token=e2e-invite-token');
  await page.getByPlaceholder('请输入手机号').fill('15926626945');

  const requestCodeButton = page.getByRole('button', { name: '获取验证码' });
  await requestCodeButton.click();

  await expect(page.getByText('该手机号已是当前组织员工')).toBeVisible();
  await expect(requestCodeButton).toHaveText('获取验证码');
  await expect(requestCodeButton).toBeEnabled();
  await expect(page.getByPlaceholder('请输入验证码')).toHaveValue('');
});

test('validates role and data permission before enabling employee', async ({ page }) => {
  await page.goto('/employee-management');

  const pendingEmployeeRow = page.locator('tbody tr').filter({ hasText: '15926628888' }).first();
  await expect(pendingEmployeeRow).toBeVisible();

  await pendingEmployeeRow.getByText('启用', { exact: true }).click();

  await expect(page.getByText('请先为员工配置角色和数据权限后再启用')).toBeVisible();
  await expect(page.locator('.t-dialog').filter({ hasText: '是否启用员工“待启用员工”？' })).toHaveCount(0);
});

test('opens enable confirmation after employee permissions are configured', async ({ page }) => {
  await page.goto('/employee-management');

  const pendingEmployeeRow = page.locator('tbody tr').filter({ hasText: '15926628888' }).first();
  await expect(pendingEmployeeRow).toBeVisible();

  await pendingEmployeeRow.getByText('角色', { exact: true }).click();
  const employeePermissionDialog = page.locator('.t-dialog').filter({ hasText: '配置权限' });
  await expect(employeePermissionDialog).toBeVisible();
  await employeePermissionDialog.getByText('查看自己').click();
  await employeePermissionDialog.locator('.t-select').click();
  await page.getByRole('listitem', { name: '运营管理平台角色' }).click();
  await employeePermissionDialog.locator('.t-dialog__header').click();
  const permissionUpdateRequest = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith('/api/admin/employees/2/permissions'),
  );
  await employeePermissionDialog.getByRole('button', { name: '提交' }).click();
  await expect((await permissionUpdateRequest).postDataJSON()).toEqual({ roleIds: '2', dataPermission: 'self' });
  await expect(employeePermissionDialog).toBeHidden();

  await pendingEmployeeRow.getByText('启用', { exact: true }).click();

  await expect(
    page.locator('.t-dialog').filter({ hasText: '是否启用员工“待启用员工”？启用后恢复登录权限。' }),
  ).toBeVisible();
});

test('filters menu and employee actions by logged-in permissions', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 2,
        name: '权限员工',
        phone: '15900000001',
        roles: ['ADMIN_MANAGER'],
        permissions: [
          'admin.permission-management.employee-management.view',
          'admin.permission-management.employee-management.edit',
        ],
        employeeId: 999,
        tenantId: 1,
        storeId: 1,
        dataPermission: 'self',
      }),
    );
  });

  await page.goto('/employee-management');
  const sideNav = page.locator('.side-nav');
  const firstEmployeeRow = page.locator('tbody tr').filter({ hasText: '15926626945' }).first();
  const firstEmployeeActions = firstEmployeeRow.locator('.table-actions');

  await expect(sideNav.getByText('工作台')).toHaveCount(0);
  await expect(sideNav.getByText('员工管理')).toBeVisible();
  await expect(sideNav.getByText('角色管理')).toHaveCount(0);
  await expect(sideNav.getByText('商品分类管理')).toHaveCount(0);
  await expect(sideNav.getByText('属性库管理')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /邀请员工/ })).toHaveCount(0);
  await expect(firstEmployeeActions.getByText('编辑', { exact: true })).toBeVisible();
  await expect(firstEmployeeActions.getByText('角色', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeActions.getByText('停用', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeActions.getByText('启用', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeActions.getByText('删除', { exact: true })).toHaveCount(0);

  const pendingEmployeeRow = page.locator('tbody tr').filter({ hasText: '15926628888' }).first();
  const pendingEmployeeActions = pendingEmployeeRow.locator('.table-actions');
  await expect(pendingEmployeeActions.getByText('编辑', { exact: true })).toBeVisible();
  await expect(pendingEmployeeActions.getByText('角色', { exact: true })).toHaveCount(0);
});

test('shows employee permission action without edit action for permission-only users', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 5,
        name: '员工权限管理员',
        phone: '15900000005',
        roles: ['EMPLOYEE_PERMISSION_MANAGER'],
        permissions: [
          'admin.permission-management.employee-management.view',
          'admin.permission-management.employee-management.permission',
        ],
        employeeId: 5,
        tenantId: 1,
        storeId: 1,
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/employee-management');
  const permissionOnlyEmployeeRow = page.locator('tbody tr').filter({ hasText: '15926628888' }).first();
  const permissionOnlyEmployeeActions = permissionOnlyEmployeeRow.locator('.table-actions');
  await expect(permissionOnlyEmployeeActions.getByText('编辑', { exact: true })).toHaveCount(0);
  await expect(permissionOnlyEmployeeActions.getByText('角色', { exact: true })).toBeVisible();
});

test('allows granted employee operations for records created by another account', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 19,
        name: '门店店长',
        phone: '13900000001',
        roles: ['STORE_MANAGER'],
        permissions: [
          'admin.permission-management.employee-management.view',
          'admin.permission-management.employee-management.edit',
          'admin.permission-management.employee-management.permission',
          'admin.permission-management.employee-management.toggle-status',
          'admin.permission-management.employee-management.delete',
        ],
        employeeId: 19,
        tenantId: 14,
        storeId: 14,
        dataPermission: 'self',
      }),
    );
  });

  await page.goto('/employee-management');
  const row = page.locator('tbody tr').filter({ hasText: '15926627777' }).first();
  const actions = row.locator('.table-actions');

  await actions.getByText('编辑', { exact: true }).click();
  const profileDialog = page.locator('.t-dialog').filter({ hasText: '编辑资料' });
  await expect(profileDialog).toBeVisible();
  await profileDialog.getByRole('button', { name: '取消' }).click();

  await actions.getByText('角色', { exact: true }).click();
  const permissionDialog = page.locator('.t-dialog').filter({ hasText: '配置权限' });
  await expect(permissionDialog).toBeVisible();
  await permissionDialog.getByRole('button', { name: '取消' }).click();

  await actions.getByText(/^(停用|启用)$/).click();
  const statusDialog = page.locator('.t-dialog').filter({ hasText: /是否(停用|启用)员工/ });
  await expect(statusDialog).toBeVisible();
  await statusDialog.getByRole('button', { name: '取消' }).click();

  await actions.getByText('删除', { exact: true }).click();
  const deleteDialog = page.locator('.t-dialog').filter({ hasText: '是否删除员工' });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: '取消' }).click();
});

test('hides all operations for the current employee', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        name: '韩健',
        phone: '15926627777',
        roles: ['EMPLOYEE_MANAGER'],
        permissions: [
          'admin.permission-management.employee-management.view',
          'admin.permission-management.employee-management.edit',
          'admin.permission-management.employee-management.permission',
          'admin.permission-management.employee-management.toggle-status',
          'admin.permission-management.employee-management.delete',
        ],
        employeeId: 3,
        tenantId: 1,
        storeId: 1,
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/employee-management');
  const row = page.locator('tbody tr').filter({ hasText: '15926627777' }).first();

  const actions = row.locator('.table-actions');
  await expect(actions.getByText('编辑', { exact: true })).toHaveCount(0);
  await expect(actions.getByText('角色', { exact: true })).toHaveCount(0);
  await expect(actions.getByText('停用', { exact: true })).toHaveCount(0);
  await expect(actions.getByText('删除', { exact: true })).toHaveCount(0);
  await expect(actions.locator('.table-action-placeholder')).toHaveText('-');
});

test('shows current account info and logout on tenant management page', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 4,
        name: '租户管理员',
        phone: '15900000004',
        roles: ['TENANT_MANAGER'],
        roleNames: ['租户管理员'],
        identityType: 'tenant_admin',
        permissions: ['admin.tenant.tenant-management.unarchived.view'],
        employeeId: 4,
        tenantId: 1,
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/tenant-management');

  await expect(page.locator('.top-nav .user-name')).toHaveText('租户管理员');
  await expect(page.locator('.top-nav .user-role')).toHaveText('租户管理员');
  await expect(page.getByRole('button', { name: /退出登录/ })).toBeVisible();
});

test('shows only granted store management operations for a restricted account', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 12,
        name: '门店受限管理员',
        phone: '15900000012',
        roles: ['STORE_OPERATOR'],
        permissions: [
          'admin.tenant.tenant-store-management.operating.view',
          'admin.tenant.tenant-store-management.operating.edit-level',
          'admin.tenant.tenant-store-management.operating.archive',
        ],
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/tenant-store-management');
  const main = page.getByRole('main');
  const row = main.locator('tbody tr').filter({ hasText: '杭州体验门店' });

  await expect(main.getByRole('button', { name: '新增', exact: true })).toHaveCount(0);
  await expect(row.getByRole('button', { name: '修改门店级别' })).toBeVisible();
  await expect(row.locator('.table-actions .t-link')).toHaveText(['归档']);
  await expect(row.getByText('编辑', { exact: true })).toHaveCount(0);
  await expect(row.getByText('删除', { exact: true })).toHaveCount(0);

  await row.getByRole('button', { name: '修改门店级别' }).click({ force: true });
  const levelDialog = page.locator('.t-dialog').filter({ hasText: '门店级别' });
  await expect(levelDialog).toBeVisible();
  await levelDialog.getByRole('button', { name: '取消' }).click();
});

test('filters role actions by logged-in permissions', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 3,
        name: '角色权限员工',
        phone: '15900000002',
        roles: ['ROLE_PERMISSION_MANAGER'],
        identityType: 'platform_admin',
        permissions: [
          'admin.permission-management.employee-management.view',
          'admin.permission-management.role-management.view',
          'admin.permission-management.role-management.permission',
        ],
        employeeId: 3,
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/role-management');
  const main = page.getByRole('main');
  const sideNav = page.locator('.side-nav');

  await expect(sideNav.getByText('员工管理')).toBeVisible();
  await expect(sideNav.getByText('角色管理')).toBeVisible();
  await expect(main.locator('.role-tabs')).toHaveCount(0);
  await expect(main.getByRole('button', { name: /新增/ })).toHaveCount(0);

  const operationRoleRow = page.locator('tbody tr').filter({ hasText: '运营管理平台角色' }).first();
  await expect(operationRoleRow.getByText('权限', { exact: true })).toBeVisible();
  await expect(operationRoleRow.getByText('编辑', { exact: true })).toHaveCount(0);
  await expect(operationRoleRow.getByText('删除', { exact: true })).toHaveCount(0);
});

test('allows granted role operations for records created by another account', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 19,
        name: '门店店长',
        phone: '13900000001',
        roles: ['STORE_MANAGER'],
        permissions: [
          'admin.permission-management.role-management.view',
          'admin.permission-management.role-management.edit',
          'admin.permission-management.role-management.permission',
          'admin.permission-management.role-management.delete',
        ],
        employeeId: 19,
        tenantId: 14,
        storeId: 14,
        dataPermission: 'self',
      }),
    );
  });

  await page.goto('/role-management');
  const row = page.locator('tbody tr').filter({ hasText: '运营管理平台角色' }).first();
  const actions = row.locator('.table-actions');

  await actions.getByText('编辑', { exact: true }).click();
  const editDialog = page.locator('.t-dialog').filter({ hasText: '编辑' });
  await expect(editDialog).toBeVisible();
  await editDialog.getByRole('button', { name: '取消' }).click();

  await actions.getByText('权限', { exact: true }).click();
  const permissionDialog = page.locator('.t-dialog').filter({ hasText: '权限配置' });
  await expect(permissionDialog).toBeVisible();
  await permissionDialog.getByRole('button', { name: '取消' }).click();

  await actions.getByText('删除', { exact: true }).click();
  const deleteDialog = page.locator('.t-dialog').filter({ hasText: '是否删除角色' });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: '取消' }).click();
});

test('opens role permission configuration dialog', async ({ page }) => {
  await page.goto('/role-management');
  const main = page.getByRole('main');
  await expect(main.getByText('角色管理')).toBeVisible();
  await expect(main.locator('.role-tabs')).toHaveCount(0);

  const superAdminRoleRow = page.locator('tbody tr').filter({ hasText: '超级管理员' }).first();
  await expect(superAdminRoleRow).toBeVisible();
  await expect(superAdminRoleRow.getByText('权限', { exact: true })).toHaveCount(0);
  await expect(superAdminRoleRow.getByText('删除', { exact: true })).toHaveCount(0);

  const operationRoleRow = page.locator('tbody tr').filter({ hasText: '运营管理平台角色' }).first();
  await expect(operationRoleRow).toBeVisible();
  await expect(operationRoleRow.locator('.table-actions .t-link')).toHaveText(['编辑', '权限', '删除']);
  await operationRoleRow.getByText('权限', { exact: true }).click();

  const permissionDialog = page.locator('.t-dialog').filter({ hasText: '权限配置' });
  await expect(permissionDialog).toBeVisible();
  await expect(permissionDialog.getByRole('heading', { name: '功能权限', exact: true })).toBeVisible();
  const roleModuleList = permissionDialog.locator('.permission-module-list');
  const roleMatrix = permissionDialog.locator('.permission-matrix');
  await expect(roleModuleList.locator('.permission-module-item')).toHaveCount(4);
  await expect(roleModuleList.locator('.permission-module-item > span:first-child')).toHaveText([
    '租户与门店',
    '商品管理',
    '供应商管理',
    '权限管理',
  ]);
  await expect(roleModuleList.getByText('租户与门店', { exact: true })).toBeVisible();
  await expect(roleModuleList.getByText('门店分类管理', { exact: true })).toHaveCount(0);
  await expect(roleModuleList.getByText('商品管理', { exact: true })).toBeVisible();
  await expect(roleModuleList.getByText('权限管理', { exact: true })).toBeVisible();
  await expect(roleModuleList.getByText('供应商管理', { exact: true })).toBeVisible();
  await expect(roleMatrix.locator('thead')).toContainText('二级菜单');
  await expect(roleMatrix.locator('thead')).toContainText('三级菜单');
  await expect(roleMatrix.locator('thead')).toContainText('页面');
  await expect(roleMatrix.locator('thead')).toContainText('页面 Tab');
  await expect(roleMatrix.locator('thead')).toContainText('操作权限');
  await roleModuleList.getByText('租户与门店', { exact: true }).click();
  await expect(roleMatrix.locator('tbody .permission-menu-cell')).toHaveText(['租户管理', '门店管理', '门店基础数据']);
  await expect(roleMatrix.locator('tbody .permission-third-menu-cell')).toHaveText(['—', '—', '门店级别管理']);
  const tenantPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '租户管理页' });
  await expect(tenantPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '业务开通',
    '编辑',
    '归档',
  ]);
  const archivedTenantPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '已归档' }).first();
  await expect(archivedTenantPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '恢复运营',
    '彻底删除',
  ]);
  const storePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '门店管理页' });
  await expect(storePermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '修改门店级别',
    '编辑',
    '归档',
  ]);
  const archivedStorePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '已归档' }).nth(1);
  await expect(archivedStorePermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '恢复运营',
    '彻底删除',
  ]);
  const storeLevelPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '门店级别管理页' });
  await expect(storeLevelPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  await roleModuleList.getByText('商品管理', { exact: true }).click();
  await expect(roleMatrix.locator('tbody tr')).toHaveCount(24);
  await expect(roleMatrix.locator('tbody .permission-menu-cell')).toHaveText(adminProductSecondMenuLabels);
  await expect(roleMatrix.locator('tbody .permission-third-menu-cell')).toHaveText(adminProductThirdMenuLabels);
  const slabGlobalPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '页面全局' });
  await expect(slabGlobalPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText(['操作日志']);
  await expect(roleMatrix.getByText('操作日志', { exact: true })).toHaveCount(1);
  await expect(roleMatrix.getByText('商品分类管理', { exact: true })).toBeVisible();
  await expect(roleMatrix.getByText('商品分类管理页', { exact: true })).toBeVisible();
  const finishedCategoryPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '成品现货分类' });
  const accessoryCategoryPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '配件分类' });
  await expect(finishedCategoryPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText(
    categoryCatalogActionLabels,
  );
  await expect(accessoryCategoryPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText(
    categoryCatalogActionLabels,
  );
  const finishedTemplatePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '成品现货模板' });
  const accessoryTemplatePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '配件模板' });
  await expect(finishedTemplatePermissionRow.getByText('分类属性模板', { exact: true })).toBeVisible();
  const templateActionLabels = [
    '查看',
    '绑定属性',
    '属性角色',
    '参与SKU组合',
    '必填',
    '绑定选项值',
    '发布/取消发布',
    '移除',
  ];
  await expect(finishedTemplatePermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText(
    templateActionLabels,
  );
  await expect(accessoryTemplatePermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText(
    templateActionLabels,
  );
  const sharedAttributePermissionRow = roleMatrix
    .locator('tbody tr')
    .filter({ has: page.getByText('共享基础属性', { exact: true }) });
  const finishedAttributePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '成品现货专属属性' });
  const accessoryAttributePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '配件专属属性' });
  await expect(sharedAttributePermissionRow.getByText('属性库管理', { exact: true })).toBeVisible();
  for (const row of [sharedAttributePermissionRow, finishedAttributePermissionRow, accessoryAttributePermissionRow]) {
    await expect(row.locator('.permission-action-grid .t-checkbox')).toHaveText(['查看', '新增', '停用/启用', '删除']);
  }
  const sharedAttributeValuePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '共享基础属性值' });
  const finishedAttributeValuePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '成品现货专属值' });
  const accessoryAttributeValuePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '配件专属值' });
  await expect(sharedAttributeValuePermissionRow.getByText('属性值管理', { exact: true })).toBeVisible();
  for (const row of [
    sharedAttributeValuePermissionRow,
    finishedAttributeValuePermissionRow,
    accessoryAttributeValuePermissionRow,
  ]) {
    await expect(row.locator('.permission-action-grid .t-checkbox')).toHaveText(['查看', '新增', '停用/启用', '删除']);
  }
  const markupActionLabels = ['查看', '新增', '编辑', '排序', '停用/启用', '删除'];
  const finishedMarkupPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '成品价格配置' });
  const slabMarkupPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '大板价格配置' });
  await expect(finishedMarkupPermissionRow.getByText('价格配置', { exact: true })).toBeVisible();
  await expect(finishedMarkupPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText(
    markupActionLabels,
  );
  await expect(slabMarkupPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText(markupActionLabels);
  const slabVarietyPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '品种管理页' });
  await expect(slabVarietyPermissionRow.getByText('大板基础数据', { exact: true })).toBeVisible();
  await expect(slabVarietyPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  const slabOriginPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '产地管理页' });
  await expect(slabOriginPermissionRow.getByText('产地管理', { exact: true })).toBeVisible();
  await expect(slabOriginPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  const slabTexturePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '纹理管理页' });
  await expect(slabTexturePermissionRow.getByText('纹理管理', { exact: true })).toBeVisible();
  await expect(slabTexturePermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '别名',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  const slabColorPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '色系管理页' });
  await expect(slabColorPermissionRow.getByText('色系管理', { exact: true })).toBeVisible();
  await expect(slabColorPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '色系分类管理',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  const slabGradePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '等级管理页' });
  await expect(slabGradePermissionRow.getByText('等级管理', { exact: true })).toBeVisible();
  await expect(slabGradePermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '排序',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  await expect(roleMatrix.getByText('成品现货基础数据', { exact: true })).toBeVisible();
  await expect(roleMatrix.getByText('成品现货工艺管理页', { exact: true })).toBeVisible();
  const craftPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '成品现货工艺管理页' });
  await expect(craftPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  await roleModuleList.getByText('供应商管理', { exact: true }).click();
  const supplierPermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '供应商管理页' });
  await expect(supplierPermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '供货类型配置',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  await roleModuleList.getByText('权限管理', { exact: true }).click();
  await expect(roleMatrix.locator('tbody tr')).toHaveCount(2);
  await expect(roleMatrix.getByText('员工管理', { exact: true })).toBeVisible();
  await expect(roleMatrix.getByText('员工管理页', { exact: true })).toBeVisible();
  const employeePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '员工管理页' });
  await expect(employeePermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '邀请员工',
    '编辑',
    '角色',
    '停用/启用',
    '删除',
  ]);
  const employeeViewPermission = employeePermissionRow.getByRole('checkbox', { name: '查看' });
  await employeePermissionRow.getByText('编辑', { exact: true }).click();
  await expect(employeeViewPermission).toBeChecked();
  await employeePermissionRow.getByText('查看', { exact: true }).click();
  await expect(employeePermissionRow.locator('.permission-action-grid input[type="checkbox"]:checked')).toHaveCount(0);
  const rolePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '角色管理页' });
  await expect(rolePermissionRow.locator('.permission-tab-cell')).toHaveText('—');
  await expect(rolePermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '权限',
    '删除',
  ]);
  await expect(roleMatrix.getByText('城市合伙人门店角色', { exact: true })).toHaveCount(0);
  await expect(roleMatrix.getByText('大板供应商门店角色', { exact: true })).toHaveCount(0);
  await expect(permissionDialog.getByRole('button', { name: '全选全部' })).toBeEnabled();
  await expect(permissionDialog.getByRole('button', { name: '清空全部' })).toBeEnabled();
  await expect(permissionDialog.getByRole('checkbox', { name: '全选当前模块' })).toBeEnabled();
  await permissionDialog.getByRole('button', { name: '取消' }).click();

  await operationRoleRow.getByText('删除', { exact: true }).click();
  const deleteDialog = page.locator('.t-dialog').filter({ hasText: '是否删除角色' });
  await expect(deleteDialog).toContainText(
    '是否删除角色“运营管理平台角色”？删除后，使用该角色的用户将被清空角色并自动停用账号，无法继续登录。请及时为相关用户重新分配角色。',
  );
  await deleteDialog.getByRole('button', { name: '取消' }).click();
});

test('shows the full function catalog for both terminals during development', async ({ page }) => {
  await page.goto('/terminal-function-allocation');
  const main = page.getByRole('main');
  const moduleList = main.locator('.permission-module-list');
  const matrix = main.locator('.permission-matrix');
  const matrixToolbar = matrix.locator('.permission-matrix__toolbar');

  await expect(main.getByText('城市合伙人门店管理后台', { exact: true })).toBeVisible();
  await expect(main.getByText('大板供应商门店管理后台', { exact: true })).toBeVisible();
  await expect(moduleList.locator('.permission-module-item')).toHaveCount(5);
  await expect(moduleList.locator('.permission-module-item > span:first-child')).toHaveText([
    '租户与门店',
    '商品管理',
    '供应商管理',
    '门店分类管理',
    '权限管理',
  ]);
  await expect(moduleList.getByText('门店分类管理', { exact: true })).toBeVisible();
  await expect(moduleList.getByText('商品管理', { exact: true })).toBeVisible();
  await expect(moduleList.getByText('供应商管理', { exact: true })).toBeVisible();
  await expect(moduleList.getByText('权限管理', { exact: true })).toBeVisible();
  await expect(moduleList.getByText('租户与门店', { exact: true })).toBeVisible();
  await expect(matrixToolbar.locator('h4')).toHaveCount(0);
  await expect(matrixToolbar).toHaveText(/全选当前模块\s*已下放\s*0\s*\/\s*21/);
  await expect(matrixToolbar.locator('.matrix-toolbar-right')).toHaveCSS('flex-wrap', 'nowrap');
  await expect(matrixToolbar).toHaveCSS('min-height', '48px');
  await expect(matrix.locator('.permission-matrix__table-wrap')).toHaveCSS('max-height', '472px');

  await expect(matrix.locator('thead')).toContainText('二级菜单');
  await expect(matrix.locator('thead')).toContainText('三级菜单');
  await expect(matrix.locator('thead')).toContainText('页面');
  await expect(matrix.locator('th.permission-tab-column')).toHaveText('Tab');
  await expect(matrix.locator('thead')).toContainText('操作权限');
  await expect(matrix.locator('tbody .permission-menu-cell')).toHaveText(['租户管理', '门店管理', '门店基础数据']);
  await expect(matrix.locator('tbody .permission-third-menu-cell')).toHaveText(['—', '—', '门店级别管理']);
  const tenantAllocationRow = matrix.locator('tbody tr').filter({ hasText: '租户管理页' });
  await expect(tenantAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '业务开通',
    '编辑',
    '归档',
  ]);
  const archivedTenantAllocationRow = matrix.locator('tbody tr').filter({ hasText: '已归档' }).first();
  await expect(archivedTenantAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '恢复运营',
    '彻底删除',
  ]);
  const storeAllocationRow = matrix.locator('tbody tr').filter({ hasText: '门店管理页' });
  await expect(storeAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '修改门店级别',
    '编辑',
    '归档',
  ]);
  const archivedStoreAllocationRow = matrix.locator('tbody tr').filter({ hasText: '已归档' }).nth(1);
  await expect(archivedStoreAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '恢复运营',
    '彻底删除',
  ]);
  const storeLevelAllocationRow = matrix.locator('tbody tr').filter({ hasText: '门店级别管理页' });
  await expect(storeLevelAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  await moduleList.getByText('门店分类管理', { exact: true }).click();
  await expect(matrixToolbar).toHaveText(/全选当前模块\s*已下放\s*0\s*\/\s*8/);
  const storeCategoryAllocationRow = matrix.locator('tbody tr').filter({ hasText: '门店分类管理页' });
  await expect(storeCategoryAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText(
    categoryCatalogActionLabels,
  );
  await moduleList.getByText('商品管理', { exact: true }).click();
  await expect(matrixToolbar).toHaveText(/全选当前模块\s*已下放\s*0\s*\/\s*89/);
  await expect(matrix.locator('tbody tr')).toHaveCount(16);
  await expect(matrix.locator('tbody .permission-menu-cell')).toHaveText(productSecondMenuLabels);
  await expect(matrix.locator('tbody .permission-third-menu-cell')).toHaveText(productThirdMenuLabels);
  await expect(matrix.getByText('商品分类管理', { exact: true })).toBeVisible();
  await expect(matrix.getByText('商品分类管理页', { exact: true })).toBeVisible();
  const finishedCategoryAllocationRow = matrix.locator('tbody tr').filter({ hasText: '成品现货分类' });
  const accessoryCategoryAllocationRow = matrix.locator('tbody tr').filter({ hasText: '配件分类' });
  await expect(finishedCategoryAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText(
    categoryCatalogActionLabels,
  );
  await expect(accessoryCategoryAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText(
    categoryCatalogActionLabels,
  );
  const finishedTemplateAllocationRow = matrix.locator('tbody tr').filter({ hasText: '成品现货模板' });
  const accessoryTemplateAllocationRow = matrix.locator('tbody tr').filter({ hasText: '配件模板' });
  await expect(finishedTemplateAllocationRow.getByText('分类属性模板', { exact: true })).toBeVisible();
  const templateAllocationActionLabels = [
    '查看',
    '绑定属性',
    '属性角色',
    '参与SKU组合',
    '必填',
    '绑定选项值',
    '发布/取消发布',
    '移除',
  ];
  await expect(finishedTemplateAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText(
    templateAllocationActionLabels,
  );
  await expect(accessoryTemplateAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText(
    templateAllocationActionLabels,
  );
  const sharedAttributeAllocationRow = matrix
    .locator('tbody tr')
    .filter({ has: page.getByText('共享基础属性', { exact: true }) });
  const finishedAttributeAllocationRow = matrix.locator('tbody tr').filter({ hasText: '成品现货专属属性' });
  const accessoryAttributeAllocationRow = matrix.locator('tbody tr').filter({ hasText: '配件专属属性' });
  await expect(sharedAttributeAllocationRow.getByText('属性库管理', { exact: true })).toBeVisible();
  for (const row of [sharedAttributeAllocationRow, finishedAttributeAllocationRow, accessoryAttributeAllocationRow]) {
    await expect(row.locator('.permission-action-grid .t-checkbox')).toHaveText(['查看', '新增', '停用/启用', '删除']);
  }
  const sharedAttributeValueAllocationRow = matrix.locator('tbody tr').filter({ hasText: '共享基础属性值' });
  const finishedAttributeValueAllocationRow = matrix.locator('tbody tr').filter({ hasText: '成品现货专属值' });
  const accessoryAttributeValueAllocationRow = matrix.locator('tbody tr').filter({ hasText: '配件专属值' });
  await expect(sharedAttributeValueAllocationRow.getByText('属性值管理', { exact: true })).toBeVisible();
  for (const row of [
    sharedAttributeValueAllocationRow,
    finishedAttributeValueAllocationRow,
    accessoryAttributeValueAllocationRow,
  ]) {
    await expect(row.locator('.permission-action-grid .t-checkbox')).toHaveText(['查看', '新增', '停用/启用', '删除']);
  }
  const slabVarietyAllocationRow = matrix.locator('tbody tr').filter({ hasText: '品种管理页' });
  await expect(slabVarietyAllocationRow.getByText('大板基础数据', { exact: true })).toBeVisible();
  await expect(slabVarietyAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  const slabOriginAllocationRow = matrix.locator('tbody tr').filter({ hasText: '产地管理页' });
  await expect(slabOriginAllocationRow.getByText('产地管理', { exact: true })).toBeVisible();
  await expect(slabOriginAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  const slabTextureAllocationRow = matrix.locator('tbody tr').filter({ hasText: '纹理管理页' });
  await expect(slabTextureAllocationRow.getByText('纹理管理', { exact: true })).toBeVisible();
  await expect(slabTextureAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '别名',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  const slabColorAllocationRow = matrix.locator('tbody tr').filter({ hasText: '色系管理页' });
  await expect(slabColorAllocationRow.getByText('色系管理', { exact: true })).toBeVisible();
  await expect(slabColorAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '色系分类管理',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  const slabGradeAllocationRow = matrix.locator('tbody tr').filter({ hasText: '等级管理页' });
  await expect(slabGradeAllocationRow.getByText('等级管理', { exact: true })).toBeVisible();
  await expect(slabGradeAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '排序',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  await expect(matrix.getByText('成品现货基础数据', { exact: true })).toBeVisible();
  await expect(matrix.getByText('成品现货工艺管理页', { exact: true })).toBeVisible();
  const craftAllocationRow = matrix.locator('tbody tr').filter({ hasText: '成品现货工艺管理页' });
  await expect(craftAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  await moduleList.getByText('供应商管理', { exact: true }).click();
  await expect(matrixToolbar).toHaveText(/全选当前模块\s*已下放\s*0\s*\/\s*6/);
  const supplierAllocationRow = matrix.locator('tbody tr').filter({ hasText: '供应商管理页' });
  await expect(supplierAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '供货类型配置',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  await moduleList.getByText('权限管理', { exact: true }).click();
  await expect(matrixToolbar).toHaveText(/全选当前模块\s*已下放\s*0\s*\/\s*11/);
  await expect(matrix.getByText('员工管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('角色管理页', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: '全选全部' })).toBeEnabled();
  await expect(main.getByRole('button', { name: '清空全部' })).toBeEnabled();
  await expect(main.getByRole('button', { name: '保存' })).toBeEnabled();
  await expect(main.getByRole('button', { name: '重置' })).toBeVisible();

  await main.locator('.terminal-tabs').getByText('大板供应商门店管理后台', { exact: true }).click();
  await expect(moduleList.locator('.permission-module-item')).toHaveCount(5);
  await expect(moduleList.getByText('门店分类管理', { exact: true })).toBeVisible();
  await expect(moduleList.getByText('商品管理', { exact: true })).toBeVisible();
  await expect(moduleList.getByText('供应商管理', { exact: true })).toBeVisible();
  await expect(moduleList.getByText('权限管理', { exact: true })).toBeVisible();
  await expect(moduleList.getByText('租户与门店', { exact: true })).toBeVisible();
  await moduleList.getByText('租户与门店', { exact: true }).click();
  await expect(matrix.getByText('租户管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('门店管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('门店级别管理页', { exact: true })).toBeVisible();
  await expect(matrix.locator('.permission-action-grid .t-checkbox')).toHaveCount(21);
  await moduleList.getByText('供应商管理', { exact: true }).click();
  await expect(matrix.getByText('供应商管理页', { exact: true })).toBeVisible();
  await expect(matrix.locator('.permission-action-grid .t-checkbox')).toHaveCount(6);
  await moduleList.getByText('商品管理', { exact: true }).click();
  await expect(matrix.getByText('商品分类管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('属性库管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('属性值管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('分类属性模板页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('成品现货工艺管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('品种管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('产地管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('纹理管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('色系管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('等级管理页', { exact: true })).toBeVisible();
  await expect(matrix.locator('.permission-action-grid .t-checkbox')).toHaveCount(89);
  await moduleList.getByText('权限管理', { exact: true }).click();
  await expect(matrix.getByText('员工管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('角色管理页', { exact: true })).toBeVisible();
  await expect(matrix.locator('.permission-action-grid .t-checkbox')).toHaveCount(11);
});
