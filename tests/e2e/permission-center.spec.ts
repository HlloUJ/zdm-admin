import { expect, test } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
  await installAdminApiMocks(page);
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

  await expect(craftRow).toBeVisible();
  await expect(main.getByRole('button', { name: '新增' })).toHaveCount(0);
  await expect(craftRow.getByText('编辑', { exact: true })).toBeVisible();
  await expect(craftRow.getByText('停用', { exact: true })).toHaveCount(0);
  await expect(craftRow.getByText('删除', { exact: true })).toHaveCount(0);
});

test('opens employee invite and edit dialogs', async ({ page }) => {
  await page.goto('/employee-management');
  const main = page.getByRole('main');

  await expect(main.getByText('员工管理')).toBeVisible();
  await expect(main.getByText(/共 \d+ 条数据/)).toBeVisible();
  await expect(main.locator('thead')).toContainText('邀请人');
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

  await expect(firstEmployeeRow.getByText('角色', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeRow.getByText('停用', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeRow.getByText('启用', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeRow.getByText('删除', { exact: true })).toHaveCount(0);

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
  await expect(page.locator('.t-dialog').filter({ hasText: '是否启用员工【待启用员工】？' })).toHaveCount(0);
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
  await employeePermissionDialog.getByRole('button', { name: '提交' }).click();
  await expect(employeePermissionDialog).toBeHidden();

  await pendingEmployeeRow.getByText('启用', { exact: true }).click();

  await expect(
    page.locator('.t-dialog').filter({ hasText: '是否启用员工【待启用员工】？启用后恢复登录权限。' }),
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
        employeeId: 2,
        tenantId: 1,
        storeId: 1,
        dataPermission: 'self',
      }),
    );
  });

  await page.goto('/employee-management');
  const sideNav = page.locator('.side-nav');
  const firstEmployeeRow = page.locator('tbody tr').filter({ hasText: '15926626945' }).first();

  await expect(sideNav.getByText('工作台')).toHaveCount(0);
  await expect(sideNav.getByText('员工管理')).toBeVisible();
  await expect(sideNav.getByText('角色管理')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /邀请员工/ })).toHaveCount(0);
  await expect(firstEmployeeRow.getByText('编辑', { exact: true })).toBeVisible();
  await expect(firstEmployeeRow.getByText('角色', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeRow.getByText('停用', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeRow.getByText('删除', { exact: true })).toHaveCount(0);

  const pendingEmployeeRow = page.locator('tbody tr').filter({ hasText: '15926628888' }).first();
  await expect(pendingEmployeeRow.getByText('编辑', { exact: true })).toBeVisible();
  await expect(pendingEmployeeRow.getByText('角色', { exact: true })).toHaveCount(0);
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
  await expect(permissionOnlyEmployeeRow.getByText('编辑', { exact: true })).toHaveCount(0);
  await expect(permissionOnlyEmployeeRow.getByText('角色', { exact: true })).toBeVisible();
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
        permissions: ['admin.tenant.tenant-management.view'],
        employeeId: 4,
        tenantId: 1,
        storeId: 1,
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/tenant-management');

  await expect(page.locator('.top-nav .user-name')).toHaveText('租户管理员');
  await expect(page.locator('.top-nav .user-role')).toHaveText('租户管理员');
  await expect(page.getByRole('button', { name: /退出登录/ })).toBeVisible();
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
        permissions: [
          'admin.permission-management.employee-management.view',
          'admin.permission-management.role-management.operation-platform.view',
          'admin.permission-management.role-management.operation-platform.permission',
        ],
        employeeId: 3,
        tenantId: 1,
        storeId: 1,
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

test('opens role permission configuration dialog', async ({ page }) => {
  await page.goto('/role-management');
  const main = page.getByRole('main');
  const roleTabs = main.locator('.role-tabs .t-tabs__nav-item');

  await expect(main.getByText('角色管理')).toBeVisible();
  await expect(roleTabs).toHaveText(['运营管理平台角色', '城市合伙人门店角色', '大板供应商门店角色']);
  await expect(roleTabs.filter({ hasText: '运营管理平台角色' })).toHaveClass(/t-is-active/);

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
  await expect(roleModuleList.locator('.permission-module-item')).toHaveCount(2);
  await expect(roleModuleList.getByText('商品基础数据中心', { exact: true })).toBeVisible();
  await expect(roleModuleList.getByText('权限管理', { exact: true })).toBeVisible();
  await expect(roleMatrix.locator('thead')).toContainText('二级菜单');
  await expect(roleMatrix.locator('thead')).toContainText('页面');
  await expect(roleMatrix.locator('thead')).toContainText('页面 Tab');
  await expect(roleMatrix.locator('thead')).toContainText('操作权限');
  await expect(roleMatrix.locator('tbody tr')).toHaveCount(1);
  await expect(roleMatrix.getByText('成品现货工艺管理', { exact: true })).toBeVisible();
  await expect(roleMatrix.getByText('成品现货工艺管理页', { exact: true })).toBeVisible();
  await expect(roleMatrix.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  await roleModuleList.getByText('权限管理', { exact: true }).click();
  await expect(roleMatrix.locator('tbody tr')).toHaveCount(4);
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
  const operationRolePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '运营管理平台角色' });
  const partnerRolePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '城市合伙人门店角色' });
  const supplierRolePermissionRow = roleMatrix.locator('tbody tr').filter({ hasText: '大板供应商门店角色' });
  await expect(operationRolePermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '权限',
    '删除',
  ]);
  await expect(partnerRolePermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '删除',
  ]);
  await expect(supplierRolePermissionRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '删除',
  ]);
  await expect(permissionDialog.getByRole('button', { name: '全选全部' })).toBeEnabled();
  await expect(permissionDialog.getByRole('button', { name: '清空全部' })).toBeEnabled();
  await expect(permissionDialog.getByRole('checkbox', { name: '全选当前模块' })).toBeEnabled();
  await permissionDialog.getByRole('button', { name: '取消' }).click();

  await operationRoleRow.getByText('删除', { exact: true }).click();
  const deleteDialog = page.locator('.t-dialog').filter({ hasText: '是否删除角色' });
  await expect(deleteDialog).toContainText(
    '是否删除角色【运营管理平台角色】？删除后，使用该角色的用户将被清空角色并自动停用账号，无法继续登录。请及时为相关用户重新分配角色。',
  );
  await deleteDialog.getByRole('button', { name: '取消' }).click();
});

