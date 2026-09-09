import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

async function setup(page: Page, permissions = ['all']) {
  await page.addInitScript((permissions) => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        name: '测试人员',
        roles: permissions.includes('all') ? ['SUPER_ADMIN'] : [],
        permissions,
        dataPermission: 'all',
      }),
    );
  }, permissions);
  await installAdminApiMocks(page);
  const attribute = {
    attributeId: 10,
    name: '颜色',
    scope: 'shared',
    valueType: 'select',
    attributeRole: 'sales',
    requiredFlag: true,
    sortOrder: 1,
    options: [{ id: 100, value: '白色', code: 'white' }],
  };
  const versions: Record<string, unknown>[] = [
    {
      id: 1,
      categoryId: 3,
      versionNo: 1,
      state: 'published',
      revision: 2,
      content: [attribute],
      createdByName: '测试人员',
      publishedByName: '测试人员',
      publishedAt: '2026-09-08T09:00:00+08:00',
      changeNote: '初始版本',
    },
    {
      id: 2,
      categoryId: 3,
      versionNo: null,
      state: 'draft',
      revision: 0,
      content: [structuredClone(attribute)],
      createdByName: '测试人员',
      changeNote: '',
    },
  ];
  await page.route('**/api/admin/template-versions**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/admin/template-versions', '');
    const method = route.request().method();
    const body = method === 'GET' || method === 'DELETE' ? {} : route.request().postDataJSON();
    let data: unknown;
    if (path === '/categories')
      data = [
        {
          id: url.searchParams.get('scope') === 'finished' ? 3 : 4,
          name: url.searchParams.get('scope') === 'finished' ? '岩板餐桌' : '桌腿',
          scope: url.searchParams.get('scope'),
          status: 'enabled',
        },
      ];
    else if (path === '/attribute-options')
      data = [{ id: 11, name: '尺寸', scope: 'shared', valueType: 'text', status: 'enabled' }];
    else if (path === '/value-options')
      data = [
        { id: 100, value: '白色', code: 'white' },
        { id: 101, value: '黑色', code: 'black' },
      ];
    else if (path === '' && method === 'GET')
      data = versions.filter((v) => v.categoryId === Number(url.searchParams.get('categoryId')));
    else if (path === '' && method === 'POST') {
      data = {
        id: versions.length + 1,
        ...body,
        versionNo: null,
        state: 'draft',
        revision: 0,
        content: [],
        createdByName: '测试人员',
        changeNote: '',
      };
      versions.push(data as Record<string, unknown>);
    } else {
      const id = Number(path.split('/')[1]);
      const version = versions.find((v) => v.id === id)!;
      if (path.endsWith('/display-order')) {
        const previous = version.content as Array<{ attributeId: number; sortOrder: number }>;
        version.content = body.attributeIds.map((id: number, index: number) => ({
          ...previous.find((row) => row.attributeId === id),
          sortOrder: index + 1,
        }));
        version.revision = Number(version.revision) + 1;
      } else if (method === 'PUT') Object.assign(version, body, { revision: Number(version.revision) + 1 });
      if (path.endsWith('/publish'))
        Object.assign(version, {
          state: 'published',
          versionNo: versions.filter((v) => v.categoryId === version.categoryId && v.state === 'published').length + 1,
          revision: Number(version.revision) + 1,
          publishedByName: '测试人员',
          publishedAt: '2026-09-08T10:00:00',
        });
      if (method === 'DELETE') versions.splice(versions.indexOf(version), 1);
      data = method === 'DELETE' ? true : version;
    }
    await route.fulfill({ json: { code: 0, message: 'ok', data } });
  });
  return versions;
}

