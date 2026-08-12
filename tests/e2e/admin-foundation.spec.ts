import { expect, test } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
  await installAdminApiMocks(page);
});

test('keeps foundation pagination spacing consistent inside list layouts', async ({ page }) => {
  await page.goto('/product-attribute');

  const styles = await page.locator('.zdm-admin-list-layout__pagination').evaluate((host) => {
    const pagination = host.querySelector<HTMLElement>('.zdm-admin-pagination');
    if (!pagination) return null;

    const hostStyle = getComputedStyle(host);
    const paginationStyle = getComputedStyle(pagination);
    return {
      hostMarginTop: hostStyle.marginTop,
      paginationDisplay: paginationStyle.display,
      paginationJustifyContent: paginationStyle.justifyContent,
      paginationMarginTop: paginationStyle.marginTop,
      paginationWidth: paginationStyle.width,
      hostWidth: getComputedStyle(host).width,
    };
  });

  expect(styles).toEqual({
    hostMarginTop: '16px',
    paginationDisplay: 'flex',
    paginationJustifyContent: 'flex-end',
    paginationMarginTop: '0px',
    paginationWidth: styles?.hostWidth,
    hostWidth: styles?.hostWidth,
  });
});

test('uses the official TDesign pagination controls on routed list pages', async ({ page }) => {
  const routes = [
    '/finished-stock-management',
    '/finished-stock-craft',
    '/employee-management',
    '/role-management',
    '/slab-management',
    '/supplier-management',
    '/tenant-management',
    '/tenant-store-management',
  ];

  for (const route of routes) {
    await page.goto(route);
    const pagination = page.locator('.zdm-admin-pagination .t-pagination');
    await expect(pagination).toBeVisible();
    await expect(page.locator('.custom-pagination')).toHaveCount(0);

    const controlHeight = await pagination
      .locator('.t-pagination__btn-next')
      .evaluate((control) => Math.round(control.getBoundingClientRect().height));
    expect(controlHeight).toBe(32);
  }
});

test('searches slabs by name, id, or code with the shared filter on every status tab', async ({ page }) => {
  await page.goto('/slab-management');
  const keywordInput = page.getByPlaceholder('大板名称/ID/编码', { exact: true });
  await expect(page.locator('.slab-keyword-filter')).toHaveCSS('width', '234px');
  const primaryLabels = await page.locator('.filter-primary-row .t-form__label').allTextContents();
  expect(primaryLabels.slice(-2)).toEqual(['等级：', '租户：']);
  const primaryGap = await page.locator('.filter-primary-row').evaluate((element) => {
    const styles = getComputedStyle(element);
    return { columnGap: styles.columnGap, rowGap: styles.rowGap };
  });
  expect(primaryGap.columnGap).toBe(primaryGap.rowGap);
  const keywordBox = await page.locator('.slab-keyword-filter').boundingBox();
  const storeBox = await page.locator('.store-filter').boundingBox();
  const searchBox = await page.getByRole('button', { name: '查询', exact: true }).boundingBox();
  expect(storeBox?.x).toBe(keywordBox?.x);
  expect(searchBox?.y).toBe(storeBox?.y);
  expect(searchBox?.x).toBeGreaterThan((storeBox?.x ?? 0) + (storeBox?.width ?? 0));

  for (const tabLabel of ['仓库中 1', '出售中', '已下架', '已售完', '回收站 2']) {
    await page.getByText(tabLabel, { exact: true }).click();
    await expect(keywordInput).toBeVisible();
  }

  await page.getByText('仓库中 1', { exact: true }).click();
  for (const keyword of ['雪花白大板', '6', 'SLAB-E2E-006']) {
    await keywordInput.fill(keyword);
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.getByRole('row', { name: /雪花白大板 06/ })).toBeVisible();
  }

  await page.getByText('回收站 2', { exact: true }).click();
  await keywordInput.fill('SLAB-E2E-008');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('row', { name: /回收站大板 08/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /回收站大板 07/ })).toHaveCount(0);
});

