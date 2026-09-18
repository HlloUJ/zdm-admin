import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

test('sorts siblings, retains children and rejects cross-parent or cross-level drops', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({ id: 1, roles: ['SUPER_ADMIN'], permissions: ['all'], dataPermission: 'all' }),
    );
  });
  await installAdminApiMocks(page);
  const records = [
    { id: 101, parentId: null, name: '父类甲', sortOrder: 1 },
    { id: 102, parentId: null, name: '父类乙', sortOrder: 2 },
    { id: 103, parentId: 101, name: '子类甲一', sortOrder: 1 },
    { id: 104, parentId: 101, name: '子类甲二', sortOrder: 2 },
    { id: 105, parentId: 102, name: '子类乙一', sortOrder: 1 },
  ].map((row) => ({ ...row, scope: 'finished', status: 'enabled', createdAt: '2026-09-17T10:00:00' }));
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/admin/product-categories', (route) => route.fulfill({ json: { code: 0, data: records } }));
  await page.route('**/api/admin/product-categories/*', async (route) => {
    const payload = route.request().postDataJSON();
    const id = Number(route.request().url().split('/').pop());
    writes.push({ id, ...payload });
    const record = records.find((row) => row.id === id)!;
    Object.assign(record, payload);
    await route.fulfill({ json: { code: 0, data: record } });
  });
  await page.goto('/product-category');
  const rows = page.locator('main tbody tr');
  const row = (name: string) => rows.filter({ hasText: name });
  const drag = async (from: string, to: string) => {
    // TDesign registers Sortable after rendering the rows; visible rows alone
    // do not mean that the drag listeners are attached yet.
    await expect
      .poll(() =>
        page.locator('main tbody').evaluate((body) => Object.keys(body).some((key) => key.startsWith('Sortable'))),
      )
      .toBe(true);
    await row(from).locator('.category-name-cell').dragTo(row(to).locator('.category-name-cell'));
  };
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('上移', { exact: true })).toHaveCount(0);
  await expect(page.getByText('下移', { exact: true })).toHaveCount(0);
  await drag('父类甲', '父类乙');
  await expect(rows.first()).toContainText('父类乙');
  await page.reload();
  await expect(rows.first()).toContainText('父类乙');
  await row('父类甲').getByRole('button', { name: '展开下级分类' }).click();
  await row('父类乙').getByRole('button', { name: '展开下级分类' }).click();
  await drag('子类甲一', '子类甲二');
  await expect.poll(() => records.find((r) => r.id === 104)?.sortOrder).toBe(1);
  const count = writes.length;
  await drag('子类甲二', '子类乙一');
  await drag('子类甲二', '父类乙');
  expect(writes).toHaveLength(count);
  expect(records.find((r) => r.id === 104)?.parentId).toBe(101);
  await page.reload();
  await row('父类甲').getByRole('button', { name: '展开下级分类' }).click();
  await expect(rows.nth(2)).toContainText('子类甲二');
});

test('reopens category forms without stale validation after creating or cancelling', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({ id: 1, roles: ['SUPER_ADMIN'], permissions: ['all'], dataPermission: 'all' }),
    );
  });
  await installAdminApiMocks(page);
  await page.goto('/product-category');
  for (const scope of ['成品现货分类', '配件分类']) {
    await page.locator('.scope-tabs .t-tabs__nav-item').filter({ hasText: scope }).click();
    await page.getByRole('button', { name: '新增一级分类', exact: true }).click();
    const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增一级分类' });
    await dialog.getByPlaceholder('请输入，最多20个字符').fill(`${scope}连续新增`);
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: '新增一级分类', exact: true }).click();
    await expect(dialog.getByPlaceholder('请输入，最多20个字符')).toHaveValue('');
    await expect(dialog.locator('.t-is-error')).toHaveCount(0);
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog.getByText('请输入分类名称', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '新增一级分类', exact: true }).click();
    await expect(dialog.locator('.t-is-error')).toHaveCount(0);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
});
