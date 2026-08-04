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
  const categoryAttributes = [
    {
      id: 1,
      categoryId: 3,
      attributeId: 1,
      requiredFlag: true,
      skuFlag: false,
      sortOrder: 1,
      status: 'enabled',
      publishStatus: 'unpublished',
      createdByName: '韩健',
      createdAt: '2026-08-04T09:30:00',
    },
  ];

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
    fulfillJson(route, [
      {
        id: 1,
        scope: 'shared',
        name: '材质',
        valueType: 'select',
        status: 'disabled',
        createdAt: '2026-08-04T09:00:00',
      },
      {
        id: 2,
        scope: 'shared',
        name: '颜色',
        valueType: 'select',
        status: 'enabled',
        createdAt: '2026-08-04T10:00:00',
      },
      {
        id: 3,
        scope: 'finished',
        name: '尺寸',
        valueType: 'number',
        status: 'enabled',
        createdAt: '2026-08-04T11:00:00',
      },
      {
        id: 4,
        scope: 'shared',
        name: '停用属性',
        valueType: 'text',
        status: 'disabled',
        createdAt: '2026-08-04T12:00:00',
      },
    ]),
  );
  await page.route('**/api/admin/category-attributes/batch', async (route) => {
    const payload = route.request().postDataJSON() as { categoryId: number; attributeIds: number[] };
    const created = payload.attributeIds.map((attributeId, index) => ({
      id: categoryAttributes.length + index + 1,
      categoryId: payload.categoryId,
      attributeId,
      requiredFlag: false,
      skuFlag: false,
      sortOrder: categoryAttributes.length + index + 1,
      status: 'disabled',
      publishStatus: 'unpublished',
      createdByName: '当前操作员',
      createdAt: '2026-08-04T10:00:00',
    }));
    categoryAttributes.push(...created);
    await fulfillJson(route, created);
  });
  await page.route(/\/api\/admin\/category-attributes\/\d+$/, async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    const index = categoryAttributes.findIndex((item) => item.id === id);
    if (route.request().method() === 'PUT' && index >= 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      Object.assign(categoryAttributes[index], route.request().postDataJSON());
      await fulfillJson(route, categoryAttributes[index]);
      return;
    }
    if (route.request().method() === 'DELETE' && index >= 0) {
      categoryAttributes.splice(index, 1);
      await fulfillJson(route, true);
      return;
    }
    await route.fallback();
  });
  await page.route(/\/api\/admin\/category-attributes\/\d+\/(publish|unpublish)$/, async (route) => {
    const urlParts = new URL(route.request().url()).pathname.split('/');
    const id = Number(urlParts.at(-2));
    const index = categoryAttributes.findIndex((item) => item.id === id);
    if (route.request().method() !== 'PUT' || index < 0) {
      await route.fallback();
      return;
    }
    categoryAttributes[index].publishStatus = urlParts.at(-1) === 'publish' ? 'published' : 'unpublished';
    await fulfillJson(route, categoryAttributes[index]);
  });
  await page.route('**/api/admin/category-attributes', (route) => fulfillJson(route, categoryAttributes));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
  await installAdminApiMocks(page);
  await installCategoryAttributeMocks(page);
});

