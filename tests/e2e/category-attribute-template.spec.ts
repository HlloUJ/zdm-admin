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
  const selectedValueIds = new Map<number, number[]>([[1, [101]]]);
  const categoryAttributes = [
    {
      id: 1,
      categoryId: 3,
      attributeId: 1,
      attributeRole: 'product' as string | null,
      requiredFlag: true,
      skuFlag: false,
      sortOrder: 1,
      status: 'enabled',
      publishStatus: 'unpublished',
      optionCount: 1,
      createdByAccountId: 1,
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
      attributeRole: null,
      requiredFlag: false,
      skuFlag: false,
      sortOrder: categoryAttributes.length + index + 1,
      status: 'disabled',
      publishStatus: 'unpublished',
      optionCount: 0,
      createdByAccountId: 1,
      createdByName: '当前操作员',
      createdAt: '2026-08-04T10:00:00',
    }));
    categoryAttributes.push(...created);
    await fulfillJson(route, created);
  });
  await page.route(/\/api\/admin\/category-attributes\/\d+\/values$/, async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-2));
    if (route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON() as { valueIds: number[] };
      selectedValueIds.set(id, payload.valueIds);
    }
    const selected = selectedValueIds.get(id) ?? [];
    await fulfillJson(route, [
      { id: 101, value: '岩板1', code: 'SLAB-1', status: 'enabled', selected: selected.includes(101) },
      { id: 102, value: '实木2', code: 'WOOD-1', status: 'enabled', selected: selected.includes(102) },
    ]);
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
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        name: '韩健',
        phone: '15926626945',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
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

  const publishFilter = templatePanel.locator('.t-form__item').filter({ hasText: '发布' });
  const filterItemTops = await templatePanel
    .locator('.filter-fields .t-form__item')
    .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
  expect(filterItemTops).toHaveLength(3);
  expect(Math.max(...filterItemTops) - Math.min(...filterItemTops)).toBeLessThanOrEqual(1);
  const keywordFilter = templatePanel.locator('.t-form__item').filter({ hasText: '属性名称' });
  const statusFilter = templatePanel.locator('.t-form__item').filter({ hasText: '状态' });
  const keywordFilterWidth = await keywordFilter.evaluate((item) => item.getBoundingClientRect().width);
  const statusFilterWidth = await statusFilter.evaluate((item) => item.getBoundingClientRect().width);
  const publishFilterWidth = await publishFilter.evaluate((item) => item.getBoundingClientRect().width);
  expect(keywordFilterWidth / statusFilterWidth).toBeCloseTo(1.6, 1);
  expect(publishFilterWidth).toBeCloseTo(statusFilterWidth, 0);
  const filterControlTops = await templatePanel
    .locator('.filter-row .t-form__item, .filter-row .t-button')
    .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
  expect(filterControlTops).toHaveLength(5);
  expect(Math.max(...filterControlTops) - Math.min(...filterControlTops)).toBeLessThanOrEqual(1);
  const filterSpacing = await templatePanel.locator('.filter-row').evaluate((row) => {
    const keywordLabel = row.querySelector<HTMLElement>('.t-form__item:nth-child(1) .t-form__label');
    const keywordInput = row.querySelector<HTMLElement>('.t-form__item:nth-child(1) .t-input');
    const publishItem = row.querySelector<HTMLElement>('.t-form__item:nth-child(3)');
    const queryButton = row.querySelector<HTMLElement>('.filter-actions .t-button');
    return keywordLabel && keywordInput && publishItem && queryButton
      ? {
          labelWidth: keywordLabel.getBoundingClientRect().width,
          labelRight: keywordLabel.getBoundingClientRect().right,
          inputLeft: keywordInput.getBoundingClientRect().left,
          publishRight: publishItem.getBoundingClientRect().right,
          queryLeft: queryButton.getBoundingClientRect().left,
        }
      : null;
  });
  expect(filterSpacing).not.toBeNull();
  expect(filterSpacing!.labelWidth).toBeGreaterThanOrEqual(72);
  expect(filterSpacing!.inputLeft).toBeGreaterThanOrEqual(filterSpacing!.labelRight);
  expect(filterSpacing!.queryLeft).toBeGreaterThan(filterSpacing!.publishRight);
  await publishFilter.locator('.t-select').click();
  await page.getByRole('listitem', { name: '已发布' }).click();
  await templatePanel.getByRole('button', { name: '查询', exact: true }).click();
  await expect(materialRow).toHaveCount(0);
  await publishFilter.locator('.t-select').click();
  await page.getByRole('listitem', { name: '未发布' }).click();
  await templatePanel.getByRole('button', { name: '查询', exact: true }).click();
  await expect(materialRow).toBeVisible();

  const materialSwitches = materialRow.locator('.t-switch');
  await materialSwitches.nth(1).click();
  await expect(materialSwitches.nth(1)).toHaveClass(/t-is-loading/);
  await expect(materialSwitches.nth(0)).not.toHaveClass(/t-is-loading/);
  await expect(materialSwitches.nth(1)).not.toHaveClass(/t-is-loading/);

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
  await expect(headers.nth(3)).toContainText('选项数');
  await expect(headers.nth(4)).toContainText('属性角色');
  await expect(headers.nth(5)).toContainText('参与SKU组合');
  await expect(headers.nth(6)).toContainText('必填');
  const skuHeaderLayout = await headers.nth(5).evaluate((header) => {
    const content = header.querySelector<HTMLElement>('.t-table__th-cell-inner') ?? header;
    const style = getComputedStyle(content);
    return {
      width: header.getBoundingClientRect().width,
      height: content.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });
  expect(skuHeaderLayout.width).toBeGreaterThanOrEqual(156);
  expect(skuHeaderLayout.height).toBeLessThanOrEqual(skuHeaderLayout.lineHeight + 2);
  await expect(headers.nth(7)).toContainText('状态');
  await expect(headers.nth(8)).toContainText('发布');
  await expect(headers.nth(9)).toContainText('绑定人');
  await expect(headers.nth(10)).toContainText('绑定时间');
  await expect(headers.getByText('排序', { exact: true })).toHaveCount(0);
  const operationColumnWidth = await headers.nth(11).evaluate((header) => header.getBoundingClientRect().width);
  expect(operationColumnWidth).toBeGreaterThanOrEqual(226);
  expect(operationColumnWidth).toBeLessThanOrEqual(234);
  await expect(materialRow).toContainText('韩健');
  await expect(materialRow.locator('td').nth(3)).toHaveText('1');
  const materialRoleInput = materialRow.locator('.attribute-role-select').getByRole('textbox');
  await expect(materialRoleInput).toHaveValue('商品属性');

  await materialRow.locator('td').nth(3).getByText('1', { exact: true }).click();
  const boundValueViewDialog = page.locator('.t-dialog').filter({ hasText: '已绑定选项值' });
  await expect(boundValueViewDialog).toBeVisible();
  await expect(boundValueViewDialog).toContainText('当前属性：材质');
  await expect(boundValueViewDialog).toContainText('已绑定 1 项');
  await expect(boundValueViewDialog.locator('tbody tr')).toHaveCount(1);
  await expect(boundValueViewDialog.locator('tbody tr')).toContainText('岩板1');
  await expect(boundValueViewDialog.getByRole('checkbox')).toHaveCount(0);
  const boundValueSearchInput = boundValueViewDialog.getByPlaceholder('请输入选项值');
  await boundValueSearchInput.fill('板1');
  await expect(boundValueViewDialog.locator('tbody tr')).toHaveCount(1);
  await boundValueSearchInput.fill('木');
  await expect(boundValueViewDialog.getByText('暂无已绑定选项值', { exact: true })).toBeVisible();
  await expect(boundValueViewDialog.getByText('岩板1', { exact: true })).toHaveCount(0);
  await boundValueSearchInput.fill('');
  const removeBoundValueRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/admin/category-attributes/1/values') && request.method() === 'PUT',
  );
  await boundValueViewDialog.getByText('移除', { exact: true }).click();
  const removeBoundValueRequest = await removeBoundValueRequestPromise;
  expect(removeBoundValueRequest.postDataJSON()).toEqual({ valueIds: [] });
  await expect(boundValueViewDialog.getByText('暂无已绑定选项值', { exact: true })).toBeVisible();
  await expect(materialRow.locator('td').nth(3)).toHaveText('0');
  await boundValueViewDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(boundValueViewDialog).toBeHidden();

  await materialRow.getByText('绑定选项值', { exact: true }).click();
  const valueBindingDialog = page.locator('.t-dialog').filter({ hasText: '当前属性：材质' });
  await expect(valueBindingDialog).toBeVisible();
  const valueRows = valueBindingDialog.locator('tbody tr');
  await expect(valueRows).toHaveCount(2);
  await expect(valueRows.filter({ hasText: '岩板' }).getByRole('checkbox')).not.toBeChecked();
  await expect(valueRows.filter({ hasText: '玻璃' })).toHaveCount(0);
  await expect(valueBindingDialog.getByRole('columnheader', { name: '选项编码' })).toHaveCount(0);
  const valueSearchInput = valueBindingDialog.getByPlaceholder('请输入选项值');
  await valueSearchInput.fill('木2');
  await expect(valueRows).toHaveCount(1);
  await expect(valueRows.filter({ hasText: '实木' })).toBeVisible();
  await valueRows.filter({ hasText: '实木' }).locator('.t-checkbox').click();
  await valueSearchInput.fill('');
  await expect(valueRows).toHaveCount(2);
  await expect(valueRows.filter({ hasText: '实木' }).getByRole('checkbox')).toBeChecked();
  await valueRows.filter({ hasText: '岩板' }).locator('.t-checkbox').click();
  await valueSearchInput.fill('1');
  await expect(valueRows).toHaveCount(1);
  await expect(valueRows.filter({ hasText: '岩板1' })).toBeVisible();
  await valueSearchInput.fill('');
  const valueBindingRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/admin/category-attributes/1/values') && request.method() === 'PUT',
  );
  await valueBindingDialog.getByRole('button', { name: '提交', exact: true }).click();
  const valueBindingRequest = await valueBindingRequestPromise;
  const valueBindingPayload = valueBindingRequest.postDataJSON() as { valueIds: number[] };
  expect(valueBindingPayload.valueIds).toHaveLength(2);
  expect(valueBindingPayload.valueIds).toEqual(expect.arrayContaining([101, 102]));
  await expect(valueBindingDialog).toBeHidden();
  await expect(materialRow.locator('td').nth(3)).toHaveText('2');

  let publishRequestCount = 0;
  await page.route('**/api/admin/category-attributes/1/publish', async (route) => {
    publishRequestCount += 1;
    await route.fallback();
  });
  const publishRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/admin/category-attributes/1/publish') && request.method() === 'PUT',
  );
  await materialRow.getByText('发布', { exact: true }).click();
  const publishDialog = page.locator('.t-dialog').filter({ hasText: '是否发布属性“材质”？' });
  await expect(publishDialog).toBeVisible();
  expect(publishRequestCount).toBe(0);
  await publishDialog.getByRole('button', { name: '确认发布', exact: true }).click();
  await publishRequestPromise;
  await expect(page.getByText('已发布“材质”', { exact: true })).toBeVisible();
  expect(publishRequestCount).toBe(1);
  await expect(materialRow.getByText('已发布', { exact: true })).toHaveCount(1);
  await expect(materialRow.locator('.t-tag').filter({ hasText: '已发布' })).toHaveClass(/t-tag--success/);
  await expect(materialRoleInput).toBeDisabled();
  await expect(materialRow.locator('.t-switch').nth(0)).toHaveClass(/t-is-disabled/);
  await expect(materialRow.locator('.t-switch').nth(1)).toHaveClass(/t-is-disabled/);
  const unpublishButton = materialRow.getByText('取消发布', { exact: true });
  await expect(unpublishButton).toBeVisible();
  await expect(unpublishButton).toHaveClass(/t-link--theme-warning/);
  await expect(unpublishButton).toHaveClass(/t-link--hover-color/);
  await expect(unpublishButton).not.toHaveClass(/t-link--hover-underline/);
  const operationButtonTops = await materialRow
    .locator('.table-actions .t-link')
    .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().top));
  expect(operationButtonTops).toHaveLength(3);
  expect(Math.max(...operationButtonTops) - Math.min(...operationButtonTops)).toBeLessThanOrEqual(1);

  let unpublishRequestCount = 0;
  await page.route('**/api/admin/category-attributes/1/unpublish', async (route) => {
    unpublishRequestCount += 1;
    await route.fallback();
  });
  const unpublishRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/admin/category-attributes/1/unpublish') && request.method() === 'PUT',
  );
  await materialRow.getByText('取消发布', { exact: true }).click();
  const unpublishDialog = page.locator('.t-dialog').filter({ hasText: '是否取消发布属性“材质”？' });
  await expect(unpublishDialog).toBeVisible();
  expect(unpublishRequestCount).toBe(0);
  await unpublishDialog.getByRole('button', { name: '确认取消发布', exact: true }).click();
  await unpublishRequestPromise;
  await expect(page.getByText('已取消发布“材质”', { exact: true })).toBeVisible();
  expect(unpublishRequestCount).toBe(1);
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
  await expect(sizeRow.locator('td').nth(3)).toHaveText('-');
  await expect(sizeRow.getByText('启用', { exact: true })).toHaveCount(1);
  await expect(sizeRow.getByText('未发布', { exact: true })).toHaveCount(1);
  const colorRoleSelect = colorRow.locator('.attribute-role-select');
  const sizeRoleSelect = sizeRow.locator('.attribute-role-select');
  const colorRoleInput = colorRoleSelect.getByRole('textbox');
  const sizeRoleInput = sizeRoleSelect.getByRole('textbox');
  const sizeSkuSwitch = sizeRow.locator('.t-switch').nth(0);
  await expect(colorRoleInput).toHaveValue('');
  await expect(sizeRoleInput).toHaveValue('');
  await expect(sizeSkuSwitch).toHaveClass(/t-is-disabled/);

  await colorRow.getByText('发布', { exact: true }).click();
  await expect(page.locator('.t-message').filter({ hasText: '请先选择属性角色' })).toBeVisible();

  const salesRoleResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/category-attributes/2') &&
      response.request().method() === 'PUT' &&
      response.request().postDataJSON().attributeRole === 'sales',
  );
  await sizeRoleSelect.click();
  await page.getByRole('listitem', { name: '销售属性', exact: true }).click();
  const salesRoleResponse = await salesRoleResponsePromise;
  expect(salesRoleResponse.request().postDataJSON()).toMatchObject({ attributeRole: 'sales', skuFlag: false });
  await expect(sizeRoleInput).toHaveValue('销售属性');
  await expect(sizeRoleSelect.locator('.t-loading')).toHaveCount(0);
  await sizeRoleSelect.hover();
  await expect(sizeRoleSelect.locator('.t-input__suffix-clear')).toHaveCount(0);
  await expect(sizeSkuSwitch).not.toHaveClass(/t-is-disabled/);

  const skuRequestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/admin/category-attributes/2') &&
      request.method() === 'PUT' &&
      request.postDataJSON().skuFlag === true,
  );
  await sizeSkuSwitch.click();
  await skuRequestPromise;
  await expect(sizeSkuSwitch).toHaveClass(/t-is-checked/);

  let roleChangeRequestCount = 0;
  await page.route('**/api/admin/category-attributes/2', async (route) => {
    if (route.request().method() === 'PUT') roleChangeRequestCount += 1;
    await route.fallback();
  });
  const productRoleRequestPromise = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/admin/category-attributes/2') &&
      request.method() === 'PUT' &&
      request.postDataJSON().attributeRole === 'product',
  );
  await sizeRoleSelect.click();
  await page.getByRole('listitem', { name: '商品属性', exact: true }).click();
  const roleChangeDialog = page.locator('.t-dialog').filter({ hasText: '切换为商品属性后将关闭“参与SKU组合”' });
  await expect(roleChangeDialog).toBeVisible();
  expect(roleChangeRequestCount).toBe(0);
  await roleChangeDialog.getByRole('button', { name: '确认修改', exact: true }).click();
  const productRoleRequest = await productRoleRequestPromise;
  expect(productRoleRequest.postDataJSON()).toMatchObject({ attributeRole: 'product', skuFlag: false });
  expect(roleChangeRequestCount).toBe(1);
  await expect(sizeRoleInput).toHaveValue('商品属性');
  await expect(sizeSkuSwitch).not.toHaveClass(/t-is-checked/);
  await expect(sizeSkuSwitch).toHaveClass(/t-is-disabled/);

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
  const removeDialog = page.locator('.t-dialog').filter({ hasText: '是否移除属性“颜色”？' });
  await expect(removeDialog).toBeVisible();
  await removeDialog.getByRole('button', { name: '确认移除', exact: true }).click();
  await removeRequestPromise;
  await expect(page.getByText('已移除“颜色”', { exact: true })).toBeVisible();
  await expect(colorRow).toHaveCount(0);

  await expect(templatePanel.locator('.zdm-admin-pagination')).toBeVisible();
});