test('aligns tenant and reset on the right while distributing slab filters evenly', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/slab-management');

  const primaryItems = page.locator('.filter-primary-row .t-form__item');
  const itemBoxes = await primaryItems.evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }),
  );
  const gaps = itemBoxes.slice(1).map((box, index) => Math.round(box.left - itemBoxes[index].right));
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);

  const tenantBox = await page.locator('.tenant-filter').boundingBox();
  const resetBox = await page.locator('.reset-filter-button').boundingBox();
  expect(Math.round((tenantBox?.x ?? 0) + (tenantBox?.width ?? 0))).toBe(
    Math.round((resetBox?.x ?? 0) + (resetBox?.width ?? 0)),
  );
  await expect(page.locator('.store-filter')).toHaveCSS('width', '234px');
  await expect(page.locator('.slab-keyword-filter')).toHaveCSS('width', '234px');
});

test('orders the requested management lists by creation time descending', async ({ page }) => {
  const cases = [
    {
      path: '/slab-variety',
      endpoint: '**/api/admin/slab-varieties',
      newerName: '较新品种',
      records: [
        { id: 101, name: '较早品种', code: 'older-variety', status: 'enabled', createdAt: '2026-08-01T09:00:00' },
        { id: 102, name: '较新品种', code: 'newer-variety', status: 'enabled', createdAt: '2026-08-03T09:00:00' },
      ],
    },
    {
      path: '/finished-stock-craft',
      endpoint: '**/api/admin/crafts',
      newerName: '较新工艺',
      records: [
        { id: 201, name: '较早工艺', type: '边工艺', status: 'enabled', createdAt: '2026-08-01T09:00:00' },
        { id: 202, name: '较新工艺', type: '边工艺', status: 'enabled', createdAt: '2026-08-03T09:00:00' },
      ],
    },
    {
      path: '/employee-management',
      endpoint: '**/api/admin/employees',
      newerName: '较新员工',
      records: [
        {
          id: 301,
          name: '较早员工',
          gender: 'male',
          phone: '15900000301',
          status: 'enabled',
          roleIds: '2',
          dataPermission: 'all',
          createdAt: '2026-08-01T09:00:00',
        },
        {
          id: 302,
          name: '较新员工',
          gender: 'female',
          phone: '15900000302',
          status: 'enabled',
          roleIds: '2',
          dataPermission: 'all',
          createdAt: '2026-08-03T09:00:00',
        },
      ],
    },
    {
      path: '/role-management',
      endpoint: '**/api/admin/roles',
      newerName: '较新角色',
      records: [
        {
          id: 401,
          name: '较早角色',
          code: 'OLDER_ROLE',
          category: 'operation-platform',
          clientCode: 'admin',
          dataScope: 'all',
          status: 'enabled',
          functionPermissions: '',
          createdAt: '2026-08-01T09:00:00',
        },
        {
          id: 402,
          name: '较新角色',
          code: 'NEWER_ROLE',
          category: 'operation-platform',
          clientCode: 'admin',
          dataScope: 'all',
          status: 'enabled',
          functionPermissions: '',
          createdAt: '2026-08-03T09:00:00',
        },
      ],
    },
  ];

  for (const item of cases) {
    await page.unroute(item.endpoint);
    await page.route(item.endpoint, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'ok', data: item.records }),
      }),
    );

    await page.goto(item.path);
    await expect(page.getByRole('main').locator('tbody tr').first()).toContainText(item.newerName);
  }
});