test('tabs retain automatically saved drafts', async ({ page }) => {
  const versions = await setup(page);
  await page.goto('/category-attribute-template');
  const continueDraft = page.getByRole('button', { name: '继续编辑草稿', exact: true });
  await page.waitForLoadState('networkidle');
  if (await continueDraft.isVisible()) await continueDraft.click();
  await expect(page.getByText('成品现货模板', { exact: true })).toBeVisible();
  await expect(page.getByText('配件模板', { exact: true })).toBeVisible();
  await expect(page.locator('.exit-edit')).toHaveText('草稿箱');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
  await page.locator('.attribute-table .required-switch').first().click();
  await page.getByText('配件模板', { exact: true }).click();
  await expect(page.locator('.category-content .t-tree__label').filter({ hasText: '桌腿' })).toBeVisible();
  await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
  expect((versions.find((v) => v.id === 2)?.content as Record<string, unknown>[])[0]?.requiredFlag).toBe(false);
  await page.getByText('成品现货模板', { exact: true }).click();
  await expect(page.locator('.attribute-table .required-switch').first()).not.toHaveClass(/t-is-checked/);
  await page.locator('.exit-edit').click();
  await expect(page.locator('.exit-edit')).toHaveCount(0);
  await page.getByRole('button', { name: '继续编辑草稿', exact: true }).click();
  await expect(page.locator('.attribute-table .required-switch').first()).not.toHaveClass(/t-is-checked/);
  await expect(page.getByText('已保存“草稿”', { exact: true })).toBeVisible();
  expect(versions.find((v) => v.id === 2)?.versionNo).toBeNull();
  expect((versions.find((v) => v.id === 2)?.content as Record<string, unknown>[])[0]?.requiredFlag).toBe(false);
  await page.getByText('配件模板', { exact: true }).click();
  await expect(page.locator('.category-content .t-tree__label').filter({ hasText: '桌腿' })).toBeVisible();
  await expect(page.locator('.version-panel .t-tabs')).toHaveCount(0);
});

test('published snapshots stay read only without inner template tabs', async ({ page }) => {
  await setup(page);
  await page.goto('/category-attribute-template');
  await expect(page.locator('.attribute-table')).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.locator('.version-panel .t-tabs')).toHaveCount(0);
  await expect(page.getByText('标准属性构建规格', { exact: true })).toHaveCount(0);
});

test('only an authorized scope is visible and cannot create versions', async ({ page }) => {
  await setup(page, ['admin.product-data-center.category-attribute-template.accessory.attributes.view']);
  await page.goto('/category-attribute-template');
  const continueDraft = page.getByRole('button', { name: '继续编辑草稿', exact: true });
  await page.waitForLoadState('networkidle');
  if (await continueDraft.isVisible()) await continueDraft.click();
  await expect(page.locator('.category-content .t-tree__label').filter({ hasText: '桌腿' })).toBeVisible();
  await expect(page.getByRole('main').locator('.t-tabs__nav-item')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '创建新版本草稿', exact: true })).toHaveCount(0);
});

test('attribute list paginates without dropping draft rows on save', async ({ page }) => {
  const versions = await setup(page);
  const draft = versions.find((version) => version.id === 2)!;
  const original = (draft.content as Record<string, unknown>[])[0]!;
  draft.content = Array.from({ length: 12 }, (_, index) => ({
    ...original,
    attributeId: 1000 + index,
    name: `分页属性${index + 1}`,
    sortOrder: index + 1,
  }));
  await page.goto('/category-attribute-template');
  const continueDraft = page.getByRole('button', { name: '继续编辑草稿', exact: true });
  await page.waitForLoadState('networkidle');
  if (await continueDraft.isVisible()) await continueDraft.click();
  const list = page.locator('.attribute-table');
  await expect(list.locator('tbody tr')).toHaveCount(10);
  await expect(list.locator('tbody tr').first().locator('td').nth(1)).toHaveText('1');
  await expect(list.getByText('分页属性11', { exact: true })).toHaveCount(0);
  await page.locator('.zdm-admin-pagination').getByText('2', { exact: true }).click();
  await expect(list.locator('tbody tr')).toHaveCount(2);
  await expect(list.locator('tbody tr').first().locator('td').nth(1)).toHaveText('11');
  await expect(list.getByText('分页属性11', { exact: true })).toBeVisible();
  await list.locator('tbody tr').first().locator('.required-switch').click();
  await expect(page.getByText('已保存“草稿”', { exact: true })).toBeVisible();
  const saved = draft.content as Record<string, unknown>[];
  expect(saved).toHaveLength(12);
  expect(saved[0]?.requiredFlag).toBe(true);
  expect(saved[10]?.requiredFlag).toBe(false);
});

