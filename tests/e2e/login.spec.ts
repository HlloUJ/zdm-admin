import { expect, test } from '@playwright/test';

test('shows the login page', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '欢迎登录' })).toBeVisible();
  await expect(page.getByPlaceholder('请输入手机号')).toHaveValue('');
  await expect(page.getByPlaceholder('请输入验证码')).toHaveValue('');
});
