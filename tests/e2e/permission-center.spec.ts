import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
});

test('opens employee invite and edit dialogs', async ({ page }) => {
  await page.goto('/employee-management');
  const main = page.getByRole('main');

  await expect(main.getByText('员工管理')).toBeVisible();
  await expect(main.getByText(/共 \d+ 条数据/)).toBeVisible();

  await main.getByRole('button', { name: /邀请员工/ }).click();
  const inviteDialog = page.locator('.t-dialog').filter({ hasText: '邀请员工' });
  await expect(inviteDialog).toBeVisible();
  await expect(inviteDialog.getByText('员工邀请链接')).toBeVisible();
  await inviteDialog.getByRole('button', { name: '关闭' }).click();

  const firstEmployeeRow = page.locator('tbody tr').filter({ hasText: '15926626945' }).first();
  await expect(firstEmployeeRow).toBeVisible();
  await firstEmployeeRow.getByText('编辑').click();
  const editDialog = page.locator('.t-dialog').filter({ hasText: '编辑员工' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByText('角色')).toBeVisible();
  await expect(editDialog.getByText('数据权限')).toBeVisible();
  await editDialog.getByRole('button', { name: '取消' }).click();
});

test('opens role permission configuration dialog', async ({ page }) => {
  await page.goto('/role-management');
  const main = page.getByRole('main');

  await expect(main.getByText('角色管理')).toBeVisible();
  await main.getByText('运营管理平台角色').click();

  const firstRoleRow = page
    .locator('tbody tr')
    .filter({ hasText: /超级管理员|管理员|运营|客服/ })
    .first();
  await expect(firstRoleRow).toBeVisible();
  await firstRoleRow.getByText('权限管理').click();

  const permissionDialog = page.locator('.t-dialog').filter({ hasText: '权限配置' });
  await expect(permissionDialog).toBeVisible();
  await expect(permissionDialog.getByText('功能权限')).toBeVisible();
  await expect(permissionDialog.getByRole('heading', { name: '租户与门店' })).toBeVisible();
  await permissionDialog.getByRole('button', { name: '取消' }).click();
});