test('category panel matches the content panel without growing from page scroll', async ({ page }) => {
  const versions = await setup(page);
  const draft = versions.find((version) => version.id === 2)!;
  const original = (draft.content as Record<string, unknown>[])[0]!;
  draft.content = Array.from({ length: 10 }, (_, index) => ({
    ...original,
    attributeId: 1000 + index,
    name: `属性${index + 1}`,
    sortOrder: index + 1,
  }));
  await page.setViewportSize({ width: 1393, height: 650 });
  await page.goto('/category-attribute-template');
  const continueDraft = page.getByRole('button', { name: '继续编辑草稿', exact: true });
  await page.waitForLoadState('networkidle');
  if (await continueDraft.isVisible()) await continueDraft.click();
  const panel = page.locator('.category-panel');
  await expect(page.locator('.attribute-table tbody tr')).toHaveCount(10);
  const initialHeight = (await panel.boundingBox())!.height;
  expect(initialHeight).toBe((await page.locator('.version-panel').boundingBox())!.height);
  await page.locator('.attribute-table tbody tr').last().scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.locator('.exit-edit').click();
  await expect
    .poll(
      async () => (await panel.boundingBox())!.height - (await page.locator('.version-panel').boundingBox())!.height,
    )
    .toBe(0);
  const switchedHeight = (await panel.boundingBox())!.height;
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => (await panel.boundingBox())!.height).toBe(switchedHeight);
});

test('add attributes paginates and retains selections across search and pages', async ({ page }) => {
  await setup(page);
  await page.route('**/attribute-options?**', (route) =>
    route.fulfill({
      json: {
        code: 0,
        message: 'ok',
        data: Array.from({ length: 12 }, (_, index) => ({
          id: 200 + index,
          name: `候选属性${index + 1}`,
          scope: 'shared',
          valueType: 'text',
          status: 'enabled',
        })),
      },
    }),
  );
  await page.goto('/category-attribute-template');
  const continueDraft = page.getByRole('button', { name: '继续编辑草稿', exact: true });
  await page.waitForLoadState('networkidle');
  if (await continueDraft.isVisible()) await continueDraft.click();
  await page.getByRole('button', { name: '添加属性', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByRole('columnheader', { name: '来源', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('columnheader', { name: '输入类型', exact: true })).toBeVisible();
  await expect(dialog.locator('tbody tr')).toHaveCount(10);
  const firstRow = dialog.locator('tbody tr').first();
  await firstRow.getByText('候选属性1', { exact: true }).click();
  await expect(firstRow.getByRole('checkbox')).toBeChecked();
  await firstRow.getByText('文本输入', { exact: true }).click();
  await expect(firstRow.getByRole('checkbox')).not.toBeChecked();
  await firstRow.locator('.t-checkbox').click();
  await expect(firstRow.getByRole('checkbox')).toBeChecked();
  await dialog.locator('.zdm-admin-pagination').getByText('2', { exact: true }).click();
  await expect(dialog.locator('tbody tr')).toHaveCount(2);
  await dialog.locator('tbody tr').first().locator('.t-checkbox').click();
  await dialog.getByPlaceholder('搜索属性名称').fill('候选属性12');
  await expect(dialog.locator('tbody tr')).toHaveCount(1);
  await expect(dialog.locator('tbody tr')).toContainText('文本输入');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.locator('.attribute-table')).toContainText('候选属性1');
  await expect(page.locator('.attribute-table')).toContainText('候选属性11');
});

test('publish highlights missing roles and dropdown options', async ({ page }) => {
  const versions = await setup(page);
  const draft = versions.find((version) => version.id === 2)!;
  const row = (draft.content as Record<string, unknown>[])[0]!;
  row.attributeRole = '';
  row.options = [];
  await page.goto('/category-attribute-template');
  const continueDraft = page.getByRole('button', { name: '继续编辑草稿', exact: true });
  await page.waitForLoadState('networkidle');
  if (await continueDraft.isVisible()) await continueDraft.click();
  const table = page.locator('.attribute-table');
  await expect(table.getByRole('columnheader', { name: '属性角色 *', exact: true })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: '选项值 *', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '发布新版本', exact: true }).click();
  await expect(page.getByText('请完善属性角色和选项值后发布', { exact: true })).toBeVisible();
  await expect(table.locator('.t-select .t-input')).toHaveClass(/t-is-error/);
  await expect(table.locator('.t-link--theme-danger').filter({ hasText: /^0$/ })).toBeVisible();
  await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
  await page.getByRole('button', { name: '添加属性', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await dialog.getByText('尺寸', { exact: true }).click();
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  const addedRole = table.locator('tbody tr').last().locator('.t-select .t-input');
  await expect(addedRole).not.toHaveClass(/t-is-error/);
  await page.getByRole('button', { name: '发布新版本', exact: true }).click();
  await expect(addedRole).toHaveClass(/t-is-error/);
});

test('option values support row selection and pagination without applying on cancel', async ({ page }) => {
  await setup(page);
  await page.route('**/value-options?**', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, value: `选项${i + 1}`, code: `code${i + 1}` })),
      },
    }),
  );
  await page.goto('/category-attribute-template');
  const continueDraft = page.getByRole('button', { name: '继续编辑草稿', exact: true });
  await page.waitForLoadState('networkidle');
  if (await continueDraft.isVisible()) await continueDraft.click();
  const link = page.locator('.attribute-table tbody tr').first().locator('.t-link').first();
  const originalCount = await link.innerText();
  await link.click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.locator('tbody tr')).toHaveCount(10);
  await dialog.locator('.zdm-admin-pagination').getByText('2', { exact: true }).click();
  await dialog.getByText('选项11', { exact: true }).click();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(link).toHaveText(originalCount);
  await link.click();
  await dialog.locator('.zdm-admin-pagination').getByText('2', { exact: true }).click();
  await dialog.getByText('选项11', { exact: true }).click();
  await dialog.getByPlaceholder('搜索选项值').fill('选项12');
  await expect(dialog.locator('tbody tr')).toHaveCount(1);
  await dialog.getByText('选项12', { exact: true }).click();
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(link).toHaveText(String(Number(originalCount) + 2));
});