test('opens tenant create, business and edit dialogs', async ({ page }) => {
  await page.goto('/tenant-management');
  const main = page.getByRole('main');

  await expect(main.getByText('租户管理').first()).toBeVisible();
  await expect(main.getByText('装点猫直营租户')).toBeVisible();

  await main.getByRole('button', { name: /新增/ }).click();
  const createDialog = page.locator('.t-dialog').filter({ hasText: '新增' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByText('租户姓名')).toBeVisible();
  await expect(createDialog.getByText('联系方式')).toBeVisible();
  await createDialog.getByRole('button', { name: '取消' }).click();
  await expect(createDialog).toBeHidden();

  const tenantRow = page.locator('tbody tr').filter({ hasText: '装点猫直营租户' }).first();
  await tenantRow.getByText('业务开通').click();
  const businessDialog = page.locator('.t-dialog').filter({ hasText: '业务开通' });
  await expect(businessDialog).toBeVisible();
  await expect(businessDialog.getByText('城市合伙人')).toBeVisible();
  await expect(businessDialog.getByText('大板供应商')).toBeVisible();
  await businessDialog.getByRole('button', { name: '取消' }).click();
  await expect(businessDialog).toBeHidden();

  await tenantRow.getByText('编辑').click();
  const editDialog = page.locator('.t-dialog').filter({ hasText: '编辑' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.locator('input').first()).toHaveValue('装点猫直营租户');
  await editDialog.getByRole('button', { name: '取消' }).click();
  await expect(editDialog).toBeHidden();
});

test('opens store create, level and edit dialogs', async ({ page }) => {
  await page.goto('/tenant-store-management');
  const main = page.getByRole('main');

  await expect(main.getByText('门店管理').first()).toBeVisible();
  await expect(main.getByText('杭州体验门店')).toBeVisible();
  const tableHeaders = main.locator('thead th');
  await expect(tableHeaders.nth(8)).toContainText('创建人');
  await expect(tableHeaders.nth(9)).toContainText('创建时间');
  await expect(page.locator('tbody tr').filter({ hasText: '杭州体验门店' }).first()).toContainText('韩健');

  await main.getByRole('button', { name: /新增/ }).click();
  const createDialog = page.locator('.t-dialog').filter({ hasText: '新增' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByText('选择租户')).toBeVisible();
  await expect(createDialog.getByText('店铺类型')).toBeVisible();
  await expect(createDialog.getByText('门店地址')).toBeVisible();
  await createDialog.getByRole('button', { name: '取消' }).click();
  await expect(createDialog).toBeHidden();

  const storeRow = page.locator('tbody tr').filter({ hasText: '杭州体验门店' }).first();
  await storeRow.locator('.level-cell').hover();
  await storeRow.getByLabel('快速编辑店铺级别').click();
  const levelDialog = page.locator('.t-dialog').filter({ hasText: '店铺级别' });
  await expect(levelDialog).toBeVisible();
  await expect(levelDialog.getByText('店铺级别').first()).toBeVisible();
  await levelDialog.getByRole('button', { name: '取消' }).click();
  await expect(levelDialog).toBeHidden();

  await storeRow.getByText('编辑').click();
  const editDialog = page.locator('.t-dialog').filter({ hasText: '编辑' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.locator('input').first()).toHaveValue('杭州体验门店');
  await editDialog.getByRole('button', { name: '取消' }).click();
  await expect(editDialog).toBeHidden();
});

test('opens supplier create and edit dialogs', async ({ page }) => {
  await page.goto('/supplier-management');
  const main = page.getByRole('main');

  await expect(main.getByText('供应商管理').first()).toBeVisible();
  await expect(main.getByText('装点猫大板供应商')).toBeVisible();

  await main.getByRole('button', { name: /新增/ }).click();
  const createDialog = page.locator('.t-dialog').filter({ hasText: '新增' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByText('供应商名称')).toBeVisible();
  await expect(createDialog.getByText('供应商类型')).toBeVisible();
  await expect(createDialog.getByText('联系电话')).toBeVisible();
  await createDialog.getByRole('button', { name: '取消' }).click();
  await expect(createDialog).toBeHidden();

  const supplierRow = page.locator('tbody tr').filter({ hasText: '装点猫大板供应商' }).first();
  await expect(supplierRow.getByText('韩健', { exact: true })).toBeVisible();
  await supplierRow.getByText('编辑').click();
  const editDialog = page.locator('.t-dialog').filter({ hasText: '编辑' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.locator('input').first()).toHaveValue('装点猫大板供应商');
  await editDialog.getByRole('button', { name: '取消' }).click();
  await expect(editDialog).toBeHidden();
});