test('每个类目最多只能开启4个SKU组合属性', async ({ page }) => {
  const productAttributes = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    scope: 'shared',
    name: `SKU属性${index + 1}`,
    valueType: 'select',
    status: 'enabled',
    createdAt: `2026-08-04T${String(index + 9).padStart(2, '0')}:00:00`,
  }));
  const categoryAttributes = productAttributes.map((attribute, index) => ({
    id: index + 1,
    categoryId: 3,
    attributeId: attribute.id,
    attributeRole: 'sales',
    requiredFlag: false,
    skuFlag: index < 4,
    sortOrder: index + 1,
    status: 'enabled',
    publishStatus: 'unpublished',
    createdByAccountId: 1,
    createdByName: '韩健',
    createdAt: '2026-08-04T09:30:00',
  }));
  let updateRequestCount = 0;

  await page.route('**/api/admin/product-attributes', (route) => fulfillJson(route, productAttributes));
  await page.route('**/api/admin/category-attributes', (route) => fulfillJson(route, categoryAttributes));
  await page.route(/\/api\/admin\/category-attributes\/\d+$/, async (route) => {
    if (route.request().method() === 'PUT') updateRequestCount += 1;
    await route.fallback();
  });

  await page.goto('/category-attribute-template');
  const fifthRow = page.getByRole('main').locator('tbody tr').filter({ hasText: 'SKU属性5' });
  await expect(fifthRow.locator('.t-switch').nth(0)).not.toHaveClass(/t-is-checked/);
  await fifthRow.locator('.t-switch').nth(0).click();
  await expect(page.locator('.t-message').filter({ hasText: '参与SKU组合的属性最多只能开启4个' })).toBeVisible();
  await expect(fifthRow.locator('.t-switch').nth(0)).not.toHaveClass(/t-is-checked/);
  expect(updateRequestCount).toBe(0);
});