test('exit edit waits for auto-save before returning to published view', async ({ page }) => {
  const versions = await setup(page);
  await page.goto('/category-attribute-template');
  const continueDraft = page.getByRole('button', { name: '继续编辑草稿', exact: true });
  await page.waitForLoadState('networkidle');
  if (await continueDraft.isVisible()) await continueDraft.click();
  await expect(page.locator('.exit-edit')).toHaveText('草稿箱');
  await expect(page.locator('.version-panel .t-tabs')).toHaveCount(0);
  await page.locator('.attribute-table .required-switch').first().click();
  await page.locator('.exit-edit').click();
  await expect(
    page.getByText('已发布版本仅可调整属性展示顺序，其他配置不可修改，如需调整配置，需创建新版本草稿，并发布新版本。'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '继续编辑草稿', exact: true }).click();
  await expect(page.locator('.attribute-table .required-switch').first()).not.toHaveClass(/t-is-checked/);
  expect((versions.find((v) => v.id === 2)!.content as Array<{ requiredFlag: boolean }>)[0]!.requiredFlag).toBe(false);
});

test('refresh opens published view rather than automatically editing the existing draft', async ({ page }) => {
  await setup(page);
  await page.goto('/category-attribute-template');
  await expect(page.getByRole('button', { name: '继续编辑草稿', exact: true })).toBeVisible();
  await expect(page.locator('.exit-edit')).toHaveCount(0);
  await page.getByRole('button', { name: '继续编辑草稿', exact: true }).click();
  await expect(page.locator('.exit-edit')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '继续编辑草稿', exact: true })).toBeVisible();
  await expect(page.locator('.exit-edit')).toHaveCount(0);
  await expect(
    page.getByText('已发布版本仅可调整属性展示顺序，其他配置不可修改，如需调整配置，需创建新版本草稿，并发布新版本。'),
  ).toBeVisible();
});

