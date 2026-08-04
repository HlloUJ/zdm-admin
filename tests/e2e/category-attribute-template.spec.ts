import { expect, test, type Page, type Route } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

const apiOk = (data: unknown) => ({ code: 0, message: 'ok', data });
const fulfillJson = (route: Route, data: unknown) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(apiOk(data)),
  });

async function installCategoryAttributeMocks(page: Page) {
  await page.route('**/api/admin/product-categories', (route) =>
    fulfillJson(route, [
      { id: 1, scope: 'finished', name: '成品现货', status: 'enabled', createdAt: '2026-08-01T09:00:00' },
      {
        id: 2,
        parentId: 1,
        scope: 'finished',
        name: '茶几',
        status: 'enabled',
        createdAt: '2026-08-02T09:00:00',
      },
      {
        id: 3,
        parentId: 2,
        scope: 'finished',
        name: '岩板茶几',
        status: 'enabled',
        createdAt: '2026-08-03T09:00:00',
      },
      {
        id: 4,
        parentId: 2,
        scope: 'finished',
        name: '停用茶几',
        status: 'disabled',
        createdAt: '2026-08-04T09:00:00',
      },
      {
        id: 5,
        parentId: 2,
        scope: 'finished',
        name: '实木茶几',
        status: 'enabled',
        createdAt: '2026-08-02T10:00:00',
      },
      {
        id: 6,
        parentId: 1,
        scope: 'finished',
        name: '停用父级',
        status: 'disabled',
        createdAt: '2026-08-05T09:00:00',
      },
      {
        id: 7,
        parentId: 6,
        scope: 'finished',
        name: '隐藏子类',
        status: 'enabled',
        createdAt: '2026-08-06T09:00:00',
      },
    ]),
  );
  await page.route('**/api/admin/product-attributes', (route) =>
    fulfillJson(route, [{ id: 1, scope: 'shared', name: '材质', valueType: 'select', status: 'enabled' }]),
  );
  await page.route('**/api/admin/category-attributes', (route) =>
    fulfillJson(route, [
      {
        id: 1,
        categoryId: 3,
        attributeId: 1,
        requiredFlag: true,
        skuFlag: false,
        sortOrder: 1,
        status: 'enabled',
        createdByName: '韩健',
        createdAt: '2026-08-04T09:30:00',
      },
    ]),
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
  await installAdminApiMocks(page);
  await installCategoryAttributeMocks(page);
});

test('hides inactive categories and selects an enabled leaf beside the template list', async ({ page }) => {
  await page.goto('/category-attribute-template');

  const main = page.getByRole('main');
  await expect(main.locator('.zdm-admin-list-layout')).toHaveCount(1);
  await expect(main.locator('.zdm-admin-list-layout__filters')).toHaveCount(0);
  await expect(main.getByText('当前分类：')).toHaveCount(0);
  await expect(main.getByRole('button', { name: '切换分类' })).toHaveCount(0);

  const categoryPanel = main.locator('.category-panel');
  const templatePanel = main.locator('.template-panel');
  await expect(categoryPanel.getByText('商品分类', { exact: true })).toBeVisible();
  await expect(categoryPanel.locator('.category-node-parent')).toHaveCount(2);
  await expect(categoryPanel.getByRole('button', { name: '岩板茶几', exact: true })).toBeVisible();
  await expect(categoryPanel.getByText('停用茶几', { exact: true })).toHaveCount(0);
  await expect(categoryPanel.getByText('停用父级', { exact: true })).toHaveCount(0);
  await expect(categoryPanel.getByText('隐藏子类', { exact: true })).toHaveCount(0);
  const leafNodes = categoryPanel.locator('.category-node-leaf');
  await expect(leafNodes).toHaveCount(2);
  await expect(leafNodes.nth(0)).toHaveText('岩板茶几');
  await expect(leafNodes.nth(1)).toHaveText('实木茶几');
  await expect(categoryPanel.locator('.category-node-leaf.active')).toHaveCount(0);
  await expect(main.locator('tbody tr').filter({ hasText: '材质' })).toHaveCount(0);
  await expect(main.getByRole('button', { name: '绑定属性' })).toBeDisabled();

  const positions = await main.locator('.category-template-layout').evaluate((layout) => {
    const category = layout.querySelector<HTMLElement>('.category-panel')?.getBoundingClientRect();
    const template = layout.querySelector<HTMLElement>('.template-panel')?.getBoundingClientRect();
    return category && template ? { categoryRight: category.right, templateLeft: template.left } : null;
  });
  expect(positions).not.toBeNull();
  expect(positions!.categoryRight).toBeLessThanOrEqual(positions!.templateLeft);

  const typography = await categoryPanel.locator('.category-name').evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return `${style.fontFamily}|${style.fontSize}|${style.fontWeight}|${style.lineHeight}`;
    }),
  );
  expect(new Set(typography).size).toBe(1);

  await categoryPanel.getByRole('button', { name: '岩板茶几', exact: true }).click();

  await expect(categoryPanel.getByRole('button', { name: '岩板茶几', exact: true })).toHaveClass(/active/);
  await expect(templatePanel.getByText('成品现货 > 茶几 > 岩板茶几', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: '绑定属性' })).toBeEnabled();

  const headers = main.getByRole('columnheader');
  await expect(headers.nth(5)).toContainText('状态');
  await expect(headers.nth(6)).toContainText('创建人');
  await expect(headers.nth(7)).toContainText('创建时间');
  await expect(main.locator('tbody tr').filter({ hasText: '材质' }).first()).toContainText('韩健');

  await expect(templatePanel.locator('.zdm-admin-pagination')).toBeVisible();
});