test('selects the first leaf and manages bindings from the template list', async ({ page }) => {
  await page.goto('/category-attribute-template');

  const main = page.getByRole('main');
  await expect(main.locator('.zdm-admin-list-layout')).toHaveCount(1);
  await expect(main.locator('.zdm-admin-list-layout__filters')).toHaveCount(0);
  await expect(main.getByText('当前分类：')).toHaveCount(0);
  await expect(main.getByRole('button', { name: '切换分类' })).toHaveCount(0);

  const tabsWidth = await main.locator('.zdm-admin-list-layout__toolbar').evaluate((toolbar) => {
    const scope = toolbar.querySelector<HTMLElement>('.scope-controls')?.getBoundingClientRect();
    const tabs = toolbar.querySelector<HTMLElement>('.t-tabs')?.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    return scope && tabs ? { toolbar: toolbarRect.width, scope: scope.width, tabs: tabs.width } : null;
  });
  expect(tabsWidth).not.toBeNull();
  expect(tabsWidth!.scope).toBeGreaterThanOrEqual(tabsWidth!.toolbar - 1);
  expect(tabsWidth!.tabs).toBeGreaterThanOrEqual(tabsWidth!.scope - 1);

  const categoryPanel = main.locator('.category-panel');
  const templatePanel = main.locator('.template-panel');
  await expect(categoryPanel.locator('.panel-toolbar')).toHaveCount(0);
  await expect(templatePanel.locator('.panel-toolbar')).toHaveCount(0);
  await expect(categoryPanel.locator('.category-node-parent')).toHaveCount(2);
  await expect(categoryPanel.getByRole('button', { name: '岩板茶几', exact: true })).toBeVisible();
  await expect(categoryPanel.getByText('停用茶几', { exact: true })).toHaveCount(0);
  await expect(categoryPanel.getByText('停用父级', { exact: true })).toHaveCount(0);
  await expect(categoryPanel.getByText('隐藏子类', { exact: true })).toHaveCount(0);
  const leafNodes = categoryPanel.locator('.category-node-leaf');
  await expect(leafNodes).toHaveCount(2);
  await expect(leafNodes.nth(0)).toHaveText('岩板茶几');
  await expect(leafNodes.nth(1)).toHaveText('实木茶几');
  await expect(categoryPanel.locator('.category-node-leaf.active')).toHaveText('岩板茶几');
  const materialRow = main.locator('tbody tr').filter({ hasText: '材质' }).first();
  await expect(materialRow).toContainText('韩健');
  await expect(materialRow.getByText('停用', { exact: true })).toHaveCount(1);
  await expect(materialRow.getByText('未发布', { exact: true })).toHaveCount(1);
  await expect(materialRow.locator('.t-tag').filter({ hasText: '未发布' })).toHaveClass(/t-tag--danger/);
  const publishButton = materialRow.getByText('发布', { exact: true });
  await expect(publishButton).toBeVisible();
  await expect(publishButton).toHaveClass(/t-link--theme-success/);
  await expect(publishButton).toHaveClass(/t-link--hover-color/);
  await expect(publishButton).not.toHaveClass(/t-link--hover-underline/);
  await expect(materialRow.getByText('移除', { exact: true })).toBeVisible();
  await expect(materialRow.getByText('启用', { exact: true })).toHaveCount(0);
  await expect(materialRow.getByText('删除', { exact: true })).toHaveCount(0);
  const bindButton = templatePanel.locator('.template-toolbar').getByRole('button', { name: '绑定属性' });
  await expect(bindButton).toBeEnabled();

  const materialSwitches = materialRow.locator('.t-switch');
  await materialSwitches.nth(0).click();
  await expect(materialSwitches.nth(0)).toHaveClass(/t-is-loading/);
  await expect(materialSwitches.nth(1)).not.toHaveClass(/t-is-loading/);
  await expect(materialSwitches.nth(0)).not.toHaveClass(/t-is-loading/);

  const toolbarPosition = await templatePanel.evaluate((panel) => {
    const filters = panel.querySelector<HTMLElement>('.filter-row')?.getBoundingClientRect();
    const toolbar = panel.querySelector<HTMLElement>('.template-toolbar')?.getBoundingClientRect();
    return filters && toolbar ? { filterBottom: filters.bottom, toolbarTop: toolbar.top } : null;
  });
  expect(toolbarPosition).not.toBeNull();
  expect(toolbarPosition!.toolbarTop).toBeGreaterThanOrEqual(toolbarPosition!.filterBottom);

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

  const categorySearchInput = categoryPanel.getByPlaceholder('请输入分类名称');
  await categorySearchInput.fill('实木');
  await categoryPanel.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(categoryPanel.getByRole('button', { name: '实木茶几', exact: true })).toBeVisible();
  await expect(categoryPanel.getByRole('button', { name: '岩板茶几', exact: true })).toHaveCount(0);
  await expect(categoryPanel.locator('.category-node-parent')).toHaveCount(2);

  await categorySearchInput.hover();
  await categoryPanel.locator('.t-input__suffix-clear').click();
  await expect(categoryPanel.getByRole('button', { name: '岩板茶几', exact: true })).toBeVisible();
  await expect(categoryPanel.getByRole('button', { name: '实木茶几', exact: true })).toBeVisible();
  await expect(categoryPanel.getByText('停用茶几', { exact: true })).toHaveCount(0);

  await categoryPanel.getByRole('button', { name: '岩板茶几', exact: true }).click();

  await expect(categoryPanel.getByRole('button', { name: '岩板茶几', exact: true })).toHaveClass(/active/);
  await expect(bindButton).toBeEnabled();

  const headers = main.getByRole('columnheader');
  await expect(headers.nth(5)).toContainText('状态');
  await expect(headers.nth(6)).toContainText('发布');
  await expect(headers.nth(7)).toContainText('绑定人');
  await expect(headers.nth(8)).toContainText('绑定时间');
  await expect(headers.getByText('排序', { exact: true })).toHaveCount(0);
  const operationColumnWidth = await headers.nth(9).evaluate((header) => header.getBoundingClientRect().width);
  expect(operationColumnWidth).toBeGreaterThanOrEqual(136);
  expect(operationColumnWidth).toBeLessThanOrEqual(144);
  await expect(materialRow).toContainText('韩健');

  const publishRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/admin/category-attributes/1/publish') && request.method() === 'PUT',
  );
  await materialRow.getByText('发布', { exact: true }).click();
  await publishRequestPromise;
  await expect(materialRow.getByText('已发布', { exact: true })).toHaveCount(1);
  await expect(materialRow.locator('.t-tag').filter({ hasText: '已发布' })).toHaveClass(/t-tag--success/);
  const unpublishButton = materialRow.getByText('取消发布', { exact: true });
  await expect(unpublishButton).toBeVisible();
  await expect(unpublishButton).toHaveClass(/t-link--theme-warning/);
  await expect(unpublishButton).toHaveClass(/t-link--hover-color/);
  await expect(unpublishButton).not.toHaveClass(/t-link--hover-underline/);
  const operationButtonTops = await materialRow
    .locator('.table-actions .t-link')
    .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().top));
  expect(operationButtonTops).toHaveLength(2);
  expect(Math.max(...operationButtonTops) - Math.min(...operationButtonTops)).toBeLessThanOrEqual(1);

  const unpublishRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/admin/category-attributes/1/unpublish') && request.method() === 'PUT',
  );
  await materialRow.getByText('取消发布', { exact: true }).click();
  await unpublishRequestPromise;
  await expect(materialRow.getByText('未发布', { exact: true })).toHaveCount(1);
  await expect(materialRow.getByText('发布', { exact: true })).toBeVisible();

  await bindButton.click();
  const bindDialog = page.locator('.t-dialog').filter({ hasText: '商品分类：' });
  await expect(bindDialog).toBeVisible();
  const bindTable = bindDialog.locator('.bind-attribute-table');
  const bindRows = bindTable.locator('tbody tr');
  await expect(bindDialog.getByText('已选择 0 项', { exact: true })).toBeVisible();
  await expect(bindRows).toHaveCount(2);
  await expect(bindRows.nth(0)).toContainText('尺寸');
  await expect(bindRows.nth(1)).toContainText('颜色');
  await expect(bindRows.filter({ hasText: '材质' })).toHaveCount(0);
  await expect(bindRows.filter({ hasText: '停用属性' })).toHaveCount(0);
  await bindRows.nth(0).locator('.t-checkbox').click();
  await bindRows.nth(1).locator('.t-checkbox').click();
  await expect(bindDialog.getByText('已选择 2 项', { exact: true })).toBeVisible();
  const batchRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/admin/category-attributes/batch') && request.method() === 'POST',
  );
  await bindDialog.getByRole('button', { name: '提交', exact: true }).click();
  const batchRequest = await batchRequestPromise;
  expect(batchRequest.postDataJSON()).toEqual({ categoryId: 3, attributeIds: [3, 2] });
  await expect(bindDialog).toBeHidden();
  const colorRow = main.locator('tbody tr').filter({ hasText: '颜色' });
  const sizeRow = main.locator('tbody tr').filter({ hasText: '尺寸' });
  await expect(colorRow).toContainText('当前操作员');
  await expect(colorRow.getByText('启用', { exact: true })).toHaveCount(1);
  await expect(colorRow.getByText('未发布', { exact: true })).toHaveCount(1);
  await expect(sizeRow).toContainText('当前操作员');
  await expect(sizeRow.getByText('启用', { exact: true })).toHaveCount(1);
  await expect(sizeRow.getByText('未发布', { exact: true })).toHaveCount(1);

  const tableRows = main.locator('tbody tr');
  await expect(tableRows.nth(0)).toContainText('材质');
  await expect(tableRows.nth(1)).toContainText('尺寸');
  await expect(tableRows.nth(2)).toContainText('颜色');
  await expect(materialRow.locator('.t-table__handle-draggable .binding-drag-icon')).toBeVisible();
  await colorRow.locator('.t-table__handle-draggable').dragTo(sizeRow.locator('.t-table__handle-draggable'));
  await expect(tableRows.nth(1)).toContainText('颜色');
  await expect(tableRows.nth(2)).toContainText('尺寸');

  await bindButton.click();
  const updatedBindDialog = page.locator('.t-dialog').filter({ hasText: '商品分类：' });
  const updatedSizeRow = updatedBindDialog.locator('tbody tr').filter({ hasText: '尺寸' });
  await expect(updatedSizeRow.getByRole('checkbox')).toBeChecked();
  await updatedSizeRow.locator('.t-checkbox').click();
  const unbindRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/admin/category-attributes/2') && request.method() === 'DELETE',
  );
  await updatedBindDialog.getByRole('button', { name: '提交', exact: true }).click();
  await unbindRequestPromise;
  await expect(sizeRow).toHaveCount(0);

  const removeRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/admin/category-attributes/3') && request.method() === 'DELETE',
  );
  await colorRow.getByText('移除', { exact: true }).click();
  const removeDialog = page.locator('.t-dialog').filter({ hasText: '是否移除属性【颜色】？' });
  await expect(removeDialog).toBeVisible();
  await removeDialog.getByRole('button', { name: '确认', exact: true }).click();
  await removeRequestPromise;
  await expect(colorRow).toHaveCount(0);

  await expect(templatePanel.locator('.zdm-admin-pagination')).toBeVisible();
});