test('new attribute drafts start empty without a base version', async ({ page }) => {
  const versions = await setup(page);
  versions.splice(
    versions.findIndex((version) => version.id === 2),
    1,
  );
  await page.goto('/category-attribute-template');
  await page.getByRole('button', { name: '创建新版本草稿', exact: true }).click();
  await expect(page.locator('.exit-edit')).toHaveText('草稿箱');
  await expect(page.locator('.draft-version-info')).toHaveText('待发布版本 V2');
  const draft = versions.find((version) => version.state === 'draft')!;
  expect(draft.baseId).toBeUndefined();
  expect(draft.content).toEqual([]);
});

test('published metadata and history use creation labels and formatted publish time, hidden in draft', async ({
  browser,
}) => {
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' });
  const page = await context.newPage();
  await setup(page);
  await page.goto('/category-attribute-template');
  const metadata = page.locator('.template-metadata');
  await expect(metadata).toContainText('创建人');
  await expect(metadata).toContainText('创建时间');
  await expect(metadata).toContainText('2026/09/08 09:00');
  await page.getByRole('button', { name: '版本记录', exact: true }).click();
  const drawer = page.locator('.t-drawer');
  await expect(drawer.getByRole('columnheader', { name: '创建人', exact: true })).toBeVisible();
  await expect(drawer.getByRole('columnheader', { name: '创建时间', exact: true })).toBeVisible();
  await expect(drawer.getByRole('cell', { name: '2026/09/08 09:00', exact: true })).toBeVisible();
  await drawer.getByText('查看', { exact: true }).click();
  await page.getByRole('button', { name: '继续编辑草稿', exact: true }).click();
  await expect(metadata).toHaveCount(0);
  await context.close();
});

test('published option values show all rows without search pagination or footer actions', async ({ page }) => {
  const versions = await setup(page);
  const options = Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, value: `只读选项${i + 1}`, code: `${i + 1}` }));
  (versions[0]!.content as Array<{ options: typeof options }>)[0]!.options = options;
  await page.goto('/category-attribute-template');
  await page.locator('.t-table__body').getByText('12', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('只读选项12', { exact: true })).toBeVisible();
  await expect(dialog.getByPlaceholder('搜索选项值')).toHaveCount(0);
  await expect(dialog.locator('.t-pagination')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '提交', exact: true })).toHaveCount(0);
});