test('shows verified craft, employee, and role management resources in both terminal allocations', async ({ page }) => {
  await page.goto('/terminal-function-allocation');
  const main = page.getByRole('main');
  const moduleList = main.locator('.permission-module-list');
  const matrix = main.locator('.permission-matrix');
  const matrixToolbar = matrix.locator('.permission-matrix__toolbar');

  await expect(main.getByText('城市合伙人门店管理后台', { exact: true })).toBeVisible();
  await expect(main.getByText('大板供应商门店管理后台', { exact: true })).toBeVisible();
  await expect(moduleList.locator('.permission-module-item')).toHaveCount(2);
  await expect(moduleList.getByText('商品基础数据中心', { exact: true })).toBeVisible();
  await expect(moduleList.getByText('权限管理', { exact: true })).toBeVisible();
  await expect(matrixToolbar.locator('h4')).toHaveCount(0);
  await expect(matrixToolbar).toHaveText(/全选当前模块\s*已下放\s*0\s*\/\s*5/);
  await expect(matrixToolbar.locator('.matrix-toolbar-right')).toHaveCSS('flex-wrap', 'nowrap');
  await expect(matrixToolbar).toHaveCSS('min-height', '48px');
  await expect(matrix.locator('.permission-matrix__table-wrap')).toHaveCSS('max-height', '472px');

  await expect(matrix.locator('thead')).toContainText('二级菜单');
  await expect(matrix.locator('thead')).toContainText('页面');
  await expect(matrix.locator('th.permission-tab-column')).toHaveText('Tab');
  await expect(matrix.locator('thead')).toContainText('操作权限');
  await expect(matrix.locator('tbody tr')).toHaveCount(1);
  await expect(matrix.getByText('成品现货工艺管理', { exact: true })).toBeVisible();
  await expect(matrix.getByText('成品现货工艺管理页', { exact: true })).toBeVisible();
  await expect(matrix.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '新增',
    '编辑',
    '停用/启用',
    '删除',
  ]);
  await moduleList.getByText('权限管理', { exact: true }).click();
  await expect(matrixToolbar).toHaveText(/全选当前模块\s*已下放\s*0\s*\/\s*19/);
  await expect(matrix.locator('tbody tr')).toHaveCount(4);
  await expect(matrix.getByText('员工管理', { exact: true })).toBeVisible();
  await expect(matrix.getByText('员工管理页', { exact: true })).toBeVisible();
  const employeeAllocationRow = matrix.locator('tbody tr').filter({ hasText: '员工管理页' });
  await expect(employeeAllocationRow.locator('.permission-action-grid .t-checkbox')).toHaveText([
    '查看',
    '邀请员工',
    '编辑',
    '角色',
    '停用/启用',
    '删除',
  ]);
  await expect(matrix.getByText('角色管理', { exact: true })).toBeVisible();
  await expect(matrix.getByText('角色管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('运营管理平台角色', { exact: true })).toBeVisible();
  await expect(matrix.getByText('城市合伙人门店角色', { exact: true })).toBeVisible();
  await expect(matrix.getByText('大板供应商门店角色', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: '全选全部' })).toBeEnabled();
  await expect(main.getByRole('button', { name: '清空全部' })).toBeEnabled();
  await expect(main.getByRole('button', { name: '保存' })).toBeEnabled();
  await expect(main.getByRole('button', { name: '重置' })).toBeVisible();

  await main.locator('.terminal-tabs').getByText('大板供应商门店管理后台', { exact: true }).click();
  await expect(moduleList.locator('.permission-module-item')).toHaveCount(2);
  await expect(moduleList.getByText('商品基础数据中心', { exact: true })).toBeVisible();
  await expect(matrix.getByText('成品现货工艺管理页', { exact: true })).toBeVisible();
  await expect(matrix.locator('.permission-action-grid .t-checkbox')).toHaveCount(5);
  await moduleList.getByText('权限管理', { exact: true }).click();
  await expect(moduleList.getByText('权限管理', { exact: true })).toBeVisible();
  await expect(matrix.getByText('员工管理页', { exact: true })).toBeVisible();
  await expect(matrix.getByText('角色管理页', { exact: true })).toBeVisible();
  await expect(matrix.locator('.permission-action-grid .t-checkbox')).toHaveCount(19);
});
