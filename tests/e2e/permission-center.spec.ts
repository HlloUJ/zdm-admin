import { expect, test } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
  await installAdminApiMocks(page);
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
  await firstEmployeeRow.getByText('编辑资料').click();
  const profileDialog = page.locator('.t-dialog').filter({ hasText: '编辑资料' });
  await expect(profileDialog).toBeVisible();
  await expect(profileDialog.locator('label').filter({ hasText: '姓名' })).toBeVisible();
  await expect(profileDialog.locator('label').filter({ hasText: '性别' })).toBeVisible();
  await expect(profileDialog.locator('label').filter({ hasText: '手机号码' })).toBeVisible();
  await expect(profileDialog.locator('label').filter({ hasText: '备注' })).toBeVisible();
  await expect(profileDialog.locator('label').filter({ hasText: '角色' })).toHaveCount(0);
  await expect(profileDialog.getByText('数据权限')).toHaveCount(0);
  await profileDialog.locator('textarea').fill('备注'.repeat(50));
  await profileDialog.getByRole('button', { name: '提交' }).click();
  await expect(page.getByText('备注最多输入100个字符')).toHaveCount(0);
  await expect(profileDialog).toBeHidden();

  await expect(firstEmployeeRow.getByText('配置权限')).toHaveCount(0);
  await expect(firstEmployeeRow.getByText('停用', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeRow.getByText('启用', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeRow.getByText('删除', { exact: true })).toHaveCount(0);

  const pendingEmployeeRow = page.locator('tbody tr').filter({ hasText: '15926628888' }).first();
  await expect(pendingEmployeeRow).toBeVisible();
  await pendingEmployeeRow.getByText('配置权限').click();
  const employeePermissionDialog = page.locator('.t-dialog').filter({ hasText: '配置权限' });
  await expect(employeePermissionDialog).toBeVisible();
  await expect(employeePermissionDialog.locator('label').filter({ hasText: '角色' })).toBeVisible();
  await expect(employeePermissionDialog.getByText('数据权限')).toBeVisible();
  await expect(employeePermissionDialog.locator('label').filter({ hasText: '姓名' })).toHaveCount(0);
  await expect(employeePermissionDialog.locator('label').filter({ hasText: '性别' })).toHaveCount(0);
  await expect(employeePermissionDialog.locator('label').filter({ hasText: '备注' })).toHaveCount(0);
  await employeePermissionDialog.getByRole('button', { name: '取消' }).click();
});

test('registers from employee invite link', async ({ page }) => {
  await page.goto('/employee-invite?token=e2e-invite-token');

  await expect(page.getByRole('heading', { name: '员工注册' })).toBeVisible();
  await page.getByPlaceholder('请输入手机号').fill('15926629999');
  await page.getByPlaceholder('请输入验证码').fill('888888');
  await page.getByRole('button', { name: '下一步' }).click();

  await page.getByPlaceholder('请输入姓名').fill('待审核员工');
  await page.locator('.gender-radio').getByText('男').click();
  await page.getByRole('button', { name: '提交注册' }).click();

  await expect(page.getByRole('heading', { name: '注册信息已提交' })).toBeVisible();
  await expect(page.getByText('请等待超级管理员确认信息并启用账号。')).toBeVisible();
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

  await pendingEmployeeRow.getByText('配置权限').click();
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
          'admin.permission-management.employee-management.query',
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
  await expect(firstEmployeeRow.getByText('编辑资料')).toBeVisible();
  await expect(firstEmployeeRow.getByText('配置权限')).toHaveCount(0);
  await expect(firstEmployeeRow.getByText('停用', { exact: true })).toHaveCount(0);
  await expect(firstEmployeeRow.getByText('删除', { exact: true })).toHaveCount(0);

  const pendingEmployeeRow = page.locator('tbody tr').filter({ hasText: '15926628888' }).first();
  await expect(pendingEmployeeRow.getByText('配置权限')).toBeVisible();
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
        permissions: ['admin.tenant.tenant-management.query'],
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
          'admin.permission-management.role-management.query',
          'admin.permission-management.role-management.permission',
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

  await expect(main.getByRole('button', { name: /新增/ })).toHaveCount(0);
  await main.getByText('运营管理平台角色').click();

  const operationRoleRow = page.locator('tbody tr').filter({ hasText: '运营管理平台角色' }).first();
  await expect(operationRoleRow.getByText('权限管理')).toBeVisible();
  await expect(operationRoleRow.getByText('编辑', { exact: true })).toHaveCount(0);
  await expect(operationRoleRow.getByText('删除', { exact: true })).toHaveCount(0);
});

test('opens role permission configuration dialog', async ({ page }) => {
  await page.goto('/role-management');
  const main = page.getByRole('main');

  await expect(main.getByText('角色管理')).toBeVisible();
  await main.getByText('运营管理平台角色').click();

  const superAdminRoleRow = page.locator('tbody tr').filter({ hasText: '超级管理员' }).first();
  await expect(superAdminRoleRow).toBeVisible();
  await expect(superAdminRoleRow.getByText('权限管理')).toHaveCount(0);
  await expect(superAdminRoleRow.getByText('删除', { exact: true })).toHaveCount(0);

  const operationRoleRow = page.locator('tbody tr').filter({ hasText: '运营管理平台角色' }).first();
  await expect(operationRoleRow).toBeVisible();
  await operationRoleRow.getByText('权限管理').click();

  const permissionDialog = page.locator('.t-dialog').filter({ hasText: '权限配置' });
  await expect(permissionDialog).toBeVisible();
  await expect(permissionDialog.getByText('功能权限')).toBeVisible();
  await expect(permissionDialog.getByRole('heading', { name: '租户与门店' })).toBeVisible();
  await permissionDialog.getByRole('button', { name: '取消' }).click();
});