test('attribute list and draft show serial numbers and support dragging', async ({ page }) => {
  await setup(page);
  await page.goto('/category-attribute-template');
  const table = page.locator('.attribute-table');
  await expect(table.getByRole('columnheader', { name: '序号', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑草稿', exact: true }).click();
  await expect(table.getByRole('columnheader', { name: '序号', exact: true })).toBeVisible();
  await expect(table.locator('.t-icon-move')).toBeVisible();
});

test('published drag order saves automatically and survives refresh', async ({ page }) => {
  const versions = await setup(page);
  const version = versions[0]!;
  const original = (version.content as Array<Record<string, unknown>>)[0]!;
  version.content = Array.from({ length: 12 }, (_, i) => ({
    ...original,
    attributeId: 1000 + i,
    name: `拖拽属性${i + 1}`,
    sortOrder: i + 1,
  }));
  await page.goto('/category-attribute-template');
  await page.locator('.zdm-admin-pagination').getByText('2', { exact: true }).click();
  const handles = page.locator('.attribute-table .t-icon-move');
  await handles.first().dragTo(handles.nth(1), { targetPosition: { x: 8, y: 13 } });
  await expect(page.getByText('已调整“字段显示顺序”', { exact: true })).toBeVisible();
  expect((version.content as Array<{ attributeId: number }>)[10]!.attributeId).toBe(1011);
  expect(version.versionNo).toBe(1);
  await page.reload();
  await page.locator('.zdm-admin-pagination').getByText('2', { exact: true }).click();
  await expect(page.locator('.attribute-table tbody tr').first()).toContainText('拖拽属性12');
  await expect(page.locator('.attribute-table tbody tr').first().locator('td').nth(1)).toHaveText('11');
});

test('failed display order save restores rows', async ({ page }) => {
  const versions = await setup(page);
  const original = (versions[0]!.content as Array<Record<string, unknown>>)[0]!;
  versions[0]!.content = [original, { ...original, attributeId: 11, name: '第二属性', sortOrder: 2 }];
  await page.route('**/api/admin/template-versions/*/display-order', (route) =>
    route.fulfill({ status: 400, json: { code: 400, message: '排序保存失败' } }),
  );
  await page.goto('/category-attribute-template');
  const handles = page.locator('.attribute-table .t-icon-move');
  await handles.first().dragTo(handles.nth(1), { targetPosition: { x: 8, y: 13 } });
  await expect(page.getByText('调整“字段显示顺序”失败：排序保存失败', { exact: true })).toBeVisible();
  await expect(page.locator('.attribute-table tbody tr').first()).toContainText('颜色');
});

test('view-only users cannot drag published attributes', async ({ page }) => {
  await setup(page, ['admin.product-data-center.category-attribute-template.finished.attributes.view']);
  await page.goto('/category-attribute-template');
  await expect(page.locator('.attribute-table').getByText('颜色', { exact: true })).toBeVisible();
  await expect(page.locator('.attribute-table .t-icon-move')).toHaveCount(0);
});

test('auto-save serializes rapid changes and publish waits for the latest revision', async ({ page }) => {
  const versions = await setup(page);
  const revisions: number[] = [];
  let releaseFirst!: () => void;
  const firstHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route('**/api/admin/template-versions/2', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    revisions.push(route.request().postDataJSON().revision);
    if (revisions.length === 1) await firstHeld;
    await route.fallback();
  });
  await page.goto('/category-attribute-template');
  await page.getByRole('button', { name: '继续编辑草稿', exact: true }).click();
  const toggle = page.locator('.attribute-table .required-switch').first();
  await toggle.click();
  await expect.poll(() => revisions.length).toBe(1);
  await toggle.click();
  await page.getByRole('button', { name: '发布新版本', exact: true }).click();
  await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
  releaseFirst();
  await expect(page.locator('.t-dialog:visible')).toBeVisible();
  expect(revisions).toEqual([0, 1]);
  const draft = versions.find((v) => v.id === 2)!;
  expect((draft.content as Array<{ requiredFlag: boolean }>)[0]!.requiredFlag).toBe(true);
  await page.locator('.t-dialog:visible').getByRole('button', { name: '确认发布', exact: true }).click();
  await expect(page.getByText('已发布“新版本”', { exact: true })).toBeVisible();
  expect(draft.revision).toBe(3);
});

test('auto-save failure preserves edits and navigation retries saving before refresh', async ({ page }) => {
  const versions = await setup(page);
  let fail = true;
  await page.route('**/api/admin/template-versions/2', (route) => {
    if (route.request().method() === 'PUT' && fail)
      return route.fulfill({ status: 500, json: { code: 500, message: '暂时无法保存' } });
    return route.fallback();
  });
  await page.goto('/category-attribute-template');
  await page.getByRole('button', { name: '继续编辑草稿', exact: true }).click();
  await page.locator('.attribute-table .required-switch').first().click();
  await expect(page.getByText('保存“草稿”失败：暂时无法保存', { exact: true })).toBeVisible();
  await expect(page.locator('.attribute-table .required-switch').first()).not.toHaveClass(/t-is-checked/);
  expect((versions[1]!.content as Array<{ requiredFlag: boolean }>)[0]!.requiredFlag).toBe(true);
  fail = false;
  await page.locator('.exit-edit').click();
  await expect(page.getByText('已保存“草稿”', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '继续编辑草稿', exact: true }).click();
  await expect(page.locator('.attribute-table .required-switch').first()).not.toHaveClass(/t-is-checked/);
  await expect(page.getByText('尚未保存', { exact: true })).toHaveCount(0);
  await expect(page.locator('.draft-save-status')).toHaveCount(0);
  await expect(page.locator('.draft-status').getByText('已保存', { exact: true })).toHaveCount(0);
  const status = await page.locator('.draft-status').boundingBox();
  const add = await page.getByRole('button', { name: '添加属性', exact: true }).boundingBox();
  const publish = await page.getByRole('button', { name: '发布新版本', exact: true }).boundingBox();
  expect(status!.x).toBeLessThan(add!.x);
  expect(add!.x).toBeLessThan(publish!.x);
  await expect(page.locator('.attribute-summary')).toHaveCount(0);
});

test('history view closes the drawer and shows the chosen version metadata and attributes', async ({ page }) => {
  const versions = await setup(page);
  const latest = structuredClone(versions[0]!);
  latest.id = 3;
  latest.versionNo = 2;
  latest.publishedByName = '新版创建人';
  latest.publishedAt = '2026-09-09T11:00:00+08:00';
  latest.content = [];
  versions.unshift(latest);
  await page.goto('/category-attribute-template');
  await expect(page.locator('.template-metadata')).toContainText('当前版本 V2');
  await page.getByRole('button', { name: '版本记录', exact: true }).click();
  const drawer = page.locator('.t-drawer:visible');
  await drawer
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'V1', exact: true }) })
    .getByText('查看', { exact: true })
    .click();
  await expect(drawer).not.toHaveClass(/t-drawer--open/);
  await expect(page.locator('.template-metadata')).toContainText('历史版本 V1');
  await expect(page.locator('.template-metadata')).toContainText('2026/09/08 09:00');
  await expect(page.locator('.template-metadata')).not.toContainText('新版创建人');
  await expect(page.locator('.attribute-table').getByText('颜色', { exact: true })).toBeVisible();
});