test('标准选项属性未绑定选项值时禁止发布', async ({ page }) => {
  await page.route('**/api/admin/category-attributes/1/values', (route) =>
    fulfillJson(route, [
      { id: 101, value: '岩板', code: 'SLAB', status: 'enabled', selected: false },
      { id: 102, value: '实木', code: 'WOOD', status: 'enabled', selected: false },
    ]),
  );
  let publishRequestCount = 0;
  await page.route('**/api/admin/category-attributes/1/publish', async (route) => {
    publishRequestCount += 1;
    await route.fallback();
  });

  await page.goto('/category-attribute-template');
  const row = page.getByRole('main').locator('tbody tr').filter({ hasText: '材质' }).first();
  await row.getByText('发布', { exact: true }).click();

  await expect(page.locator('.t-message').filter({ hasText: '请先绑定选项值' })).toBeVisible();
  await expect(page.locator('.t-dialog').filter({ hasText: '是否发布属性“材质”？' })).toHaveCount(0);
  expect(publishRequestCount).toBe(0);
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
        permissions: ['admin.product-data-center.category-attribute-template.finished.view'],
        dataPermission: 'self',
      }),
    );
  });

  await page.goto('/category-attribute-template');
  const main = page.getByRole('main');
  await expect(main.locator('.scope-controls .t-tabs')).toHaveCount(0);
  await expect(main.getByRole('button', { name: '岩板茶几', exact: true })).toHaveClass(/active/);

  const row = main.locator('tbody tr').filter({ hasText: '材质' }).first();
  await expect(row).toContainText('韩健');
  await expect(main.getByRole('button', { name: '绑定属性' })).toHaveCount(0);
  await expect(row.locator('.t-switch')).toHaveCount(2);
  await expect(row.locator('.t-switch').nth(0)).toHaveClass(/t-is-disabled/);
  await expect(row.locator('.t-switch').nth(1)).toHaveClass(/t-is-disabled/);
  await expect(row.locator('.attribute-role-select').getByRole('textbox')).toBeDisabled();
  await expect(row.locator('.t-table__handle-draggable')).toHaveCount(0);
  await expect(row.getByText('启用', { exact: true })).toHaveCount(0);
  await expect(row.getByText('停用', { exact: true })).toHaveCount(1);
  await expect(row.getByText('未发布', { exact: true })).toHaveCount(1);
  await expect(row.getByText('发布', { exact: true })).toHaveCount(0);
  await expect(row.getByText('取消发布', { exact: true })).toHaveCount(0);
  await expect(row.getByText('移除', { exact: true })).toHaveCount(0);
  await expect(row.getByText('删除', { exact: true })).toHaveCount(0);
  await expect(row.getByText('绑定选项值', { exact: true })).toHaveCount(0);
  await expect(row.locator('.table-actions')).toHaveText('-');
});

test('enables only the granted category attribute field control', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 21,
        name: '模板属性角色管理员',
        phone: '15926620021',
        roles: ['CATEGORY_ATTRIBUTE_ROLE_EDITOR'],
        permissions: [
          'admin.product-data-center.category-attribute-template.finished.view',
          'admin.product-data-center.category-attribute-template.finished.attribute-role',
        ],
        dataPermission: 'self',
      }),
    );
  });

  await page.goto('/category-attribute-template');
  const row = page.getByRole('main').locator('tbody tr').filter({ hasText: '材质' }).first();
  await expect(row.locator('.attribute-role-select').getByRole('textbox')).toBeEnabled();
  await expect(row.locator('.t-switch').nth(0)).toHaveClass(/t-is-disabled/);
  await expect(row.locator('.t-switch').nth(1)).toHaveClass(/t-is-disabled/);
  await expect(row.getByText('绑定选项值', { exact: true })).toHaveCount(0);
});