test('keeps template data visible while hiding ungranted binding operations', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 20,
        name: '模板查看员',
        phone: '15926620020',
        roles: ['CATEGORY_ATTRIBUTE_VIEWER'],
        permissions: ['admin.product-data-center.category-attribute-template.view'],
        dataPermission: 'self',
      }),
    );
  });

  await page.goto('/category-attribute-template');
  const main = page.getByRole('main');
  await expect(main.getByRole('button', { name: '岩板茶几', exact: true })).toHaveClass(/active/);

  const row = main.locator('tbody tr').filter({ hasText: '材质' }).first();
  await expect(row).toContainText('韩健');
  await expect(main.getByRole('button', { name: '绑定属性' })).toHaveCount(0);
  await expect(row.locator('.t-switch')).toHaveCount(2);
  await expect(row.locator('.t-switch').nth(0)).toHaveClass(/t-is-disabled/);
  await expect(row.locator('.t-switch').nth(1)).toHaveClass(/t-is-disabled/);
  await expect(row.locator('.t-table__handle-draggable')).toHaveCount(0);
  await expect(row.getByText('启用', { exact: true })).toHaveCount(0);
  await expect(row.getByText('停用', { exact: true })).toHaveCount(1);
  await expect(row.getByText('未发布', { exact: true })).toHaveCount(1);
  await expect(row.getByText('发布', { exact: true })).toHaveCount(0);
  await expect(row.getByText('取消发布', { exact: true })).toHaveCount(0);
  await expect(row.getByText('移除', { exact: true })).toHaveCount(0);
  await expect(row.getByText('删除', { exact: true })).toHaveCount(0);
  await expect(row.locator('.table-actions')).toHaveText('-');
});