test('specification switches enforce a template-wide limit and persist with the attribute draft', async ({ page }) => {
  const versions = await setup(page);
  const draft = versions.find((version) => version.id === 2)!;
  const original = (draft.content as Record<string, unknown>[])[0]!;
  draft.content = Array.from({ length: 12 }, (_, index) => ({
    ...original,
    attributeId: 1000 + index,
    name: `构建测试${index + 1}`,
    attributeRole: index === 4 ? 'product' : index === 5 ? '' : 'sales',
    skuFlag: index < 4,
    sortOrder: index + 1,
  }));
  await page.goto('/category-attribute-template');
  await page.getByRole('button', { name: '继续编辑草稿', exact: true }).click();
  const table = page.locator('.attribute-table');
  const headers = await table.locator('thead th').allTextContents();
  const specificationColumn = headers.findIndex((text) => text.includes('构建规格'));
  expect(headers.findIndex((text) => text.includes('构建规格'))).toBe(
    headers.findIndex((text) => text.includes('属性角色')) + 1,
  );
  await expect(table.locator('tbody tr').nth(4).locator('td').nth(specificationColumn)).toHaveText('-');
  await expect(table.locator('tbody tr').nth(5).locator('td').nth(specificationColumn)).toHaveText('-');
  const seventh = table.locator('tbody tr').nth(6).locator('.specification-control');
  await expect(seventh.locator('.t-switch')).toHaveClass(/t-is-disabled/);
  await seventh.click();
  await expect(page.getByText('最多选择4个属性构建规格', { exact: true })).toBeVisible();
  expect((draft.content as Record<string, unknown>[]).filter((row) => row.skuFlag)).toHaveLength(4);
  await table.locator('.specification-control .t-switch').first().click();
  await expect(seventh.locator('.t-switch')).not.toHaveClass(/t-is-disabled/);
  await page.locator('.zdm-admin-pagination').getByText('2', { exact: true }).click();
  await table.locator('.specification-control .t-switch').last().click();
  await expect.poll(() => (draft.content as Record<string, unknown>[])[11]?.skuFlag).toBe(true);
  await expect(table.locator('.specification-control .t-switch').first()).toHaveClass(/t-is-disabled/);
  await page.locator('.zdm-admin-pagination').getByText('1', { exact: true }).click();
  const secondRole = table.locator('tbody tr').nth(1).locator('.t-select');
  await secondRole.click();
  await page.locator('.t-select__list:visible').getByText('商品属性', { exact: true }).click();
  await expect.poll(() => (draft.content as Record<string, unknown>[])[1]?.skuFlag).toBe(false);
  await expect(table.locator('tbody tr').nth(1).locator('td').nth(specificationColumn)).toHaveText('-');
  await expect.poll(() => (draft.content as Record<string, unknown>[]).filter((row) => row.skuFlag).length).toBe(3);
  await page.reload();
  await page.getByRole('button', { name: '继续编辑草稿', exact: true }).click();
  await expect(table.locator('.specification-control .t-switch').first()).not.toHaveClass(/t-is-checked/);
  await page.locator('.zdm-admin-pagination').getByText('2', { exact: true }).click();
  await expect(table.locator('.specification-control .t-switch').last()).toHaveClass(/t-is-checked/);
});

