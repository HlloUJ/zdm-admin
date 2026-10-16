import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

for (const failure of ['server', 'network'] as const) {
  test(`valid submit retains the ${failure} failure Toast and never replaces it with validation feedback`, async ({
    page,
  }) => {
    await installAdminApiMocks(page);
    let requests = 0;
    await page.route('**/api/admin/auth/login', async (route) => {
      requests++;
      if (failure === 'network') await route.abort('failed');
      else await route.fulfill({ status: 500, json: { code: 500, message: '服务暂不可用，请稍后重试' } });
    });
    await page.goto('/login');
    await page.getByPlaceholder('请输入手机号').fill('15900000001');
    await page.getByPlaceholder('请输入验证码').fill('888888');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    const feedback = page.locator('.zdm-admin-feedback');
    await expect(feedback).toHaveCount(1);
    await expect(feedback).not.toHaveText('');
    await expect(feedback.filter({ hasText: '表单校验未通过，请检查标红字段' })).toHaveCount(0);
    if (failure === 'server') await expect(feedback).toContainText('服务暂不可用，请稍后重试');
    await expect(page.locator('.t-form__controls.t-is-error')).toHaveCount(0);
    await expect(page.getByPlaceholder('请输入手机号')).toHaveValue('15900000001');
    await expect(page.getByPlaceholder('请输入验证码')).toHaveValue('888888');
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled();
    await expect(page).toHaveURL(/\/login$/);
    expect(requests).toBe(1);
  });
}
