import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

const prefix = 'admin.tenant.store-category-management';
async function setup(page: Page, permissions: string[]) {
  await page.addInitScript((permissions) => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        clientCode: 'admin',
        name: '测试员工',
        phone: '15900000001',
        roles: ['EMPLOYEE'],
        tenantId: 1,
        storeId: 1,
        storeType: 'cityPartner',
        dataPermission: 'self',
        permissions,
      }),
    );
  }, permissions);
  await installAdminApiMocks(page);
  const rows = [
    {
      id: 1,
      scope: 'finished',
      parentId: null,
      name: '成品一级',
      sortOrder: 1,
      productCount: 0,
      status: 'enabled',
      createdByName: '其他员工',
      createdAt: '2026-10-09T14:28:00',
    },
    { id: 2, scope: 'finished', parentId: 1, name: '成品二级', sortOrder: 1, productCount: 0, status: 'enabled' },
    { id: 3, scope: 'finished', parentId: 2, name: '成品三级', sortOrder: 1, productCount: 0, status: 'enabled' },
    { id: 4, scope: 'accessory', parentId: null, name: '配件一级', sortOrder: 1, productCount: 0, status: 'enabled' },
    { id: 5, scope: 'finished', parentId: null, name: '成品另一级', sortOrder: 2, productCount: 0, status: 'enabled' },
  ];
  const requests: { method: string; scope: string | null; payload?: Record<string, unknown> }[] = [];
  await page.route(/\/api\/admin\/store-categories(?:\/[^?]*)?(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const payload = method === 'PUT' || method === 'POST' ? route.request().postDataJSON() : undefined;
    requests.push({ method, scope: url.searchParams.get('scope'), payload });
    const data = method === 'GET' ? rows.filter((row) => row.scope === url.searchParams.get('scope')) : rows[0];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'ok', data }) });
  });
  return requests;
}

test('switches isolated category types and limits maintenance to three levels', async ({ page }) => {
  const actions = ['view', 'create-root', 'create-child', 'edit', 'sort', 'toggle-status', 'delete'];
  const requests = await setup(
    page,
    ['finished', 'accessory'].flatMap((scope) => actions.map((action) => `${prefix}.${scope}.${action}`)),
  );
  await page.goto('/store-category-management');
  await expect(page.locator('.t-tabs__nav-item').filter({ hasText: '成品现货分类' })).toBeVisible();
  await expect(page.locator('.t-tabs__nav-item').filter({ hasText: '配件分类' })).toBeVisible();
  await expect(page.getByText('其他员工', { exact: true })).toBeVisible();
  const dragIcon = page.locator('tbody [data-category-id]').first();
  await expect(dragIcon).toBeVisible();
  const dragSpace = await dragIcon.evaluate((icon) => {
    const cell = icon.closest('td')!;
    const style = getComputedStyle(cell);
    return {
      available: cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      required: icon.getBoundingClientRect().width,
      inset: icon.getBoundingClientRect().left - cell.getBoundingClientRect().left,
      nameInset: parseFloat(getComputedStyle(cell.nextElementSibling!).paddingLeft),
    };
  });
  expect(dragSpace.required).toBeGreaterThan(0);
  expect(dragSpace.available).toBeGreaterThanOrEqual(dragSpace.required);
  expect(dragSpace.inset).toBe(0);
  expect(dragSpace.nameInset).toBe(0);
  await expect(page.getByText('2026/10/09 14:28', { exact: true })).toBeVisible();
  await page.getByRole('row').filter({ hasText: '成品一级' }).getByRole('button', { name: '展开下级分类' }).click();
  await page.getByRole('row').filter({ hasText: '成品二级' }).getByRole('button', { name: '展开下级分类' }).click();
  const third = page.getByRole('row').filter({ hasText: '成品三级' });
  await expect(third).toBeVisible();
  await expect(third.getByText('新增下级', { exact: true })).toHaveCount(0);
  await page.locator('.t-tabs__nav-item').filter({ hasText: '配件分类' }).click();
  await expect(page.getByText('配件一级', { exact: true })).toBeVisible();
  await expect(page.getByText('成品一级', { exact: true })).toHaveCount(0);
  expect(requests.filter((item) => item.method === 'GET').map((item) => item.scope)).toContain('accessory');
  await page.getByRole('button', { name: '新增一级分类', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await dialog.getByPlaceholder('请输入，最多20个字符').fill('新增配件分类');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.find((item) => item.method === 'POST')?.payload).toMatchObject({
    scope: 'accessory',
    name: '新增配件分类',
  });
});

test('accessory-only permission hides the tab rail and falls back without requesting finished data', async ({
  page,
}) => {
  const requests = await setup(page, [`${prefix}.accessory.view`]);
  await page.goto('/store-category-management');
  await expect(page.getByText('配件一级', { exact: true })).toBeVisible();
  await expect(page.locator('.t-tabs__nav')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增一级分类' })).toHaveCount(0);
  await expect(page.getByText('编辑', { exact: true })).toHaveCount(0);
  expect(requests.filter((item) => item.method === 'GET').every((item) => item.scope === 'accessory')).toBe(true);
});

test('unscoped historical grants do not expose the module or request private categories', async ({ page }) => {
  const requests = await setup(page, [`${prefix}.view`, `${prefix}.move-up`]);
  await page.goto('/store-category-management');
  await expect(page).not.toHaveURL(/store-category-management$/);
  await expect(page.locator('.side-nav').getByText('门店分类管理', { exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test('edit without status permission preserves status and never grants sorting', async ({ page }) => {
  const requests = await setup(page, [`${prefix}.finished.edit`]);
  await page.goto('/store-category-management');
  await page.getByRole('row').filter({ hasText: '成品一级' }).getByText('编辑', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByRole('radio', { name: '启用', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: '停用', exact: true })).toBeDisabled();
  await dialog.getByPlaceholder('请输入，最多20个字符').fill('修改名称');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.find((item) => item.method === 'PUT')?.payload).toEqual({ name: '修改名称' });
  await expect(page.locator('[data-category-id]')).toHaveCount(0);
});