test('create permission includes continuing and all draft controls without history permission', async ({ page }) => {
  const prefix = 'admin.product-data-center.category-attribute-template.finished.attributes.';
  await setup(page, [prefix + 'view', prefix + 'create']);
  await page.goto('/category-attribute-template');
  await expect(page.getByRole('button', { name: '版本记录', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '继续编辑草稿', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加属性', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发布新版本', exact: true })).toBeVisible();
  await expect(page.getByText('移除', { exact: true })).toBeVisible();
  await expect(page.locator('.attribute-table .required-switch')).toBeVisible();
});

test('history permission gives version records but no draft access', async ({ page }) => {
  const prefix = 'admin.product-data-center.category-attribute-template.finished.attributes.';
  await setup(page, [prefix + 'view', prefix + 'history']);
  await page.goto('/category-attribute-template');
  await expect(page.getByRole('button', { name: '继续编辑草稿', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '版本记录', exact: true }).click();
  await expect(page.locator('.t-drawer')).toBeVisible();
  await expect(page.locator('.t-drawer').getByText('复制', { exact: true })).toHaveCount(0);
});

test('copy after view confirms before replacing a draft and opens the complete copied configuration', async ({
  page,
}) => {
  const versions = await setup(page);
  const original = structuredClone(versions[0]!);
  const draft = versions[1]!;
  draft.content = [];
  let copies = 0;
  await page.route('**/api/admin/template-versions/1/copy', async (route) => {
    copies++;
    expect(route.request().postDataJSON()).toEqual({ draftId: 2, revision: 0 });
    Object.assign(draft, { content: structuredClone(original.content), revision: 1 });
    await route.fulfill({ json: { code: 0, message: 'ok', data: draft } });
  });
  await page.goto('/category-attribute-template');
  await page.getByRole('button', { name: '版本记录', exact: true }).click();
  const links = page.locator('.t-drawer tbody .t-link');
  await expect(links).toHaveText(['查看', '复制']);
  await page.getByText('复制', { exact: true }).click();
  await expect(page.getByText('当前分类已有草稿，复制后将覆盖草稿中的全部配置，是否继续？')).toBeVisible();
  expect(copies).toBe(0);
  await page.getByRole('button', { name: '确认复制', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加属性', exact: true })).toBeVisible();
  await expect(page.locator('.attribute-table')).toContainText('颜色');
  await expect(page.locator('.t-drawer')).not.toHaveClass(/t-drawer--open/);
  expect(copies).toBe(1);
  expect(versions[0]).toEqual(original);
});

test('copy creates a draft immediately when none exists', async ({ page }) => {
  const versions = await setup(page);
  versions.splice(1, 1);
  await page.route('**/api/admin/template-versions/1/copy', async (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    const copied = { ...structuredClone(versions[0]), id: 3, versionNo: null, state: 'draft', revision: 1 };
    versions.push(copied);
    await route.fulfill({ json: { code: 0, message: 'ok', data: copied } });
  });
  await page.goto('/category-attribute-template');
  await page.getByRole('button', { name: '版本记录', exact: true }).click();
  await page.getByText('复制', { exact: true }).click();
  await expect(page.getByRole('button', { name: '添加属性', exact: true })).toBeVisible();
  await expect(page.locator('.attribute-table')).toContainText('颜色');
  await expect(page.getByRole('button', { name: '确认复制', exact: true })).toHaveCount(0);
});
