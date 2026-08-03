import { expect, test } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

test('shows the login page', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '欢迎登录' })).toBeVisible();
  await expect(page.getByPlaceholder('请输入手机号')).toHaveValue('');
  await expect(page.getByPlaceholder('请输入验证码')).toHaveValue('');
});

test('stores and displays the logged-in user', async ({ page }) => {
  await installAdminApiMocks(page);
  await page.route('**/api/admin/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'ok',
        data: {
          token: 'dev-token:2',
          user: {
            id: 2,
            name: '测试员工',
            phone: '15900000001',
            roles: ['OPERATION_MANAGER'],
            roleNames: ['运营经理'],
            permissions: ['admin.permission-management.employee-management.view'],
          },
        },
      }),
    });
  });

  await page.goto('/login');
  await page.getByPlaceholder('请输入手机号').fill('15900000001');
  await page.getByPlaceholder('请输入验证码').fill('888888');
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page).toHaveURL(/\/employee-management$/);
  await expect(page.locator('.top-nav .user-name')).toHaveText('测试员工');
  await expect(page.locator('.top-nav .user-role')).toHaveText('运营经理');
  await expect(page.locator('.top-nav .user-meta')).toHaveCSS('flex-direction', 'row');
});

test('logs out and clears the local account session', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token:1');
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        name: '超级管理员',
        phone: '15926626945',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });

  await page.goto('/dashboard');
  await page.getByRole('button', { name: /退出登录/ }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '欢迎登录' })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('zdm-admin-token'))).toBeNull();
  expect(await page.evaluate(() => window.localStorage.getItem('zdm-admin-user'))).toBeNull();
});
